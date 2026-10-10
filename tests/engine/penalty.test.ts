import { describe, expect, it } from 'vitest';
import { breachOf, nearLimit, penaltyFor, wholeUnits } from '../../src/engine/penalty';

describe('wholeUnits', () => {
  it('rounds a breach up to the next complete unit', () => {
    expect(wholeUnits(2.8)).toBe(3);
    expect(wholeUnits(1.3)).toBe(2);
    expect(wholeUnits(0.01)).toBe(1);
    expect(wholeUnits(1.5)).toBe(2);
  });
  it('does not over-count a whole-number breach hit by float noise', () => {
    expect(wholeUnits(1.0000000000000284)).toBe(1);
    expect(wholeUnits(62.0 - 61.0)).toBe(1);
    expect(wholeUnits(2.8000000000000043)).toBe(3);
    expect(wholeUnits(0)).toBe(0);
  });
});

describe('breachOf', () => {
  it('is zero on or inside the limits (limits are absolute)', () => {
    expect(breachOf(48, 48, undefined)).toBe(0);
    expect(breachOf(85, 65, 85)).toBe(0);
  });
  it('measures distance outside the nearest limit', () => {
    expect(breachOf(47.9, 48, undefined)).toBe(0.1);
    expect(breachOf(141.3, 120, 140)).toBe(1.3);
    expect(breachOf(60, 65, 85)).toBe(5);
  });
});

describe('penaltyFor', () => {
  it('charges a flat penalty once for any breach', () => {
    expect(penaltyFor({ flat: 5 }, 0.01)).toBe(5);
    expect(penaltyFor({ flat: 5 }, 0)).toBe(0);
  });
  it('charges per whole unit for proportional penalties', () => {
    expect(penaltyFor({ perUnit: 2 }, 2.8)).toBe(6);
    expect(penaltyFor({ perUnit: 10 }, 1.5)).toBe(20);
    expect(penaltyFor({ perUnit: 2.5 }, 1.2)).toBe(5);
  });
});

describe('nearLimit', () => {
  it('flags passing values within 0.5 of a limit', () => {
    expect(nearLimit(48.3, 48, undefined)).toBe(true);
    expect(nearLimit(48.5, 48, undefined)).toBe(true);
    expect(nearLimit(48.6, 48, undefined)).toBe(false);
    expect(nearLimit(84.7, 65, 85)).toBe(true);
    expect(nearLimit(75, 65, 85)).toBe(false);
  });
});
