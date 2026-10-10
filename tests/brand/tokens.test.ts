import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const hex = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --${name} missing from tokens.css`);
  return m[1];
};

describe('brand tokens', () => {
  it('uses the exact brand values', () => {
    expect(hex('carbon-shadow').toUpperCase()).toBe('#05000B');
    expect(hex('chicane-violet').toUpperCase()).toBe('#961B81');
    expect(hex('pitlane-pink').toUpperCase()).toBe('#E6007E');
    expect(hex('burnout-orange').toUpperCase()).toBe('#ED6D05');
    expect(hex('podium-gold').toUpperCase()).toBe('#FCBC00');
  });

  it('keeps text pairs readable (4.5:1) on the surfaces the UI uses', () => {
    const pairs: [string, string][] = [
      ['carbon-100', 'carbon-shadow'],
      ['carbon-100', 'carbon-800'],
      ['white', 'carbon-shadow'],
      ['white', 'chicane-violet'],
      ['carbon-300', 'carbon-800'],
      ['carbon-300', 'carbon-shadow'],
      ['burnout-orange', 'carbon-shadow'],
      ['burnout-orange', 'carbon-800'],
      ['pitlane-pink', 'carbon-shadow'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the focus ring visible (3:1) on dark surfaces', () => {
    expect(contrast(hex('podium-gold'), hex('carbon-shadow'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('podium-gold'), hex('carbon-800'))).toBeGreaterThanOrEqual(3);
  });
});
