import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/evaluate';
import { SECTIONS, WF26, ruleByArticle } from '../../src/rules';

const rule = (a: string) => {
  const r = ruleByArticle(a);
  if (!r) throw new Error(`rule ${a} missing`);
  return r;
};

describe('WF26 rule data integrity', () => {
  it('has unique article keys', () => {
    const arts = WF26.rules.map((r) => r.article);
    expect(new Set(arts).size).toBe(arts.length);
  });
  it('puts every rule in a known section, in bench order', () => {
    const ids = SECTIONS.map((s) => s.id);
    for (const r of WF26.rules) expect(ids).toContain(r.section);
    const order = WF26.rules.map((r) => ids.indexOf(r.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('marks every PP+ article from T2.5.2 as proportional', () => {
    const pp = [
      'T3.4', 'T3.5', 'T3.6', 'T3.7', 'T5.2', 'T5.6', 'T7.2', 'T7.3', 'T7.4', 'T7.5', 'T7.11',
      'T8.6.1', 'T8.6.2', 'T8.6.3', 'T9.5.1', 'T9.5.2', 'T9.5.3', 'T9.5.4',
    ];
    for (const a of pp) {
      expect('perUnit' in rule(a).penalty, a).toBe(true);
    }
  });
  it('has the issue date of the regulations', () => {
    expect(WF26.id).toBe('wf26-professional');
    expect(WF26.issued).toBe('2026-02-10');
  });
});

describe('WF26 worked examples from the regulation digest', () => {
  it('T9.5.1 rear wing span 47.2 vs 50.0 is 6 pts per car', () => {
    const r = evaluate(rule('T9.5.1'), { leading: 47.2, trailing: 47.2, top: 47.2, bottom: 47.2 });
    expect(r.penalty).toBe(6);
  });
  it('T3.6 weight 46.5 vs 48.0 is 20 pts plus 3 g ballast', () => {
    const r = evaluate(rule('T3.6'), 46.5);
    expect(r.penalty).toBe(20);
    expect(r.notes.join(' ')).toContain('3 g');
  });
  it('T7.3 wheelbase 141.3 vs 140.0 is 10 pts', () => {
    expect(evaluate(rule('T7.3'), 141.3).penalty).toBe(10);
  });
  it('T7.11 front obstruction 22.4 vs 20.0 is 30 pts', () => {
    expect(evaluate(rule('T7.11'), 22.4).penalty).toBe(30);
  });
  it('T7.4 both rear wheels at 13.8 vs 15.0 is 10 pts and stays Performance', () => {
    const r = evaluate(rule('T7.4'), { FL: 12, FR: 12, RL: 13.8, RR: 13.8 });
    expect(r.penalty).toBe(10);
    expect(r.cls).toBe('PERF');
  });
  it('T7.4 one rear wheel at 13.8 keeps 5 pts but is General', () => {
    const r = evaluate(rule('T7.4'), { FL: 12, FR: 12, RL: 13.8, RR: 15 });
    expect(r.penalty).toBe(5);
    expect(r.cls).toBe('GEN');
  });
  it('T3.6 exactly 48.0 g passes and 47.9 g fails by one unit', () => {
    expect(evaluate(rule('T3.6'), 48).status).toBe('pass');
    expect(evaluate(rule('T3.6'), 47.9).penalty).toBe(10);
  });
  it('T7.2 uses 38.0 front and 34.0 rear', () => {
    const r = evaluate(rule('T7.2'), { front: 37, rear: 34 });
    expect(r.penalty).toBe(2.5);
    expect(evaluate(rule('T7.2'), { front: 38, rear: 34 }).status).toBe('pass');
  });
  it('T4.4.4 halo notch accepts 33.0 to 35.0', () => {
    expect(evaluate(rule('T4.4.4'), 34).status).toBe('pass');
    expect(evaluate(rule('T4.4.4'), 35.1).penalty).toBe(5);
  });
  it('T5.4 chamber angle accepts negative degrees', () => {
    expect(evaluate(rule('T5.4'), -2.5).status).toBe('pass');
  });
});
