import { describe, expect, it } from 'vitest';
import { areaTotal, bandIndex, round1, validateScores } from '../../src/engine/scorecard';
import { INDIA_2026 } from '../../src/rulesets';

const technique = INDIA_2026.areas.find((a) => a.id === 'verbal-technique')!;
const schedule = INDIA_2026.areas.find((a) => a.id === 'pm-initiating')!;

describe('validateScores', () => {
  it('accepts whole numbers within 0..max, including both limits', () => {
    expect(validateScores(technique, { 'engagement-presentation-dynamics': 0, 'team-contribution': 20 }, { complete: true })).toEqual([]);
  });

  it('rejects out-of-range and non-integer scores with the criterion named', () => {
    const p = validateScores(technique, { 'engagement-presentation-dynamics': 21, 'team-contribution': 4.5 }, { complete: false });
    expect(p.map((x) => [x.criterionId, x.kind])).toEqual([
      ['engagement-presentation-dynamics', 'out-of-range'],
      ['team-contribution', 'not-integer'],
    ]);
    expect(p[0].message).toContain('0 to 20');
  });

  it('rejects negatives, NaN and Infinity', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = validateScores(technique, { 'team-contribution': bad }, { complete: false });
      expect(p, String(bad)).toHaveLength(1);
    }
  });

  it('rejects unknown criteria', () => {
    const p = validateScores(technique, { nonsense: 5 }, { complete: false });
    expect(p).toEqual([expect.objectContaining({ criterionId: 'nonsense', kind: 'unknown' })]);
  });

  it('allows missing criteria when not complete, and flags them when complete', () => {
    expect(validateScores(technique, { 'team-contribution': 10 }, { complete: false })).toEqual([]);
    const p = validateScores(technique, { 'team-contribution': 10 }, { complete: true });
    expect(p).toEqual([expect.objectContaining({ criterionId: 'engagement-presentation-dynamics', kind: 'missing' })]);
  });

  it('uses each criterion own maximum (15-point schedule)', () => {
    const p = validateScores(schedule, { 'initiation-process': 20, 'project-schedule': 16 }, { complete: true });
    expect(p.map((x) => x.criterionId)).toEqual(['project-schedule']);
  });
});

describe('areaTotal and bandIndex', () => {
  it('sums the scores present', () => {
    expect(areaTotal(technique, { 'engagement-presentation-dynamics': 14, 'team-contribution': 9 })).toBe(23);
    expect(areaTotal(technique, {})).toBe(0);
  });

  it('finds the band for a score at every boundary', () => {
    const c = technique.criteria[0];
    expect([0, 5, 6, 10, 11, 15, 16, 20].map((s) => bandIndex(c, s))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(bandIndex(c, 21)).toBe(-1);
    expect(bandIndex(c, -1)).toBe(-1);
    expect(bandIndex(c, 5.5)).toBe(-1);
  });
});

describe('round1', () => {
  it('rounds half up to one decimal without float surprises', () => {
    expect(round1(91.45)).toBe(91.5);
    expect(round1(1.3333333)).toBe(1.3);
    expect(round1(2.25)).toBe(2.3);
    expect(round1(0.1 + 0.2)).toBe(0.3);
    expect(round1(94.5)).toBe(94.5);
  });
});
