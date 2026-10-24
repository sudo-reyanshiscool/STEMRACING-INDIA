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

describe('light and dark interface contrast', () => {
  const root = css.match(/:root\s*\{([^}]+)\}/)![1];
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)![1];
  const declarations = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  for (const [theme, block] of [['light', root], ['dark', root + dark]]) {
    it(`keeps text and score-band guidance readable in ${theme} mode`, () => {
      const tokens = declarations(block);
      const resolve = (name: string): string => {
        const value = tokens[name];
        return value.startsWith('var(') ? resolve(value.slice(6, -1)) : value;
      };
      for (const surface of ['bg', 'bg-raised', 'bg-subtle', 'input-bg', 'sheet-surface', 'sheet-subtotal']) {
        for (const text of ['fg', 'fg-strong', 'fg-muted']) expect(contrast(resolve(text), resolve(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const band of ['low','mid-low','mid-high','high']) expect(contrast(resolve(`band-${band}`), resolve(`band-${band}-bg`)), band).toBeGreaterThanOrEqual(4.5);
      for (const text of ['danger', 'warning', 'success', 'heading-accent']) expect(contrast(resolve(text), resolve('bg-raised')), text).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve('focus'), resolve('bg'))).toBeGreaterThanOrEqual(3);
    });
  }
});
