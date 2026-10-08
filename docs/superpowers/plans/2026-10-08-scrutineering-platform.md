# STEM Racing India Digital Scrutineering Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline-first PWA that scrutineers use at the bench to enter car measurements, get WF26 penalties computed automatically, and print a result sheet, styled with the STEM Racing brand system.

**Architecture:** A framework-free TypeScript app. A pure rules engine (`src/engine`) evaluates typed WF26 rule data (`src/rules`) against measurements; IndexedDB (`src/store`) persists events, teams, cars and inspections; small DOM screens (`src/ui`) render the checklist; jsPDF builds the result sheet. No backend.

**Tech Stack:** TypeScript, Vite, vite-plugin-pwa, idb, jsPDF + jspdf-autotable, Vitest + jsdom + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-scrutineering-platform-design.md`

**Regulation source of truth:** `/Users/rg/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/475458fb-4d9e-44b9-ac36-7ebaa61a6350/41305dd3-ca3e-4662-b512-80e23c2a3603/skills/stem-racing-regulations/references/wf26-technical-digest.md` (and `SRWF26_Technical_Regulations.pdf` beside it). Rule data in Task 4 is copied from it.

**Brand source of truth:** the published "STEM Racing" design system, https://claude.ai/artifact/KutpCGGzkX3doLkwNpHZCQ (Secondary division theme of the STEM Racing Brand Identity Guidelines v1.3), and the brand pack at `/Users/rg/Downloads/STEM RACING BRANDING SHARE/`.

## Deviations from the spec (decided while planning)

- **T7.9 zones** are four separate `check` rules (T7.9.1 to T7.9.4), not a `tiered` kind. Same behaviour, less engine code.
- **PDF typography:** jsPDF cannot embed woff2, so the PDF uses built-in Helvetica Bold Italic for headings and Helvetica for text (the design system's own fallback is Arial), with brand colours and the official logo. On-screen UI uses the real brand fonts.
- **Logo:** the brand pack has no India location-lockup PNG (only an `.ai` file at `/Users/rg/Downloads/STEM Racing TM_Location_Logo_RGB_India.ai`). v1 uses the primary STEM Racing logo. Swapping in the India lockup is a one-file replacement (`public/brand/logo-full-colour-white.png`).
- **Front wing span (T8.6.1):** the scrutineer enters, for each of the four lines, the span counting only segments that are at least 25.0 mm (a shorter segment counts as 0).
- **Per-axle reclassification (T7.4, T7.5):** the infringement is reclassified General when no axle has both its wheels out of limit. This is the literal reading of "only one wheel on an axle is out"; revisit if a judge reads it differently.
- **Offline needs a secure context:** service workers and `crypto.randomUUID` need https or localhost. Host on https (for example Vercel), or serve from `localhost`. `file://` does not work.

## Global Constraints

- Metric units: mm and g. Limits are absolute: 47.9 g fails a 48.0 g minimum (T2.7.1). Measurements include paint and decals (T2.7.2).
- Proportional penalty: breach rounded UP to the next whole unit (1.0 mm or 1.0 g), times the per-unit rate (T2.5.2).
- Penalties apply once per infringement per car; cars A and B are assessed separately (T2.5.1).
- Any PERFORMANCE failure (after reclassification) makes the car ineligible for Fastest Car and Best Engineered Car (T2.4.2).
- Margin warning: a passing value within 0.5 mm or 0.5 g of a limit.
- Brand tokens only: use the named colour tokens from `src/styles/tokens.css`; never add a new blue, green or red.
- Headings `h1` and `h2` are Magistral Bold Italic, never upright. `h2` on dark surfaces uses the heading gradient (`chicane-violet` to `pitlane-pink` to `burnout-orange`). Body text is MachoModular, 17px on a 1.6 line, max 68 characters wide.
- Buttons: min height 48px (44px for `btn--small`), 4px radius, Magistral Medium Italic in capitals via CSS (write labels in sentence case). Tags are pills. Cards are 8px radius. No drop shadows.
- Focus ring: 3px `focus` token, 3px offset, on every interactive element.
- Logo: the supplied artwork unaltered, at least 32px high, half its height as clear space on every side. Never stretch, recolour or put it on a busy ground.
- No icon set: status and actions are words ("Pass", "Fail", "At risk", "To do"). Colour never carries meaning alone.
- Sentence case for headings and labels. Never invent teams, scores, dates or names; empty states say there is nothing yet.
- Touch-first: every control at least 44px high.
- Never use `innerHTML` with user-entered text. Build DOM with `h()` and `textContent`.
- Every git commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.

## Review Focus

The spec is silent on these inputs, and each is likely to bite someone at a bench. Each has a test in the task that owns the code.

1. **Untouched rows and empty cars.** A row nobody has filled in must read "To do", not "Pass"; a car with nothing entered shows "Not started" and 0 pts. (Task 3 `pending` tests, Task 5 `carStatus` tests.)
2. **Float noise at whole-number breaches.** `62.0 - 61.0` computed as `1.0000000000000284` must be 1 unit, not 2; a value exactly on a limit passes; 47.99 g fails by 1 unit. (Task 2 penalty tests, Task 4 worked examples.)
3. **Bad typing.** `47,2` (comma decimal), `abc`, `-3`, `1e3`, spaces, and a blank field. Comma decimals are accepted; the rest are shown as "Enter a number" and are never scored or crash. Negative is allowed only for the chamber angle. (Task 2 parse tests, Task 8 UI behaviour.)
4. **Storage and backup abuse.** Duplicate team numbers in one event (case-insensitive), very long or non-Latin names, a malformed or hostile backup JSON (wrong shape, `__proto__` keys), and IndexedDB being unavailable. (Task 6 tests, Task 7 fatal-error panel.)
5. **Hostile text in PDF and DOM.** Team names containing `<script>`, quotes or emoji must render as text and produce a safe PDF file name. (Task 7 DOM test, Task 10 file-name test.)

---

## File structure

```
package.json  tsconfig.json  vite.config.ts  playwright.config.ts  index.html  .gitignore  README.md
public/fonts/*.woff2                      brand fonts (Magistral, MachoModular)
public/brand/logo-full-colour-white.png   header and PDF logo
public/brand/signifier.png  public/icons/icon-192.png  public/icons/icon-512.png
src/main.ts                               boot: open store, mount shell, start router, register SW
src/vite-env.d.ts
src/styles/tokens.css fonts.css base.css components.css
src/engine/types.ts parse.ts penalty.ts evaluate.ts describe.ts summarise.ts index.ts
src/rules/sections.ts wf26.ts index.ts
src/store/id.ts db.ts backup.ts index.ts
src/ui/dom.ts router.ts ctx.ts shell.ts tags.ts rows.ts
src/ui/home.ts event.ts checklist.ts summary.ts compare.ts
src/pdf/resultSheet.ts
tests/brand/contrast.ts tokens.test.ts
tests/engine/parse.test.ts penalty.test.ts evaluate.test.ts summarise.test.ts
tests/rules/wf26.test.ts
tests/store/store.test.ts backup.test.ts
tests/ui/router.test.ts dom.test.ts
tests/pdf/resultSheet.test.ts
e2e/inspection.spec.ts
```

---

### Task 1: Scaffold, tooling and brand foundation

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/vite-env.d.ts`, `src/main.ts` (placeholder), `src/styles/tokens.css`, `src/styles/fonts.css`, `public/fonts/*`, `public/brand/*`, `public/icons/*`
- Test: `tests/brand/contrast.ts`, `tests/brand/tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--carbon-shadow --carbon-800 --carbon-700 --carbon-500 --carbon-300 --carbon-100 --surface-light --white --ignite-indigo --chicane-violet --pitlane-pink --burnout-orange --podium-gold --bg --bg-raised --fg --fg-strong --fg-muted --rule --heading-accent --focus --font-display --font-body --radius-button --radius-card --radius-pill --gutter --container`; `contrast(hexA, hexB): number` in `tests/brand/contrast.ts`.

- [ ] **Step 1: Create the project files**

Run from `/Users/rg/STEM Racing India ` (note the trailing space in the folder name; quote paths):

```bash
cd "/Users/rg/STEM Racing India "
cat > package.json <<'EOF'
{
  "name": "stem-racing-india-scrutineering",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
EOF
npm install idb jspdf jspdf-autotable
npm install -D typescript vite vite-plugin-pwa vitest jsdom fake-indexeddb @playwright/test
npx playwright install chromium
cat > .gitignore <<'EOF'
node_modules
dist
playwright-report
test-results
.DS_Store
EOF
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client", "vite-plugin-pwa/client"]
  },
  "include": ["src", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'brand/*.png'],
      manifest: {
        name: 'STEM Racing India Digital Scrutineering',
        short_name: 'Scrutineering',
        description: 'Offline scrutineering checklist for STEM Racing cars.',
        start_url: '/',
        display: 'standalone',
        background_color: '#05000B',
        theme_color: '#05000B',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'] },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
});
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#05000B" />
    <title>STEM Racing India scrutineering</title>
    <link rel="icon" href="/brand/signifier.png" />
    <link rel="preload" href="/fonts/Magistral-BoldItalic.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/MachoModular-Medium.woff2" as="font" type="font/woff2" crossorigin />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts` (placeholder, replaced in Task 7):

```ts
import './styles/tokens.css';
import './styles/fonts.css';

document.getElementById('app')!.textContent = 'STEM Racing India scrutineering';
```

- [ ] **Step 2: Copy brand assets**

Fonts come from the published design system. They were saved by an earlier `read` into the session scratchpad; if that folder is gone, re-run the Artifact `read` with `url: https://claude.ai/artifact/KutpCGGzkX3doLkwNpHZCQ` and `paths` set to the five `project/fonts/*.woff2` files.

```bash
cd "/Users/rg/STEM Racing India "
mkdir -p public/fonts public/brand public/icons
SRC="/private/tmp/claude-501/-Users-rg-STEM-Racing-India-/a5bdace6-9bf4-4415-b55d-8a83649ba6ba/scratchpad/artifact-files/99271a6e-1c98-410a-8823-2d020d7ae9a5/project/fonts"
cp "$SRC"/Magistral-BoldItalic.woff2 "$SRC"/Magistral-MediumItalic.woff2 \
   "$SRC"/MachoModular-Light.woff2 "$SRC"/MachoModular-Medium.woff2 "$SRC"/MachoModular-Bold.woff2 public/fonts/
PACK="/Users/rg/Downloads/STEM RACING BRANDING SHARE/Graphic Assets/Logos"
sips -Z 1200 "$PACK/STEM Racing TM Logo/RGB/PNG/STEM Racing TM Logo - Full Colour White.png" --out public/brand/logo-full-colour-white.png
sips -Z 600  "$PACK/Signifier/RGB/STEM Racing Signifier_RGB.png" --out public/brand/signifier.png
sips -z 192 192 "$PACK/Signifier/RGB/STEM Racing Signifier_RGB.png" --out public/icons/icon-192.png
sips -z 512 512 "$PACK/Signifier/RGB/STEM Racing Signifier_RGB.png" --out public/icons/icon-512.png
ls -la public/fonts public/brand public/icons
```

Expected: five woff2 files, two brand PNGs, two icons. If the signifier is not square, `sips -z` stretches it; use `sips --padToHeightWidth 512 512 --padColor 05000B` instead for the two icons and note it.

- [ ] **Step 3: Write the failing brand test**

`tests/brand/contrast.ts`:

```ts
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
```

`tests/brand/tokens.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/brand/tokens.test.ts`
Expected: FAIL, `ENOENT ... src/styles/tokens.css` (the file does not exist yet).

- [ ] **Step 5: Write tokens.css and fonts.css**

`src/styles/tokens.css`:

```css
/* STEM Racing brand tokens: Secondary division theme, Brand Identity Guidelines v1.3.
   Source: the published "STEM Racing" design system. Dark surface is the default. */
:root {
  --carbon-shadow: #05000B;
  --carbon-800: #261A3D;
  --carbon-700: #2E2347;
  --carbon-500: #5B5376;
  --carbon-300: #A39FB8;
  --carbon-100: #D7D6E3;
  --surface-light: #F3F3F7;
  --white: #FFFFFF;

  --ignite-indigo: #312783;
  --chicane-violet: #961B81;
  --pitlane-pink: #E6007E;
  --burnout-orange: #ED6D05;
  --podium-gold: #FCBC00;

  --bg: var(--carbon-shadow);
  --bg-raised: var(--carbon-800);
  --fg: var(--carbon-100);
  --fg-strong: var(--white);
  --fg-muted: var(--carbon-300);
  --rule: var(--carbon-700);
  --heading-accent: var(--pitlane-pink);
  --focus: var(--podium-gold);

  --font-display: "Magistral", Arial, system-ui, sans-serif;
  --font-body: "MachoModular", Arial, system-ui, sans-serif;

  --radius-button: 4px;
  --radius-card: 8px;
  --radius-pill: 999px;

  --gutter: clamp(1.375rem, 0.75rem + 2.5vw, 2.5rem);
  --container: 1200px;
  --section-y: clamp(2.5rem, 1.5rem + 4vw, 5rem);
  --header-h: 88px;
  --logo-h: 44px;
}
```

`src/styles/fonts.css`:

```css
@font-face { font-family: "Magistral"; src: url("/fonts/Magistral-BoldItalic.woff2") format("woff2"); font-weight: 700; font-style: italic; font-display: swap; }
@font-face { font-family: "Magistral"; src: url("/fonts/Magistral-MediumItalic.woff2") format("woff2"); font-weight: 500; font-style: italic; font-display: swap; }
@font-face { font-family: "MachoModular"; src: url("/fonts/MachoModular-Light.woff2") format("woff2"); font-weight: 300; font-style: normal; font-display: swap; }
/* The brand pack has no Regular weight, so 400 renders as Medium. */
@font-face { font-family: "MachoModular"; src: url("/fonts/MachoModular-Medium.woff2") format("woff2"); font-weight: 400 500; font-style: normal; font-display: swap; }
@font-face { font-family: "MachoModular"; src: url("/fonts/MachoModular-Bold.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
```

- [ ] **Step 6: Run the tests and a build**

Run: `npx vitest run tests/brand/tokens.test.ts && npm run build`
Expected: 3 tests PASS; build succeeds and writes `dist/` including `sw.js` and `manifest.webmanifest`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold PWA project with STEM Racing brand tokens, fonts and logo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine primitives (types, parsing, penalty maths)

**Files:**
- Create: `src/engine/types.ts`, `src/engine/parse.ts`, `src/engine/penalty.ts`
- Test: `tests/engine/parse.test.ts`, `tests/engine/penalty.test.ts`

**Interfaces:**
- Produces (exact):
  - `types.ts`: `RuleClass`, `Unit`, `SectionId`, `FlatPenalty`, `UnitPenalty`, `Penalty`, `RangeRule`, `CheckRule`, `ItemDef`, `PerItemRangeRule`, `PerItemCheckRule`, `SpanRule`, `Rule`, `SPAN_LINES`, `SpanLine`, `Value`, `Measurements`, `Status`, `Result`
  - `parse.ts`: `parseMeasurement(text: string, opts?: { allowNegative?: boolean }): number | undefined` (undefined = blank, `NaN` = invalid)
  - `penalty.ts`: `round6(n)`, `wholeUnits(breach)`, `breachOf(value, min?, max?)`, `penaltyFor(p: Penalty, breach: number)`, `nearLimit(value, min?, max?, tol?)`

- [ ] **Step 1: Write the failing tests**

`tests/engine/parse.test.ts`:

```ts
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
```

`tests/engine/penalty.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine`
Expected: FAIL, cannot resolve `../../src/engine/parse` and `../../src/engine/penalty`.

- [ ] **Step 3: Implement**

`src/engine/types.ts`:

```ts
export type RuleClass = 'GEN' | 'SAF' | 'PERF';
export type Unit = 'mm' | 'g' | 'deg' | 'count';
export type SectionId =
  | 'registration'
  | 'scales'
  | 'chamber'
  | 'tethers'
  | 'wheels'
  | 'nose'
  | 'rear'
  | 'halo'
  | 'drawings';

export interface FlatPenalty { flat: number }
export interface UnitPenalty { perUnit: number }
export type Penalty = FlatPenalty | UnitPenalty;

interface RuleBase {
  article: string;
  name: string;
  cls: RuleClass;
  section: SectionId;
  /** Measurement condition shown on the row, e.g. cartridge inserted. */
  condition?: string;
  hint?: string;
}

/** One number against min/max. Unit comes from the rule. */
export interface RangeRule extends RuleBase {
  kind: 'range';
  unit: Unit;
  min?: number;
  max?: number;
  penalty: Penalty;
  /** T3.6: officials add underside ballast at 0.2 g per 0.1 g under. */
  ballastIfUnder?: boolean;
}

/** One pass/fail question. true = compliant. */
export interface CheckRule extends RuleBase {
  kind: 'check';
  question: string;
  penalty: FlatPenalty;
}

export interface ItemDef {
  id: string;
  label: string;
  group?: string;
  min?: number;
  max?: number;
}

/** One number per item (wheel, axle, chord extreme). Penalty is charged per failing item. */
export interface PerItemRangeRule extends RuleBase {
  kind: 'perItemRange';
  unit: Unit;
  items: ItemDef[];
  penalty: Penalty;
  /** T7.4/T7.5: if no axle has both wheels out, keep the points but classify General. */
  generalIfOneWheelPerAxle?: boolean;
}

/** One pass/fail per item. Penalty is charged per failing item. */
export interface PerItemCheckRule extends RuleBase {
  kind: 'perItemCheck';
  question: string;
  items: ItemDef[];
  penalty: FlatPenalty;
}

export const SPAN_LINES = ['leading', 'trailing', 'top', 'bottom'] as const;
export type SpanLine = (typeof SPAN_LINES)[number];

/** Wing span: four measured lines, the shortest governs. Always mm. */
export interface SpanRule extends RuleBase {
  kind: 'span';
  min: number;
  penalty: UnitPenalty;
}

export type Rule = RangeRule | CheckRule | PerItemRangeRule | PerItemCheckRule | SpanRule;

export type Value = number | boolean | Record<string, number | boolean | undefined> | undefined;
/** Keyed by rule article. */
export type Measurements = Record<string, Value>;

export type Status = 'pending' | 'pass' | 'fail' | 'invalid';

export interface Result {
  article: string;
  name: string;
  /** Effective class after any reclassification. */
  cls: RuleClass;
  declaredCls: RuleClass;
  status: Status;
  penalty: number;
  /** Human-readable lines explaining each breach. */
  detail: string[];
  /** Extra notes such as ballast or reclassification. */
  notes: string[];
  /** Passing, but within 0.5 of a limit. */
  atRisk: boolean;
}
```

`src/engine/parse.ts`:

```ts
/**
 * Parse text typed into a measurement field.
 * Returns undefined for blank input and NaN for anything that is not a plain decimal number.
 */
export function parseMeasurement(text: string, opts: { allowNegative?: boolean } = {}): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const normalised = t.replace(',', '.');
  const pattern = opts.allowNegative ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/ : /^\+?(\d+(\.\d*)?|\.\d+)$/;
  if (!pattern.test(normalised)) return NaN;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : NaN;
}
```

`src/engine/penalty.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/engine && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): add rule types, measurement parsing and penalty maths" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rule evaluation for every rule kind

**Files:**
- Create: `src/engine/evaluate.ts`, `src/engine/describe.ts`
- Test: `tests/engine/evaluate.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces (exact):
  - `evaluate(rule: Rule, value: Value): Result`
  - `describeLimit(rule: Rule): string` (for example `"65.0 to 85.0 mm · 5 pts per mm"`)
  - `describePenalty(rule: Rule): string`
  - `fmt(n: number): string` (integers get one decimal: `65` → `"65.0"`, `1.5` → `"1.5"`)

- [ ] **Step 1: Write the failing tests**

`tests/engine/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/evaluate';
import { describeLimit } from '../../src/engine/describe';
import type { CheckRule, PerItemCheckRule, PerItemRangeRule, RangeRule, SpanRule } from '../../src/engine/types';

const weight: RangeRule = {
  kind: 'range', article: 'T3.6', name: 'Weight', cls: 'PERF', section: 'scales',
  unit: 'g', min: 48, penalty: { perUnit: 10 }, ballastIfUnder: true,
};
const width: RangeRule = {
  kind: 'range', article: 'T3.4', name: 'Width', cls: 'GEN', section: 'scales',
  unit: 'mm', min: 65, max: 85, penalty: { perUnit: 5 },
};
const angle: RangeRule = {
  kind: 'range', article: 'T5.4', name: 'Chamber angle', cls: 'SAF', section: 'chamber',
  unit: 'deg', min: -3, max: 3, penalty: { flat: 5 },
};
const chamberDia: RangeRule = {
  kind: 'range', article: 'T5.1', name: 'Chamber diameter', cls: 'SAF', section: 'chamber',
  unit: 'mm', min: 18, max: 18.5, penalty: { flat: 5 },
};
const sticker: CheckRule = {
  kind: 'check', article: 'T3.1.3', name: 'Sticker', cls: 'GEN', section: 'registration',
  question: 'Sticker present', penalty: { flat: 5 },
};
const contact: PerItemRangeRule = {
  kind: 'perItemRange', article: 'T7.4', name: 'Contact width', cls: 'PERF', section: 'wheels', unit: 'mm',
  penalty: { perUnit: 2.5 }, generalIfOneWheelPerAxle: true,
  items: [
    { id: 'FL', label: 'Front left', group: 'front', min: 12 },
    { id: 'FR', label: 'Front right', group: 'front', min: 12 },
    { id: 'RL', label: 'Rear left', group: 'rear', min: 15 },
    { id: 'RR', label: 'Rear right', group: 'rear', min: 15 },
  ],
};
const rotation: PerItemCheckRule = {
  kind: 'perItemCheck', article: 'T7.8', name: 'Rotation', cls: 'PERF', section: 'wheels',
  question: 'Rotates freely', penalty: { flat: 5 },
  items: [
    { id: 'FL', label: 'Front left' }, { id: 'FR', label: 'Front right' },
    { id: 'RL', label: 'Rear left' }, { id: 'RR', label: 'Rear right' },
  ],
};
const span: SpanRule = {
  kind: 'span', article: 'T9.5.1', name: 'Rear wing span', cls: 'PERF', section: 'rear',
  min: 50, penalty: { perUnit: 2 },
};

describe('range rules', () => {
  it('is pending when nothing is entered', () => {
    const r = evaluate(weight, undefined);
    expect(r.status).toBe('pending');
    expect(r.penalty).toBe(0);
  });
  it('passes exactly on the limit and does not penalise', () => {
    const r = evaluate(weight, 48);
    expect(r.status).toBe('pass');
    expect(r.penalty).toBe(0);
  });
  it('fails 47.9 g by one whole unit', () => {
    const r = evaluate(weight, 47.9);
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
  });
  it('notes the ballast officials add when underweight', () => {
    const r = evaluate(weight, 46.5);
    expect(r.penalty).toBe(20);
    expect(r.notes.join(' ')).toContain('3 g');
  });
  it('flags a pass within 0.5 of a limit as at risk', () => {
    expect(evaluate(width, 84.8).atRisk).toBe(true);
    expect(evaluate(width, 75).atRisk).toBe(false);
  });
  it('treats NaN and negatives as invalid, but allows negative degrees', () => {
    expect(evaluate(width, NaN).status).toBe('invalid');
    expect(evaluate(width, -1).status).toBe('invalid');
    expect(evaluate(angle, -2).status).toBe('pass');
    expect(evaluate(angle, -3.5).status).toBe('fail');
  });
  it('charges flat rules once however far out', () => {
    expect(evaluate(chamberDia, 17).penalty).toBe(5);
    expect(evaluate(chamberDia, 19.9).penalty).toBe(5);
  });
  it('rejects a non-number value as invalid', () => {
    expect(evaluate(width, true).status).toBe('invalid');
  });
});

describe('check rules', () => {
  it('is pending, passes on true, fails on false with the flat penalty', () => {
    expect(evaluate(sticker, undefined).status).toBe('pending');
    expect(evaluate(sticker, true).status).toBe('pass');
    const f = evaluate(sticker, false);
    expect(f.status).toBe('fail');
    expect(f.penalty).toBe(5);
  });
  it('rejects a number as invalid', () => {
    expect(evaluate(sticker, 3).status).toBe('invalid');
  });
});

describe('per-item range rules', () => {
  it('stays pending until every item is entered, but fails early on a bad item', () => {
    expect(evaluate(contact, { FL: 13 }).status).toBe('pending');
    const early = evaluate(contact, { FL: 10 });
    expect(early.status).toBe('fail');
    expect(early.penalty).toBe(5);
  });
  it('multiplies by failing wheels: both rears at 13.8 vs 15.0 is 10 pts, stays PERF', () => {
    const r = evaluate(contact, { FL: 13, FR: 13, RL: 13.8, RR: 13.8 });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
    expect(r.cls).toBe('PERF');
  });
  it('reclassifies to General when only one wheel on an axle is out, keeping the points', () => {
    const r = evaluate(contact, { FL: 13, FR: 13, RL: 13.8, RR: 15 });
    expect(r.penalty).toBe(5);
    expect(r.cls).toBe('GEN');
    expect(r.declaredCls).toBe('PERF');
    expect(r.notes.join(' ')).toContain('General');
  });
  it('reports invalid when any item is not a number', () => {
    expect(evaluate(contact, { FL: NaN, FR: 13, RL: 15, RR: 15 }).status).toBe('invalid');
  });
});

describe('per-item check rules', () => {
  it('charges per failing wheel', () => {
    const r = evaluate(rotation, { FL: true, FR: false, RL: false, RR: true });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(10);
  });
  it('passes when all four are true', () => {
    expect(evaluate(rotation, { FL: true, FR: true, RL: true, RR: true }).status).toBe('pass');
  });
  it('is pending with a partial answer and no failures', () => {
    expect(evaluate(rotation, { FL: true }).status).toBe('pending');
  });
});

describe('span rules', () => {
  it('the shortest of the four lines governs: 47.2 vs 50.0 is 6 pts', () => {
    const r = evaluate(span, { leading: 50, trailing: 47.2, top: 50, bottom: 50 });
    expect(r.status).toBe('fail');
    expect(r.penalty).toBe(6);
    expect(r.detail.join(' ')).toContain('trailing');
  });
  it('passes when all four lines meet the minimum', () => {
    expect(evaluate(span, { leading: 50, trailing: 50.4, top: 51, bottom: 52 }).status).toBe('pass');
  });
  it('is pending with fewer than four lines unless one is already short', () => {
    expect(evaluate(span, { leading: 52 }).status).toBe('pending');
    expect(evaluate(span, { leading: 49 }).status).toBe('fail');
  });
});

describe('describeLimit', () => {
  it('describes ranges and penalties for the row label', () => {
    expect(describeLimit(width)).toBe('65.0 to 85.0 mm · 5 pts per mm');
    expect(describeLimit(weight)).toBe('48.0 g minimum · 10 pts per g');
    expect(describeLimit(sticker)).toBe('Pass or fail · 5 pts');
    expect(describeLimit(span)).toBe('50.0 mm minimum, shortest line governs · 2 pts per mm');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine/evaluate.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/evaluate`.

- [ ] **Step 3: Implement describe.ts**

`src/engine/describe.ts`:

```ts
import type { Rule, RangeRule, ItemDef } from './types';

/** Integers get one decimal so limits read like the regulations: 65 -> "65.0". */
export function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const unitLabel = (u: string): string => (u === 'deg' ? '°' : u === 'count' ? '' : ` ${u}`);

function bounds(min: number | undefined, max: number | undefined, unit: string): string {
  const u = unitLabel(unit);
  if (min !== undefined && max !== undefined) return `${fmt(min)} to ${fmt(max)}${u}`;
  if (min !== undefined) return `${fmt(min)}${u} minimum`;
  if (max !== undefined) return `${fmt(max)}${u} maximum`;
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
```

Note: for `unit: 'count'` with `max: 0` the text reads `0.0 maximum`; adjust: in `bounds`, when `unit === 'count'` use `String(n)` instead of `fmt(n)`. Apply that tweak now:

```ts
const num = (n: number, unit: string): string => (unit === 'count' ? String(n) : fmt(n));
```

and use `num(...)` in place of `fmt(...)` inside `bounds`. (Task 4's T3.9.2 shows as "0 maximum · 5 pts per count".)

- [ ] **Step 4: Implement evaluate.ts**

`src/engine/evaluate.ts`:

```ts
import { fmt } from './describe';
import { breachOf, nearLimit, penaltyFor, round6, wholeUnits } from './penalty';
import {
  SPAN_LINES,
  type CheckRule, type ItemDef, type PerItemCheckRule, type PerItemRangeRule,
  type RangeRule, type Result, type Rule, type SpanRule, type Value,
} from './types';

function base(rule: Rule): Result {
  return {
    article: rule.article, name: rule.name, cls: rule.cls, declaredCls: rule.cls,
    status: 'pending', penalty: 0, detail: [], notes: [], atRisk: false,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, number | boolean | undefined> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function limitText(min: number | undefined, max: number | undefined, unit: string): string {
  const u = unit === 'deg' ? '°' : unit === 'count' ? '' : ` ${unit}`;
  if (min !== undefined && max !== undefined) return `${fmt(min)} to ${fmt(max)}${u}`;
  if (min !== undefined) return `minimum ${fmt(min)}${u}`;
  return `maximum ${fmt(max as number)}${u}`;
}

const unitSuffix = (unit: string): string => (unit === 'deg' ? '°' : unit === 'count' ? '' : ` ${unit}`);

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
    const units = 'perUnit' in rule.penalty ? ` (${wholeUnits(breach)} whole unit${wholeUnits(breach) === 1 ? '' : 's'})` : '';
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
  if (invalid > 0) { r.status = 'invalid'; return r; }
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
    r.detail.push(`Shortest line (${shortest.line}) is ${shortest.v} mm, ${breach} mm under ${fmt(rule.min)} mm (${wholeUnits(breach)} whole unit${wholeUnits(breach) === 1 ? '' : 's'})`);
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/engine && npx tsc --noEmit`
Expected: all engine tests PASS; no type errors. If `describeLimit` for the span test differs, fix `describe.ts` to produce exactly `50.0 mm minimum, shortest line governs · 2 pts per mm`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): evaluate range, check, per-item and span rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: WF26 Professional rule data

**Files:**
- Create: `src/rules/sections.ts`, `src/rules/wf26.ts`, `src/rules/index.ts`
- Test: `tests/rules/wf26.test.ts`

**Interfaces:**
- Consumes: `Rule`, `SectionId`, `evaluate` (Tasks 2 and 3).
- Produces (exact):
  - `SECTIONS: { id: SectionId; title: string }[]` (bench order)
  - `interface Ruleset { id: string; name: string; issued: string; rules: Rule[] }`
  - `WF26: Ruleset` (`id: 'wf26-professional'`)
  - `ruleByArticle(article: string): Rule | undefined`

- [ ] **Step 1: Write the failing tests**

`tests/rules/wf26.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/evaluate';
import { SECTIONS, WF26, ruleByArticle } from '../../src/rules';

const rule = (a: string) => {
  const r = ruleByArticle(a);
  if (!r) throw new Error(`rule ${a} missing`);
  return r;
};

describe('WF26 rule data integrity', () => {
  it('has unique article keys', () => {
    const arts = WF26.rules.map((r) => r.article);
    expect(new Set(arts).size).toBe(arts.length);
  });
  it('puts every rule in a known section, in bench order', () => {
    const ids = SECTIONS.map((s) => s.id);
    for (const r of WF26.rules) expect(ids).toContain(r.section);
    const order = WF26.rules.map((r) => ids.indexOf(r.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('marks every PP+ article from T2.5.2 as proportional', () => {
    const pp = [
      'T3.4', 'T3.5', 'T3.6', 'T3.7', 'T5.2', 'T5.6', 'T7.2', 'T7.3', 'T7.4', 'T7.5', 'T7.11',
      'T8.6.1', 'T8.6.2', 'T8.6.3', 'T9.5.1', 'T9.5.2', 'T9.5.3', 'T9.5.4',
    ];
    for (const a of pp) {
      expect('perUnit' in rule(a).penalty, a).toBe(true);
    }
  });
  it('has the issue date of the regulations', () => {
    expect(WF26.id).toBe('wf26-professional');
    expect(WF26.issued).toBe('2026-02-10');
  });
});

describe('WF26 worked examples from the regulation digest', () => {
  it('T9.5.1 rear wing span 47.2 vs 50.0 is 6 pts per car', () => {
    const r = evaluate(rule('T9.5.1'), { leading: 47.2, trailing: 47.2, top: 47.2, bottom: 47.2 });
    expect(r.penalty).toBe(6);
  });
  it('T3.6 weight 46.5 vs 48.0 is 20 pts plus 3 g ballast', () => {
    const r = evaluate(rule('T3.6'), 46.5);
    expect(r.penalty).toBe(20);
    expect(r.notes.join(' ')).toContain('3 g');
  });
  it('T7.3 wheelbase 141.3 vs 140.0 is 10 pts', () => {
    expect(evaluate(rule('T7.3'), 141.3).penalty).toBe(10);
  });
  it('T7.11 front obstruction 22.4 vs 20.0 is 30 pts', () => {
    expect(evaluate(rule('T7.11'), 22.4).penalty).toBe(30);
  });
  it('T7.4 both rear wheels at 13.8 vs 15.0 is 10 pts and stays Performance', () => {
    const r = evaluate(rule('T7.4'), { FL: 12, FR: 12, RL: 13.8, RR: 13.8 });
    expect(r.penalty).toBe(10);
    expect(r.cls).toBe('PERF');
  });
  it('T7.4 one rear wheel at 13.8 keeps 5 pts but is General', () => {
    const r = evaluate(rule('T7.4'), { FL: 12, FR: 12, RL: 13.8, RR: 15 });
    expect(r.penalty).toBe(5);
    expect(r.cls).toBe('GEN');
  });
  it('T3.6 exactly 48.0 g passes and 47.9 g fails by one unit', () => {
    expect(evaluate(rule('T3.6'), 48).status).toBe('pass');
    expect(evaluate(rule('T3.6'), 47.9).penalty).toBe(10);
  });
  it('T7.2 uses 38.0 front and 34.0 rear', () => {
    const r = evaluate(rule('T7.2'), { front: 37, rear: 34 });
    expect(r.penalty).toBe(2.5);
    expect(evaluate(rule('T7.2'), { front: 38, rear: 34 }).status).toBe('pass');
  });
  it('T4.4.4 halo notch accepts 33.0 to 35.0', () => {
    expect(evaluate(rule('T4.4.4'), 34).status).toBe('pass');
    expect(evaluate(rule('T4.4.4'), 35.1).penalty).toBe(5);
  });
  it('T5.4 chamber angle accepts negative degrees', () => {
    expect(evaluate(rule('T5.4'), -2.5).status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/rules`
Expected: FAIL, cannot resolve `../../src/rules`.

- [ ] **Step 3: Implement sections.ts and index.ts**

`src/rules/sections.ts`:

```ts
import type { SectionId } from '../engine/types';

/** Bench order, as a scrutineering bay works. */
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'registration', title: 'Registration and identity' },
  { id: 'scales', title: 'Scales and gauges' },
  { id: 'chamber', title: 'Chamber and cartridge' },
  { id: 'tethers', title: 'Tether guides' },
  { id: 'wheels', title: 'Wheels' },
  { id: 'nose', title: 'Nose and front wing' },
  { id: 'rear', title: 'Rear wing' },
  { id: 'halo', title: 'Halo, helmet and virtual cargo' },
  { id: 'drawings', title: 'Engineering drawings' },
];
```

`src/rules/index.ts`:

```ts
export { SECTIONS } from './sections';
export { WF26, ruleByArticle, type Ruleset } from './wf26';
```

- [ ] **Step 4: Implement wf26.ts**

Values below are copied from `wf26-technical-digest.md`. Check each against that file while typing; the test above only pins some of them.

`src/rules/wf26.ts`:

```ts
import type {
  CheckRule, ItemDef, PerItemCheckRule, PerItemRangeRule, RangeRule, Rule, RuleClass, SectionId, SpanRule, Unit,
} from '../engine/types';

export interface Ruleset {
  id: string;
  name: string;
  issued: string;
  rules: Rule[];
}

const CI = 'Cartridge in, car resting on all four wheels unaided';

interface RangeOpts {
  unit: Unit;
  min?: number;
  max?: number;
  flat?: number;
  perUnit?: number;
  condition?: string;
  hint?: string;
  ballastIfUnder?: boolean;
}

const range = (article: string, name: string, cls: RuleClass, section: SectionId, o: RangeOpts): RangeRule => ({
  kind: 'range', article, name, cls, section, unit: o.unit, min: o.min, max: o.max,
  penalty: o.perUnit !== undefined ? { perUnit: o.perUnit } : { flat: o.flat as number },
  condition: o.condition, hint: o.hint, ballastIfUnder: o.ballastIfUnder,
});

const check = (
  article: string, name: string, cls: RuleClass, section: SectionId, flat: number, question: string,
  extra: { condition?: string; hint?: string } = {},
): CheckRule => ({ kind: 'check', article, name, cls, section, question, penalty: { flat }, ...extra });

const perCheck = (
  article: string, name: string, cls: RuleClass, section: SectionId, flat: number, question: string,
  items: ItemDef[], extra: { condition?: string; hint?: string } = {},
): PerItemCheckRule => ({ kind: 'perItemCheck', article, name, cls, section, question, items, penalty: { flat }, ...extra });

const perRange = (
  article: string, name: string, cls: RuleClass, section: SectionId, unit: Unit, perUnit: number, items: ItemDef[],
  extra: { condition?: string; hint?: string; generalIfOneWheelPerAxle?: boolean } = {},
): PerItemRangeRule => ({ kind: 'perItemRange', article, name, cls, section, unit, items, penalty: { perUnit }, ...extra });

const span = (article: string, name: string, section: SectionId, min: number, perUnit: number, hint?: string): SpanRule => ({
  kind: 'span', article, name, cls: 'PERF', section, min, penalty: { perUnit }, hint,
});

const WHEELS: ItemDef[] = [
  { id: 'FL', label: 'Front left', group: 'front' },
  { id: 'FR', label: 'Front right', group: 'front' },
  { id: 'RL', label: 'Rear left', group: 'rear' },
  { id: 'RR', label: 'Rear right', group: 'rear' },
];
const withLimits = (min?: number, max?: number, frontMin?: number, rearMin?: number): ItemDef[] =>
  WHEELS.map((w) => ({
    ...w,
    min: frontMin !== undefined ? (w.group === 'front' ? frontMin : rearMin) : min,
    max,
  }));

const chordItems = (): ItemDef[] => [
  { id: 'narrowest', label: 'Narrowest chord', min: 15 },
  { id: 'widest', label: 'Widest chord', max: 25 },
];
const thicknessItems = (): ItemDef[] => [
  { id: 'thinnest', label: 'Thinnest point', min: 2 },
  { id: 'thickest', label: 'Thickest point', max: 6 },
];

const rules: Rule[] = [
  // Registration and identity
  check('T3.1.3', 'Holographic Model Block sticker', 'GEN', 'registration', 5, 'The holographic sticker from this car\'s Model Block is on the submission sheet'),
  check('T3.1.4', 'Cars A and B identical', 'GEN', 'registration', 5, 'Both race cars have identical geometry'),
  check('T3.3', 'Only T1.1 components', 'PERF', 'registration', 20, 'Nothing on the car is outside the twelve T1.1 components'),
  range('T3.9.2', 'Introduced spare components', 'GEN', 'registration', { unit: 'count', max: 0, perUnit: 5, hint: 'Count spares not submitted at registration or not geometrically identical' }),
  check('T4.1', 'Single-piece body', 'GEN', 'registration', 20, 'Body is one continuous CNC-machined Model Block piece rear of plane A'),
  check('T4.6', 'Logo decal on each side', 'GEN', 'registration', 5, 'One 30 x 15 mm official decal per side, fully adhered and fully visible in side view'),
  check('T4.7', 'Team number and A/B marking', 'GEN', 'registration', 2, 'Number plus A or B between halo front edge and plane A, visible in plan view, text at least 8.0 mm high'),
  range('T4.8', 'Decal thickness', 'GEN', 'registration', { unit: 'mm', max: 0.5, flat: 5, hint: 'Total decal thickness, excluding surface finish' }),

  // Scales and gauges
  check('T3.2', 'Safe construction', 'SAF', 'scales', 10, 'The car is judged safe to race'),
  check('T2.7', 'Rests on four wheels', 'GEN', 'scales', 0, 'With a full cartridge inserted the car rests on all four wheels unaided', {
    condition: CI,
    hint: 'No penalty of its own, but a nose-up car fails T3.5, T3.7, T5.2, T5.4, T7.6 and T7.11',
  }),
  range('T3.4', 'Total width', 'GEN', 'scales', { unit: 'mm', min: 65, max: 85, perUnit: 5, hint: 'Widest feature, paint and decals included' }),
  range('T3.5', 'Total height', 'GEN', 'scales', { unit: 'mm', max: 65, perUnit: 5, condition: CI }),
  range('T3.6', 'Total weight (no cartridge)', 'PERF', 'scales', { unit: 'g', min: 48, perUnit: 10, ballastIfUnder: true, hint: 'Use the calibrated competition scales' }),
  range('T3.7', 'Track clearance', 'GEN', 'scales', { unit: 'mm', min: 1.5, perUnit: 10, condition: CI, hint: 'Every component except the wheels. Watch low front wings and tether guides' }),

  // Chamber and cartridge
  range('T5.1', 'Chamber diameter', 'SAF', 'chamber', { unit: 'mm', min: 18, max: 18.5, flat: 5, hint: 'Any point through the minimum depth' }),
  range('T5.2', 'Chamber distance from track', 'GEN', 'chamber', { unit: 'mm', min: 30, max: 40, perUnit: 5, condition: CI, hint: 'Rear centre of the cartridge to the track' }),
  range('T5.3', 'Chamber depth', 'SAF', 'chamber', { unit: 'mm', min: 45, max: 58, flat: 5 }),
  range('T5.4', 'Chamber angle', 'SAF', 'chamber', { unit: 'deg', min: -3, max: 3, flat: 5, condition: CI }),
  range('T5.5', 'Chamber wall thickness', 'SAF', 'chamber', { unit: 'mm', min: 3, flat: 10, hint: 'Unpainted and uninterrupted around the minimum depth' }),
  range('T5.6', 'Cartridge protrusion', 'PERF', 'chamber', { unit: 'mm', min: 5, perUnit: 10, hint: 'Beyond the rear of the car, and fully visible through a 360° sweep' }),

  // Tether guides
  check('T6.1', 'Tether guide location', 'SAF', 'tethers', 10, 'Exactly two secure guides: front within 10.0 mm ahead of the front axle, rear within 10.0 mm behind the rear axle'),
  check('T6.2', 'Tether guide opening', 'SAF', 'tethers', 5, 'The 3.5 mm tool passes and the 6.0 mm tool is blocked'),
  check('T6.3', 'Tether guide strength', 'SAF', 'tethers', 10, 'Holes fully closed and each guide holds 300 g'),

  // Wheels
  check('T7.1', 'Four cylindrical wheels', 'GEN', 'wheels', 25, 'Four cylindrical wheels, opposing wheels on a common axis'),
  perRange('T7.2', 'Distance between opposing wheels', 'PERF', 'wheels', 'mm', 2.5, [
    { id: 'front', label: 'Front axle', group: 'front', min: 38 },
    { id: 'rear', label: 'Rear axle', group: 'rear', min: 34 },
  ], { hint: 'Innermost distance between rotating wheel parts' }),
  range('T7.3', 'Wheelbase', 'PERF', 'wheels', { unit: 'mm', min: 120, max: 140, perUnit: 5, hint: 'Front to rear wheel centre lines, side view' }),
  perRange('T7.4', 'Track contact width', 'PERF', 'wheels', 'mm', 2.5, withLimits(undefined, undefined, 12, 15), {
    generalIfOneWheelPerAxle: true, hint: 'Constant-contact surface, excluding chamfers and fillets',
  }),
  perRange('T7.5', 'Wheel diameter', 'PERF', 'wheels', 'mm', 2.5, withLimits(28, 32), { generalIfOneWheelPerAxle: true }),
  perCheck('T7.6', 'All four wheels touch the track', 'PERF', 'wheels', 2.5, 'Wheel touches the track across its full contact width', WHEELS, { condition: CI }),
  perCheck('T7.7', 'Rolling surface', 'PERF', 'wheels', 2.5, 'Diameter is consistent across the contact width (no tread)', WHEELS),
  perCheck('T7.8', 'Free rotation', 'PERF', 'wheels', 5, 'Rotates freely on a 3° incline', WHEELS),
  check('T7.9.1', 'Clear zone in front of front wheels', 'PERF', 'wheels', 2.5, 'The 5.0 mm zone tool fits with no obstruction'),
  check('T7.9.2', 'Clear zone behind front wheels', 'PERF', 'wheels', 5, 'The zone tool (30.0 mm at the outer edge, tapering at 60° to 15.0 mm) fits'),
  check('T7.9.3', 'Clear zone in front of rear wheels', 'PERF', 'wheels', 5, 'The zone tool (30.0 mm at the outer edge, tapering at 45° to 5.0 mm) fits'),
  check('T7.9.4', 'Clear zone behind rear wheels', 'PERF', 'wheels', 2.5, 'The 5.0 mm zone tool fits with no obstruction'),
  perCheck('T7.10', 'Wheel visibility, side view', 'PERF', 'wheels', 10, 'Wheel is unobscured except by wheel support systems', WHEELS),
  range('T7.11', 'Front wheel obstruction, front view', 'PERF', 'wheels', { unit: 'mm', max: 20, perUnit: 10, condition: CI, hint: 'Highest point of any front-view obstruction of the front wheels' }),
  check('T7.12', 'Wheel supports inside the wheel cylinder', 'GEN', 'wheels', 5, 'Every wheel support fits inside the cylinder through the opposing wheels\' diameters'),
  perCheck('T7.13', 'Wheel safety test', 'SAF', 'wheels', 2.5, 'Holds 300 g on the claw tool', WHEELS, { hint: 'Needs clearance at the wheel inner corner for the claw' }),

  // Nose and front wing
  range('T8.2', 'Nose cone overhang', 'GEN', 'nose', { unit: 'mm', max: 40, flat: 5, hint: 'Forward of plane A to the extreme front of the car' }),
  check('T8.3', 'Front wing description', 'GEN', 'nose', 5, 'Wing on the nose with a leading and trailing edge across the full span'),
  check('T8.4', 'Front wing rigidity', 'GEN', 'nose', 5, 'Wing is rigid and its span does not change'),
  check('T8.5.1', 'Nose and wing support location', 'GEN', 'nose', 10, 'Forward of plane A, at most 25.0 mm high, within 15.0 mm either side of the centre line'),
  check('T8.5.2', 'Front wing location', 'GEN', 'nose', 10, 'At most 20.0 mm high wherever wider than 15.0 mm either side of the centre line'),
  check('T8.5.3', 'Front wing end plates', 'GEN', 'nose', 10, 'Outside the minimum span, at most 10.0 mm wide, at most 25.0 mm high beyond the wheels or 20.0 mm in front of them'),
  span('T8.6.1', 'Front wing span', 'nose', 50, 2, 'Enter each line\'s span counting only segments of at least 25.0 mm (a shorter segment counts as 0). Maximum two segments'),
  perRange('T8.6.2', 'Front wing chord', 'PERF', 'nose', 'mm', 1, chordItems(), { hint: 'Up to three elements that overlap in plan view' }),
  perRange('T8.6.3', 'Front wing thickness', 'PERF', 'nose', 'mm', 1, thicknessItems()),
  check('T8.7', 'Front wing clear airflow', 'PERF', 'nose', 5, 'The 5.0 mm ball on a 2.0 mm rod passes around the wing across the minimum span'),
  check('T8.8', 'Front wing visibility', 'PERF', 'nose', 10, 'Wing is unobstructed in front view'),

  // Rear wing
  check('T9.2', 'Rear wing description', 'GEN', 'rear', 5, 'Wing at the rear with a leading and trailing edge across the required span'),
  check('T9.3', 'Rear wing rigidity', 'GEN', 'rear', 5, 'Wing is rigid and its span does not change'),
  check('T9.4.1', 'Rear wing location', 'GEN', 'rear', 10, 'Wing and support are wholly rear of plane B'),
  range('T9.4.2', 'Rear overhang length', 'GEN', 'rear', { unit: 'mm', max: 40, flat: 5, hint: 'Behind plane B to the extreme rear of the car' }),
  range('T9.4.3', 'Rear overhang height', 'GEN', 'rear', { unit: 'mm', max: 65, flat: 5, hint: 'Rear of plane B, above the track' }),
  span('T9.5.1', 'Rear wing span', 'rear', 50, 2, 'A single unbroken span. A support that intersects the span fails it'),
  perRange('T9.5.2', 'Rear wing chord', 'PERF', 'rear', 'mm', 1, chordItems(), { hint: 'Up to two elements that overlap' }),
  perRange('T9.5.3', 'Rear wing thickness', 'PERF', 'rear', 'mm', 1, thicknessItems()),
  range('T9.5.4', 'Rear wing height deviation', 'GEN', 'rear', { unit: 'mm', max: 15, perUnit: 1, hint: 'Change from the wing\'s highest point along the minimum span, top surface' }),
  check('T9.6', 'Rear wing clear airflow', 'PERF', 'rear', 5, 'The 5.0 mm ball on a 2.0 mm rod passes around the wing across the minimum span'),
  check('T9.7', 'Rear wing visibility', 'PERF', 'rear', 10, 'Wing is unobstructed in front and rear views across the minimum span'),

  // Halo, helmet and virtual cargo
  check('T4.2', 'Virtual cargo', 'PERF', 'halo', 25, 'Minimum envelope (60.0 x 55.0 tapering to 10.0 x 10.0 mm) is inside the body, between the axle centre lines, symmetric, and clear of the halo pocket'),
  check('T4.4.1', 'Official halo, unmodified', 'PERF', 'halo', 10, 'Halo is the official 2026 file with no dimensional or surface changes'),
  check('T4.4.2', 'Halo visible, front and side', 'GEN', 'halo', 10, 'Unobstructed by any other component'),
  check('T4.4.3', 'Halo visible, top', 'GEN', 'halo', 10, 'Unobstructed in plan view except by the helmet'),
  range('T4.4.4', 'Halo notch height', 'SAF', 'halo', { unit: 'mm', min: 33, max: 35, flat: 5, hint: 'Notch centre 34.0 ± 1.0 mm above the track (pocket floor 24.0 mm)' }),
  check('T4.4.5', 'Halo safety test 1', 'SAF', 'halo', 5, 'Car on a cartridge carries a 2 kg load at the notch'),
  check('T4.4.6', 'Halo safety test 2', 'SAF', 'halo', 5, 'Car horizontal, supported by the chamber, carries 300 g on the halo front edge'),
  check('T4.5', 'Official helmet, unmodified', 'GEN', 'halo', 5, 'Official 2026 helmet, unmodified dimensions, not glued in (ballast access)'),

  // Engineering drawings
  check('T4.3', 'Virtual cargo identified in drawings', 'GEN', 'drawings', 5, 'Dimensioned from an axle centre line and height above track, and hatched, shaded or outlined'),
  check('T7.12.2', 'Wheel supports identified in drawings', 'GEN', 'drawings', 5, 'Front and rear wheel support surfaces are identified'),
  check('T8.1', 'Nose and front wing identified in drawings', 'GEN', 'drawings', 5, 'Nose, front wing(s), end plates and supports are dimensioned and identified'),
  check('T9.1', 'Rear wing identified in drawings', 'GEN', 'drawings', 5, 'Rear wing and supports are dimensioned and identified'),
];

export const WF26: Ruleset = {
  id: 'wf26-professional',
  name: 'Aramco STEM Racing World Finals 2026: Professional',
  issued: '2026-02-10',
  rules,
};

const byArticle = new Map(rules.map((r) => [r.article, r]));
export const ruleByArticle = (article: string): Rule | undefined => byArticle.get(article);
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/rules && npx tsc --noEmit`
Expected: all rules tests PASS. If the "bench order" test fails, reorder the entries in `rules` so sections appear in `SECTIONS` order. Note T4.2 sits in the halo section and T4.3/T7.12.2 in drawings by design.

- [ ] **Step 6: Review the rule data against the digest**

Open `wf26-technical-digest.md` and tick off every table row (T3 to T9) against the entries above: article, class, limits, penalty. Fix any mismatch and add a test for it. Not scrutineered at the bench and deliberately omitted: T3.8 (race-time changes), T7.14 (optional Pit Stop award), T10.1 (launch contact).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(rules): add WF26 Professional rule data with digest worked examples" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Car and pair summaries

**Files:**
- Create: `src/engine/summarise.ts`, `src/engine/index.ts`
- Test: `tests/engine/summarise.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `Rule`, `Result`, `Measurements` (Tasks 2 to 4).
- Produces (exact):
  - `AWARDS_LOST: readonly ['Fastest Car', 'Best Engineered Car']`
  - `interface CarSummary { results: Result[]; total: number; perfFailures: Result[]; safetyFailures: Result[]; generalFailures: Result[]; atRisk: Result[]; pending: Result[]; invalid: Result[]; ineligibleFor: string[]; complete: boolean; started: boolean }`
  - `summarise(rules: Rule[], m: Measurements): CarSummary`
  - `type CarStatus = 'not-started' | 'in-progress' | 'clean' | 'penalties'`
  - `carStatus(s: CarSummary): CarStatus`
  - `interface PairSummary { total: number; shared: Result[]; onlyA: Result[]; onlyB: Result[] }`
  - `summarisePair(a: CarSummary, b: CarSummary): PairSummary`
  - `src/engine/index.ts` re-exports everything public from the engine.

- [ ] **Step 1: Write the failing tests**

`tests/engine/summarise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AWARDS_LOST, carStatus, summarise, summarisePair } from '../../src/engine';
import { WF26 } from '../../src/rules';

const rules = WF26.rules;

describe('summarise', () => {
  it('an untouched car is not started, totals 0 and every row is pending', () => {
    const s = summarise(rules, {});
    expect(s.started).toBe(false);
    expect(s.total).toBe(0);
    expect(s.pending.length).toBe(rules.length);
    expect(s.complete).toBe(false);
    expect(carStatus(s)).toBe('not-started');
  });

  it('totals penalties and splits failures by effective class', () => {
    const s = summarise(rules, {
      'T3.6': 46.5, // PERF, 20
      'T3.4': 60, // GEN, 5 mm under 65 -> 25
      'T5.1': 17, // SAF, 5
    });
    expect(s.total).toBe(20 + 25 + 5);
    expect(s.perfFailures.map((r) => r.article)).toEqual(['T3.6']);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T3.4']);
    expect(s.safetyFailures.map((r) => r.article)).toEqual(['T5.1']);
    expect(s.ineligibleFor).toEqual([...AWARDS_LOST]);
    expect(carStatus(s)).toBe('in-progress');
  });

  it('a General-reclassified single wheel breach does not cost award eligibility', () => {
    const s = summarise(rules, { 'T7.4': { FL: 12, FR: 12, RL: 13.8, RR: 15 } });
    expect(s.total).toBe(5);
    expect(s.perfFailures).toHaveLength(0);
    expect(s.ineligibleFor).toEqual([]);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T7.4']);
  });

  it('lists at-risk passes and invalid rows', () => {
    const s = summarise(rules, { 'T3.4': 84.9, 'T3.5': NaN });
    expect(s.atRisk.map((r) => r.article)).toEqual(['T3.4']);
    expect(s.invalid.map((r) => r.article)).toEqual(['T3.5']);
    expect(s.total).toBe(0);
  });

  it('is complete with no failures only when every row is answered', () => {
    const m: Record<string, number | boolean | Record<string, number | boolean>> = {};
    for (const r of rules) {
      if (r.kind === 'check') m[r.article] = true;
      else if (r.kind === 'range') m[r.article] = r.min ?? 0 + 1;
    }
    const partial = summarise(rules, m);
    expect(partial.complete).toBe(false);
    expect(carStatus(partial)).toBe('in-progress');
  });

  it('ignores measurements for unknown articles', () => {
    const s = summarise(rules, { 'T99.9': 5 });
    expect(s.started).toBe(true);
    expect(s.total).toBe(0);
  });

  it('counts a zero-point failed gate as a failure', () => {
    const s = summarise(rules, { 'T2.7': false });
    expect(s.total).toBe(0);
    expect(s.generalFailures.map((r) => r.article)).toEqual(['T2.7']);
  });
});

describe('carStatus', () => {
  it('reports clean when complete with no failures, penalties otherwise', () => {
    const answered = Object.fromEntries(
      rules.map((r) => {
        switch (r.kind) {
          case 'check': return [r.article, true];
          case 'range': return [r.article, r.min ?? 0];
          case 'span': return [r.article, { leading: 60, trailing: 60, top: 60, bottom: 60 }];
          case 'perItemCheck': return [r.article, Object.fromEntries(r.items.map((i) => [i.id, true]))];
          case 'perItemRange': return [r.article, Object.fromEntries(r.items.map((i) => [i.id, i.min ?? i.max ?? 0]))];
        }
      }),
    );
    expect(carStatus(summarise(rules, answered))).toBe('clean');
    expect(carStatus(summarise(rules, { ...answered, 'T3.6': 40 }))).toBe('penalties');
  });
});

describe('summarisePair', () => {
  it('adds totals and finds faults shared by both cars', () => {
    const a = summarise(rules, { 'T3.6': 46.5, 'T3.4': 60 });
    const b = summarise(rules, { 'T3.6': 46.5, 'T5.1': 17 });
    const p = summarisePair(a, b);
    expect(p.total).toBe(a.total + b.total);
    expect(p.shared.map((r) => r.article)).toEqual(['T3.6']);
    expect(p.onlyA.map((r) => r.article)).toEqual(['T3.4']);
    expect(p.onlyB.map((r) => r.article)).toEqual(['T5.1']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine/summarise.test.ts`
Expected: FAIL, cannot resolve `../../src/engine`.

- [ ] **Step 3: Implement**

`src/engine/summarise.ts`:

```ts
import { evaluate } from './evaluate';
import type { Measurements, Result, Rule, Value } from './types';

export const AWARDS_LOST = ['Fastest Car', 'Best Engineered Car'] as const;

export interface CarSummary {
  results: Result[];
  total: number;
  perfFailures: Result[];
  safetyFailures: Result[];
  generalFailures: Result[];
  atRisk: Result[];
  pending: Result[];
  invalid: Result[];
  ineligibleFor: string[];
  complete: boolean;
  started: boolean;
}

const entered = (v: Value): boolean =>
  v !== undefined && (typeof v !== 'object' || Object.values(v).some((x) => x !== undefined));

export function summarise(rules: Rule[], m: Measurements): CarSummary {
  const results = rules.map((rule) => evaluate(rule, m[rule.article]));
  const failures = results.filter((r) => r.status === 'fail');
  const perfFailures = failures.filter((r) => r.cls === 'PERF');
  const pending = results.filter((r) => r.status === 'pending');
  const invalid = results.filter((r) => r.status === 'invalid');
  return {
    results,
    total: results.reduce((sum, r) => sum + r.penalty, 0),
    perfFailures,
    safetyFailures: failures.filter((r) => r.cls === 'SAF'),
    generalFailures: failures.filter((r) => r.cls === 'GEN'),
    atRisk: results.filter((r) => r.status === 'pass' && r.atRisk),
    pending,
    invalid,
    ineligibleFor: perfFailures.length > 0 ? [...AWARDS_LOST] : [],
    complete: pending.length === 0 && invalid.length === 0,
    started: Object.values(m).some(entered),
  };
}

export type CarStatus = 'not-started' | 'in-progress' | 'clean' | 'penalties';

export function carStatus(s: CarSummary): CarStatus {
  if (!s.started) return 'not-started';
  if (!s.complete) return 'in-progress';
  return s.results.some((r) => r.status === 'fail') ? 'penalties' : 'clean';
}

export interface PairSummary {
  total: number;
  shared: Result[];
  onlyA: Result[];
  onlyB: Result[];
}

export function summarisePair(a: CarSummary, b: CarSummary): PairSummary {
  const failed = (s: CarSummary) => s.results.filter((r) => r.status === 'fail');
  const fa = failed(a);
  const fb = failed(b);
  const inB = new Set(fb.map((r) => r.article));
  const inA = new Set(fa.map((r) => r.article));
  return {
    total: a.total + b.total,
    shared: fa.filter((r) => inB.has(r.article)),
    onlyA: fa.filter((r) => !inB.has(r.article)),
    onlyB: fb.filter((r) => !inA.has(r.article)),
  };
}
```

`src/engine/index.ts`:

```ts
export * from './types';
export { parseMeasurement } from './parse';
export { round6, wholeUnits, breachOf, penaltyFor, nearLimit } from './penalty';
export { evaluate } from './evaluate';
export { describeLimit, describePenalty, fmt } from './describe';
export { AWARDS_LOST, summarise, carStatus, summarisePair, type CarSummary, type CarStatus, type PairSummary } from './summarise';
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every test so far PASSES.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): summarise cars and pairs with award ineligibility and status" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: IndexedDB store and JSON backup

**Files:**
- Create: `src/store/id.ts`, `src/store/db.ts`, `src/store/backup.ts`, `src/store/index.ts`
- Test: `tests/store/store.test.ts`, `tests/store/backup.test.ts`

**Interfaces:**
- Consumes: `Measurements` (Task 2).
- Produces (exact):
  - `newId(): string`
  - Records: `EventRec { id; name; date; venue; rulesetId; createdAt }`, `Team { id; eventId; number; name; school; createdAt }`, `Car { id; teamId; label: 'A' | 'B' }`, `Inspection { carId; scrutineer; startedAt; updatedAt; measurements: Measurements; notes: Record<string, string> }`
  - `class StoreError extends Error { code: 'duplicate-team-number' | 'invalid-input' | 'invalid-backup' | 'not-found' }`
  - `interface Store { createEvent(i: { name: string; date: string; venue?: string }): Promise<EventRec>; listEvents(): Promise<EventRec[]>; getEvent(id: string): Promise<EventRec | undefined>; createTeam(eventId: string, i: { number: string; name: string; school?: string }): Promise<{ team: Team; cars: [Car, Car] }>; listTeams(eventId: string): Promise<Team[]>; getTeam(id: string): Promise<Team | undefined>; carsForTeam(teamId: string): Promise<Car[]>; getCar(id: string): Promise<Car | undefined>; getInspection(carId: string): Promise<Inspection | undefined>; saveInspection(i: Inspection): Promise<Inspection>; exportAll(): Promise<Backup>; importAll(raw: unknown): Promise<ImportReport> }`
  - `openStore(dbName?: string): Promise<Store>` (default name `'stem-racing-india-scrutineering'`)
  - `interface Backup { app: 'stem-racing-india-scrutineering'; version: 1; exportedAt: number; events: EventRec[]; teams: Team[]; cars: Car[]; inspections: Inspection[] }`
  - `interface ImportReport { added: { events: number; teams: number; cars: number; inspections: number }; updated: number }`
  - `parseBackup(raw: unknown): Backup` (throws `StoreError('invalid-backup')`)

- [ ] **Step 1: Write the failing tests**

`tests/store/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { StoreError, openStore, type Store } from '../../src/store';

let store: Store;
beforeEach(async () => {
  store = await openStore(`test-${Math.random().toString(36).slice(2)}`);
});

describe('events and teams', () => {
  it('creates an event with a ruleset and lists it', async () => {
    const e = await store.createEvent({ name: ' Regional round ', date: '2026-11-01', venue: 'Pune' });
    expect(e.name).toBe('Regional round');
    expect(e.rulesetId).toBe('wf26-professional');
    expect((await store.listEvents()).map((x) => x.id)).toEqual([e.id]);
  });

  it('rejects an event with no name', async () => {
    await expect(store.createEvent({ name: '   ', date: '2026-11-01' })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('creates a team with cars A and B', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { team, cars } = await store.createTeam(e.id, { number: '12', name: 'Apex' });
    expect(cars.map((c) => c.label)).toEqual(['A', 'B']);
    expect((await store.carsForTeam(team.id)).map((c) => c.label)).toEqual(['A', 'B']);
    expect((await store.getCar(cars[0].id))?.teamId).toBe(team.id);
  });

  it('rejects a duplicate team number in the same event, ignoring case and spaces', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    await store.createTeam(e.id, { number: 'A12', name: 'One' });
    await expect(store.createTeam(e.id, { number: ' a12 ', name: 'Two' })).rejects.toMatchObject({ code: 'duplicate-team-number' });
    const other = await store.createEvent({ name: 'F', date: '2026-11-02' });
    await expect(store.createTeam(other.id, { number: 'A12', name: 'Two' })).resolves.toBeDefined();
  });

  it('keeps hostile and very long names as plain text, within limits', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { team } = await store.createTeam(e.id, { number: '1', name: '<script>alert(1)</script> 🚗 "quoted"' });
    expect(team.name).toBe('<script>alert(1)</script> 🚗 "quoted"');
    await expect(store.createTeam(e.id, { number: '2', name: 'x'.repeat(500) })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(store.createTeam(e.id, { number: '', name: 'No number' })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('lists teams in natural number order', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    for (const n of ['10', '2', '1']) await store.createTeam(e.id, { number: n, name: `T${n}` });
    expect((await store.listTeams(e.id)).map((t) => t.number)).toEqual(['1', '2', '10']);
  });

  it('rejects a team for an unknown event', async () => {
    await expect(store.createTeam('nope', { number: '1', name: 'X' })).rejects.toBeInstanceOf(StoreError);
  });
});

describe('inspections', () => {
  it('saves and reads an inspection, stamping updatedAt', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { cars } = await store.createTeam(e.id, { number: '1', name: 'A' });
    expect(await store.getInspection(cars[0].id)).toBeUndefined();
    const saved = await store.saveInspection({
      carId: cars[0].id, scrutineer: 'R', startedAt: 1, updatedAt: 1, measurements: { 'T3.6': 46.5 }, notes: {},
    });
    expect(saved.updatedAt).toBeGreaterThan(1);
    expect((await store.getInspection(cars[0].id))?.measurements['T3.6']).toBe(46.5);
  });

  it('drops NaN measurements instead of persisting them', async () => {
    const e = await store.createEvent({ name: 'E', date: '2026-11-01' });
    const { cars } = await store.createTeam(e.id, { number: '1', name: 'A' });
    await store.saveInspection({
      carId: cars[0].id, scrutineer: '', startedAt: 1, updatedAt: 1,
      measurements: { 'T3.6': NaN, 'T7.4': { FL: NaN, FR: 12 } }, notes: {},
    });
    const back = await store.getInspection(cars[0].id);
    expect(back?.measurements['T3.6']).toBeUndefined();
    expect((back?.measurements['T7.4'] as Record<string, number | undefined>).FL).toBeUndefined();
    expect((back?.measurements['T7.4'] as Record<string, number | undefined>).FR).toBe(12);
  });
});
```

`tests/store/backup.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openStore, parseBackup, type Store } from '../../src/store';

let a: Store;
let b: Store;
beforeEach(async () => {
  a = await openStore(`test-a-${Math.random().toString(36).slice(2)}`);
  b = await openStore(`test-b-${Math.random().toString(36).slice(2)}`);
});

async function seed(s: Store) {
  const e = await s.createEvent({ name: 'E', date: '2026-11-01' });
  const { team, cars } = await s.createTeam(e.id, { number: '1', name: 'Apex' });
  await s.saveInspection({ carId: cars[0].id, scrutineer: 'R', startedAt: 1, updatedAt: 1, measurements: { 'T3.6': 46.5 }, notes: {} });
  return { e, team, cars };
}

describe('backup', () => {
  it('round-trips everything into an empty store', async () => {
    const { cars } = await seed(a);
    const backup = await a.exportAll();
    expect(backup.app).toBe('stem-racing-india-scrutineering');
    expect(backup.version).toBe(1);
    const report = await b.importAll(JSON.parse(JSON.stringify(backup)));
    expect(report.added).toEqual({ events: 1, teams: 1, cars: 2, inspections: 1 });
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(46.5);
  });

  it('is idempotent and keeps the newer inspection when ids collide', async () => {
    const { cars } = await seed(a);
    const backup = JSON.parse(JSON.stringify(await a.exportAll()));
    await b.importAll(backup);
    const again = await b.importAll(backup);
    expect(again.added).toEqual({ events: 0, teams: 0, cars: 0, inspections: 0 });

    backup.inspections[0].updatedAt += 1000;
    backup.inspections[0].measurements['T3.6'] = 50;
    const updated = await b.importAll(backup);
    expect(updated.updated).toBe(1);
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(50);

    backup.inspections[0].updatedAt -= 5000;
    backup.inspections[0].measurements['T3.6'] = 1;
    await b.importAll(backup);
    expect((await b.getInspection(cars[0].id))?.measurements['T3.6']).toBe(50);
  });
});

describe('parseBackup', () => {
  const ok = { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: 1, events: [], teams: [], cars: [], inspections: [] };

  it('accepts a valid empty backup', () => {
    expect(parseBackup(ok).version).toBe(1);
  });

  it('rejects malformed input with a StoreError', () => {
    const bad: unknown[] = [
      null, 'text', 5, [], {}, { ...ok, version: 2 }, { ...ok, app: 'other' }, { ...ok, events: 'x' },
      { ...ok, events: [{ id: 1 }] }, { ...ok, teams: [{ id: 't', eventId: 'e' }] },
      { ...ok, cars: [{ id: 'c', teamId: 't', label: 'Z' }] },
    ];
    for (const raw of bad) {
      expect(() => parseBackup(raw), JSON.stringify(raw)).toThrowError(/backup/i);
    }
  });

  it('does not let __proto__ keys pollute measurements', () => {
    const raw = JSON.parse(
      '{"app":"stem-racing-india-scrutineering","version":1,"exportedAt":1,"events":[],"teams":[],"cars":[],' +
        '"inspections":[{"carId":"c","scrutineer":"","startedAt":1,"updatedAt":1,"notes":{},"measurements":{"__proto__":{"polluted":true},"T3.6":5}}]}',
    );
    const parsed = parseBackup(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed.inspections[0].measurements)).toEqual(['T3.6']);
  });

  it('refuses an import whose cars point at a missing team, leaving the store untouched', async () => {
    const raw = { ...ok, cars: [{ id: 'c1', teamId: 'ghost', label: 'A' }] };
    await expect(a.importAll(raw)).rejects.toMatchObject({ code: 'invalid-backup' });
    expect(await a.listEvents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/store`
Expected: FAIL, cannot resolve `../../src/store`.

- [ ] **Step 3: Implement id.ts and backup.ts**

`src/store/id.ts`:

```ts
/** crypto.randomUUID only exists in secure contexts; fall back so an http LAN host still works. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

`src/store/backup.ts`:

```ts
import type { Measurements, Value } from '../engine';
import { StoreError } from './db';
import type { Car, EventRec, Inspection, Team } from './db';

export interface Backup {
  app: 'stem-racing-india-scrutineering';
  version: 1;
  exportedAt: number;
  events: EventRec[];
  teams: Team[];
  cars: Car[];
  inspections: Inspection[];
}

export interface ImportReport {
  added: { events: number; teams: number; cars: number; inspections: number };
  updated: number;
}

const bad = (msg: string): never => {
  throw new StoreError('invalid-backup', `Not a valid STEM Racing scrutineering backup: ${msg}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : bad(`${what} must be text`));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : bad(`${what} must be a number`));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(`${what} must be a list`));

/** Rebuild a measurement value copying only own, non-prototype keys. */
function cleanValue(v: unknown): Value {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (isObj(v)) {
    const out: Record<string, number | boolean | undefined> = {};
    for (const key of Object.keys(v)) {
      if (key === '__proto__') continue;
      const inner = v[key];
      if (typeof inner === 'number' && Number.isFinite(inner)) out[key] = inner;
      else if (typeof inner === 'boolean') out[key] = inner;
    }
    return out;
  }
  return undefined;
}

function cleanMeasurements(raw: unknown): Measurements {
  if (!isObj(raw)) return bad('measurements must be an object');
  const out: Measurements = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = cleanValue(raw[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function cleanNotes(raw: unknown): Record<string, string> {
  if (!isObj(raw)) return bad('notes must be an object');
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__') continue;
    if (typeof raw[key] === 'string') out[key] = raw[key] as string;
  }
  return out;
}

export function parseBackup(raw: unknown): Backup {
  if (!isObj(raw)) return bad('expected an object');
  if (raw.app !== 'stem-racing-india-scrutineering') return bad('wrong app marker');
  if (raw.version !== 1) return bad('unsupported version');
  const events = arr(raw.events, 'events').map((e): EventRec => {
    if (!isObj(e)) return bad('event must be an object');
    return {
      id: str(e.id, 'event id'), name: str(e.name, 'event name'), date: str(e.date, 'event date'),
      venue: typeof e.venue === 'string' ? e.venue : '', rulesetId: str(e.rulesetId, 'rulesetId'),
      createdAt: num(e.createdAt, 'event createdAt'),
    };
  });
  const teams = arr(raw.teams, 'teams').map((t): Team => {
    if (!isObj(t)) return bad('team must be an object');
    return {
      id: str(t.id, 'team id'), eventId: str(t.eventId, 'team eventId'), number: str(t.number, 'team number'),
      name: str(t.name, 'team name'), school: typeof t.school === 'string' ? t.school : '',
      createdAt: num(t.createdAt, 'team createdAt'),
    };
  });
  const cars = arr(raw.cars, 'cars').map((c): Car => {
    if (!isObj(c)) return bad('car must be an object');
    const label = c.label;
    if (label !== 'A' && label !== 'B') return bad('car label must be A or B');
    return { id: str(c.id, 'car id'), teamId: str(c.teamId, 'car teamId'), label };
  });
  const inspections = arr(raw.inspections, 'inspections').map((i): Inspection => {
    if (!isObj(i)) return bad('inspection must be an object');
    return {
      carId: str(i.carId, 'inspection carId'), scrutineer: typeof i.scrutineer === 'string' ? i.scrutineer : '',
      startedAt: num(i.startedAt, 'inspection startedAt'), updatedAt: num(i.updatedAt, 'inspection updatedAt'),
      measurements: cleanMeasurements(i.measurements), notes: cleanNotes(i.notes),
    };
  });
  return { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: num(raw.exportedAt, 'exportedAt'), events, teams, cars, inspections };
}
```

- [ ] **Step 4: Implement db.ts and index.ts**

`src/store/db.ts`:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Measurements } from '../engine';
import { parseBackup, type Backup, type ImportReport } from './backup';
import { newId } from './id';

export interface EventRec { id: string; name: string; date: string; venue: string; rulesetId: string; createdAt: number }
export interface Team { id: string; eventId: string; number: string; name: string; school: string; createdAt: number }
export interface Car { id: string; teamId: string; label: 'A' | 'B' }
export interface Inspection {
  carId: string;
  scrutineer: string;
  startedAt: number;
  updatedAt: number;
  measurements: Measurements;
  notes: Record<string, string>;
}

export class StoreError extends Error {
  constructor(public code: 'duplicate-team-number' | 'invalid-input' | 'invalid-backup' | 'not-found', message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

interface Schema extends DBSchema {
  events: { key: string; value: EventRec };
  teams: { key: string; value: Team; indexes: { byEvent: string } };
  cars: { key: string; value: Car; indexes: { byTeam: string } };
  inspections: { key: string; value: Inspection };
}

export interface Store {
  createEvent(i: { name: string; date: string; venue?: string }): Promise<EventRec>;
  listEvents(): Promise<EventRec[]>;
  getEvent(id: string): Promise<EventRec | undefined>;
  createTeam(eventId: string, i: { number: string; name: string; school?: string }): Promise<{ team: Team; cars: [Car, Car] }>;
  listTeams(eventId: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | undefined>;
  carsForTeam(teamId: string): Promise<Car[]>;
  getCar(id: string): Promise<Car | undefined>;
  getInspection(carId: string): Promise<Inspection | undefined>;
  saveInspection(i: Inspection): Promise<Inspection>;
  exportAll(): Promise<Backup>;
  importAll(raw: unknown): Promise<ImportReport>;
}

const RULESET_ID = 'wf26-professional';
const LIMITS = { event: 120, number: 12, team: 80, school: 120, venue: 120 };

function text(value: string | undefined, label: string, max: number, required: boolean): string {
  const v = (value ?? '').trim();
  if (required && v === '') throw new StoreError('invalid-input', `${label} is required.`);
  if (v.length > max) throw new StoreError('invalid-input', `${label} must be ${max} characters or fewer.`);
  return v;
}

const normNumber = (n: string): string => n.trim().toLowerCase().replace(/\s+/g, '');

/** Drop NaN so an invalid half-typed value is never persisted. */
function sanitise(m: Measurements): Measurements {
  const out: Measurements = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === 'object' && v !== null) {
      const inner: Record<string, number | boolean | undefined> = {};
      for (const [ik, iv] of Object.entries(v)) {
        if (typeof iv === 'boolean' || (typeof iv === 'number' && Number.isFinite(iv))) inner[ik] = iv;
      }
      out[k] = inner;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

export async function openStore(dbName = 'stem-racing-india-scrutineering'): Promise<Store> {
  const db: IDBPDatabase<Schema> = await openDB<Schema>(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('events', { keyPath: 'id' });
      d.createObjectStore('teams', { keyPath: 'id' }).createIndex('byEvent', 'eventId');
      d.createObjectStore('cars', { keyPath: 'id' }).createIndex('byTeam', 'teamId');
      d.createObjectStore('inspections', { keyPath: 'carId' });
    },
  });

  return {
    async createEvent(i) {
      const rec: EventRec = {
        id: newId(), name: text(i.name, 'Event name', LIMITS.event, true), date: text(i.date, 'Date', 10, true),
        venue: text(i.venue, 'Venue', LIMITS.venue, false), rulesetId: RULESET_ID, createdAt: Date.now(),
      };
      await db.put('events', rec);
      return rec;
    },
    async listEvents() {
      return (await db.getAll('events')).sort((a, b) => b.createdAt - a.createdAt);
    },
    getEvent: (id) => db.get('events', id),

    async createTeam(eventId, i) {
      const number = text(i.number, 'Team number', LIMITS.number, true);
      const name = text(i.name, 'Team name', LIMITS.team, true);
      const school = text(i.school, 'School or club', LIMITS.school, false);
      const tx = db.transaction(['events', 'teams', 'cars'], 'readwrite');
      if (!(await tx.objectStore('events').get(eventId))) {
        tx.abort();
        throw new StoreError('not-found', 'That event no longer exists.');
      }
      const existing = await tx.objectStore('teams').index('byEvent').getAll(eventId);
      if (existing.some((t) => normNumber(t.number) === normNumber(number))) {
        tx.abort();
        throw new StoreError('duplicate-team-number', `Team number ${number} is already used in this event.`);
      }
      const team: Team = { id: newId(), eventId, number, name, school, createdAt: Date.now() };
      const cars: [Car, Car] = [
        { id: newId(), teamId: team.id, label: 'A' },
        { id: newId(), teamId: team.id, label: 'B' },
      ];
      await tx.objectStore('teams').put(team);
      await tx.objectStore('cars').put(cars[0]);
      await tx.objectStore('cars').put(cars[1]);
      await tx.done;
      return { team, cars };
    },
    async listTeams(eventId) {
      const teams = await db.getAllFromIndex('teams', 'byEvent', eventId);
      return teams.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    },
    getTeam: (id) => db.get('teams', id),
    async carsForTeam(teamId) {
      return (await db.getAllFromIndex('cars', 'byTeam', teamId)).sort((a, b) => a.label.localeCompare(b.label));
    },
    getCar: (id) => db.get('cars', id),

    getInspection: (carId) => db.get('inspections', carId),
    async saveInspection(i) {
      const prev = await db.get('inspections', i.carId);
      const rec: Inspection = {
        ...i,
        measurements: sanitise(i.measurements),
        updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1, i.updatedAt + 1),
      };
      await db.put('inspections', rec);
      return rec;
    },

    async exportAll() {
      const [events, teams, cars, inspections] = await Promise.all([
        db.getAll('events'), db.getAll('teams'), db.getAll('cars'), db.getAll('inspections'),
      ]);
      return { app: 'stem-racing-india-scrutineering', version: 1, exportedAt: Date.now(), events, teams, cars, inspections };
    },

    async importAll(raw) {
      const b = parseBackup(raw);
      const teamIds = new Set(b.teams.map((t) => t.id));
      const carIds = new Set(b.cars.map((c) => c.id));
      const eventIds = new Set(b.events.map((e) => e.id));
      if (b.teams.some((t) => !eventIds.has(t.eventId)) || b.cars.some((c) => !teamIds.has(c.teamId)) || b.inspections.some((i) => !carIds.has(i.carId))) {
        throw new StoreError('invalid-backup', 'Not a valid STEM Racing scrutineering backup: records point at missing parents.');
      }
      const report: ImportReport = { added: { events: 0, teams: 0, cars: 0, inspections: 0 }, updated: 0 };
      const tx = db.transaction(['events', 'teams', 'cars', 'inspections'], 'readwrite');
      for (const e of b.events) if (!(await tx.objectStore('events').get(e.id))) { await tx.objectStore('events').put(e); report.added.events++; }
      for (const t of b.teams) if (!(await tx.objectStore('teams').get(t.id))) { await tx.objectStore('teams').put(t); report.added.teams++; }
      for (const c of b.cars) if (!(await tx.objectStore('cars').get(c.id))) { await tx.objectStore('cars').put(c); report.added.cars++; }
      for (const i of b.inspections) {
        const have = await tx.objectStore('inspections').get(i.carId);
        if (!have) { await tx.objectStore('inspections').put(i); report.added.inspections++; }
        else if (i.updatedAt > have.updatedAt) { await tx.objectStore('inspections').put(i); report.updated++; }
      }
      await tx.done;
      return report;
    },
  };
}
```

`src/store/index.ts`:

```ts
export { openStore, StoreError, type Store, type EventRec, type Team, type Car, type Inspection } from './db';
export { parseBackup, type Backup, type ImportReport } from './backup';
export { newId } from './id';
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: store tests PASS with the rest. Watch for: (a) a circular import between `db.ts` and `backup.ts` (`StoreError`), which works because it is only used inside functions, but if the bundler complains, move `StoreError` and the record types to `src/store/types.ts` and import from both; (b) `saveInspection` returning `updatedAt > 1` for the test input.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(store): IndexedDB store with duplicate-number guard and validated JSON backup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: UI foundation, branded shell, home and event screens

**Files:**
- Create: `src/styles/base.css`, `src/styles/components.css`, `src/ui/dom.ts`, `src/ui/router.ts`, `src/ui/ctx.ts`, `src/ui/shell.ts`, `src/ui/tags.ts`, `src/ui/home.ts`, `src/ui/event.ts`
- Modify: `src/main.ts` (replace the placeholder)
- Test: `tests/ui/router.test.ts`, `tests/ui/dom.test.ts`

**Interfaces:**
- Consumes: `Store`, `StoreError`, `Backup` (Task 6); `summarise`, `carStatus`, `CarStatus` (Task 5); `WF26` (Task 4).
- Produces (exact):
  - `h(tag, props, ...children)` and `Child` in `dom.ts`
  - `type Route = { name: 'home' } | { name: 'event'; eventId: string } | { name: 'car'; carId: string } | { name: 'summary'; carId: string } | { name: 'compare'; teamId: string }`; `parseHash(hash: string): Route`; `routeHref(r: Route): string`; `startRouter(onRoute: (r: Route) => void): void`
  - `interface Ctx { store: Store; main: HTMLElement; rerender: () => void }`
  - `mountShell(root: HTMLElement): { main: HTMLElement }`
  - `statusTag(status: Status | CarStatus-ish)`, `classTag(cls: RuleClass)` in `tags.ts` (see code)
  - `homeScreen(ctx: Ctx): Promise<HTMLElement>`, `eventScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`
  - CSS classes used by later tasks: `.btn .btn--primary .btn--ghost .btn--small .tag .tag--pass .tag--fail .tag--risk .tag--todo .card .field .seg .row .bar .stack .grid .lead .muted .back`

- [ ] **Step 1: Write the failing tests**

`tests/ui/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHash, routeHref } from '../../src/ui/router';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/event/e1')).toEqual({ name: 'event', eventId: 'e1' });
    expect(parseHash('#/car/c1')).toEqual({ name: 'car', carId: 'c1' });
    expect(parseHash('#/car/c1/summary')).toEqual({ name: 'summary', carId: 'c1' });
    expect(parseHash('#/team/t1/compare')).toEqual({ name: 'compare', teamId: 't1' });
  });
  it('falls back to home for anything unknown', () => {
    expect(parseHash('#/nonsense')).toEqual({ name: 'home' });
    expect(parseHash('#/car/')).toEqual({ name: 'home' });
  });
  it('round-trips and encodes ids', () => {
    for (const r of [
      { name: 'home' }, { name: 'event', eventId: 'a b' }, { name: 'car', carId: 'c/1' },
      { name: 'summary', carId: 'c1' }, { name: 'compare', teamId: 't1' },
    ] as const) {
      expect(parseHash(routeHref(r))).toEqual(r);
    }
  });
});
```

`tests/ui/dom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { h } from '../../src/ui/dom';

describe('h', () => {
  it('builds elements with props, listeners and nested children', () => {
    let clicked = 0;
    const el = h('button', { class: 'btn', type: 'button', onclick: () => clicked++ }, 'Go', null, false, h('span', null, '!'));
    expect(el.className).toBe('btn');
    expect(el.textContent).toBe('Go!');
    el.click();
    expect(clicked).toBe(1);
  });
  it('renders hostile text as text, never markup', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const el = h('p', null, evil);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe(evil);
  });
  it('sets boolean attributes and skips nullish props', () => {
    const el = h('input', { disabled: true, hidden: false, title: undefined, value: '47.2' });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.value).toBe('47.2');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui`
Expected: FAIL, cannot resolve `../../src/ui/router` and `../../src/ui/dom`.

- [ ] **Step 3: Implement dom.ts and router.ts**

`src/ui/dom.ts`:

```ts
export type Child = Node | string | number | null | undefined | false;

/** Tiny hyperscript. Strings become text nodes, so user text can never inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'value') {
      (el as unknown as HTMLInputElement).value = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
```

`src/ui/router.ts`:

```ts
export type Route =
  | { name: 'home' }
  | { name: 'event'; eventId: string }
  | { name: 'car'; carId: string }
  | { name: 'summary'; carId: string }
  | { name: 'compare'; teamId: string };

const HOME: Route = { name: 'home' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter((p) => p !== '');
  const id = (i: number): string | undefined => {
    const raw = parts[i];
    if (!raw) return undefined;
    try { return decodeURIComponent(raw); } catch { return undefined; }
  };
  if (parts[0] === 'event' && id(1) && parts.length === 2) return { name: 'event', eventId: id(1)! };
  if (parts[0] === 'car' && id(1) && parts.length === 2) return { name: 'car', carId: id(1)! };
  if (parts[0] === 'car' && id(1) && parts[2] === 'summary' && parts.length === 3) return { name: 'summary', carId: id(1)! };
  if (parts[0] === 'team' && id(1) && parts[2] === 'compare' && parts.length === 3) return { name: 'compare', teamId: id(1)! };
  return HOME;
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'event': return `#/event/${encodeURIComponent(r.eventId)}`;
    case 'car': return `#/car/${encodeURIComponent(r.carId)}`;
    case 'summary': return `#/car/${encodeURIComponent(r.carId)}/summary`;
    case 'compare': return `#/team/${encodeURIComponent(r.teamId)}/compare`;
  }
}

export function startRouter(onRoute: (r: Route) => void): void {
  const run = () => onRoute(parseHash(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ui`
Expected: PASS.

- [ ] **Step 5: Write the brand stylesheets**

`src/styles/base.css`:

```css
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: var(--font-body); font-size: 17px; line-height: 1.6; font-weight: 400;
}
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.btn:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, button:focus-visible {
  box-shadow: 0 0 0 6px var(--carbon-shadow);
}
.skip { position: absolute; left: -9999px; background: var(--white); color: var(--carbon-shadow); padding: 12px 16px; border-radius: var(--radius-button); }
.skip:focus { left: var(--gutter); top: 8px; z-index: 20; }

h1, h2 { font-family: var(--font-display); font-style: italic; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
h1 { color: var(--fg-strong); font-size: clamp(2.25rem, 1.6rem + 2.6vw, 3.5rem); line-height: 1.05; }
h2 {
  width: fit-content; padding-inline-end: .15em; font-size: clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem); line-height: 1.05;
  background: linear-gradient(90deg, var(--chicane-violet) -15%, var(--pitlane-pink) 52%, var(--burnout-orange) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
@media (forced-colors: active) { h2 { background: none; color: CanvasText; } }
h3 { font-size: 20px; line-height: 1.25; font-weight: 700; margin: 0; color: var(--fg-strong); }
p { margin: 0; max-width: 68ch; }
a { color: inherit; text-decoration-line: underline; text-decoration-color: var(--pitlane-pink); text-decoration-thickness: .125em; text-underline-offset: .22em; }
a:hover { text-decoration-color: currentColor; }
.lead { font-size: 21px; line-height: 1.5; max-width: 60ch; }
.muted { color: var(--fg-muted); }
.small { font-size: 13px; line-height: 1.5; }
.eyebrow { font-size: 13px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--fg-muted); }

.site-header { height: var(--header-h); border-bottom: 1px solid var(--rule); }
.site-header__in {
  max-width: var(--container); height: 100%; margin: 0 auto; padding: 0 var(--gutter);
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.site-header img { display: block; height: var(--logo-h); width: auto; }
.site-header .eyebrow { margin: 0; }
main { max-width: var(--container); margin: 0 auto; padding: var(--section-y) var(--gutter); display: flex; flex-direction: column; gap: var(--section-y); outline: none; }
.stack { display: flex; flex-direction: column; gap: 16px; }
.stack--lg { gap: 32px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 24px; }
.back { display: inline-block; font-size: 15px; }
```

`src/styles/components.css`:

```css
/* Components from the STEM Racing design system (bundle.css), plus the scrutineering rows. */
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 12px 24px; border: 2px solid transparent; border-radius: var(--radius-button); font-family: var(--font-display); font-style: italic; font-weight: 500; font-size: 15px; letter-spacing: .06em; line-height: 1.1; text-decoration: none; text-transform: uppercase; cursor: pointer; transition: background-color .2s ease, border-color .2s ease, color .2s ease; }
.btn--small { min-height: 44px; padding: 8px 16px; font-size: 13px; }
.btn--primary { background: var(--chicane-violet); color: var(--white); }
.btn--primary:hover { background: var(--ignite-indigo); }
.btn--ghost { background: transparent; border-color: var(--fg-strong); color: var(--fg-strong); }
.btn--ghost:hover { background: var(--fg-strong); color: var(--bg); }
.btn[disabled] { opacity: .5; cursor: not-allowed; }

.tag { display: inline-block; padding: .3em .75em; border: 1px solid currentColor; border-radius: var(--radius-pill); font-size: 12px; font-weight: 700; letter-spacing: .12em; line-height: 1.3; text-transform: uppercase; white-space: nowrap; }
.tag--pass { color: var(--fg-strong); }
.tag--fail { background: var(--chicane-violet); border-color: var(--pitlane-pink); border-width: 2px; color: var(--white); }
.tag--risk { color: var(--burnout-orange); }
.tag--todo { color: var(--fg-muted); }
.tag--class { color: var(--fg-muted); }

.card { padding: 24px; border: 1px solid var(--carbon-800); border-radius: var(--radius-card); background: linear-gradient(90deg, var(--carbon-shadow) 0%, var(--carbon-700) 100%); color: var(--carbon-100); display: flex; flex-direction: column; gap: 12px; }
.card h3 { color: var(--white); }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 15px; }
.field__label { font-size: 13px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-muted); }
.field__box { display: flex; align-items: center; gap: 8px; }
.field input, .field select {
  min-height: 48px; width: 100%; padding: 8px 12px; border: 2px solid var(--carbon-500); border-radius: var(--radius-button);
  background: var(--carbon-shadow); color: var(--fg-strong); font: inherit; font-size: 17px;
}
.field input[aria-invalid="true"] { border-color: var(--pitlane-pink); }
.field__unit { min-width: 2.5em; color: var(--fg-muted); font-size: 15px; }
.field__error { color: var(--burnout-orange); font-size: 13px; }

.seg { display: inline-flex; border: 2px solid var(--fg-strong); border-radius: var(--radius-button); overflow: hidden; }
.seg button { min-height: 44px; min-width: 88px; padding: 8px 16px; border: 0; background: transparent; color: var(--fg-strong); font-family: var(--font-display); font-style: italic; font-weight: 500; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.seg button + button { border-left: 2px solid var(--fg-strong); }
.seg button[aria-checked="true"] { background: var(--fg-strong); color: var(--bg); }

.form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 16px; align-items: end; }
.alert { padding: 12px 16px; border: 2px solid var(--pitlane-pink); border-radius: var(--radius-button); color: var(--fg-strong); }

.section { display: flex; flex-direction: column; gap: 16px; }
.row { display: flex; flex-direction: column; gap: 12px; padding: 20px; border: 1px solid var(--carbon-800); border-radius: var(--radius-card); background: var(--bg-raised); }
.row--fail { border-color: var(--pitlane-pink); border-width: 2px; }
.row__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; }
.row__art { font-weight: 700; color: var(--fg-strong); }
.row__limit { font-size: 15px; color: var(--fg-muted); }
.row__controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
.row__controls .field { min-width: 150px; flex: 1 1 150px; max-width: 240px; }
.row__result { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; font-size: 15px; }
.row__notes { margin: 0; padding-left: 1.1em; font-size: 14px; max-width: 68ch; }

.bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding: 12px var(--gutter); margin: 0 calc(-1 * var(--gutter)); background: var(--carbon-shadow); border-bottom: 1px solid var(--rule); }
.bar__total { font-family: var(--font-display); font-style: italic; font-weight: 700; font-size: 40px; line-height: 1; color: var(--fg-strong); }
.bar__meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 14px; }

.stat { display: flex; flex-direction: column-reverse; gap: 8px; }
.stat__value { color: var(--fg-strong); font-family: var(--font-display); font-style: italic; font-weight: 700; font-size: 72px; line-height: .95; }
.stat__label { max-width: 24ch; font-weight: 700; line-height: 1.3; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.list li { padding: 16px; border: 1px solid var(--rule); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: 4px; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; }

@media (prefers-reduced-motion: no-preference) {
  main > * { animation: rise .6s ease both; }
  @keyframes rise { from { opacity: 0; transform: translateY(1.5rem); } to { opacity: 1; transform: none; } }
}
```

- [ ] **Step 6: Implement ctx, tags, shell**

`src/ui/ctx.ts`:

```ts
import type { Store } from '../store';

export interface Ctx {
  store: Store;
  main: HTMLElement;
  /** Re-render the current route, for example after a form submit. */
  rerender: () => void;
}
```

`src/ui/tags.ts`:

```ts
import type { CarStatus, RuleClass, Status } from '../engine';
import { h } from './dom';

const CLASS_LABEL: Record<RuleClass, string> = { GEN: 'General', SAF: 'Safety', PERF: 'Performance' };

export const classTag = (cls: RuleClass) => h('span', { class: 'tag tag--class' }, CLASS_LABEL[cls]);
export const classLabel = (cls: RuleClass): string => CLASS_LABEL[cls];

/** Status is always a word, never colour alone. */
export function statusTag(status: Status, atRisk = false) {
  if (status === 'fail') return h('span', { class: 'tag tag--fail' }, 'Fail');
  if (status === 'pass') return atRisk ? h('span', { class: 'tag tag--risk' }, 'Pass, at risk') : h('span', { class: 'tag tag--pass' }, 'Pass');
  if (status === 'invalid') return h('span', { class: 'tag tag--fail' }, 'Enter a number');
  return h('span', { class: 'tag tag--todo' }, 'To do');
}

const CAR_LABEL: Record<CarStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  clean: 'No penalties',
  penalties: 'Penalties',
};

export function carStatusTag(status: CarStatus) {
  const cls = status === 'penalties' ? 'tag--fail' : status === 'clean' ? 'tag--pass' : 'tag--todo';
  return h('span', { class: `tag ${cls}` }, CAR_LABEL[status]);
}
```

`src/ui/shell.ts`:

```ts
import { h } from './dom';

export function mountShell(root: HTMLElement): { main: HTMLElement } {
  const main = h('main', { id: 'main', tabindex: '-1' });
  root.replaceChildren(
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { href: '#/', 'aria-label': 'STEM Racing scrutineering home' },
          h('img', { src: '/brand/logo-full-colour-white.png', alt: 'STEM Racing', height: 44 })),
        h('p', { class: 'eyebrow' }, 'Digital scrutineering'),
      ),
    ),
    main,
  );
  return { main };
}
```

Note: the skip link href `#main` conflicts with the hash router. Replace it with a button-style handler instead: `h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content')` and define `main` before it (as above, `main` is created first). Use that version.

- [ ] **Step 7: Implement home and event screens**

`src/ui/home.ts`:

```ts
import { StoreError } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const today = (): string => new Date().toISOString().slice(0, 10);

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function homeScreen(ctx: Ctx): Promise<HTMLElement> {
  const events = await ctx.store.listEvents();
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const show = (msg: string) => { error.textContent = msg; error.hidden = false; };

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today(), required: true })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Venue (optional)'), h('input', { name: 'venue', maxlength: 120, autocomplete: 'off' })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      const ev = await ctx.store.createEvent({ name: String(f.get('name')), date: String(f.get('date')), venue: String(f.get('venue')) });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      show(err instanceof StoreError ? err.message : 'Could not save the event.');
    }
  });

  const exportBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Export backup');
  exportBtn.addEventListener('click', async () => {
    const backup = await ctx.store.exportAll();
    download(`stem-racing-scrutineering-backup-${today()}.json`, JSON.stringify(backup));
  });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import backup file' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const report = await ctx.store.importAll(JSON.parse(await file.text()));
      show(`Imported ${report.added.teams} teams and ${report.added.inspections} inspections; updated ${report.updated}.`);
      error.classList.remove('alert');
      ctx.rerender();
    } catch (err) {
      show(err instanceof StoreError ? err.message : 'That file could not be read as a backup.');
    }
  });

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('p', { class: 'eyebrow' }, 'Season 9'),
      h('h1', null, 'Digital scrutineering'),
      h('p', { class: 'lead' }, 'Record measurements at the inspection bench. Penalties follow the Aramco STEM Racing World Finals 2026 Technical Regulations.'),
    ),
    error,
    h('section', { class: 'section' }, h('h2', null, 'Events'),
      events.length === 0
        ? h('p', { class: 'muted' }, 'No events yet. Create one to start inspecting cars.')
        : h('ul', { class: 'list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, [e.date, e.venue].filter(Boolean).join(' · '))))),
    ),
    h('section', { class: 'section' }, h('h2', null, 'New event'), form),
    h('section', { class: 'section' }, h('h2', null, 'Backup'),
      h('p', { class: 'muted' }, 'Records live on this device only. Export a backup to keep a copy or to merge another device\'s records.'),
      h('div', { class: 'actions' }, exportBtn, h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Import backup'), fileInput)),
    ),
  );
}
```

`src/ui/event.ts`:

```ts
import { carStatus, summarise } from '../engine';
import { WF26 } from '../rules';
import { StoreError, type Car } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { carStatusTag } from './tags';

async function carLink(ctx: Ctx, car: Car): Promise<HTMLElement> {
  const insp = await ctx.store.getInspection(car.id);
  const s = summarise(WF26.rules, insp?.measurements ?? {});
  return h('a', { class: 'btn btn--ghost btn--small', href: routeHref({ name: 'car', carId: car.id }) },
    `Car ${car.label}`, ' ', carStatusTag(carStatus(s)), s.started ? ` ${s.total} pts` : '');
}

export async function eventScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const event = await ctx.store.getEvent(eventId);
  if (!event) return h('div', { class: 'stack' }, h('p', null, 'That event was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));

  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team number'), h('input', { name: 'number', required: true, maxlength: 12, autocomplete: 'off', inputmode: 'text' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team name'), h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'School or club (optional)'), h('input', { name: 'school', maxlength: 120, autocomplete: 'off' })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Add team'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await ctx.store.createTeam(eventId, { number: String(f.get('number')), name: String(f.get('name')), school: String(f.get('school')) });
      ctx.rerender();
    } catch (err) {
      error.textContent = err instanceof StoreError ? err.message : 'Could not save the team.';
      error.hidden = false;
    }
  });

  const teams = await ctx.store.listTeams(eventId);
  const cards = await Promise.all(teams.map(async (t) => {
    const cars = await ctx.store.carsForTeam(t.id);
    const links = await Promise.all(cars.map((c) => carLink(ctx, c)));
    return h('article', { class: 'card' },
      h('h3', null, `Team ${t.number} · ${t.name}`),
      t.school ? h('p', { class: 'small' }, t.school) : null,
      h('div', { class: 'actions' }, links),
      h('a', { href: routeHref({ name: 'compare', teamId: t.id }) }, 'Compare cars A and B'),
    );
  }));

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, 'All events'),
      h('p', { class: 'eyebrow' }, [event.date, event.venue].filter(Boolean).join(' · ')),
      h('h1', null, event.name),
    ),
    h('section', { class: 'section' }, h('h2', null, 'Teams'),
      teams.length === 0 ? h('p', { class: 'muted' }, 'No teams yet. Add the first team below.') : h('div', { class: 'grid' }, cards)),
    h('section', { class: 'section' }, h('h2', null, 'Add a team'), error, form),
  );
}
```

- [ ] **Step 8: Replace main.ts**

`src/main.ts`:

```ts
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import { registerSW } from 'virtual:pwa-register';
import { openStore, type Store } from './store';
import type { Ctx } from './ui/ctx';
import { h } from './ui/dom';
import { eventScreen } from './ui/event';
import { homeScreen } from './ui/home';
import { startRouter, type Route } from './ui/router';
import { mountShell } from './ui/shell';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
const { main } = mountShell(root);

async function boot(): Promise<void> {
  let store: Store;
  try {
    store = await openStore();
  } catch {
    main.replaceChildren(
      h('h1', null, 'Storage unavailable'),
      h('p', { class: 'alert', role: 'alert' }, 'This browser cannot save data (private browsing or blocked storage). Open the app in a normal window, then reload.'),
    );
    return;
  }

  let current: Route = { name: 'home' };
  const ctx: Ctx = { store, main, rerender: () => void render(current) };

  async function render(route: Route): Promise<void> {
    current = route;
    try {
      let node: HTMLElement;
      switch (route.name) {
        case 'home': node = await homeScreen(ctx); break;
        case 'event': node = await eventScreen(ctx, route.eventId); break;
        default: node = h('p', null, 'This screen is not built yet.');
      }
      main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch {
      main.replaceChildren(h('h1', null, 'Something went wrong'), h('p', { class: 'alert', role: 'alert' }, 'Could not load this screen. Go back and try again.'), h('a', { href: '#/' }, 'Back to events'));
    }
  }

  startRouter((route) => void render(route));
}

void boot();
```

Later tasks add the `car`, `summary` and `compare` cases to the `switch`.

- [ ] **Step 9: Verify in the browser**

Run: `npx tsc --noEmit && npx vitest run && npm run dev` (leave dev running, or start via the preview tool). Open http://localhost:5173 and check:
- Dark `carbon-shadow` ground; STEM Racing logo at 44px with clear space; h1 in white Magistral italic; h2 in the violet-pink-orange gradient.
- Creating an event navigates to its page; adding a team shows the team card with `Car A` and `Car B` links; a duplicate number shows the alert in text.
- Tab through the page: every control shows the gold focus ring.
- Resize to 768px wide: layout stays single column and inputs stay at least 44px high.

Expected: all of the above holds; no console errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(ui): branded shell, router, home and event screens with team registry" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bench checklist screen

**Files:**
- Create: `src/ui/rows.ts`, `src/ui/checklist.ts`
- Modify: `src/main.ts` (add the `car` case)
- Test: `tests/ui/rows.test.ts`

**Interfaces:**
- Consumes: `h`, `Ctx`, `statusTag`, `classTag` (Task 7); `evaluate`, `summarise`, `parseMeasurement`, `describeLimit`, `Rule`, `Value`, `Result`, `SPAN_LINES` (Tasks 2 to 5); `WF26`, `SECTIONS` (Task 4); `Store`, `Inspection` (Task 6).
- Produces (exact):
  - `ruleRow(rule: Rule, initial: Value, onChange: (v: Value) => void): { el: HTMLElement; showResult: (r: Result) => void }`
  - `checklistScreen(ctx: Ctx, carId: string): Promise<HTMLElement>`
  - Input accessible names: single-value rows `"<article> <rule name> (<unit>)"`, for example `T3.6 Total weight (no cartridge) (g)`; item rows `"<article> <item label> (<unit>)"`; check rows are a radio group named `"<article> <rule name>"` with radios `Pass` and `Fail`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/rows.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../../src/engine';
import { ruleByArticle } from '../../src/rules';
import { ruleRow } from '../../src/ui/rows';

const rule = (a: string) => ruleByArticle(a)!;
const type = (el: HTMLInputElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('ruleRow', () => {
  it('parses typed numbers, treating a comma as a decimal point', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.6'), undefined, onChange);
    const input = el.querySelector('input')!;
    type(input, '46,5');
    expect(onChange).toHaveBeenLastCalledWith(46.5);
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('reports NaN for garbage and marks the input invalid', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.6'), undefined, onChange);
    const input = el.querySelector('input')!;
    type(input, 'abc');
    expect(onChange.mock.calls.at(-1)![0]).toBeNaN();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type(input, '47');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('exposes the accessible name from article, name and unit', () => {
    const { el } = ruleRow(rule('T3.6'), undefined, () => {});
    expect(el.querySelector('input')!.getAttribute('aria-label')).toBe('T3.6 Total weight (no cartridge) (g)');
  });

  it('allows a negative chamber angle but not a negative weight', () => {
    const onChange = vi.fn();
    const angle = ruleRow(rule('T5.4'), undefined, onChange);
    type(angle.el.querySelector('input')!, '-2');
    expect(onChange).toHaveBeenLastCalledWith(-2);
    const weight = ruleRow(rule('T3.6'), undefined, onChange);
    type(weight.el.querySelector('input')!, '-2');
    expect(onChange.mock.calls.at(-1)![0]).toBeNaN();
  });

  it('pass/fail rows are a radio group and clicking the active option clears it', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T3.1.3'), undefined, onChange);
    const [pass, fail] = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    pass.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(pass.getAttribute('aria-checked')).toBe('true');
    fail.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    fail.click();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(fail.getAttribute('aria-checked')).toBe('false');
  });

  it('per-wheel rows keep a value per wheel', () => {
    const onChange = vi.fn();
    const { el } = ruleRow(rule('T7.4'), undefined, onChange);
    const inputs = [...el.querySelectorAll('input')];
    expect(inputs).toHaveLength(4);
    type(inputs[2], '13.8');
    expect(onChange).toHaveBeenLastCalledWith({ RL: 13.8 });
    type(inputs[3], '13.8');
    expect(onChange).toHaveBeenLastCalledWith({ RL: 13.8, RR: 13.8 });
  });

  it('span rows have four lines', () => {
    const { el } = ruleRow(rule('T9.5.1'), undefined, () => {});
    expect(el.querySelectorAll('input')).toHaveLength(4);
  });

  it('shows the result as words, with points and detail, as plain text', () => {
    const { el, showResult } = ruleRow(rule('T3.6'), 46.5, () => {});
    showResult(evaluate(rule('T3.6'), 46.5));
    const result = el.querySelector('.row__result')!;
    expect(result.textContent).toContain('Fail');
    expect(result.textContent).toContain('20 pts');
    expect(el.classList.contains('row--fail')).toBe(true);
    showResult(evaluate(rule('T3.6'), undefined));
    expect(result.textContent).toContain('To do');
    expect(el.classList.contains('row--fail')).toBe(false);
  });

  it('restores initial values into the inputs', () => {
    const { el } = ruleRow(rule('T3.6'), 47.2, () => {});
    expect(el.querySelector('input')!.value).toBe('47.2');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/rows.test.ts`
Expected: FAIL, cannot resolve `../../src/ui/rows`.

- [ ] **Step 3: Implement rows.ts**

`src/ui/rows.ts`:

```ts
import { SPAN_LINES, describeLimit, parseMeasurement, type Result, type Rule, type Value } from '../engine';
import { h } from './dom';
import { classTag, statusTag } from './tags';

type Rec = Record<string, number | boolean | undefined>;

const SPAN_LABELS: Record<(typeof SPAN_LINES)[number], string> = {
  leading: 'Leading edge', trailing: 'Trailing edge', top: 'Top surface', bottom: 'Bottom surface',
};

function numberField(
  article: string, label: string, ariaName: string, unit: string, initial: number | undefined, allowNegative: boolean,
  onValue: (v: number | undefined) => void,
): HTMLElement {
  const input = h('input', {
    type: 'text', inputmode: allowNegative ? 'text' : 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': ariaName, 'aria-invalid': 'false', value: initial === undefined || Number.isNaN(initial) ? '' : String(initial),
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

function passFail(ariaName: string, label: string, initial: boolean | undefined, onValue: (v: boolean | undefined) => void): HTMLElement {
  let current = initial;
  const pass = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === true) }, 'Pass');
  const fail = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === false) }, 'Fail');
  const set = (next: boolean) => {
    current = current === next ? undefined : next;
    pass.setAttribute('aria-checked', String(current === true));
    fail.setAttribute('aria-checked', String(current === false));
    onValue(current);
  };
  pass.addEventListener('click', () => set(true));
  fail.addEventListener('click', () => set(false));
  return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), h('div', { class: 'seg', role: 'radiogroup', 'aria-label': ariaName }, pass, fail));
}

function controls(rule: Rule, initial: Value, onChange: (v: Value) => void): HTMLElement[] {
  switch (rule.kind) {
    case 'range': {
      const unit = rule.unit;
      return [numberField(rule.article, 'Measured', `${rule.article} ${rule.name} (${unit})`, unit, typeof initial === 'number' ? initial : undefined, unit === 'deg', (v) => onChange(v))];
    }
    case 'check':
      return [passFail(`${rule.article} ${rule.name}`, 'Compliant?', typeof initial === 'boolean' ? initial : undefined, (v) => onChange(v))];
    case 'perItemRange': {
      const rec: Rec = typeof initial === 'object' && initial !== null ? { ...initial } : {};
      return rule.items.map((item) =>
        numberField(rule.article, item.label, `${rule.article} ${item.label} (${rule.unit})`, rule.unit, rec[item.id] as number | undefined, false, (v) => {
          if (v === undefined) delete rec[item.id]; else rec[item.id] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
    case 'perItemCheck': {
      const rec: Rec = typeof initial === 'object' && initial !== null ? { ...initial } : {};
      return rule.items.map((item) =>
        passFail(`${rule.article} ${item.label}`, item.label, rec[item.id] as boolean | undefined, (v) => {
          if (v === undefined) delete rec[item.id]; else rec[item.id] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
    case 'span': {
      const rec: Rec = typeof initial === 'object' && initial !== null ? { ...initial } : {};
      return SPAN_LINES.map((line) =>
        numberField(rule.article, SPAN_LABELS[line], `${rule.article} ${SPAN_LABELS[line]} (mm)`, 'mm', rec[line] as number | undefined, false, (v) => {
          if (v === undefined) delete rec[line]; else rec[line] = v;
          onChange(Object.keys(rec).length === 0 ? undefined : { ...rec });
        }));
    }
  }
}

export function ruleRow(rule: Rule, initial: Value, onChange: (v: Value) => void): { el: HTMLElement; showResult: (r: Result) => void } {
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
    h('div', { class: 'row__controls' }, controls(rule, initial, onChange)),
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ui/rows.test.ts`
Expected: PASS. If the per-wheel test's `toHaveBeenLastCalledWith({ RL: 13.8 })` fails because a mutable `rec` was passed, make sure `onChange` receives a copy (`{ ...rec }`), as above.

- [ ] **Step 5: Implement checklist.ts**

`src/ui/checklist.ts`:

```ts
import { summarise, type Measurements, type Value } from '../engine';
import { SECTIONS, WF26 } from '../rules';
import type { Inspection } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { ruleRow } from './rows';

export async function checklistScreen(ctx: Ctx, carId: string): Promise<HTMLElement> {
  const car = await ctx.store.getCar(carId);
  const team = car ? await ctx.store.getTeam(car.teamId) : undefined;
  if (!car || !team) {
    return h('div', { class: 'stack' }, h('p', null, 'That car was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  }

  const existing = await ctx.store.getInspection(carId);
  const insp: Inspection = existing ?? {
    carId, scrutineer: '', startedAt: Date.now(), updatedAt: Date.now(), measurements: {}, notes: {},
  };
  const measurements: Measurements = { ...insp.measurements };

  // Serialise writes so a fast typist never races an older save over a newer one.
  let queue: Promise<unknown> = Promise.resolve();
  const save = (): void => {
    const snapshot: Inspection = { ...insp, measurements: structuredClone(measurements) };
    queue = queue.then(() => ctx.store.saveInspection(snapshot)).then((saved) => { insp.updatedAt = saved.updatedAt; }).catch(() => {
      saveError.hidden = false;
    });
  };
  const saveError = h('p', { class: 'alert', role: 'alert', hidden: true }, 'Could not save to this device. Export a backup and check browser storage.');

  const total = h('span', { class: 'bar__total' }, '0');
  const meta = h('span', { class: 'bar__meta' });
  const bar = h('div', { class: 'bar', role: 'status', 'aria-label': 'Penalty total' },
    h('span', null, h('span', { class: 'eyebrow' }, 'Penalty points, this car'), h('br'), total),
    meta,
    h('a', { class: 'btn btn--primary btn--small', href: routeHref({ name: 'summary', carId }) }, 'See summary'),
  );

  const rows = new Map<string, ReturnType<typeof ruleRow>>();
  const refresh = (): void => {
    const s = summarise(WF26.rules, measurements);
    for (const r of s.results) rows.get(r.article)?.showResult(r);
    total.textContent = String(s.total);
    meta.replaceChildren(
      h('span', null, `${s.pending.length} to do`),
      h('span', null, `${s.perfFailures.length} performance`),
      h('span', null, `${s.safetyFailures.length} safety`),
      s.ineligibleFor.length ? h('span', null, 'Not eligible for Fastest Car or Best Engineered Car') : null,
    );
  };

  const sections = SECTIONS.map((sec) => {
    const rules = WF26.rules.filter((r) => r.section === sec.id);
    const els = rules.map((rule) => {
      const row = ruleRow(rule, measurements[rule.article], (v: Value) => {
        if (v === undefined) delete measurements[rule.article]; else measurements[rule.article] = v;
        refresh();
        save();
      });
      rows.set(rule.article, row);
      return row.el;
    });
    return h('section', { class: 'section' }, h('h2', null, sec.title), els);
  });

  const scrutineer = h('input', { value: insp.scrutineer, maxlength: 80, autocomplete: 'off', 'aria-label': 'Scrutineer name' });
  scrutineer.addEventListener('input', () => { insp.scrutineer = scrutineer.value.trim(); save(); });

  const screen = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'event', eventId: team.eventId }) }, 'Back to teams'),
      h('p', { class: 'eyebrow' }, WF26.name),
      h('h1', null, `Team ${team.number} · Car ${car.label}`),
      h('p', { class: 'lead' }, team.name),
      h('label', { class: 'field', style: 'max-width: 320px' }, h('span', { class: 'field__label' }, 'Scrutineer'), scrutineer),
    ),
    saveError,
    bar,
    ...sections,
    h('div', { class: 'actions' }, h('a', { class: 'btn btn--primary', href: routeHref({ name: 'summary', carId }) }, 'See summary')),
  );
  refresh();
  return screen;
}
```

- [ ] **Step 6: Wire the route**

In `src/main.ts` add `import { checklistScreen } from './ui/checklist';` and, inside the `switch`, before `default`:

```ts
        case 'car': node = await checklistScreen(ctx, route.carId); break;
```

- [ ] **Step 7: Run all tests and verify in the browser**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

Then `npm run dev`, create an event and team, open Car A and check:
- Enter `46,5` in T3.6: the row shows a violet "Fail" tag, `20 pts`, the ballast note, and the sticky bar shows 20.
- Enter `abc`: the field gets a pink border and the row says "Enter a number"; total is unchanged.
- Press a Pass/Fail button with the keyboard (Tab then Enter); the gold focus ring is visible.
- Reload the page: values are still there.
- Every control is at least 44px tall at 768px width.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): bench checklist with live penalties and per-keystroke saving" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Car summary and A-versus-B compare

**Files:**
- Create: `src/ui/summary.ts`, `src/ui/compare.ts`
- Modify: `src/main.ts` (add `summary` and `compare` cases)
- Test: `tests/ui/summary.test.ts`

**Interfaces:**
- Consumes: `summarise`, `summarisePair`, `CarSummary`, `Result`, `AWARDS_LOST` (Task 5); `WF26` (Task 4); `Ctx`, `h`, `routeHref`, `classTag` (Task 7).
- Produces (exact):
  - `summaryView(summary: CarSummary, extra: { carLabel: string; actions: HTMLElement[] }): HTMLElement` (pure view, testable)
  - `summaryScreen(ctx: Ctx, carId: string): Promise<HTMLElement>`
  - `compareScreen(ctx: Ctx, teamId: string): Promise<HTMLElement>`
  - `summaryScreen` exposes a download button with `data-action="download-pdf"` that calls `downloadSheet` from `../pdf/resultSheet` (defined in Task 10; this task renders the button disabled until Task 10 wires it, see Step 5).

- [ ] **Step 1: Write the failing test**

`tests/ui/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarise } from '../../src/engine';
import { WF26 } from '../../src/rules';
import { summaryView } from '../../src/ui/summary';

describe('summaryView', () => {
  it('shows the total, the award warning and performance failures first', () => {
    const s = summarise(WF26.rules, { 'T3.6': 46.5, 'T5.1': 17 });
    const el = summaryView(s, { carLabel: 'A', actions: [] });
    const text = el.textContent!;
    expect(text).toContain('25');
    expect(text).toContain('Not eligible for Fastest Car or Best Engineered Car');
    expect(text.indexOf('T3.6')).toBeLessThan(text.indexOf('T5.1'));
    expect(text).toContain('20-minute service session');
  });

  it('omits the award warning when there are no performance failures', () => {
    const s = summarise(WF26.rules, { 'T5.1': 17 });
    expect(summaryView(s, { carLabel: 'A', actions: [] }).textContent).not.toContain('Not eligible');
  });

  it('says so when nothing has been entered', () => {
    const el = summaryView(summarise(WF26.rules, {}), { carLabel: 'B', actions: [] });
    expect(el.textContent).toContain('Nothing has been entered for this car yet');
    expect(el.textContent).toContain('0');
  });

  it('lists at-risk margins and unfinished rows', () => {
    const s = summarise(WF26.rules, { 'T3.4': 84.9 });
    const text = summaryView(s, { carLabel: 'A', actions: [] }).textContent!;
    expect(text).toContain('Within 0.5 of a limit');
    expect(text).toContain('T3.4');
    expect(text).toMatch(/\d+ rows? still to do/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/summary.test.ts`
Expected: FAIL, cannot resolve `../../src/ui/summary`.

- [ ] **Step 3: Implement summary.ts**

`src/ui/summary.ts`:

```ts
import type { CarSummary, Result } from '../engine';
import { WF26 } from '../rules';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { classTag } from './tags';

function resultList(items: Result[]): HTMLElement {
  return h('ul', { class: 'list' }, items.map((r) =>
    h('li', null,
      h('div', { class: 'row__head' }, h('strong', null, `${r.article} ${r.name}`), classTag(r.cls), h('strong', null, `${r.penalty} pts`)),
      [...r.detail, ...r.notes].map((t) => h('p', { class: 'small' }, t)))));
}

export function summaryView(s: CarSummary, extra: { carLabel: string; actions: HTMLElement[] }): HTMLElement {
  const none = !s.started;
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stat' },
      h('span', { class: 'stat__value' }, String(s.total)),
      h('span', { class: 'stat__label' }, `Penalty points, Car ${extra.carLabel}`)),
    none ? h('p', { class: 'lead' }, 'Nothing has been entered for this car yet.') : null,
    s.ineligibleFor.length
      ? h('p', { class: 'alert', role: 'status' }, `Not eligible for ${s.ineligibleFor.join(' or ')} (T2.4.2): ${s.perfFailures.length} Performance infringement${s.perfFailures.length === 1 ? '' : 's'}.`)
      : null,
    s.perfFailures.length ? h('section', { class: 'section' }, h('h2', null, 'Performance'), resultList(s.perfFailures)) : null,
    s.safetyFailures.length
      ? h('section', { class: 'section' }, h('h2', null, 'Safety'),
          h('p', null, 'Fix these in the single 20-minute service session after initial specification judging, or the car is not safe to race.'),
          resultList(s.safetyFailures))
      : null,
    s.generalFailures.length ? h('section', { class: 'section' }, h('h2', null, 'General'), resultList(s.generalFailures)) : null,
    s.atRisk.length
      ? h('section', { class: 'section' }, h('h2', null, 'At risk'),
          h('p', null, 'Within 0.5 of a limit. Paint, decals and machining variance can tip these over.'),
          h('ul', { class: 'list' }, s.atRisk.map((r) => h('li', null, h('strong', null, `${r.article} ${r.name}`)))))
      : null,
    s.invalid.length
      ? h('section', { class: 'section' }, h('h2', null, 'Needs a number'), h('ul', { class: 'list' }, s.invalid.map((r) => h('li', null, `${r.article} ${r.name}`))))
      : null,
    s.pending.length
      ? h('p', { class: 'muted' }, `${s.pending.length} row${s.pending.length === 1 ? '' : 's'} still to do.`)
      : null,
    h('div', { class: 'actions' }, extra.actions),
  );
}

export async function summaryScreen(ctx: Ctx, carId: string): Promise<HTMLElement> {
  const { summarise } = await import('../engine');
  const car = await ctx.store.getCar(carId);
  const team = car ? await ctx.store.getTeam(car.teamId) : undefined;
  const event = team ? await ctx.store.getEvent(team.eventId) : undefined;
  if (!car || !team || !event) {
    return h('div', { class: 'stack' }, h('p', null, 'That car was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  }
  const insp = await ctx.store.getInspection(carId);
  const s = summarise(WF26.rules, insp?.measurements ?? {});

  const pdf = h('button', { class: 'btn btn--primary', type: 'button', 'data-action': 'download-pdf', disabled: true }, 'Download PDF');
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'car', carId }) }, 'Back to checklist'),
      h('p', { class: 'eyebrow' }, event.name),
      h('h1', null, `Team ${team.number} · Car ${car.label}`),
      h('p', { class: 'lead' }, team.name)),
    summaryView(s, {
      carLabel: car.label,
      actions: [
        pdf,
        h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId }) }, 'Back to checklist'),
        h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'compare', teamId: team.id }) }, 'Compare cars A and B'),
      ],
    }),
  );
}
```

(The dynamic `import('../engine')` in `summaryScreen` is unnecessary; replace it with a normal top-level `import { summarise, type CarSummary, type Result } from '../engine';`.)

- [ ] **Step 4: Implement compare.ts**

`src/ui/compare.ts`:

```ts
import { summarise, summarisePair, type Result } from '../engine';
import { WF26 } from '../rules';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const items = (rs: Result[]) =>
  rs.length === 0
    ? h('p', { class: 'muted' }, 'None.')
    : h('ul', { class: 'list' }, rs.map((r) => h('li', null, h('strong', null, `${r.article} ${r.name}`), h('span', { class: 'small' }, `${r.penalty} pts`))));

export async function compareScreen(ctx: Ctx, teamId: string): Promise<HTMLElement> {
  const team = await ctx.store.getTeam(teamId);
  if (!team) return h('div', { class: 'stack' }, h('p', null, 'That team was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  const cars = await ctx.store.carsForTeam(teamId);
  const [a, b] = cars;
  const sums = await Promise.all(cars.map(async (c) => summarise(WF26.rules, (await ctx.store.getInspection(c.id))?.measurements ?? {})));
  const pair = summarisePair(sums[0], sums[1]);

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'event', eventId: team.eventId }) }, 'Back to teams'),
      h('h1', null, `Team ${team.number}: Car A and Car B`),
      h('p', { class: 'lead' }, team.name)),
    h('div', { class: 'grid' },
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sums[0].total)), h('span', { class: 'stat__label' }, 'Penalty points, Car A')),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sums[1].total)), h('span', { class: 'stat__label' }, 'Penalty points, Car B')),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(pair.total)), h('span', { class: 'stat__label' }, 'Penalty points, both cars'))),
    h('section', { class: 'section' }, h('h2', null, 'Faults on both cars'),
      h('p', null, 'A shared design fault costs twice, once per car (T2.5.1).'), items(pair.shared)),
    h('section', { class: 'section' }, h('h2', null, 'Only Car A'), items(pair.onlyA)),
    h('section', { class: 'section' }, h('h2', null, 'Only Car B'), items(pair.onlyB)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId: a.id }) }, 'Open Car A'),
      h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId: b.id }) }, 'Open Car B')),
  );
}
```

- [ ] **Step 5: Wire routes**

In `src/main.ts` add the imports `summaryScreen` from `./ui/summary` and `compareScreen` from `./ui/compare`, and in the `switch`:

```ts
        case 'summary': node = await summaryScreen(ctx, route.carId); break;
        case 'compare': node = await compareScreen(ctx, route.teamId); break;
```

The PDF button stays `disabled` until Task 10 enables it.

- [ ] **Step 6: Run and verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. In the browser, after entering a failing weight on Car A and the same on Car B, "Compare" lists T3.6 under "Faults on both cars" and the pair total is double.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): car summary with award warning and A-vs-B compare" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: PDF result sheet

**Files:**
- Create: `src/pdf/resultSheet.ts`
- Modify: `src/ui/summary.ts` (enable the PDF button)
- Test: `tests/pdf/resultSheet.test.ts`

**Interfaces:**
- Consumes: `CarSummary`, `Result`, `AWARDS_LOST` (Task 5); `WF26` (Task 4).
- Produces (exact):
  - `interface SheetInput { eventName: string; teamNumber: string; teamName: string; school: string; carLabel: 'A' | 'B'; scrutineer: string; date: string; rulesetName: string; rulesetIssued: string; summary: CarSummary; logoDataUrl?: string }`
  - `sheetRows(results: Result[]): string[][]` (columns: article, name, status, class, points)
  - `sheetFileName(i: Pick<SheetInput, 'eventName' | 'teamNumber' | 'carLabel'>): string`
  - `buildResultSheet(i: SheetInput): jsPDF`
  - `downloadSheet(i: SheetInput): Promise<void>` (loads the logo, builds, saves)

- [ ] **Step 1: Write the failing tests**

`tests/pdf/resultSheet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarise } from '../../src/engine';
import { WF26 } from '../../src/rules';
import { buildResultSheet, sheetFileName, sheetRows, type SheetInput } from '../../src/pdf/resultSheet';

const input = (m: Record<string, number>, over: Partial<SheetInput> = {}): SheetInput => ({
  eventName: 'Regional round', teamNumber: '12', teamName: 'Apex', school: 'The British School', carLabel: 'A',
  scrutineer: 'R. Gupta', date: '2026-11-01', rulesetName: WF26.name, rulesetIssued: WF26.issued,
  summary: summarise(WF26.rules, m), ...over,
});

describe('sheetRows', () => {
  it('lists every rule with words for status and points only on failures', () => {
    const s = summarise(WF26.rules, { 'T3.6': 46.5, 'T3.4': 70 });
    const rows = sheetRows(s.results);
    expect(rows).toHaveLength(WF26.rules.length);
    const w = rows.find((r) => r[0] === 'T3.6')!;
    expect(w).toEqual(['T3.6', 'Total weight (no cartridge)', 'Fail', 'Performance', '20']);
    expect(rows.find((r) => r[0] === 'T3.4')).toEqual(['T3.4', 'Total width', 'Pass', 'General', '']);
    expect(rows.find((r) => r[0] === 'T3.5')![2]).toBe('To do');
  });
});

describe('sheetFileName', () => {
  it('is safe for hostile, long and non-Latin names', () => {
    const name = sheetFileName({ eventName: '../../etc/<passwd> "x"\n', teamNumber: 'A/12', carLabel: 'B' });
    expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(sheetFileName({ eventName: 'x'.repeat(500), teamNumber: '1', carLabel: 'A' }).length).toBeLessThan(120);
    expect(sheetFileName({ eventName: 'स्टेम रेसिंग', teamNumber: '१', carLabel: 'A' })).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
  });
});

describe('buildResultSheet', () => {
  it('produces a multi-page PDF', () => {
    const doc = buildResultSheet(input({ 'T3.6': 46.5, 'T5.1': 17 }));
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('renders hostile and emoji team names without throwing', () => {
    const doc = buildResultSheet(input({}, { teamName: '<script>alert(1)</script> 🚗 "quoted"', eventName: 'E'.repeat(300), school: '' }));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('works for a car with nothing entered', () => {
    expect(() => buildResultSheet(input({}))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pdf`
Expected: FAIL, cannot resolve `../../src/pdf/resultSheet`.

- [ ] **Step 3: Implement**

`src/pdf/resultSheet.ts`:

```ts
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CarSummary, Result, RuleClass, Status } from '../engine';

export interface SheetInput {
  eventName: string;
  teamNumber: string;
  teamName: string;
  school: string;
  carLabel: 'A' | 'B';
  scrutineer: string;
  date: string;
  rulesetName: string;
  rulesetIssued: string;
  summary: CarSummary;
  logoDataUrl?: string;
}

// Brand colours (design system tokens) as RGB for jsPDF.
const CARBON_SHADOW: [number, number, number] = [5, 0, 11];
const CHICANE_VIOLET: [number, number, number] = [150, 27, 129];
const PITLANE_PINK: [number, number, number] = [230, 0, 126];
const SURFACE_LIGHT: [number, number, number] = [243, 243, 247];
const CARBON_100: [number, number, number] = [215, 214, 227];

const CLASS_LABEL: Record<RuleClass, string> = { GEN: 'General', SAF: 'Safety', PERF: 'Performance' };
const STATUS_LABEL: Record<Status, string> = { pending: 'To do', pass: 'Pass', fail: 'Fail', invalid: 'Invalid' };

export function sheetRows(results: Result[]): string[][] {
  return results.map((r) => [
    r.article,
    r.name,
    STATUS_LABEL[r.status] + (r.status === 'pass' && r.atRisk ? ', at risk' : ''),
    CLASS_LABEL[r.cls],
    r.status === 'fail' ? String(r.penalty) : '',
  ]);
}

const safe = (s: string): string =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';

export function sheetFileName(i: Pick<SheetInput, 'eventName' | 'teamNumber' | 'carLabel'>): string {
  return `STEM-Racing-Scrutineering_${safe(i.eventName)}_Team-${safe(i.teamNumber)}${i.carLabel}.pdf`;
}

/** jsPDF's built-in fonts only cover Latin-1: replace anything else so text never garbles. */
const pdfText = (s: string): string => s.replace(/[^\x20-\x7E -ÿ]/g, '?');

export function buildResultSheet(i: SheetInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 12;

  // Header band: official full-colour white logo on carbon-shadow, 12 mm high with 6 mm clear space.
  doc.setFillColor(...CARBON_SHADOW);
  doc.rect(0, 0, W, 24, 'F');
  if (i.logoDataUrl) doc.addImage(i.logoDataUrl, 'PNG', M, 6, 24.2, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(16);
  doc.text('Scrutineering result sheet', W - M, 15, { align: 'right' });

  doc.setTextColor(...CARBON_SHADOW);
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(20);
  const title = doc.splitTextToSize(pdfText(`Team ${i.teamNumber}, Car ${i.carLabel}`), W - 2 * M);
  doc.text(title, M, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const info = [
    pdfText(`Team: ${i.teamName}${i.school ? ` (${i.school})` : ''}`),
    pdfText(`Event: ${i.eventName}`),
    pdfText(`Date: ${i.date}    Scrutineer: ${i.scrutineer || 'not recorded'}`),
    pdfText(`Rules: ${i.rulesetName}, issued ${i.rulesetIssued}`),
  ].flatMap((line) => doc.splitTextToSize(line, W - 2 * M) as string[]);
  doc.text(info, M, 44);
  let y = 44 + info.length * 5 + 3;

  // Totals panel.
  const s = i.summary;
  doc.setFillColor(...SURFACE_LIGHT);
  doc.roundedRect(M, y, W - 2 * M, 22, 2, 2, 'F');
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(26);
  doc.setTextColor(...CARBON_SHADOW);
  doc.text(String(s.total), M + 5, y + 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('penalty points for this car', M + 5 + doc.getTextWidth(String(s.total)) * 1.9 + 2, y + 13.5);
  doc.setFontSize(9);
  doc.text(
    `${s.perfFailures.length} Performance, ${s.safetyFailures.length} Safety, ${s.generalFailures.length} General infringements; ${s.pending.length} rows still to do`,
    M + 5, y + 19,
  );
  y += 28;

  const notes: string[] = [];
  if (!s.started) notes.push('Nothing has been entered for this car.');
  if (s.ineligibleFor.length) notes.push(`Not eligible for ${s.ineligibleFor.join(' or ')} (T2.4.2).`);
  if (s.safetyFailures.length) notes.push('Safety infringements: fix in the single 20-minute service session, or the car is not safe to race.');
  for (const r of s.results) for (const n of r.notes) if (r.status === 'fail') notes.push(`${r.article}: ${n}`);
  if (s.atRisk.length) notes.push(`At risk (within 0.5 of a limit): ${s.atRisk.map((r) => r.article).join(', ')}.`);
  doc.setFontSize(9.5);
  doc.setTextColor(...CARBON_SHADOW);
  for (const n of notes) {
    const lines = doc.splitTextToSize(pdfText(n), W - 2 * M - 4) as string[];
    doc.setFont('helvetica', 'bold');
    doc.text(lines, M + 2, y);
    y += lines.length * 4.6 + 1.5;
  }

  autoTable(doc, {
    startY: y + 2,
    head: [['Article', 'Rule', 'Result', 'Class', 'Pts']],
    body: sheetRows(s.results).map((r) => r.map(pdfText)),
    margin: { left: M, right: M, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: CARBON_SHADOW, lineColor: CARBON_100, lineWidth: 0.1 },
    headStyles: { fillColor: CHICANE_VIOLET, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 28 }, 3: { cellWidth: 26 }, 4: { cellWidth: 12, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.raw && (data.row.raw as string[])[2] === 'Fail') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [253, 232, 243];
        if (data.column.index === 2) data.cell.styles.textColor = PITLANE_PINK;
      }
    },
  });

  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let sy = last + 14;
  if (sy > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    sy = 30;
  }
  doc.setDrawColor(...CARBON_SHADOW);
  doc.line(M, sy, M + 80, sy);
  doc.line(W - M - 60, sy, W - M, sy);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...CARBON_SHADOW);
  doc.text('Scrutineer signature', M, sy + 4.5);
  doc.text('Team representative', W - M - 60, sy + 4.5);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(91, 83, 118);
    doc.text(pdfText(`${i.rulesetName}. Regulation text governs; this sheet is a record of measurements taken at the bench.`), M, 290);
    doc.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc;
}

async function loadLogo(): Promise<string | undefined> {
  try {
    const res = await fetch('/brand/logo-full-colour-white.png');
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function downloadSheet(i: SheetInput): Promise<void> {
  const logoDataUrl = i.logoDataUrl ?? (await loadLogo());
  buildResultSheet({ ...i, logoDataUrl }).save(sheetFileName(i));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pdf && npx tsc --noEmit`
Expected: PASS. If `autoTable` typing complains about `[number, number, number]` tuples for `fillColor`, widen with `as [number, number, number]`. If `jspdf` warns about the Latin-1 `?` replacement, that is expected (see the pdfText helper).

- [ ] **Step 5: Enable the PDF button**

In `src/ui/summary.ts`, import `downloadSheet` from `../pdf/resultSheet` and `WF26` (already imported). Replace the disabled button with a live one:

```ts
  const pdf = h('button', { class: 'btn btn--primary', type: 'button', 'data-action': 'download-pdf' }, 'Download PDF');
  pdf.addEventListener('click', async () => {
    pdf.setAttribute('disabled', '');
    try {
      await downloadSheet({
        eventName: event.name, teamNumber: team.number, teamName: team.name, school: team.school, carLabel: car.label,
        scrutineer: insp?.scrutineer ?? '', date: new Date().toISOString().slice(0, 10),
        rulesetName: WF26.name, rulesetIssued: WF26.issued, summary: s,
      });
    } finally {
      pdf.removeAttribute('disabled');
    }
  });
```

- [ ] **Step 6: Verify in the browser**

Run `npm run dev`. On a car with a failing weight and a failing chamber diameter, click Download PDF and open the file:
- Dark header band with the full-colour logo, a totals panel, the award note, the Safety note, and a table with failed rows highlighted.
- All rows listed; unanswered rows say "To do".
- Open a team named `<b>Test</b> 🚗`: the PDF is generated, the file name is safe, no error.

Expected: matches. Note in the commit that PDF headings use Helvetica (brand font cannot be embedded).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(pdf): branded per-car result sheet with safe file names" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Offline end-to-end test, README and release check

**Files:**
- Create: `playwright.config.ts`, `e2e/inspection.spec.ts`, `README.md`

**Interfaces:**
- Consumes: the whole app, via the built `dist/` served by `vite preview` on port 4173.

- [ ] **Step 1: Write the Playwright config and the failing e2e test**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
  projects: [
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

`e2e/inspection.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('scrutineer inspects a car offline and the work survives a reload', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Regional round');
  await page.getByRole('button', { name: 'Create event' }).click();

  await page.getByLabel('Team number').fill('12');
  await page.getByLabel('Team name').fill('Apex <b>Racing</b>');
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('heading', { name: /Team 12 · Apex <b>Racing<\/b>/ })).toBeVisible();

  // Duplicate number is refused in words.
  await page.getByLabel('Team number').fill('12');
  await page.getByLabel('Team name').fill('Another');
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('alert')).toContainText('already used');

  await page.getByRole('link', { name: /Car A/ }).click();

  // The service worker must be controlling the page before we go offline.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await context.setOffline(true);

  const weight = page.getByLabel('T3.6 Total weight (no cartridge) (g)', { exact: true });
  await weight.fill('46,5');
  const row = page.locator('[id="rule-T3.6"]');
  await expect(row).toContainText('Fail');
  await expect(row).toContainText('20 pts');
  await expect(row).toContainText('3 g');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('20');

  // Garbage is never scored.
  await weight.fill('abc');
  await expect(row).toContainText('Enter a number');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('0');
  await weight.fill('46.5');

  // Rear wing: shortest line governs.
  await page.getByLabel('T9.5.1 Trailing edge (mm)', { exact: true }).fill('47.2');
  await expect(page.locator('[id="rule-T9.5.1"]')).toContainText('6 pts');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('26');

  // Reload while offline: the app shell and the saved values both come back.
  await page.reload();
  await expect(page.getByLabel('T3.6 Total weight (no cartridge) (g)', { exact: true })).toHaveValue('46.5');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('26');

  // Summary shows the award warning.
  await page.getByRole('link', { name: 'See summary' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Not eligible for Fastest Car' })).toBeVisible();

  // PDF downloads with a safe name.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^STEM-Racing-Scrutineering_Regional-round_Team-12A\.pdf$/);
});
```

- [ ] **Step 2: Run to see it fail or reveal gaps**

Run: `npm run e2e`
Expected on the first run: it either PASSES (if every earlier task is right) or fails at a specific line. Fix the cause in the source, never by loosening the test. Typical causes: `getByRole('status', { name: 'Penalty total' })` needs the bar's `aria-label` (set in Task 8); the service worker not controlling the page (check `registerSW` ran and `dist/sw.js` exists); label text mismatches.

- [ ] **Step 3: Write the README**

`README.md`:

```markdown
# STEM Racing India digital scrutineering

Offline-first checklist for scrutineers at STEM Racing events. Enter measurements for each car, see penalties
from the Aramco STEM Racing World Finals 2026 Technical Regulations (Professional class) computed live, and print a
result sheet. Records stay on the device; export a JSON backup to copy or merge them.

## Run

    npm install
    npm run dev        # develop at http://localhost:5173
    npm run build && npm run preview   # production build at http://localhost:4173

## Test

    npm test           # engine, rules, store, UI and PDF unit tests
    npm run e2e        # offline end-to-end test (needs: npx playwright install chromium)

## Using it at an event

- Host the built `dist/` over **https** (for example Vercel), or serve it from `localhost`. Service workers and
  offline mode do not work on plain `http://` LAN addresses or `file://`.
- Open the app once with internet so it can cache itself. After that it works with no connection.
- Each device keeps its own records. Use **Export backup** on one device and **Import backup** on another to merge.

## Rules

The WF26 rules live in `src/rules/wf26.ts`, copied from the regulation digest (issued 10 February 2026). To add
another class or season, add a new ruleset file with the same shape. Amendments are published on stemracing.com;
check the clarifications page before an event. The Competition Regulations (C-prefix) are out of scope, including
the half-points rule for Safety items fixed in the service session.

## Brand

Colours, type, components and logo rules follow the STEM Racing design system
(https://claude.ai/artifact/KutpCGGzkX3doLkwNpHZCQ), the Secondary division theme of the Brand Identity Guidelines v1.3.
Replace `public/brand/logo-full-colour-white.png` with the India location lockup when a PNG is available.
The PDF uses Helvetica because jsPDF cannot embed the web fonts.
```

- [ ] **Step 4: Release check**

Run: `npm run typecheck && npm test && npm run e2e && npm run build`
Expected: all green; `dist/` contains `sw.js`, `manifest.webmanifest`, `fonts/*.woff2`, `brand/*.png`.

Then verify manually in `npm run preview`:
- Lighthouse (Chrome DevTools) PWA installability passes; "Add to Home Screen" works on a tablet.
- Switch DevTools to offline, reload: the app loads and a car opens.
- Check headings are all italic Magistral, no drop shadows anywhere, and every status shows a word.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: offline end-to-end inspection flow; docs: README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| 1 Scope: checklist and auto penalties | 3, 4, 5, 8 |
| 1 Scope: team and car registry | 6, 7 |
| 1 Scope: PDF result sheet | 10 |
| 2 Architecture (PWA, IndexedDB, units) | 1, 6, 11 |
| 3 Engine behaviours (absolute limits, PP+ rounding, per-car, reclassification, ballast, ineligibility, margin warning, cartridge-in reminders) | 2, 3, 4, 5 |
| 4 Data model, results derived on read, JSON export/import | 5, 6 |
| 5 Screens: team list, checklist, summary, A vs B | 7, 8, 9 |
| 6 PDF contents | 10 |
| 7 Testing: digest worked examples, T2.5.2 rule-data test, Playwright flow | 4, 11 |
| 8 Risks: rules version shown in UI and PDF | 8 (checklist eyebrow), 10 (sheet header) |

Gaps found and fixed in this plan: the spec's `tiered` kind became four check rules (stated under Deviations); the "runnable from local files" claim is corrected in the README (service workers need https or localhost); the front-wing segment entry convention is documented.

**Placeholder scan:** no TBD or "handle edge cases" steps; every code step contains code. Task 9 Step 3 calls out a cleanup (replace the dynamic import with a top-level import) explicitly.

**Type consistency:** `evaluate`, `summarise`, `summarisePair`, `carStatus`, `ruleRow`, `summaryView`, `sheetRows`, `sheetFileName`, `buildResultSheet`, `downloadSheet`, `openStore`/`Store` and `Ctx` use the same names and signatures wherever they appear. Measurement keys are rule articles throughout. Accessible names in Task 8 match the e2e selectors in Task 11 (`T3.6 Total weight (no cartridge) (g)`, `T9.5.1 Trailing edge (mm)`).

**Review Focus coverage:** items 1 to 5 map to tests in Tasks 2, 3, 4, 5, 6, 7, 8 and 10 as listed in the Review Focus section.
