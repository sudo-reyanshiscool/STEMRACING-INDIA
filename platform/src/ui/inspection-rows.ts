import { describeLimit, parseMeasurement, type Result, type Rule, type Value, SPAN_LINES } from '../technical';
import { h } from './dom';
import { classTag, statusTag } from './inspection-tags';

type Rec = Record<string, number | boolean | undefined>;

const SPAN_LABELS: Record<(typeof SPAN_LINES)[number], string> = {
  leading: 'Leading edge', trailing: 'Trailing edge', top: 'Top surface', bottom: 'Bottom surface',
};

function numberField(
  label: string, ariaName: string, unit: string, initial: number | undefined, allowNegative: boolean,
  disabled: boolean, onValue: (v: number | undefined) => void,
): HTMLElement {
  const input = h('input', {
    type: 'text', inputmode: allowNegative ? 'text' : 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': ariaName, 'aria-invalid': 'false', value: initial === undefined || Number.isNaN(initial) ? '' : String(initial),
    disabled: disabled || null,
  });
  input.addEventListener('input', () => {
    const v = parseMeasurement(input.value, { allowNegative });
    input.setAttribute('aria-invalid', Number.isNaN(v) ? 'true' : 'false');
    onValue(v);
  });
  const unitLabel = unit === 'deg' ? '°' : unit === 'count' ? 'no.' : unit;
  return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label),
    h('span', { class: 'field__box' }, input, h('span', { class: 'field__unit' }, unitLabel)));
}

function passFail(ariaName: string, label: string, initial: boolean | undefined, disabled: boolean, onValue: (v: boolean | undefined) => void): HTMLElement {
  let current = initial;
  const pass = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === true), disabled: disabled || null }, 'Pass');
  const fail = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === false), disabled: disabled || null }, 'Fail');
  const set = (next: boolean) => {
    if (disabled) return;
    current = current === next ? undefined : next;
    pass.setAttribute('aria-checked', String(current === true));
    fail.setAttribute('aria-checked', String(current === false));
    onValue(current);
  };
  pass.addEventListener('click', () => set(true));
  fail.addEventListener('click', () => set(false));
  return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), h('div', { class: 'seg', role: 'radiogroup', 'aria-label': ariaName }, pass, fail));
}

function controls(rule: Rule, initial: Value, disabled: boolean, onChange: (v: Value) => void): HTMLElement[] {
  const record = (): Rec => (typeof initial === 'object' && initial !== null ? { ...initial } : {});
  switch (rule.kind) {
    case 'range':
      return [numberField('Measured', `${rule.article} ${rule.name} (${rule.unit})`, rule.unit, typeof initial === 'number' ? initial : undefined, rule.unit === 'deg', disabled, (v) => onChange(v))];
    case 'check':
      return [passFail(`${rule.article} ${rule.name}`, 'Compliant?', typeof initial === 'boolean' ? initial : undefined, disabled, (v) => onChange(v))];
    case 'perItemRange': {
      const rec = record();
      return rule.items.map((item) =>
        numberField(item.label, `${rule.article} ${item.label} (${rule.unit})`, rule.unit, rec[item.id] as number | undefined, false, disabled, (v) => {
          if (v === undefined) delete rec[item.id]; else rec[item.id] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
    case 'perItemCheck': {
      const rec = record();
      return rule.items.map((item) =>
        passFail(`${rule.article} ${item.label}`, item.label, rec[item.id] as boolean | undefined, disabled, (v) => {
          if (v === undefined) delete rec[item.id]; else rec[item.id] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
    case 'span': {
      const rec = record();
      return SPAN_LINES.map((line) =>
        numberField(SPAN_LABELS[line], `${rule.article} ${SPAN_LABELS[line]} (mm)`, 'mm', rec[line] as number | undefined, false, disabled, (v) => {
          if (v === undefined) delete rec[line]; else rec[line] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
  }
}

export function ruleRow(rule: Rule, initial: Value, disabled: boolean, onChange: (v: Value) => void): { el: HTMLElement; showResult: (r: Result) => void } {
  const result = h('div', { class: 'row__result', 'aria-live': 'polite' });
  const el = h('article', { class: 'row', id: `rule-${rule.article}` },
    h('div', { class: 'row__head' },
      h('h3', null, h('span', { class: 'row__art' }, rule.article), ' ', rule.name),
      classTag(rule.cls),
    ),
    h('p', { class: 'row__limit' }, describeLimit(rule)),
    'question' in rule ? h('p', null, rule.question) : null,
    rule.condition ? h('p', { class: 'small muted' }, `Measure: ${rule.condition.toLowerCase()}`) : null,
    rule.hint ? h('p', { class: 'small muted' }, rule.hint) : null,
    h('div', { class: 'row__controls' }, controls(rule, initial, disabled, onChange)),
    result,
  );

  const showResult = (r: Result): void => {
    el.classList.toggle('row--fail', r.status === 'fail');
    const parts: Array<HTMLElement | string> = [statusTag(r.status, r.atRisk)];
    if (r.status === 'fail') parts.push(h('strong', null, `${r.penalty} pts`));
    if (r.cls !== r.declaredCls) parts.push(classTag(r.cls));
    if (r.atRisk) parts.push(h('span', { class: 'small' }, 'Within 0.5 of a limit: paint and decals can tip it over.'));
    const extra = [...r.detail, ...r.notes];
    result.replaceChildren(...parts, extra.length ? h('ul', { class: 'row__notes' }, extra.map((t) => h('li', null, t))) : '');
  };

  return { el, showResult };
}
