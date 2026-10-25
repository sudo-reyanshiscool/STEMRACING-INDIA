import { selectedRules } from '../technical';
import type { RaceHeat, RaceInput, RaceLane } from './index';
import { INDIA_TECHNICAL, summarise, type Inspection } from '../technical';

export const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
export const POINT_NAMES = [...ROUND_NAMES.slice(0, 5).map(n => `Eliminated · ${n}`), 'Runner-up', 'Winner', 'Not qualified'];
export interface ReactionScoring {
  podium: [number,number,number]; minimum: number; referenceMultiplier: number;
  falseStartPenalty: number; dnfPenalty: number; fastestCarBonus: number;
}
export const defaultReactionScoring = (): ReactionScoring => ({podium:[105,100,95],minimum:5,referenceMultiplier:1.2,falseStartPenalty:2.5,dnfPenalty:1,fastestCarBonus:10});
export function validReactionScoring(s: ReactionScoring): boolean {
  const point=(n: unknown,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max&&Math.abs(n*10-Math.round(n*10))<1e-8;
  return !!s && Array.isArray(s.podium)&&s.podium.length===3&&s.podium.every(p=>point(p,105))&&
    s.podium[0]>=s.podium[1]&&s.podium[1]>=s.podium[2]&&point(s.minimum,s.podium[2])&&
    typeof s.referenceMultiplier==='number'&&Number.isFinite(s.referenceMultiplier)&&s.referenceMultiplier>1&&s.referenceMultiplier<=10&&
    point(s.falseStartPenalty,105)&&point(s.dnfPenalty,105)&&point(s.fastestCarBonus,10);
}
export interface RacingSetup {
  scoring?: ReactionScoring;
  revision: number;
  /** Ranked seed order, frozen once a bracket heat exists. Empty until approved. */
  seeds: string[];
  reactionComplete: boolean;
  /** Six elimination stages, winner, non-qualifier. null means awaiting Chair confirmation. */
  points: Array<number | null>;
  version: string;
}
export const defaultRacingSetup = (): RacingSetup => ({ revision: 0, seeds: [], reactionComplete: false, points: [null, null, null, 85, 106, null, 135, 10], version: '' });
export type RacingSetupInput = Pick<RacingSetup, 'seeds' | 'reactionComplete' | 'points' | 'scoring'>;
export function validateSetup(s: RacingSetupInput): string | null {
  if(s.scoring!==undefined&&!validReactionScoring(s.scoring))return 'Check reaction points, penalties, reference multiplier and Fastest Car bonus.';
  if (!Array.isArray(s.seeds) || s.seeds.length > 64 || new Set(s.seeds).size !== s.seeds.length || s.seeds.some(id => typeof id !== 'string' || !id)) return 'Choose up to 64 different teams in seed order.';
  if (typeof s.reactionComplete !== 'boolean' || !Array.isArray(s.points) || s.points.length !== 8 || s.points.some(p => p !== null && (!Number.isFinite(p) || p < 0 || p > 135 || Math.round(p * 10) !== p * 10))) return 'Enter eight stage scores between 0 and 135, with at most one decimal place.';
  if (s.seeds.length && (!s.reactionComplete || s.seeds.length < 2)) return 'Complete reaction racing before approving at least two seeds.';
  return null;
}
export interface CarCheck { ready: boolean; performance: string[]; safety: string[]; additionMs: number }
export function carCheck(inspections: Inspection[], teamId: string, car: 'A' | 'B'): CarCheck {
  const i = inspections.find(i => i.teamId === teamId && i.car === car);
  if (!i || i.status !== 'submitted' || i.rulesetId !== INDIA_TECHNICAL.id) return { ready: false, performance: [], safety: [], additionMs: 0 };
  const s = summarise(selectedRules(INDIA_TECHNICAL.rules, i), i.measurements);
  const performance = s.perfFailures.map(r => r.article), safety = s.safetyFailures.map(r => r.article);
  return { ready: s.complete, performance, safety, additionMs: performance.length * 200 + safety.length * 300 };
}
export function teamCheck(inspections: Inspection[], teamId: string) {
  const a = carCheck(inspections, teamId, 'A'), b = carCheck(inspections, teamId, 'B');
  return { ready: a.ready && b.ready, disqualified: a.performance.length + a.safety.length + b.performance.length + b.safety.length > 0 };
}
export function adjustedTime(race: RaceInput, lane: RaceLane, inspections: Inspection[]): number | null {
  if (lane.status !== 'finished') return null;
  if (race.phase === 'reaction') return lane.totalMs;
  const c = carCheck(inspections, lane.teamId, lane.car);
  return c.ready ? lane.totalMs! + c.additionMs : null;
}
/** Standard seeded bracket: highest seeds meet last, with byes for unfilled seeds. */
export function seedPositions(size = 64): number[] {
  let out = [1, 2];
  while (out.length < size) { const next = out.length * 2 + 1; out = out.flatMap(n => [n, next - n]); }
  return out;
}
export interface BracketMatch {
  round: number; slot: number; team1: string | null; team2: string | null;
  resolved: boolean; winner: string | null; heat: RaceHeat | null; reason: string;
  disqualified: string[];
}
export function knockoutBracket(setup: RacingSetup, races: RaceHeat[], inspections: Inspection[]): BracketMatch[] {
  if (!setup.seeds.length) return [];
  const positions = seedPositions().map(n => setup.seeds[n - 1] ?? null), out: BracketMatch[] = [];
  for (let round = 1; round <= 6; round++) for (let slot = 1; slot <= 64 / 2 ** round; slot++) {
    const previous = round === 1 ? null : out.filter(m => m.round === round - 1 && [slot * 2 - 1, slot * 2].includes(m.slot));
    const team1 = previous ? previous[0].winner : positions[(slot - 1) * 2], team2 = previous ? previous[1].winner : positions[(slot - 1) * 2 + 1];
    const match: BracketMatch = { round, slot, team1, team2, resolved: false, winner: null, heat: null, reason: 'Awaiting previous round', disqualified: [] };
    out.push(match);
    if (previous?.some(m => !m.resolved)) continue;
    const participants = [team1, team2].filter((id): id is string => !!id);
    const checks = participants.map(id => ({ id, ...teamCheck(inspections, id) }));
    // A known breach excludes the team even if its other car still awaits inspection.
    match.disqualified = round === 1 ? checks.filter(c => c.disqualified).map(c => c.id) : [];
    if (checks.some(c => !c.ready && !match.disqualified.includes(c.id))) { match.reason = 'Awaiting submitted Car A and B inspections'; continue; }
    const eligible = participants.filter(id => !match.disqualified.includes(id));
    if (eligible.length < 2) {
      match.resolved = true; match.winner = eligible[0] ?? null;
      match.reason = match.disqualified.length ? 'Automatic first-round disqualification · PERF / SAF' : eligible.length ? 'Bye' : 'Empty bracket slot';
      continue;
    }
    const attempts = races.filter(r => r.bracket?.round === round && r.bracket.slot === slot).sort((a,b) => b.number-a.number);
    const heat = attempts[0]; match.heat = heat ?? null;
    if (!heat) { match.reason = 'Ready to race'; continue; }
    if (heat.phase !== 'knockout' || !((heat.lane1.teamId === team1 && heat.lane2.teamId === team2) || (heat.lane1.teamId === team2 && heat.lane2.teamId === team1))) { match.reason = 'Pairing changed · correct this heat before continuing'; continue; }
    const a = heat.lane1, b = heat.lane2;
    if (a.status === 'pending' || b.status === 'pending') { match.reason = 'Awaiting both lanes'; continue; }
    if (a.status !== 'finished' && b.status !== 'finished') { match.reason = [a,b].some(l=>l.status==='dnf') ? 'DNF · official review required' : 'No finisher · rerun required'; continue; }
    const at = adjustedTime(heat, a, inspections), bt = adjustedTime(heat, b, inspections);
    if (a.status === 'finished' && b.status === 'finished' && at === bt) { match.reason = 'Tie · rerun required'; continue; }
    match.winner = a.status !== 'finished' ? b.teamId : b.status !== 'finished' ? a.teamId : at! < bt! ? a.teamId : b.teamId;
    match.resolved = true; match.reason = 'Winner confirmed from adjusted total';
  }
  return out;
}

export interface RacingScores { derived: Record<string, Record<string, number>>; penalties: Array<{teamId:string;points:number}>; issues: string[]; bracket: BracketMatch[] }
export function competitionScores(teamIds: string[], races: RaceHeat[], inspections: Inspection[], setup: RacingSetup): RacingScores {
  const derived: RacingScores['derived'] = {}, deductions = new Map<string, number>(), issues: string[] = [];
  const add = (id: string, points: number) => deductions.set(id, (deductions.get(id) ?? 0) + points);
  const set = (id: string, area: string, points: number) => { (derived[id] ??= {})[area] = Math.round(points * 10) / 10; };
  const scoring=setup.scoring??defaultReactionScoring();
  if (setup.reactionComplete) {
    const best = teamIds.map(id => ({id, times:races.filter(r => r.phase === 'reaction').flatMap(r => [r.lane1,r.lane2]).filter(l => l.teamId === id && l.status === 'finished').map(l => l.totalMs!) })).map(t => ({id:t.id,time:t.times.length?Math.min(...t.times):Infinity})).sort((a,b) => a.time-b.time || a.id.localeCompare(b.id));
    const times = best.filter(t => Number.isFinite(t.time)).map(t => t.time), base = (times[2] ?? times.at(-1) ?? 0) * scoring.referenceMultiplier;
    for (const t of best) {
      const place = times.indexOf(t.time), raw = place < 0 ? scoring.minimum : place < 3 ? scoring.podium[place] : Math.max(scoring.minimum,scoring.minimum+(scoring.podium[2]-scoring.minimum)/(base-times[0])*(base-t.time));
      const lanes = races.filter(r => r.phase === 'reaction').flatMap(r => [r.lane1,r.lane2]).filter(l => l.teamId === t.id);
      set(t.id,'reaction',raw);
      add(t.id, lanes.filter(l => l.status === 'false_start').length * scoring.falseStartPenalty + (raw === scoring.minimum ? lanes.filter(l => l.status === 'dnf').length * scoring.dnfPenalty : 0));
    }
    // PERF breaches on either car remove Fastest Car eligibility. Missing checks stay pending.
    const candidates = races.filter(r => r.phase === 'reaction').flatMap(r => [r.lane1,r.lane2]).filter(l => l.status === 'finished' && teamCheck(inspections,l.teamId).ready && !['A','B'].some(c => carCheck(inspections,l.teamId,c as 'A'|'B').performance.length)).map(l => ({id:l.teamId,time:l.totalMs!-l.reactionMs!}));
    if (teamIds.every(id => teamCheck(inspections,id).ready)) {
      const fastest = Math.min(...candidates.map(c => c.time));
      for (const id of teamIds) set(id,'fastest-car',candidates.some(c => c.id===id && c.time===fastest)?scoring.fastestCarBonus:0);
    } else issues.push('Fastest Car bonus awaits submitted inspections for every team.');
  } else if (races.length || setup.revision) issues.push('Reaction racing has not been confirmed complete.');
  const bracket = knockoutBracket(setup,races,inspections), final = bracket.find(m => m.round===6);
  if (setup.seeds.length) {
    if (!final?.resolved || !final.winner) issues.push('The knockout bracket is not complete.');
    if (setup.points.some(p => p === null)) issues.push('The organiser or Chair must confirm all eight knockout stage scores.');
    if (final?.resolved && final.winner && setup.points.every(p => p !== null)) {
      for (const id of teamIds) {
        const lost = bracket.find(m => (m.team1===id || m.team2===id) && m.resolved && m.winner!==id);
        set(id,'knockout',setup.points[id===final.winner?6:lost?lost.round-1:7]!);
      }
      for (const m of bracket) for (const r of races.filter(r => r.bracket?.round===m.round && r.bracket.slot===m.slot && r.lane1.teamId===m.team1 && r.lane2.teamId===m.team2)) for (const l of [r.lane1,r.lane2]) if (['dnf','false_start'].includes(l.status)) add(l.teamId,2.5);
    }
  } else if (races.length || setup.revision) issues.push('The top-64 knockout seeds have not been approved.');
  return { derived, penalties:[...deductions].filter(([,points])=>points>0).map(([teamId,points])=>({teamId,points})).sort((a,b)=>a.teamId.localeCompare(b.teamId)), issues, bracket };
}

/** Four reaction runs per team: each car in each lane, with Heat 1 & Heat 2 paired and opposite. */
export function reactionPairings(ids: string[]): RaceInput[] {
  if (!ids.length) return [];
  if(ids.length===1) {
    const lane=(car:'A'|'B'):RaceLane=>({teamId:ids[0],car,status:'pending',totalMs:null,reactionMs:null});
    return [{label:'RR-H01',phase:'reaction',lane1:lane('A'),lane2:lane('B'),note:'',source:'manual',sourceRunId:null},{label:'RR-H02',phase:'reaction',lane1:lane('B'),lane2:lane('A'),note:'',source:'manual',sourceRunId:null}];
  }
  const n = ids.length;
  const races: RaceInput[] = [];
  let heatNum = 1;

  if (n % 2 === 0) {
    for (let i = 0; i < n; i += 2) {
      const t1 = ids[i];
      const t2 = ids[i + 1];
      for (const car of ['A', 'B'] as const) {
        // Heat 1 of pair: Team 1 in Lane 1, Team 2 in Lane 2
        races.push({
          label: `RR-H${String(heatNum++).padStart(2, '0')}`,
          phase: 'reaction',
          lane1: { teamId: t1, car, status: 'pending', totalMs: null, reactionMs: null },
          lane2: { teamId: t2, car, status: 'pending', totalMs: null, reactionMs: null },
          note: '',
          source: 'manual',
          sourceRunId: null,
        });
        // Heat 2 of pair: same cars, opposite lanes (Team 2 in Lane 1, Team 1 in Lane 2)
        races.push({
          label: `RR-H${String(heatNum++).padStart(2, '0')}`,
          phase: 'reaction',
          lane1: { teamId: t2, car, status: 'pending', totalMs: null, reactionMs: null },
          lane2: { teamId: t1, car, status: 'pending', totalMs: null, reactionMs: null },
          note: '',
          source: 'manual',
          sourceRunId: null,
        });
      }
    }
  } else {
    // Odd field: circular chain where each team gets 2 runs per car, in back-to-back swapped pairs
    for (let i = 0; i < n; i++) {
      const t1 = ids[i];
      const t2 = ids[(i + 1) % n];
      const car1 = i % 2 === 0 ? 'A' : 'B';
      const car2 = i === n - 1 ? 'B' : (i % 2 === 0 ? 'A' : 'B');
      races.push({
        label: `RR-H${String(heatNum++).padStart(2, '0')}`,
        phase: 'reaction',
        lane1: { teamId: t1, car: car1, status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: t2, car: car2, status: 'pending', totalMs: null, reactionMs: null },
        note: '',
        source: 'manual',
        sourceRunId: null,
      });
      races.push({
        label: `RR-H${String(heatNum++).padStart(2, '0')}`,
        phase: 'reaction',
        lane1: { teamId: t2, car: car2, status: 'pending', totalMs: null, reactionMs: null },
        lane2: { teamId: t1, car: car1, status: 'pending', totalMs: null, reactionMs: null },
        note: '',
        source: 'manual',
        sourceRunId: null,
      });
    }
  }
  return races;
}
