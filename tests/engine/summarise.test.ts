import { describe, expect, it } from 'vitest';
import { AWARDS_LOST, carStatus, summarise, summarisePair } from '../../src/engine';
import { WF26 } from '../../src/rules';

const rules = WF26.rules;

describe('summarise', () => {
  it('an untouched car is not started, totals 0 and every row is pending', () => {
    const s = summarise(rules, {});
    expect(s.started).toBe(false);
    expect(s.total).toBe(0);
    expect(s.pending.length).toBe(rules.length);
    expect(s.complete).toBe(false);
    expect(carStatus(s)).toBe('not-started');
  });

  it('totals penalties and splits failures by effective class', () => {
    const s = summarise(rules, {
      'T3.6': 46.5, // PERF, 20
      'T3.4': 60, // GEN, 5 mm under 65 -> 25
      'T5.1': 17, // SAF, 5
    });
    expect(s.total).toBe(20 + 25 + 5);
    expect(s.perfFailures.map((r) => r.article)).toEqual(['T3.6']);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T3.4']);
    expect(s.safetyFailures.map((r) => r.article)).toEqual(['T5.1']);
    expect(s.ineligibleFor).toEqual([...AWARDS_LOST]);
    expect(carStatus(s)).toBe('in-progress');
  });

  it('a General-reclassified single wheel breach does not cost award eligibility', () => {
    const s = summarise(rules, { 'T7.4': { FL: 12, FR: 12, RL: 13.8, RR: 15 } });
    expect(s.total).toBe(5);
    expect(s.perfFailures).toHaveLength(0);
    expect(s.ineligibleFor).toEqual([]);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T7.4']);
  });

  it('lists at-risk passes and invalid rows', () => {
    const s = summarise(rules, { 'T3.4': 84.9, 'T3.5': NaN });
    expect(s.atRisk.map((r) => r.article)).toEqual(['T3.4']);
    expect(s.invalid.map((r) => r.article)).toEqual(['T3.5']);
    expect(s.total).toBe(0);
  });

  it('ignores measurements for unknown articles', () => {
    const s = summarise(rules, { 'T99.9': 5 });
    expect(s.started).toBe(true);
    expect(s.total).toBe(0);
  });

  it('counts a zero-point failed gate as a failure', () => {
    const s = summarise(rules, { 'T2.7': false });
    expect(s.total).toBe(0);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T2.7']);
  });
});

describe('carStatus', () => {
  const answered = () =>
    Object.fromEntries(
      rules.map((r) => {
        switch (r.kind) {
          case 'check': return [r.article, true];
          case 'range': return [r.article, r.min ?? 0];
          case 'span': return [r.article, { leading: 60, trailing: 60, top: 60, bottom: 60 }];
          case 'perItemCheck': return [r.article, Object.fromEntries(r.items.map((i) => [i.id, true]))];
          case 'perItemRange': return [r.article, Object.fromEntries(r.items.map((i) => [i.id, i.min ?? i.max ?? 0]))];
        }
      }),
    );

  it('is in progress when only some rows are answered', () => {
    const partial = summarise(rules, { 'T3.6': 50 });
    expect(carStatus(partial)).toBe('in-progress');
  });

  it('reports clean when complete with no failures, penalties otherwise', () => {
    expect(carStatus(summarise(rules, answered()))).toBe('clean');
    expect(carStatus(summarise(rules, { ...answered(), 'T3.6': 40 }))).toBe('penalties');
  });
});

describe('summarisePair', () => {
  it('adds totals and finds faults shared by both cars', () => {
    const a = summarise(rules, { 'T3.6': 46.5, 'T3.4': 60 });
    const b = summarise(rules, { 'T3.6': 46.5, 'T5.1': 17 });
    const p = summarisePair(a, b);
    expect(p.total).toBe(a.total + b.total);
    expect(p.shared.map((r) => r.article)).toEqual(['T3.6']);
    expect(p.onlyA.map((r) => r.article)).toEqual(['T3.4']);
    expect(p.onlyB.map((r) => r.article)).toEqual(['T5.1']);
  });
});
