import { canonicalJson, rank, sha256Fallback } from '../engine';
import { INDIA_TECHNICAL, SPAN_LINES, specificationsScore, summarise, type Inspection, type Measurements, type Rule } from '../technical';
import { competitionScores, knockoutBracket, reactionPairings, ROUND_NAMES, type RacingSetup } from '../racing/competition';
import type { RaceHeat, RaceLane } from '../racing';
import type { ShowcaseSeed } from './memory';
import type { CardRow, EventRow, Panel, RoleRow } from './types';

const midpoint = (min?: number, max?: number) => Math.round((min !== undefined && max !== undefined ? (min + max) / 2 : min !== undefined ? min + 2 : (max ?? 0) / 2) * 100) / 100;
function passing(rule: Rule): Measurements[string] {
  switch (rule.kind) {
    case 'range': return midpoint(rule.min, rule.max);
    case 'check': return true;
    case 'perItemRange': return Object.fromEntries(rule.items.map(i => [i.id, midpoint(i.min, i.max)]));
    case 'perItemCheck': return Object.fromEntries(rule.items.map(i => [i.id, true]));
    case 'span': return Object.fromEntries(SPAN_LINES.map(line => [line, rule.min + 3]));
  }
}

/** Six fully scored, fictional teams. Never writes records, sends email or connects to a track. */
export function buildShowcaseExamples(event: EventRow): ShowcaseSeed {
  const eventId = event.id, date = '2026-10-24T09:00:00.000Z';
  const panels = [...new Set(event.ruleset.areas.filter(a => a.kind === 'scorecard').map(a => a.panel as Panel))];
  const judges: RoleRow[] = panels.map((panel, i) => ({
    id: `example-role-${i}`, eventId, userId: `example-judge-${i}`, role: 'judge', panel, teamId: null,
    name: ['Avery Rao', 'Maya Sen', 'Kabir Shah', 'Noor Mehta', 'Rohan Das'][i], email: `judge-${i + 1}@example.invalid`,
  }));
  const teams = ['Apex Racing', 'SUPERCHARGED', 'Velocity Works', 'Aurora Motorsport', 'Quantum Racing', 'Falcon Dynamics'].map((name, i) => ({
    id: `example-team-${i + 1}`, eventId, number: String(i + 1).padStart(3, '0'), name,
    school: ['Northfield Academy', 'Riverside School', 'Oakwood School', 'Horizon Academy', 'Cedar School', 'Summit Academy'][i],
  }));
  const areas = event.ruleset.areas.filter(a => a.kind === 'scorecard');
  const cards: CardRow[] = teams.flatMap((team, i) => areas.map((area, k) => ({
    id: `example-card-${team.id}-${area.id}`, eventId, teamId: team.id, areaId: area.id, panel: area.panel!,
    judgeId: judges.find(j => j.panel === area.panel)!.userId, status: 'submitted', reopenedCount: 0,
    scores: Object.fromEntries(area.criteria.map((c, n) => [c.id, Math.round(c.max * (0.92 - i * 0.055 - ((k + n) % 3) * 0.02))])),
    comments: Object.fromEntries(area.criteria.map(c => [c.id, `${team.name} provided clear evidence for ${c.name.toLowerCase()}; the final iteration could explain the measured improvement more precisely.`])),
  })));
  const feedback = cards.map(card => {
    const team = teams.find(t => t.id === card.teamId)!, area = areas.find(a => a.id === card.areaId)!;
    return { cardId: card.id, overall: `${team.name} presented a prepared and coherent ${area.name.toLowerCase()} submission. The evidence supported the main decisions and the team answered questions clearly.`,
      strengths: 'Clear division of responsibilities, an organised evidence trail and consistent technical reasoning.',
      improvements: 'Quantify the benefit of the final changes and connect the testing evidence to the team’s objectives.' };
  });
  const inspections: Inspection[] = teams.flatMap(team => (['A', 'B'] as const).map(car => ({
    id: `example-inspection-${team.id}-${car}`, eventId, teamId: team.id, car, inspectorId: judges.find(j => j.panel === 'scrutineering')!.userId,
    status: 'submitted', rulesetId: INDIA_TECHNICAL.id, measurements: Object.fromEntries(INDIA_TECHNICAL.rules.map(r => [r.article, passing(r)])),
    notes: {example: 'Synthetic passing inspection for this showcase.'}, startedAt: date, submittedAt: date, updatedAt: date, revision: 1,
  })));
  const lane = (teamId: string, car: 'A' | 'B', run: number): RaceLane => {
    const i = teams.findIndex(t => t.id === teamId);
    return {teamId, car, status: 'finished', totalMs: 1210 + i * 53 + (car === 'B' ? 9 : 0) + run % 4 * 3, reactionMs: 120 + i * 7 + run % 3};
  };
  const races: RaceHeat[] = reactionPairings(teams.map(t => t.id)).map((race, i) => ({
    ...race, id: `example-reaction-${i + 1}`, eventId, number: i + 1, revision: 1, updatedAt: date,
    lane1: lane(race.lane1.teamId, race.lane1.car, i), lane2: lane(race.lane2.teamId, race.lane2.car, i),
    note: 'Synthetic finished race for the showcase; no track connection.',
  }));
  const racingSetup: RacingSetup = {
    revision: 1, seeds: teams.map(t => t.id), reactionComplete: true,
    // Explicit example stage values; these are the same editable practice values used in Test Event.
    points: [10, 26, 52, 85, 106, 120, 135, 10], version: '',
  };
  for (let pass = 0; pass < 6; pass++) {
    const ready = knockoutBracket(racingSetup, races, inspections).filter(m => !m.resolved && m.team1 && m.team2 && m.reason === 'Ready to race');
    if (!ready.length) break;
    for (const match of ready) races.push({
      id: `example-knockout-${match.round}-${match.slot}`, eventId, number: races.length + 1, revision: 1, updatedAt: date,
      label: `${ROUND_NAMES[match.round - 1]} · example ${match.slot}`, phase: 'knockout', bracket: {round: match.round, slot: match.slot},
      lane1: lane(match.team1!, 'A', match.round), lane2: lane(match.team2!, 'A', match.round),
      note: 'Synthetic finished knockout race for the showcase; no track connection.', source: 'manual', sourceRunId: null,
    });
  }
  const racing = competitionScores(teams.map(t => t.id), races, inspections, racingSetup);
  if (racing.issues.length) throw new Error(`Incomplete showcase racing: ${racing.issues.join(' ')}`);
  const derived = Object.fromEntries(teams.map(team => {
    const pair = inspections.filter(i => i.teamId === team.id);
    return [team.id, {specifications: specificationsScore(summarise(INDIA_TECHNICAL.rules, pair[0].measurements), summarise(INDIA_TECHNICAL.rules, pair[1].measurements)), ...racing.derived[team.id]}];
  }));
  const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const inputs = {
    teams: teams.map(({id, number, name}) => ({id, number, name})),
    cards: cards.map(({teamId, areaId, judgeId, scores}) => ({teamId, areaId, judgeId, scores})).sort((a,b) => order(a.teamId,b.teamId) || order(a.areaId,b.areaId) || order(a.judgeId,b.judgeId)),
    overrides: [], penalties: [], derived, racingPenalties: racing.penalties,
    racingVersion: JSON.stringify({setup: racingSetup, races, inspections}), racingIssues: racing.issues,
  };
  const ranking = rank({ruleset: event.ruleset, ...inputs});
  const snapshotId = 'example-final-snapshot', awardsVersion = 'example-awards-v1';
  const champion = racing.bracket.find(m => m.round === 6)!.winner!;
  const fastest = teams.find(t => racing.derived[t.id]['fastest-car'] === 10)!;
  const awards = [
    {id: 'example-award-overall', title: 'Overall Champion', teamId: ranking.rows[0].teamId},
    {id: 'example-award-knockout', title: 'Knockout Champion', teamId: champion},
    {id: 'example-award-fastest', title: 'Fastest Car', teamId: fastest.id},
  ];
  return {
    event: {...event, resultsReleased: false}, teams, roles: judges, invitations: [], cards, feedback,
    nominations: [], conflicts: [], exemptions: [], overrides: [], penalties: [], inspections, races, racingSetup,
    broadcasts: [{id: 'example-announcement', eventId, senderId: null, senderEmail: 'presenter@showcase.invalid', audienceType: 'all_judges', panel: null,
      recipientCount: judges.length, subject: 'Final judging and racing complete', category: 'RESULTS', body: 'Every judging panel and race has been completed in this six-team example.', buttonText: null, buttonUrl: null, createdAt: date}],
    contacts: teams.map(t => ({teamId: t.id, managerEmail: 'shubham@stempify.com'})),
    mail: {confirmed: true, version: awardsVersion, snapshotId, awards, deliveries: []},
    snapshot: {id: snapshotId, eventId, createdAt: date, rulesetId: event.ruleset.id, rows: ranking.rows, released: true,
      inputHash: sha256Fallback(canonicalJson({rulesetId: event.ruleset.id, inputs, rows: ranking.rows}))},
    snapshotInputs: inputs,
  };
}
