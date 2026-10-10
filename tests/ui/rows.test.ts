import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../../src/engine';
import { ruleByArticle } from '../../src/rules';
import { ruleRow } from '../../src/ui/rows';

const rule = (a: string) => ruleByArticle(a)!;
const type = (el: HTMLInputElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('ruleRow', () => {
  it('parses typed numbers, treating a comma as a decimal point', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.6'), undefined, onChange);
    const input = el.querySelector('input')!;
    type(input, '46,5');
    expect(onChange).toHaveBeenLastCalledWith(46.5);
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('reports NaN for garbage and marks the input invalid', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.6'), undefined, onChange);
    const input = el.querySelector('input')!;
    type(input, 'abc');
    expect(onChange.mock.calls.at(-1)![0]).toBeNaN();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type(input, '47');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('exposes the accessible name from article, name and unit', () => {
    const { el } = ruleRow(rule('T3.6'), undefined, () => {});
    expect(el.querySelector('input')!.getAttribute('aria-label')).toBe('T3.6 Total weight (no cartridge) (g)');
  });

  it('allows a negative chamber angle but not a negative weight', () => {
    const onChange = vi.fn();
    const angle = ruleRow(rule('T5.4'), undefined, onChange);
    type(angle.el.querySelector('input')!, '-2');
    expect(onChange).toHaveBeenLastCalledWith(-2);
    const weight = ruleRow(rule('T3.6'), undefined, onChange);
    type(weight.el.querySelector('input')!, '-2');
    expect(onChange.mock.calls.at(-1)![0]).toBeNaN();
  });

  it('pass/fail rows are a radio group and clicking the active option clears it', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.1.3'), undefined, onChange);
    const [pass, fail] = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    pass.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(pass.getAttribute('aria-checked')).toBe('true');
    fail.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    fail.click();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(fail.getAttribute('aria-checked')).toBe('false');
  });

  it('per-wheel rows keep a value per wheel', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T7.4'), undefined, onChange);
    const inputs = [...el.querySelectorAll('input')];
    expect(inputs).toHaveLength(4);
    type(inputs[2], '13.8');
    expect(onChange).toHaveBeenLastCalledWith({ RL: 13.8 });
    type(inputs[3], '13.8');
    expect(onChange).toHaveBeenLastCalledWith({ RL: 13.8, RR: 13.8 });
  });

  it('span rows have four lines', () => {
    const { el } = ruleRow(rule('T9.5.1'), undefined, () => {});
    expect(el.querySelectorAll('input')).toHaveLength(4);
  });

  it('shows the result as words, with points and detail, as plain text', () => {
    const { el, showResult } = ruleRow(rule('T3.6'), 46.5, () => {});
    showResult(evaluate(rule('T3.6'), 46.5));
    const result = el.querySelector('.row__result')!;
    expect(result.textContent).toContain('Fail');
    expect(result.textContent).toContain('20 pts');
    expect(el.classList.contains('row--fail')).toBe(true);
    showResult(evaluate(rule('T3.6'), undefined));
    expect(result.textContent).toContain('To do');
    expect(el.classList.contains('row--fail')).toBe(false);
  });

  it('restores initial values into the inputs', () => {
    const { el } = ruleRow(rule('T3.6'), 47.2, () => {});
    expect(el.querySelector('input')!.value).toBe('47.2');
  });
});
