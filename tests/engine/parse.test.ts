import { describe, expect, it } from 'vitest';
import { parseMeasurement } from '../../src/engine/parse';

describe('parseMeasurement', () => {
  it('returns undefined for blank input', () => {
    expect(parseMeasurement('')).toBeUndefined();
    expect(parseMeasurement('   ')).toBeUndefined();
  });
  it('parses plain and comma decimals', () => {
    expect(parseMeasurement('47.2')).toBe(47.2);
    expect(parseMeasurement(' 47,2 ')).toBe(47.2);
    expect(parseMeasurement('48')).toBe(48);
    expect(parseMeasurement('.5')).toBe(0.5);
  });
  it('returns NaN for anything that is not a plain number', () => {
    for (const bad of ['abc', '1e3', '12mm', '1.2.3', '1,2,3', '--3', 'Infinity', '0x10']) {
      expect(parseMeasurement(bad), bad).toBeNaN();
    }
  });
  it('rejects negatives unless allowed', () => {
    expect(parseMeasurement('-3')).toBeNaN();
    expect(parseMeasurement('-3', { allowNegative: true })).toBe(-3);
    expect(parseMeasurement('+2', { allowNegative: true })).toBe(2);
  });
});
