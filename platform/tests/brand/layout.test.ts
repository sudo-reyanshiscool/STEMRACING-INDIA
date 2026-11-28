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

  // Beside the tools (theme switch, email, two buttons: about 444px) the save status gets only what is left:
  // nothing at 641px, and a warning such as "2 scores waiting to send…" broke one word per line up to about 860px.
  it('gives the save status its own header row up to 1000px, so a warning is never squeezed beside the tools', () => {
    const compact = css.match(/@media \(max-width: 1000px\)\s*\{\s*\.site-header \{[\s\S]*?\n\}/);
    expect(compact, 'compact frame rules').not.toBeNull();
    const grid = compact![0].match(/\.site-header__in\s*\{([^}]*)\}/);
    expect(grid, 'compact .site-header__in rule').not.toBeNull();
    expect(grid![1]).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)\s*;/);
    const bar = compact![0].match(/\.sync-bar\s*\{([^}]*)\}/);
    expect(bar, 'compact .sync-bar rule').not.toBeNull();
    expect(bar![1]).toMatch(/grid-column:\s*1 \/ -1/);
    expect(bar![1]).toMatch(/grid-row:\s*2/);
  });

  // On a phone the header's second column is capped (190px at 320px wide) and holds a 44px theme switch plus
  // two buttons that never shrink. Without wrapping, the right-aligned buttons slide left over the switch.
  it('drops the account buttons to their own row on a narrow phone instead of covering the theme switch', () => {
    const phone = css.match(/@media \(max-width: 640px\)\s*\{\s*\.site-header__in[\s\S]*?\n\}/);
    expect(phone, 'phone header rules').not.toBeNull();
    const tools = phone![0].match(/\.header-tools\s*\{([^}]*)\}/);
    expect(tools, 'phone .header-tools rule').not.toBeNull();
    expect(tools![1]).toMatch(/flex-wrap:\s*wrap/);
  });

  // At 360px, the commonest Android width, the tools have 230px: 44 switch + 4 + two buttons + 6 between them.
  // The labels are about 63px and 61px wide, so the side padding can be at most 12px for one row.
  it('keeps the phone account buttons narrow enough to share a row with the theme switch at 360px', () => {
    const rule = css.match(/@media \(max-width: 640px\)\s*\{\s*\.site-header__in[\s\S]*?\.who \.btn\s*\{([^}]*)\}/);
    expect(rule, 'phone .who .btn rule').not.toBeNull();
    const side = rule![1].match(/padding:\s*\d+px\s+(\d+)px\s*;/);
    expect(side, 'two-value padding').not.toBeNull();
    expect(Number(side![1])).toBeLessThanOrEqual(12);
    expect(rule![1]).toMatch(/min-height:\s*40px/);
  });

  it('stacks the moderation table on a phone so the Chair override is not off screen', () => {
    const block = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/);
    expect(block, 'phone media query').not.toBeNull();
    expect(block![1]).toMatch(/\.mod-table tr[^}]*display:\s*block|\.mod-table, \.mod-table tbody, \.mod-table tr[^{]*\{[^}]*display:\s*block/);
  });
});
