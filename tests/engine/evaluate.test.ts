import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/evaluate';
import { describeLimit } from '../../src/engine/describe';
import type { CheckRule, PerItemCheckRule, PerItemRangeRule, RangeRule, SpanRule } from '../../src/engine/types';

const weight: RangeRule = {
  kind: 'range', article: 'T3.6', name: 'Weight', cls: 'PERF', section: 'scales',
  unit: 'g', min: 48, penalty: { perUnit: 10 }, ballastIfUnder: true,
};
const width: RangeRule = {
  kind: 'range', article: 'T3.4', name: 'Width', cls: 'GEN', section: 'scales',
  unit: 'mm', min: 65, max: 85, penalty: { perUnit: 5 },
};
const angle: RangeRule = {
  kind: 'range', article: 'T5.4', name: 'Chamber angle', cls: 'SAF', section: 'chamber',
  unit: 'deg', min: -3, max: 3, penalty: { flat: 5 },
};
const chamberDia: RangeRule = {
  kind: 'range', article: 'T5.1', name: 'Chamber diameter', cls: 'SAF', section: 'chamber',
  unit: 'mm', min: 18, max: 18.5, penalty: { flat: 5 },
};
const sticker: CheckRule = {
  kind: 'check', article: 'T3.1.3', name: 'Sticker', cls: 'GEN', section: 'registration',
  question: 'Sticker present', penalty: { flat: 5 },
};
const contact: PerItemRangeRule = {
  kind: 'perItemRange', article: 'T7.4', name: 'Contact width', cls: 'PERF', section: 'wheels', unit: 'mm',
  penalty: { perUnit: 2.5 }, generalIfOneWheelPerAxle: true,
  items: [
    { id: 'FL', label: 'Front left', group: 'front', min: 12 },
    { id: 'FR', label: 'Front right', group: 'front', min: 12 },
    { id: 'RL', label: 'Rear left', group: 'rear', min: 15 },
    { id: 'RR', label: 'Rear right', group: 'rear', min: 15 },
  ],
};
const rotation: PerItemCheckRule = {
  kind: 'perItemCheck', article: 'T7.8', name: 'Rotation', cls: 'PERF', section: 'wheels',
  question: 'Rotates freely', penalty: { flat: 5 },
  items: [
    { id: 'FL', label: 'Front left' }, { id: 'FR', label: 'Front right' },
    { id: 'RL', label: 'Rear left' }, { id: 'RR', label: 'Rear right' },
  ],
};
const span: SpanRule = {
  kind: 'span', article: 'T9.5.1', name: 'Rear wing span', cls: 'PERF', section: 'rear',
  min: 50, penalty: { perUnit: 2 },
};

describe('range rules', () => {
  it('is pending when nothing is entered', () => {
    const r = evaluate(weight, undefined);
    expect(r.status).toBe('pending');
    expect(r.penalty).toBe(0);
  });
  it('passes exactly on the limit and does not penalise', () => {
    const r = evaluate(weight, 48);
    expect(r.status).toBe('pass');
    expect(r.penalty).toBe(0);
  });
  it('fails 47.9 g by one whole unit', () => {
    const r = evaluate(weight, 47.9);
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
  });
  it('notes the ballast officials add when underweight', () => {
    const r = evaluate(weight, 46.5);
    expect(r.penalty).toBe(20);
    expect(r.notes.join(' ')).toContain('3 g');
  });
  it('flags a pass within 0.5 of a limit as at risk', () => {
    expect(evaluate(width, 84.8).atRisk).toBe(true);
    expect(evaluate(width, 75).atRisk).toBe(false);
  });
  it('treats NaN and negatives as invalid, but allows negative degrees', () => {
    expect(evaluate(width, NaN).status).toBe('invalid');
    expect(evaluate(width, -1).status).toBe('invalid');
    expect(evaluate(angle, -2).status).toBe('pass');
    expect(evaluate(angle, -3.5).status).toBe('fail');
  });
  it('charges flat rules once however far out', () => {
    expect(evaluate(chamberDia, 17).penalty).toBe(5);
    expect(evaluate(chamberDia, 19.9).penalty).toBe(5);
  });
  it('rejects a non-number value as invalid', () => {
    expect(evaluate(width, true).status).toBe('invalid');
  });
});

describe('check rules', () => {
  it('is pending, passes on true, fails on false with the flat penalty', () => {
    expect(evaluate(sticker, undefined).status).toBe('pending');
    expect(evaluate(sticker, true).status).toBe('pass');
    const f = evaluate(sticker, false);
    expect(f.status).toBe('fail');
    expect(f.penalty).toBe(5);
  });
  it('rejects a number as invalid', () => {
    expect(evaluate(sticker, 3).status).toBe('invalid');
  });
});

describe('per-item range rules', () => {
  it('stays pending until every item is entered, but fails early on a bad item', () => {
    expect(evaluate(contact, { FL: 13 }).status).toBe('pending');
    const early = evaluate(contact, { FL: 10 });
    expect(early.status).toBe('fail');
    expect(early.penalty).toBe(5);
  });
  it('multiplies by failing wheels: both rears at 13.8 vs 15.0 is 10 pts, stays PERF', () => {
    const r = evaluate(contact, { FL: 13, FR: 13, RL: 13.8, RR: 13.8 });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
    expect(r.cls).toBe('PERF');
  });
  it('reclassifies to General when only one wheel on an axle is out, keeping the points', () => {
    const r = evaluate(contact, { FL: 13, FR: 13, RL: 13.8, RR: 15 });
    expect(r.penalty).toBe(5);
    expect(r.cls).toBe('GEN');
    expect(r.declaredCls).toBe('PERF');
    expect(r.notes.join(' ')).toContain('General');
  });
  it('reports invalid when any item is not a number', () => {
    expect(evaluate(contact, { FL: NaN, FR: 13, RL: 15, RR: 15 }).status).toBe('invalid');
  });
});

describe('per-item check rules', () => {
  it('charges per failing wheel', () => {
    const r = evaluate(rotation, { FL: true, FR: false, RL: false, RR: true });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
  });
  it('passes when all four are true', () => {
    expect(evaluate(rotation, { FL: true, FR: true, RL: true, RR: true }).status).toBe('pass');
  });
  it('is pending with a partial answer and no failures', () => {
    expect(evaluate(rotation, { FL: true }).status).toBe('pending');
  });
});

describe('span rules', () => {
  it('the shortest of the four lines governs: 47.2 vs 50.0 is 6 pts', () => {
    const r = evaluate(span, { leading: 50, trailing: 47.2, top: 50, bottom: 50 });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(6);
    expect(r.detail.join(' ')).toContain('trailing');
  });
  it('passes when all four lines meet the minimum', () => {
    expect(evaluate(span, { leading: 50, trailing: 50.4, top: 51, bottom: 52 }).status).toBe('pass');
  });
  it('is pending with fewer than four lines unless one is already short', () => {
    expect(evaluate(span, { leading: 52 }).status).toBe('pending');
    expect(evaluate(span, { leading: 49 }).status).toBe('fail');
  });
});

describe('describeLimit', () => {
  it('describes ranges and penalties for the row label', () => {
    expect(describeLimit(width)).toBe('65.0 to 85.0 mm · 5 pts per mm');
    expect(describeLimit(weight)).toBe('48.0 g minimum · 10 pts per g');
    expect(describeLimit(sticker)).toBe('Pass or fail · 5 pts');
    expect(describeLimit(span)).toBe('50.0 mm minimum, shortest line governs · 2 pts per mm');
  });
});
