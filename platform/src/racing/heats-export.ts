import type { RaceHeat, RaceLane, RaceStatus } from './index';

/** The two shapes only need these team fields, so tests and other callers can pass plain objects. */
export interface ExportTeam { id: string; number: string; name: string; school: string }
export interface HeatsExportInput {
  event: { id: string; name: string; startsOn?: string | null };
  teams: ExportTeam[];
  races: RaceHeat[];
  generatedAt?: string;
}

/** Formats heat numbering: RR-H01 for reaction; KR-H01 for knockout races */
export function formatHeatNumber(heat: RaceHeat, fallbackIndex: number): string {
  if (heat.phase === 'reaction') {
    const m = heat.label.match(/RR-(?:H)?(\d+)/i);
    if (m) return `RR-H${m[1].padStart(2, '0')}`;
    return `RR-H${String(fallbackIndex + 1).padStart(2, '0')}`;
  }
  // Knockout heats start from KR-H01
  const m = heat.label.match(/KR-(?:H)?(\d+)/i);
  if (m) return `KR-H${m[1].padStart(2, '0')}`;
  const slot = heat.bracket?.slot;
  if (typeof slot === 'number' && slot >= 1) return `KR-H${String(slot).padStart(2, '0')}`;
  return `KR-H${String(fallbackIndex + 1).padStart(2, '0')}`;
}

export interface HeatTeamRef { id: string; number: string | null; name: string | null; school: string | null }
export interface HeatLaneExport { lane: 1 | 2; team: HeatTeamRef; car: 'A' | 'B'; status: RaceStatus; totalMs: number | null; reactionMs: number | null }
export interface HeatExport {
  id: string; number: number; code: string; label: string; phase: 'reaction' | 'knockout';
  round: number | null; match: number | null;
  followup: 'swap' | 'rerun' | null; followupOf: string | null;
  lanes: [HeatLaneExport, HeatLaneExport];
  /** The winning lane's team once both lanes are decided; null while pending, tied or without a finisher. */
  winnerTeamId: string | null;
  note: string;
}
export interface HeatsExport {
  schemaVersion: 1; kind: 'heats'; generatedAt: string;
  event: { id: string; name: string; startsOn: string | null };
  heats: HeatExport[];
}

export interface HeatMatchup {
  order: number; phase: 'reaction' | 'knockout';
  round: number | null; match: number | null;
  teamA: HeatTeamRef;
  /** Null when a team runs its own two cars against each other, as a single-team reaction schedule does. */
  teamB: HeatTeamRef | null;
  /** Every heat this pairing covers: both cars, lane swaps and reruns. Numbers are unique; codes are as printed. */
  heatNumbers: number[];
  heats: string[];
}
export interface HeatMatchupsExport {
  schemaVersion: 1; kind: 'heat-matchups'; generatedAt: string;
  event: { id: string; name: string; startsOn: string | null };
  matchups: HeatMatchup[];
}

const ordered = (races: RaceHeat[]) => [...races].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));

/** A heat code per heat, numbered within its phase exactly as the printed schedule numbers them. */
function codes(races: RaceHeat[]): Map<string, string> {
  const out = new Map<string, string>(), seen = { reaction: 0, knockout: 0 };
  for (const heat of ordered(races)) out.set(heat.id, formatHeatNumber(heat, seen[heat.phase]++));
  return out;
}

function teamRef(teams: ExportTeam[], id: string): HeatTeamRef {
  const t = teams.find((team) => team.id === id);
  // A team removed after racing keeps its id so nothing is silently merged; its details are simply unknown.
  return t ? { id: t.id, number: t.number, name: t.name, school: t.school || null } : { id, number: null, name: null, school: null };
}

function winner(a: RaceLane, b: RaceLane): string | null {
  if (a.status === 'pending' || b.status === 'pending') return null;
  if (a.status === 'finished' && b.status === 'finished') return a.totalMs === b.totalMs ? null : a.totalMs! < b.totalMs! ? a.teamId : b.teamId;
  if (a.status === 'finished') return a.teamId;
  if (b.status === 'finished') return b.teamId;
  return null;
}

const head = (input: HeatsExportInput) => ({
  generatedAt: input.generatedAt ?? new Date().toISOString(),
  event: { id: input.event.id, name: input.event.name, startsOn: input.event.startsOn ?? null },
});

/** Every heat as recorded: lanes, cars, statuses and official times. */
export function heatsExport(input: HeatsExportInput): HeatsExport {
  const code = codes(input.races);
  const lane = (n: 1 | 2, l: RaceLane): HeatLaneExport => ({ lane: n, team: teamRef(input.teams, l.teamId), car: l.car, status: l.status, totalMs: l.totalMs, reactionMs: l.reactionMs });
  return {
    schemaVersion: 1, kind: 'heats', ...head(input),
    heats: ordered(input.races).map((heat) => ({
      id: heat.id, number: heat.number, code: code.get(heat.id)!, label: heat.label, phase: heat.phase,
      round: heat.bracket?.round ?? null, match: heat.bracket?.slot ?? null,
      followup: heat.followupKind ?? null, followupOf: heat.parentHeat ?? null,
      lanes: [lane(1, heat.lane1), lane(2, heat.lane2)],
      winnerTeamId: winner(heat.lane1, heat.lane2),
      note: heat.note,
    })),
  };
}

/**
 * For on-screen graphics: one entry per pairing, team against team. Which car ran, which lane it was in, lane swaps
 * and reruns are all the same pairing, so they collapse into it. Order follows the first heat of each pairing.
 */
export function heatMatchupsExport(input: HeatsExportInput): HeatMatchupsExport {
  const code = codes(input.races);
  const byKey = new Map<string, HeatMatchup>();
  for (const heat of ordered(input.races)) {
    const a = heat.lane1.teamId, b = heat.lane2.teamId;
    // A bracket match is one pairing even if its teams were corrected; otherwise the pair of teams identifies it.
    const key = heat.phase === 'knockout' && heat.bracket
      ? `knockout:${heat.bracket.round}:${heat.bracket.slot}`
      : `${heat.phase}:${[a, b].sort().join('|')}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.heatNumbers.push(heat.number);
      if (!existing.heats.includes(code.get(heat.id)!)) existing.heats.push(code.get(heat.id)!);
      continue;
    }
    byKey.set(key, {
      order: byKey.size + 1, phase: heat.phase,
      round: heat.bracket?.round ?? null, match: heat.bracket?.slot ?? null,
      teamA: teamRef(input.teams, a), teamB: a === b ? null : teamRef(input.teams, b),
      heatNumbers: [heat.number], heats: [code.get(heat.id)!],
    });
  }
  return { schemaVersion: 1, kind: 'heat-matchups', ...head(input), matchups: [...byKey.values()] };
}

const safe = (s: string): string =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'Event';

/** One naming scheme for every JSON download, so a folder of them sorts by event. */
export const jsonFileName = (eventName: string, label: string): string => `STEM-Racing_${safe(eventName)}_${label}.json`;

export const heatsJsonFileName = (eventName: string, kind: 'heats' | 'graphics'): string =>
  jsonFileName(eventName, kind === 'heats' ? 'Heats' : 'Heats-Graphics');
