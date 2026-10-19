import { evaluate } from './evaluate';
import type { Measurements, Result, Rule, Value } from './types';

export const AWARDS_LOST = ['Fastest Car', 'Best Engineered Car'] as const;

export interface CarSummary {
  results: Result[];
  total: number;
  perfFailures: Result[];
  safetyFailures: Result[];
  generalFailures: Result[];
  atRisk: Result[];
  pending: Result[];
  invalid: Result[];
  ineligibleFor: string[];
  complete: boolean;
  started: boolean;
}

const entered = (v: Value): boolean =>
  v !== undefined && (typeof v !== 'object' || Object.values(v).some((x) => x !== undefined));

export function summarise(rules: Rule[], m: Measurements): CarSummary {
  const results = rules.map((rule) => evaluate(rule, m[rule.article]));
  const failures = results.filter((r) => r.status === 'fail');
  const perfFailures = failures.filter((r) => r.cls === 'PERF');
  const pending = results.filter((r) => r.status === 'pending');
  const invalid = results.filter((r) => r.status === 'invalid');
  return {
    results,
    total: results.reduce((sum, r) => sum + r.penalty, 0),
    perfFailures,
    safetyFailures: failures.filter((r) => r.cls === 'SAF'),
    generalFailures: failures.filter((r) => r.cls === 'GEN'),
    atRisk: results.filter((r) => r.status === 'pass' && r.atRisk),
    pending,
    invalid,
    ineligibleFor: perfFailures.length > 0 ? [...AWARDS_LOST] : [],
    complete: pending.length === 0 && invalid.length === 0,
    started: Object.values(m).some(entered),
  };
}

export type CarStatus = 'not-started' | 'in-progress' | 'clean' | 'penalties';

export function carStatus(s: CarSummary): CarStatus {
  if (!s.started) return 'not-started';
  if (!s.complete) return 'in-progress';
  return s.results.some((r) => r.status === 'fail') ? 'penalties' : 'clean';
}

export interface PairSummary {
  total: number;
  shared: Result[];
  onlyA: Result[];
  onlyB: Result[];
}

export function summarisePair(a: CarSummary, b: CarSummary): PairSummary {
  const failed = (s: CarSummary) => s.results.filter((r) => r.status === 'fail');
  const fa = failed(a);
  const fb = failed(b);
  const inB = new Set(fb.map((r) => r.article));
  const inA = new Set(fa.map((r) => r.article));
  return {
    total: a.total + b.total,
    shared: fa.filter((r) => inB.has(r.article)),
    onlyA: fa.filter((r) => !inB.has(r.article)),
    onlyB: fb.filter((r) => !inA.has(r.article)),
  };
}

/** Specifications score for a team: 100 minus combined Car A + B penalties, floored at 0. */
export function specificationsScore(a: CarSummary, b: CarSummary): number {
  return Math.max(0, 100 - a.total - b.total);
}
