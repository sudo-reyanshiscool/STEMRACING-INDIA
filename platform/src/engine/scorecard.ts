import type { Area, Criterion } from './types';

export interface ScoreProblem {
  criterionId: string;
  kind: 'unknown' | 'not-integer' | 'out-of-range' | 'missing';
  message: string;
}

export const round1 = (n: number): number => Math.round((n + Number.EPSILON) * 10 + 1e-9) / 10;

export function validateScores(area: Area, scores: Record<string, number>, opts: { complete: boolean }): ScoreProblem[] {
  const problems: ScoreProblem[] = [];
  const byId = new Map(area.criteria.map((c) => [c.id, c]));
  // Walk the area's criteria first so problems come out in scorecard order.
  for (const c of area.criteria) {
    if (!(c.id in scores)) {
      if (opts.complete) problems.push({ criterionId: c.id, kind: 'missing', message: `${c.name} has no score` });
      continue;
    }
    const v = scores[c.id];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
      problems.push({ criterionId: c.id, kind: 'not-integer', message: `${c.name}: enter a whole number from 0 to ${c.max}` });
    } else if (v < 0 || v > c.max) {
      problems.push({ criterionId: c.id, kind: 'out-of-range', message: `${c.name}: score must be 0 to ${c.max}` });
    }
  }
  for (const id of Object.keys(scores)) {
    if (!byId.has(id)) problems.push({ criterionId: id, kind: 'unknown', message: `${id} is not a criterion of ${area.name}` });
  }
  return problems;
}

export function areaTotal(area: Area, scores: Record<string, number>): number {
  return area.criteria.reduce((sum, c) => sum + (typeof scores[c.id] === 'number' ? scores[c.id] : 0), 0);
}

export function bandIndex(criterion: Criterion, score: number): number {
  if (!Number.isInteger(score)) return -1;
  return criterion.bands.findIndex((b) => score >= b.min && score <= b.max);
}
