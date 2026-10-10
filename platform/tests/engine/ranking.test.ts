import { describe, expect, it } from 'vitest';
import { RankingInputError, rank, type CardInput, type RankInputs } from '../../src/engine';
import { INDIA_2026 } from '../../src/rulesets';

const area = (id: string) => INDIA_2026.areas.find((a) => a.id === id)!;
const all = (areaId: string, n: number) => Object.fromEntries(area(areaId).criteria.map((c) => [c.id, Math.min(n, c.max)]));
const card = (teamId: string, areaId: string, judgeId: string, n: number): CardInput => ({ teamId, areaId, judgeId, scores: all(areaId, n) });
const teams = [
  { id: 't1', number: '1', name: 'One' },
  { id: 't2', number: '2', name: 'Two' },
  { id: 't10', number: '10', name: 'Ten' },
];
const base = (over: Partial<RankInputs> = {}): RankInputs => ({
  ruleset: INDIA_2026, teams, cards: [], overrides: [], penalties: [], ...over,
});

describe('rank: empty and partial data', () => {
  it('ranks nothing as null areas, zero totals, provisional, all tied', () => {
    const r = rank(base());
    expect(r.rows.map((x) => x.total)).toEqual([0, 0, 0]);
    expect(r.rows[0].areas['de-portfolio']).toBeNull();
    expect(r.rows.every((x) => !x.judgedComplete)).toBe(true);
    expect(r.provisional).toBe(true);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1, 1]);
    expect(r.ties).toEqual([['t1', 't2', 't10']]);
    expect(r.rows.map((x) => x.number)).toEqual(['1', '2', '10']);
  });

  it('counts only the points that are available: 650 judged, derived areas only when supplied', () => {
    expect(rank(base()).maxAvailable).toBe(650);
    expect(rank(base({ derived: { t1: { knockout: 30 } } })).maxAvailable).toBe(785);
  });
});

describe('rank: combining judges', () => {
  it('uses the mean of submitted cards, to one decimal', () => {
    const r = rank(base({ cards: [card('t1', 'de-portfolio', 'jA', 10), card('t1', 'de-portfolio', 'jB', 11)] }));
    expect(r.rows.find((x) => x.teamId === 't1')!.areas['de-portfolio']).toBe(94.5); // (90 + 99) / 2
  });

  it('rounds a repeating mean to one decimal', () => {
    const cards = [card('t1', 'engineering-drawings', 'a', 1), card('t1', 'engineering-drawings', 'b', 1), card('t1', 'engineering-drawings', 'c', 2)];
    expect(rank(base({ cards })).rows.find((x) => x.teamId === 't1')!.areas['engineering-drawings']).toBe(1.3);
  });

  it('a chair override replaces the judges mean', () => {
    const r = rank(base({
      cards: [card('t1', 'de-portfolio', 'jA', 10)],
      overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 120 }],
    }));
    expect(r.rows.find((x) => x.teamId === 't1')!.areas['de-portfolio']).toBe(120);
  });

  it('an override can stand in for an area with no cards', () => {
    const r = rank(base({ overrides: [{ teamId: 't2', areaId: 'pit-display', value: 40 }] }));
    expect(r.rows.find((x) => x.teamId === 't2')!.total).toBe(40);
  });
});

describe('rank: totals, categories, penalties and completeness', () => {
  const fullJudged = (teamId: string, n: number): CardInput[] =>
    INDIA_2026.areas.filter((a) => a.kind === 'scorecard').map((a) => card(teamId, a.id, 'j1', n));

  it('sums areas into categories and subtracts protest penalties', () => {
    const r = rank(base({
      cards: [card('t1', 'de-portfolio', 'j', 10), card('t1', 'verbal-technique', 'j', 10)],
      penalties: [{ teamId: 't1', points: 15 }],
    }));
    const row = r.rows.find((x) => x.teamId === 't1')!;
    expect(row.categories['design-engineering']).toBe(90);
    expect(row.categories.verbal).toBe(20);
    expect(row.subtotal).toBe(110);
    expect(row.penalties).toBe(15);
    expect(row.total).toBe(95);
  });

  it('marks a team judgedComplete only when every scorecard area has a score', () => {
    const r = rank(base({ cards: fullJudged('t1', 10) }));
    expect(r.rows.find((x) => x.teamId === 't1')!.judgedComplete).toBe(true);
    expect(r.rows.find((x) => x.teamId === 't2')!.judgedComplete).toBe(false);
    expect(r.provisional).toBe(true);
    expect(rank(base({ cards: [...fullJudged('t1', 10), ...fullJudged('t2', 9), ...fullJudged('t10', 8)] })).provisional).toBe(false);
  });

  it('adds derived areas such as knock-out', () => {
    const r = rank(base({ derived: { t1: { knockout: 85, specifications: 92 } } }));
    expect(r.rows.find((x) => x.teamId === 't1')!.total).toBe(177);
  });
});

describe('rank: ordering, ties and the knock-out tie-break', () => {
  it('orders by total descending with competition ranking', () => {
    const r = rank(base({ cards: [card('t1', 'de-portfolio', 'j', 5), card('t2', 'de-portfolio', 'j', 10), card('t10', 'de-portfolio', 'j', 5)] }));
    expect(r.rows.map((x) => [x.teamId, x.rank])).toEqual([['t2', 1], ['t1', 2], ['t10', 2]]);
    expect(r.ties).toEqual([['t1', 't10']]);
    expect(r.rows.map((x) => x.tied)).toEqual([false, true, true]);
  });

  it('equal totals, different knock-out scores: knock-out decides and no tie is flagged', () => {
    const r = rank(base({
      derived: { t1: { knockout: 52, reaction: 0 }, t2: { knockout: 26, reaction: 26 } },
    }));
    expect(r.rows.slice(0, 2).map((x) => x.total)).toEqual([52, 52]);
    expect(r.rows.slice(0, 2).map((x) => x.teamId)).toEqual(['t1', 't2']);
    expect(r.rows.slice(0, 2).map((x) => x.rank)).toEqual([1, 2]);
    expect(r.rows.slice(0, 2).some((x) => x.tied)).toBe(false);
  });

  it('flags equal total and equal knock-out as a tie for the Chair', () => {
    const r = rank(base({ derived: { t1: { knockout: 52 }, t2: { knockout: 52 } } }));
    expect(r.ties[0]).toEqual(['t1', 't2']);
  });

  it('ties in the middle share a rank and the next rank skips', () => {
    const cards = [card('t1', 'de-portfolio', 'j', 10), card('t2', 'de-portfolio', 'j', 8), card('t10', 'de-portfolio', 'j', 8)];
    const r = rank(base({ cards, teams: [...teams, { id: 't3', number: '3', name: 'Three' }] }));
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 2, 4]);
  });
});

describe('rank: bad input is refused loudly', () => {
  it('throws on an unknown area, a derived area card, or unknown criteria', () => {
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'nope', judgeId: 'j', scores: {} }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'knockout', judgeId: 'j', scores: {} }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { x: 1 } }] }))).toThrow(RankingInputError);
  });

  it('throws on an incomplete or out-of-range submitted card', () => {
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { 'team-contribution': 5 } }] }))).toThrow(/no score/);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { 'team-contribution': 25, 'engagement-presentation-dynamics': 1 } }] }))).toThrow(RankingInputError);
  });

  it('throws on an override above the area maximum, below zero, or for a derived area', () => {
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 181 }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: -1 }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'knockout', value: 5 }] }))).toThrow(RankingInputError);
  });

  it('ignores cards, overrides and penalties for teams that are not in the event, but throws on bad penalty points', () => {
    expect(rank(base({ cards: [card('ghost', 'de-portfolio', 'j', 10)] })).rows.every((x) => x.total === 0)).toBe(true);
    expect(() => rank(base({ penalties: [{ teamId: 't1', points: -5 }] }))).toThrow(RankingInputError);
  });
});

describe('rank: scale and determinism', () => {
  it('ranks 80 teams with 3 judges on every scorecard area quickly and identically twice', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, number: String(i + 1), name: `Team ${i + 1}` }));
    const cards: CardInput[] = [];
    for (const t of many) for (const a of INDIA_2026.areas.filter((x) => x.kind === 'scorecard')) for (const j of ['a', 'b', 'c']) cards.push(card(t.id, a.id, j, (Number(t.id.slice(1)) % 15) + 1));
    const start = Date.now();
    const r1 = rank({ ruleset: INDIA_2026, teams: many, cards, overrides: [], penalties: [] });
    expect(Date.now() - start).toBeLessThan(1500);
    const r2 = rank({ ruleset: INDIA_2026, teams: [...many].reverse(), cards: [...cards].reverse(), overrides: [], penalties: [] });
    expect(r2.rows.map((x) => [x.teamId, x.rank, x.total])).toEqual(r1.rows.map((x) => [x.teamId, x.rank, x.total]));
  });
});

describe('rank: derived values are validated', () => {
  const d = (teamId: string, areaId: string, v: number) => base({ derived: { [teamId]: { [areaId]: v } } });
  it('throws on NaN, Infinity, negative or above-maximum values', () => {
    expect(() => rank(d('t1', 'knockout', NaN))).toThrow(RankingInputError);
    expect(() => rank(d('t1', 'knockout', Infinity))).toThrow(RankingInputError);
    expect(() => rank(d('t1', 'knockout', -1))).toThrow(RankingInputError);
    expect(() => rank(d('t1', 'knockout', area('knockout').max + 1))).toThrow(RankingInputError);
  });
  it('accepts the boundaries 0 and the area maximum', () => {
    expect(() => rank(d('t1', 'knockout', 0))).not.toThrow();
    expect(() => rank(d('t1', 'knockout', area('knockout').max))).not.toThrow();
  });
  it('throws when the key names a scorecard area or an unknown area', () => {
    expect(() => rank(d('t1', 'de-portfolio', 10))).toThrow(RankingInputError);
    expect(() => rank(d('t1', 'nope', 10))).toThrow(RankingInputError);
  });
  it('validates values for unknown teams, then ignores them', () => {
    expect(() => rank(d('ghost', 'knockout', 9999))).toThrow(RankingInputError);
    const r = rank(d('ghost', 'knockout', 10));
    expect(r.rows.every((x) => x.total === 0)).toBe(true);
  });
});

describe('rank: duplicate cards', () => {
  it('throws when one judge has two cards for the same team and area', () => {
    const cards = [card('t1', 'de-portfolio', 'jA', 10), card('t1', 'de-portfolio', 'jA', 11)];
    expect(() => rank(base({ cards }))).toThrow(RankingInputError);
    expect(() => rank(base({ cards }))).toThrow(/duplicate/i);
  });
  it('allows the same judge on different teams or areas, and different judges on the same one', () => {
    const cards = [
      card('t1', 'de-portfolio', 'jA', 10), card('t2', 'de-portfolio', 'jA', 10),
      card('t1', 'pit-display', 'jA', 10), card('t1', 'de-portfolio', 'jB', 10),
    ];
    expect(() => rank(base({ cards }))).not.toThrow();
  });
});

describe('rank: override precision and duplicates', () => {
  it('rejects an override that is not representable at one decimal place', () => {
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 100.55 }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 100.5 }] }))).not.toThrow();
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 0.3 }] }))).not.toThrow();
  });
  it('throws on two overrides for the same team and area', () => {
    const overrides = [
      { teamId: 't1', areaId: 'de-portfolio', value: 100 },
      { teamId: 't1', areaId: 'de-portfolio', value: 110 },
    ];
    expect(() => rank(base({ overrides }))).toThrow(RankingInputError);
  });
});

describe('rank: penalty sums are rounded to one decimal', () => {
  it('shows 0.1 + 0.2 as 0.3 and subtracts exactly that', () => {
    const r = rank(base({
      cards: [card('t1', 'verbal-technique', 'j', 20)],
      penalties: [{ teamId: 't1', points: 0.1 }, { teamId: 't1', points: 0.2 }],
    }));
    const row = r.rows.find((x) => x.teamId === 't1')!;
    expect(row.penalties).toBe(0.3);
    expect(row.subtotal).toBe(40);
    expect(row.total).toBe(39.7);
  });
});
