import type { Penalty } from './types';

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** T2.5.2: round a breach UP to the next complete unit. Rounding to 6 dp first removes float noise. */
export function wholeUnits(breach: number): number {
  const b = round6(breach);
  return b <= 0 ? 0 : Math.ceil(b);
}

/** Distance outside the limits; 0 on or inside them (limits are absolute, T2.7.1). */
export function breachOf(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return round6(min - value);
  if (max !== undefined && value > max) return round6(value - max);
  return 0;
}

export function penaltyFor(p: Penalty, breach: number): number {
  if (breach <= 0) return 0;
  return 'flat' in p ? p.flat : wholeUnits(breach) * p.perUnit;
}

/** A passing value within `tol` of a limit is a manufacturing risk (paint and decals eat margin). */
export function nearLimit(value: number, min?: number, max?: number, tol = 0.5): boolean {
  if (min !== undefined && round6(value - min) <= tol) return true;
  if (max !== undefined && round6(max - value) <= tol) return true;
  return false;
}
