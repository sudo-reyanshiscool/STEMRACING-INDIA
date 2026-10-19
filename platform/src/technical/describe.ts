import type { ItemDef, RangeRule, Rule } from './types';

/** Integers get one decimal so limits read like the regulations: 65 -> "65.0". */
export function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const num = (n: number, unit: string): string => (unit === 'count' ? String(n) : fmt(n));
const unitLabel = (u: string): string => (u === 'deg' ? '°' : u === 'count' ? '' : ` ${u}`);

function bounds(min: number | undefined, max: number | undefined, unit: string): string {
  const u = unitLabel(unit);
  if (min !== undefined && max !== undefined) return `${num(min, unit)} to ${num(max, unit)}${u}`;
  if (min !== undefined) return `${num(min, unit)}${u} minimum`;
  if (max !== undefined) return `${num(max, unit)}${u} maximum`;
  return '';
}

export function describePenalty(rule: Rule): string {
  if ('flat' in rule.penalty) return `${rule.penalty.flat} pts`;
  const unit = rule.kind === 'span' ? 'mm' : (rule as RangeRule).unit;
  return `${rule.penalty.perUnit} pts per ${unit}`;
}

function itemBounds(items: ItemDef[], unit: string): string {
  const parts = items.map((i) => bounds(i.min, i.max, unit)).filter(Boolean);
  return [...new Set(parts)].join(' / ');
}

export function describeLimit(rule: Rule): string {
  const pen = describePenalty(rule);
  switch (rule.kind) {
    case 'range':
      return `${bounds(rule.min, rule.max, rule.unit) || 'None allowed'} · ${pen}`;
    case 'check':
    case 'perItemCheck':
      return `Pass or fail · ${pen}${rule.kind === 'perItemCheck' ? ' per wheel' : ''}`;
    case 'perItemRange':
      return `${itemBounds(rule.items, rule.unit)} · ${pen}`;
    case 'span':
      return `${fmt(rule.min)} mm minimum, shortest line governs · ${pen}`;
  }
}
