import { describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const area = (id: string) => INDIA_2026.areas.find((a) => a.id === id)!;
const categoryTotal = (id: string) => sum(INDIA_2026.areas.filter((a) => a.categoryId === id).map((a) => a.max));

describe('India National Finals 2026 ruleset', () => {
  it('totals 1000 points across the six categories (C3.5)', () => {
    expect(sum(INDIA_2026.areas.map((a) => a.max))).toBe(1000);
    expect(categoryTotal('specification')).toBe(160);
    expect(categoryTotal('design-engineering')).toBe(180);
    expect(categoryTotal('project-management')).toBe(90);
    expect(categoryTotal('enterprise')).toBe(180);
    expect(categoryTotal('verbal')).toBe(140);
    expect(categoryTotal('racing')).toBe(250);
  });

  it('has 650 judged points on scorecards', () => {
    expect(sum(INDIA_2026.areas.filter((a) => a.kind === 'scorecard').map((a) => a.max))).toBe(650);
  });

  it('keeps every scorecard area maximum equal to the sum of its criteria', () => {
    for (const a of INDIA_2026.areas.filter((x) => x.kind === 'scorecard')) {
      expect(sum(a.criteria.map((c) => c.max)), a.id).toBe(a.max);
      expect(a.criteria.length, a.id).toBeGreaterThan(0);
      expect(a.panel, a.id).not.toBeNull();
    }
  });

  it('has no criteria and no panel on derived areas', () => {
    for (const a of INDIA_2026.areas.filter((x) => x.kind === 'derived')) {
      expect(a.criteria, a.id).toEqual([]);
      expect(a.panel, a.id).toBeNull();
    }
    expect(INDIA_2026.areas.filter((a) => a.kind === 'derived').map((a) => a.id)).toEqual([
      'specifications', 'reaction', 'knockout', 'fastest-car',
    ]);
  });

  it('gives every criterion four contiguous bands covering 0..max', () => {
    for (const a of INDIA_2026.areas) {
      for (const c of a.criteria) {
        expect(c.bands, c.id).toHaveLength(4);
        expect(c.bands[0].min, c.id).toBe(0);
        expect(c.bands[3].max, c.id).toBe(c.max);
        for (let i = 1; i < 4; i++) expect(c.bands[i].min, c.id).toBe(c.bands[i - 1].max + 1);
      }
    }
  });

  it('uses the scorecard band ranges for 20, 15 and 10 point criteria', () => {
    const bands = (areaId: string, critId: string) =>
      area(areaId).criteria.find((c) => c.id === critId)!.bands.map((b) => `${b.min}-${b.max}`);
    expect(bands('verbal-technique', 'team-contribution')).toEqual(['0-5', '6-10', '11-15', '16-20']);
    expect(bands('pm-initiating', 'project-schedule')).toEqual(['0-3', '4-7', '8-11', '12-15']);
    expect(bands('pm-planning', 'roles-responsibilities')).toEqual(['0-2', '3-4', '5-7', '8-10']);
  });

  it('has unique area ids and unique criterion ids within an area', () => {
    const ids = INDIA_2026.areas.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of INDIA_2026.areas) {
      const cids = a.criteria.map((c) => c.id);
      expect(new Set(cids).size, a.id).toBe(cids.length);
    }
  });

  it('maps panels as in C12.3 and names the tie-break and protest rules', () => {
    expect(area('engineering-drawings').panel).toBe('scrutineering');
    expect(area('de-portfolio').panel).toBe('design_engineering');
    expect(area('pm-executing').panel).toBe('project_management');
    expect(area('pit-display').panel).toBe('enterprise');
    expect(area('verbal-subject').panel).toBe('verbal');
    expect(INDIA_2026.tieBreakAreaId).toBe('knockout');
    expect(INDIA_2026.protestPenalty).toBe(15);
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(INDIA_2026))).toEqual(INDIA_2026);
  });
});
