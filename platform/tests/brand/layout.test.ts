import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/platform.css', 'utf8');

describe('platform layout rules', () => {
  it('pins the last table column with a solid background so scrolled cells never show through it', () => {
    const rule = css.match(/\.table \.pin-end\s*\{([^}]*)\}/);
    expect(rule, '.table .pin-end rule').not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*sticky/);
    expect(rule![1]).toMatch(/right:\s*0/);
    expect(rule![1]).toMatch(/background:\s*var\(--bg\)/);
  });

  it('lets long unbroken values such as the SHA-256 fingerprint wrap instead of widening the page', () => {
    const rule = css.match(/main code\s*\{([^}]*)\}/);
    expect(rule, 'main code rule').not.toBeNull();
    expect(rule![1]).toMatch(/word-break:\s*break-all/);
  });

  it('stacks the moderation table on a phone so the Chair override is not off screen', () => {
    const block = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/);
    expect(block, 'phone media query').not.toBeNull();
    expect(block![1]).toMatch(/\.mod-table tr[^}]*display:\s*block|\.mod-table, \.mod-table tbody, \.mod-table tr[^{]*\{[^}]*display:\s*block/);
  });
});
