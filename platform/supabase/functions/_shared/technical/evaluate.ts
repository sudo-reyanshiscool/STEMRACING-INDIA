import { fmt } from './describe.ts';
import { breachOf, nearLimit, penaltyFor, round6, wholeUnits } from './penalty.ts';
import {
  SPAN_LINES,
  type CheckRule, type ItemDef, type PerItemCheckRule, type PerItemRangeRule,
  type RangeRule, type Result, type Rule, type SpanRule, type Value,
} from './types.ts';

function base(rule: Rule): Result {
  return {
    article: rule.article, name: rule.name, cls: rule.cls, declaredCls: rule.cls,
    status: 'pending', penalty: 0, detail: [], notes: [], atRisk: false,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, number | boolean | undefined> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const unitSuffix = (unit: string): string => (unit === 'deg' ? '°' : unit === 'count' ? '' : ` ${unit}`);

function limitText(min: number | undefined, max: number | undefined, unit: string): string {
  const u = unitSuffix(unit);
  if (min !== undefined && max !== undefined) return `${fmt(min)} to ${fmt(max)}${u}`;
  if (min !== undefined) return `minimum ${fmt(min)}${u}`;
  return `maximum ${fmt(max as number)}${u}`;
}

const plural = (n: number): string => `${n} whole unit${n === 1 ? '' : 's'}`;

function evalRange(rule: RangeRule, value: Value): Result {
  const r = base(rule);
  if (value === undefined) return r;
  if (!isNum(value) || (value < 0 && rule.unit !== 'deg')) {
    r.status = 'invalid';
    return r;
  }
  const breach = breachOf(value, rule.min, rule.max);
  if (breach > 0) {
    r.status = 'fail';
    r.penalty = penaltyFor(rule.penalty, breach);
    const u = unitSuffix(rule.unit);
    const units = 'perUnit' in rule.penalty ? ` (${plural(wholeUnits(breach))})` : '';
    r.detail.push(`${value}${u} is ${breach}${u} outside ${limitText(rule.min, rule.max, rule.unit)}${units}`);
    if (rule.ballastIfUnder && rule.min !== undefined && value < rule.min) {
      r.notes.push(`Officials add ${round6(breach * 2)} g of underside ballast before the car may race (0.2 g per 0.1 g under).`);
    }
    return r;
  }
  r.status = 'pass';
  r.atRisk = (rule.unit === 'mm' || rule.unit === 'g') && nearLimit(value, rule.min, rule.max);
  return r;
}

function evalCheck(rule: CheckRule, value: Value): Result {
  const r = base(rule);
  if (value === undefined) return r;
  if (typeof value !== 'boolean') {
    r.status = 'invalid';
    return r;
  }
  if (value) {
    r.status = 'pass';
  } else {
    r.status = 'fail';
    r.penalty = rule.penalty.flat;
    r.detail.push(`Not compliant: ${rule.question}`);
  }
  return r;
}

function reclassify(rule: PerItemRangeRule, failing: ItemDef[], r: Result): void {
  if (!rule.generalIfOneWheelPerAxle || failing.length === 0) return;
  const groups = new Set(rule.items.map((i) => i.group ?? ''));
  const axleFullyOut = [...groups].some((g) => {
    const inGroup = rule.items.filter((i) => (i.group ?? '') === g);
    return inGroup.length > 1 && inGroup.every((i) => failing.includes(i));
  });
  if (!axleFullyOut) {
    r.cls = 'GEN';
    r.notes.push('Only one wheel on an axle is out: the points stand but this is classed General, so award eligibility is kept.');
  }
}

function evalPerItemRange(rule: PerItemRangeRule, value: Value): Result {
  const r = base(rule);
  if (value === undefined) return r;
  if (!isRecord(value)) {
    r.status = 'invalid';
    return r;
  }
  const failing: ItemDef[] = [];
  let pending = 0;
  let invalid = 0;
  for (const item of rule.items) {
    const v = value[item.id];
    if (v === undefined) { pending++; continue; }
    if (!isNum(v) || (v < 0 && rule.unit !== 'deg')) { invalid++; continue; }
    const breach = breachOf(v, item.min, item.max);
    if (breach > 0) {
      failing.push(item);
      r.penalty += penaltyFor(rule.penalty, breach);
      const u = unitSuffix(rule.unit);
      r.detail.push(`${item.label}: ${v}${u} is ${breach}${u} outside ${limitText(item.min, item.max, rule.unit)}`);
    } else if (rule.unit === 'mm' || rule.unit === 'g') {
      if (nearLimit(v, item.min, item.max)) r.atRisk = true;
    }
  }
  if (invalid > 0) { r.status = 'invalid'; r.atRisk = false; return r; }
  if (failing.length > 0) {
    r.status = 'fail';
    r.atRisk = false;
    reclassify(rule, failing, r);
    return r;
  }
  r.status = pending > 0 ? 'pending' : 'pass';
  if (r.status === 'pending') r.atRisk = false;
  return r;
}

function evalPerItemCheck(rule: PerItemCheckRule, value: Value): Result {
  const r = base(rule);
  if (value === undefined) return r;
  if (!isRecord(value)) {
    r.status = 'invalid';
    return r;
  }
  let pending = 0;
  let invalid = 0;
  let failures = 0;
  for (const item of rule.items) {
    const v = value[item.id];
    if (v === undefined) { pending++; continue; }
    if (typeof v !== 'boolean') { invalid++; continue; }
    if (!v) {
      failures++;
      r.detail.push(`${item.label}: not compliant: ${rule.question}`);
    }
  }
  if (invalid > 0) { r.status = 'invalid'; return r; }
  if (failures > 0) {
    r.status = 'fail';
    r.penalty = failures * rule.penalty.flat;
    return r;
  }
  r.status = pending > 0 ? 'pending' : 'pass';
  return r;
}

function evalSpan(rule: SpanRule, value: Value): Result {
  const r = base(rule);
  if (value === undefined) return r;
  if (!isRecord(value)) {
    r.status = 'invalid';
    return r;
  }
  const entered: { line: string; v: number }[] = [];
  for (const line of SPAN_LINES) {
    const v = value[line];
    if (v === undefined) continue;
    if (!isNum(v) || v < 0) { r.status = 'invalid'; return r; }
    entered.push({ line, v });
  }
  if (entered.length === 0) return r;
  const shortest = entered.reduce((a, b) => (b.v < a.v ? b : a));
  const breach = breachOf(shortest.v, rule.min, undefined);
  if (breach > 0) {
    r.status = 'fail';
    r.penalty = penaltyFor(rule.penalty, breach);
    r.detail.push(`Shortest line (${shortest.line}) is ${shortest.v} mm, ${breach} mm under ${fmt(rule.min)} mm (${plural(wholeUnits(breach))})`);
    return r;
  }
  if (entered.length < SPAN_LINES.length) return r;
  r.status = 'pass';
  r.atRisk = nearLimit(shortest.v, rule.min, undefined);
  return r;
}

export function evaluate(rule: Rule, value: Value): Result {
  switch (rule.kind) {
    case 'range': return evalRange(rule, value);
    case 'check': return evalCheck(rule, value);
    case 'perItemRange': return evalPerItemRange(rule, value);
    case 'perItemCheck': return evalPerItemCheck(rule, value);
    case 'span': return evalSpan(rule, value);
  }
}
