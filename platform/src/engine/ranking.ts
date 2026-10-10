import { areaTotal, round1, validateScores } from './scorecard';
import type { Area, Ruleset } from './types';

export interface CardInput { teamId: string; areaId: string; judgeId: string; scores: Record<string, number> }
export interface OverrideInput { teamId: string; areaId: string; value: number }
export interface PenaltyInput { teamId: string; points: number }
export interface TeamInput { id: string; number: string; name: string }

export interface RankInputs {
  ruleset: Ruleset;
  teams: TeamInput[];
  cards: CardInput[];
  overrides: OverrideInput[];
  penalties: PenaltyInput[];
  /** teamId -> areaId -> value, for derived areas filled by later phases (specifications, racing). */
  derived?: Record<string, Record<string, number>>;
}

export interface RankRow {
  rank: number;
  teamId: string;
  number: string;
  name: string;
  areas: Record<string, number | null>;
  categories: Record<string, number>;
  subtotal: number;
  penalties: number;
  total: number;
  judgedComplete: boolean;
  tied: boolean;
}

export interface Ranking {
  rows: RankRow[];
  maxAvailable: number;
  provisional: boolean;
  /** Groups of team ids sharing a rank that the Chair must settle. */
  ties: string[][];
}

export class RankingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingInputError';
  }
}

const key = (teamId: string, areaId: string) => `${teamId}\u0000${areaId}`;
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export function rank(inputs: RankInputs): Ranking {
  const { ruleset, teams } = inputs;
  const areas = new Map(ruleset.areas.map((a) => [a.id, a]));
  const teamIds = new Set(teams.map((t) => t.id));

  const totalsByTeamArea = new Map<string, number[]>();
  const seenCards = new Set<string>();
  for (const c of inputs.cards) {
    const area = areas.get(c.areaId);
    if (!area) throw new RankingInputError(`Scorecard for unknown area ${c.areaId}`);
    if (area.kind !== 'scorecard') throw new RankingInputError(`${area.name} is not scored on a scorecard`);
    const problems = validateScores(area, c.scores, { complete: true });
    if (problems.length > 0) throw new RankingInputError(`${area.name}, judge ${c.judgeId}: ${problems[0].message}`);
    const cardKey = `${key(c.teamId, c.areaId)}\u0000${c.judgeId}`;
    if (seenCards.has(cardKey)) {
      throw new RankingInputError(`Duplicate card: judge ${c.judgeId} has more than one card for team ${c.teamId}, ${area.name}`);
    }
    seenCards.add(cardKey);
    if (!teamIds.has(c.teamId)) continue;
    const list = totalsByTeamArea.get(key(c.teamId, c.areaId)) ?? [];
    list.push(areaTotal(area, c.scores));
    totalsByTeamArea.set(key(c.teamId, c.areaId), list);
  }

  const overrides = new Map<string, number>();
  for (const o of inputs.overrides) {
    const area = areas.get(o.areaId);
    if (!area || area.kind !== 'scorecard') throw new RankingInputError(`Override for ${o.areaId}: only scorecard areas can be overridden`);
    if (!Number.isFinite(o.value) || o.value < 0 || o.value > area.max) {
      throw new RankingInputError(`Override for ${area.name} must be between 0 and ${area.max}`);
    }
    if (Math.abs(o.value * 10 - Math.round(o.value * 10)) > 1e-9) {
      throw new RankingInputError(`Override for ${area.name} must have at most one decimal place`);
    }
    if (overrides.has(key(o.teamId, o.areaId))) {
      throw new RankingInputError(`Duplicate override for team ${o.teamId}, ${area.name}`);
    }
    overrides.set(key(o.teamId, o.areaId), o.value);
  }

  const penaltyByTeam = new Map<string, number>();
  for (const p of inputs.penalties) {
    if (!Number.isFinite(p.points) || p.points < 0) throw new RankingInputError('Penalty points must be zero or more');
    penaltyByTeam.set(p.teamId, round1((penaltyByTeam.get(p.teamId) ?? 0) + p.points));
  }

  const derived = inputs.derived ?? {};
  for (const [teamId, perTeam] of Object.entries(derived)) {
    for (const [areaId, value] of Object.entries(perTeam)) {
      const area = areas.get(areaId);
      if (!area || area.kind !== 'derived') {
        throw new RankingInputError(`Derived value for ${areaId} (team ${teamId}): not a derived area`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > area.max) {
        throw new RankingInputError(`Derived value for ${area.name} (team ${teamId}) must be between 0 and ${area.max}`);
      }
    }
  }
  const tieArea = ruleset.tieBreakAreaId;
  const scorecardAreas = ruleset.areas.filter((a) => a.kind === 'scorecard');
  const available = new Set<string>(scorecardAreas.map((a) => a.id));
  for (const perTeam of Object.values(derived)) for (const id of Object.keys(perTeam)) if (areas.get(id)?.kind === 'derived') available.add(id);
  const maxAvailable = ruleset.areas.filter((a) => available.has(a.id)).reduce((s, a) => s + a.max, 0);

  const scoreFor = (teamId: string, area: Area): number | null => {
    if (area.kind === 'derived') return derived[teamId]?.[area.id] ?? null;
    const ov = overrides.get(key(teamId, area.id));
    if (ov !== undefined) return ov;
    const list = totalsByTeamArea.get(key(teamId, area.id));
    if (!list || list.length === 0) return null;
    return round1(list.reduce((a, b) => a + b, 0) / list.length);
  };

  const rows = teams.map((t): RankRow => {
    const areaScores: Record<string, number | null> = {};
    const categories: Record<string, number> = {};
    let subtotal = 0;
    for (const a of ruleset.areas) {
      const v = scoreFor(t.id, a);
      areaScores[a.id] = v;
      if (v !== null) {
        subtotal += v;
        categories[a.categoryId] = round1((categories[a.categoryId] ?? 0) + v);
      }
    }
    const penalties = penaltyByTeam.get(t.id) ?? 0;
    return {
      rank: 0, teamId: t.id, number: t.number, name: t.name, areas: areaScores, categories,
      subtotal: round1(subtotal), penalties, total: round1(subtotal - penalties),
      judgedComplete: scorecardAreas.every((a) => areaScores[a.id] !== null), tied: false,
    };
  });

  const tie = (r: RankRow) => r.areas[tieArea] ?? 0;
  rows.sort((a, b) => b.total - a.total || tie(b) - tie(a) || natural(a.number, b.number));

  const ties: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    const same = prev && prev.total === rows[i].total && tie(prev) === tie(rows[i]);
    rows[i].rank = same ? prev.rank : i + 1;
  }
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].rank === rows[i].rank) j++;
    if (j - i > 1) {
      ties.push(rows.slice(i, j).map((r) => r.teamId));
      for (let k = i; k < j; k++) rows[k].tied = true;
    }
    i = j;
  }

  return { rows, maxAvailable, provisional: rows.some((r) => !r.judgedComplete), ties };
}
