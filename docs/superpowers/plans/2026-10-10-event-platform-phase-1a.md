# STEM Racing India Event Platform, Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the online platform's core: events, teams, roles and invitations, official scorecards for every judged area, Chair moderation, protest penalties, rankings of the judged points, and released results for teams and the public.

**Architecture:** A framework-free TypeScript web app in `platform/` talks to Supabase (Postgres with row-level security, Auth) through a small `Api` interface with an in-memory implementation (tests, demo mode) and a Supabase implementation. A pure engine (`src/engine`) computes scorecard totals and rankings from a ruleset that is plain data. Database rules are SQL migrations tested in Node with PGlite (Postgres in WASM), so no Docker or Supabase account is needed to prove them.

**Tech Stack:** TypeScript, Vite, `@supabase/supabase-js`, PGlite (tests), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-10-event-platform-design.md`

## Scope of this plan (Phase 1a)

The spec's Phase 1 is split because one plan cannot hold all of it and still yield working software. **This plan:** core, scorecards for the judged areas (650 of the 1000 points: Drawings, Renders, Finish, Design & Engineering, Project Management, Enterprise, Verbal), moderation, protest penalties (recorded by the Chair), rankings, release. **Later plans:** 1b judging schedule generator, protest and appeal lodging, judge-to-team assignment, server-side snapshot verification (Edge Function); 2 racing; 3 scrutineering and the Specifications score (100) on the shared database, public polish.

## Deviations from the spec (decided while planning)

- **Verbal scored areas follow the scorecards** (Technique 40, Composition 40, Subject 60), not the C3.5 table (60 / 40 / 40). Both total 140. Recorded as open question 9 in the spec.
- **Band descriptors are not included**, only the point ranges per band. Judges have the printed scorecards; descriptors are a 1b data import.
- **Snapshots are computed in the Chair's browser** by the shared engine and stored with their full inputs and a hash. Server-side recomputation in an Edge Function is 1b. Only the Chair role can insert a snapshot, and snapshots are immutable.
- **Any non-conflicted team in a judge's panel can be scored** (no per-team assignment until 1b).
- **Lead judges can read their panel's cards** but moderation is done by the Chair (overrides). Lead-judge cross-moderation edits come later.
- **Repository layout:** the new app lives in `platform/` beside the existing offline scrutineering app at the repo root. They are merged in Phase 3.
- **Judge-team conflicts** are declared by the judge in the app and can be removed only by the Chair or Organiser.

## Global Constraints

- Rules are data: `Ruleset` objects (JSON-serialisable) pinned to each event. The engine imports no database or UI code.
- India National Finals 2026 Competition Regulations are the source. Judged points available in this plan: **650** (Specifications 100 and Racing 250 are derived areas that later phases fill).
- Scorecard scores are **whole numbers from 0 to the criterion maximum**. Band ranges: max 20 = 0-5, 6-10, 11-15, 16-20; max 15 = 0-3, 4-7, 8-11, 12-15; max 10 = 0-2, 3-4, 5-7, 8-10.
- A submitted scorecard is locked. Only the Chair can reopen it, with a reason, and every reopening is written to `audit_log`.
- Several judges' totals for one area are combined as the **mean of submitted cards rounded to one decimal**; a Chair override replaces the area score and needs a reason.
- Rankings: total is the sum of area scores minus protest penalties (default 15). Ties are broken by the highest Knock-out score; a remaining tie is flagged for the Chair, not resolved silently.
- Permissions are enforced in SQL by row-level security, never only in the UI.
- Supabase and Vercel: **creating a hosted Supabase project or deploying to Vercel is an outside action. Stop and ask the user first.** Never commit keys; only the public anon key may appear in `.env`, and `.env` is git-ignored.
- STEM Racing brand system (Secondary division theme): dark `carbon-shadow` ground, Magistral Bold Italic headings (`h2` uses the heading gradient), MachoModular text, named colour tokens only, 44px minimum touch targets, gold focus ring, status shown in words, sentence-case labels, no drop shadows, no icon set.
- Never use `innerHTML` with user-entered text. Build DOM with `h()` and `textContent`.
- Never invent teams, scores or names in real mode. Demo mode data is labelled "sample".
- Every git commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- TDD: write the failing test, watch it fail for the right reason, implement, watch it pass, commit.

## Review Focus

The spec is silent on these inputs. Each has a test in the owning task.

1. **A judge reaching beyond their remit.** Another panel, a team they declared a conflict with, a submitted card, another judge's card, self-assigning a role. Must be refused by the database, not just hidden. (Tasks 5 and 6)
2. **Bad scores.** Out of range, non-integer, unknown criterion, missing criteria at submit, double submit. Refused in SQL, in the engine, and with an inline message in the form. (Tasks 3, 6, 13)
3. **Offline scoring.** Typing with no connection must survive a reload and sync later; if the card was submitted or reopened meanwhile, queued edits are dropped with a visible message, never silently overwriting. (Task 10)
4. **Ranking edge cases.** Nothing submitted yet, ties, fractional means, one judge versus many, an override above the maximum, teams with no data, and 80 teams. (Task 4)
5. **Release gating and immutability.** Teams and the public see nothing before release and see it again only while released; snapshots cannot be changed or deleted; hostile text in team names renders as text. (Tasks 5, 7, 12)

## File structure

```
platform/package.json tsconfig.json vite.config.ts index.html .env.example .gitignore README.md
platform/public/fonts/*.woff2  platform/public/brand/logo-full-colour-white.png
platform/src/styles/tokens.css fonts.css base.css components.css
platform/src/engine/types.ts scorecard.ts ranking.ts hash.ts index.ts
platform/src/rulesets/india-2026.ts index.ts
platform/src/api/types.ts memory.ts supabase.ts queue.ts index.ts
platform/src/ui/dom.ts router.ts ctx.ts common.ts labels.ts shell.ts login.ts events.ts event-home.ts teams.ts people.ts
platform/src/ui/scoring.ts scorecard.ts moderation.ts rankings.ts results.ts demo.ts
platform/src/main.ts  platform/src/vite-env.d.ts
platform/supabase/migrations/0001_core.sql 0002_judging.sql 0003_results.sql
platform/tests/brand/contrast.ts tokens.test.ts
platform/tests/rulesets/india-2026.test.ts
platform/tests/engine/scorecard.test.ts ranking.test.ts hash.test.ts
platform/tests/sql/harness.ts core.test.ts judging.test.ts results.test.ts
platform/tests/api/memory.test.ts queue.test.ts
platform/tests/ui/helpers.ts router.test.ts dom.test.ts login.test.ts events.test.ts event-home.test.ts teams.test.ts people.test.ts scoring.test.ts scorecard.test.ts moderation.test.ts rankings.test.ts results.test.ts
platform/tests/smoke/local.test.ts
```

All commands run from `/Users/rg/STEM Racing India /platform` unless stated (the repo folder name ends with a space; quote paths).

---

### Task 1: Scaffold the platform app with the brand foundation

**Files:**
- Create: `platform/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.env.example`, `src/vite-env.d.ts`, `src/main.ts` (placeholder), `src/styles/*.css` (copied), `public/fonts/*`, `public/brand/logo-full-colour-white.png`
- Test: `platform/tests/brand/contrast.ts`, `platform/tests/brand/tokens.test.ts`

**Interfaces:**
- Produces: the same CSS custom properties as the scrutineering app's `tokens.css`; `contrast(a, b): number` in `tests/brand/contrast.ts`.

- [ ] **Step 1: Create the branch and project files**

```bash
cd "/Users/rg/STEM Racing India "
git checkout -b build/event-platform
mkdir -p platform/src/styles platform/src/engine platform/src/rulesets platform/src/api platform/src/ui platform/supabase/migrations platform/tests/{brand,rulesets,engine,sql,api,ui} platform/public/brand
cd platform
cat > package.json <<'EOF'
{
  "name": "stem-racing-india-platform",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4174 --strictPort",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
EOF
npm install @supabase/supabase-js
npm install -D typescript vite vitest jsdom @electric-sql/pglite @types/node
printf 'node_modules\ndist\n.env\n.env.local\n.DS_Store\n' > .gitignore
printf '# Public values only. Never put the service_role key here.\nVITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n' > .env.example
cat > tsconfig.json <<'EOF'
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
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
EOF
cat > vite.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
EOF
cat > src/vite-env.d.ts <<'EOF'
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
EOF
cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#05000B" />
    <title>STEM Racing India event platform</title>
    <link rel="icon" href="/brand/signifier.png" />
    <link rel="preload" href="/fonts/Magistral-BoldItalic.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/MachoModular-Medium.woff2" as="font" type="font/woff2" crossorigin />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
EOF
cat > src/main.ts <<'EOF'
import './styles/tokens.css';
import './styles/fonts.css';

document.getElementById('app')!.textContent = 'STEM Racing India event platform';
EOF
```

- [ ] **Step 2: Write the failing brand test**

`tests/brand/contrast.ts` and `tests/brand/tokens.test.ts` are the same files as the scrutineering app's. Copy them:

```bash
cp ../tests/brand/contrast.ts tests/brand/contrast.ts
cp ../tests/brand/tokens.test.ts tests/brand/tokens.test.ts
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/brand`
Expected: FAIL, `ENOENT ... src/styles/tokens.css` (the stylesheet has not been copied yet).

- [ ] **Step 4: Copy brand assets and styles**

```bash
cp ../src/styles/tokens.css ../src/styles/fonts.css ../src/styles/base.css ../src/styles/components.css src/styles/
cp -R ../public/fonts public/fonts
cp ../public/brand/logo-full-colour-white.png ../public/brand/signifier.png public/brand/
```

- [ ] **Step 5: Run to verify pass, then build**

Run: `npx vitest run && npm run build`
Expected: 3 brand tests PASS; build succeeds and writes `dist/`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rg/STEM Racing India "
git add platform
git commit -m "feat(platform): scaffold online platform app with STEM Racing brand foundation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: India 2026 ruleset data

**Files:**
- Create: `platform/src/engine/types.ts`, `platform/src/rulesets/india-2026.ts`, `platform/src/rulesets/index.ts`
- Test: `platform/tests/rulesets/india-2026.test.ts`

**Interfaces:**
- Produces (exact):
  - `type PanelId = 'scrutineering' | 'design_engineering' | 'project_management' | 'enterprise' | 'verbal'`
  - `type CategoryId = 'specification' | 'design-engineering' | 'project-management' | 'enterprise' | 'verbal' | 'racing'`
  - `interface Band { min: number; max: number }`
  - `interface Criterion { id: string; name: string; max: number; bands: Band[] }`
  - `interface Area { id: string; name: string; categoryId: CategoryId; kind: 'scorecard' | 'derived'; panel: PanelId | null; max: number; criteria: Criterion[] }`
  - `interface Category { id: CategoryId; name: string }`
  - `interface Ruleset { id: string; name: string; version: number; issued: string; source: string; categories: Category[]; areas: Area[]; tieBreakAreaId: string; protestPenalty: number }`
  - `INDIA_2026: Ruleset` (exported from `src/rulesets`)
  - Area ids: `specifications, engineering-drawings, renders, finish-assembly, de-portfolio, pm-initiating, pm-planning, pm-executing, pm-monitoring, enterprise-portfolio, team-identity, pit-display, verbal-technique, verbal-composition, verbal-subject, reaction, knockout, fastest-car`

- [ ] **Step 1: Write the failing test**

`tests/rulesets/india-2026.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const area = (id: string) => INDIA_2026.areas.find((a) => a.id === id)!;
const categoryTotal = (id: string) => sum(INDIA_2026.areas.filter((a) => a.categoryId === id).map((a) => a.max));

describe('India National Finals 2026 ruleset', () => {
  it('totals 1000 points across the six categories (C3.5)', () => {
    expect(sum(INDIA_2026.areas.map((a) => a.max))).toBe(1000);
    expect(categoryTotal('specification')).toBe(160);
    expect(categoryTotal('design-engineering')).toBe(180);
    expect(categoryTotal('project-management')).toBe(90);
    expect(categoryTotal('enterprise')).toBe(180);
    expect(categoryTotal('verbal')).toBe(140);
    expect(categoryTotal('racing')).toBe(250);
  });

  it('has 650 judged points on scorecards', () => {
    expect(sum(INDIA_2026.areas.filter((a) => a.kind === 'scorecard').map((a) => a.max))).toBe(650);
  });

  it('keeps every scorecard area maximum equal to the sum of its criteria', () => {
    for (const a of INDIA_2026.areas.filter((x) => x.kind === 'scorecard')) {
      expect(sum(a.criteria.map((c) => c.max)), a.id).toBe(a.max);
      expect(a.criteria.length, a.id).toBeGreaterThan(0);
      expect(a.panel, a.id).not.toBeNull();
    }
  });

  it('has no criteria and no panel on derived areas', () => {
    for (const a of INDIA_2026.areas.filter((x) => x.kind === 'derived')) {
      expect(a.criteria, a.id).toEqual([]);
      expect(a.panel, a.id).toBeNull();
    }
    expect(INDIA_2026.areas.filter((a) => a.kind === 'derived').map((a) => a.id)).toEqual([
      'specifications', 'reaction', 'knockout', 'fastest-car',
    ]);
  });

  it('gives every criterion four contiguous bands covering 0..max', () => {
    for (const a of INDIA_2026.areas) {
      for (const c of a.criteria) {
        expect(c.bands, c.id).toHaveLength(4);
        expect(c.bands[0].min, c.id).toBe(0);
        expect(c.bands[3].max, c.id).toBe(c.max);
        for (let i = 1; i < 4; i++) expect(c.bands[i].min, c.id).toBe(c.bands[i - 1].max + 1);
      }
    }
  });

  it('uses the scorecard band ranges for 20, 15 and 10 point criteria', () => {
    const bands = (areaId: string, critId: string) =>
      area(areaId).criteria.find((c) => c.id === critId)!.bands.map((b) => `${b.min}-${b.max}`);
    expect(bands('verbal-technique', 'team-contribution')).toEqual(['0-5', '6-10', '11-15', '16-20']);
    expect(bands('pm-initiating', 'project-schedule')).toEqual(['0-3', '4-7', '8-11', '12-15']);
    expect(bands('pm-planning', 'roles-responsibilities')).toEqual(['0-2', '3-4', '5-7', '8-10']);
  });

  it('has unique area ids and unique criterion ids within an area', () => {
    const ids = INDIA_2026.areas.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of INDIA_2026.areas) {
      const cids = a.criteria.map((c) => c.id);
      expect(new Set(cids).size, a.id).toBe(cids.length);
    }
  });

  it('maps panels as in C12.3 and names the tie-break and protest rules', () => {
    expect(area('engineering-drawings').panel).toBe('scrutineering');
    expect(area('de-portfolio').panel).toBe('design_engineering');
    expect(area('pm-executing').panel).toBe('project_management');
    expect(area('pit-display').panel).toBe('enterprise');
    expect(area('verbal-subject').panel).toBe('verbal');
    expect(INDIA_2026.tieBreakAreaId).toBe('knockout');
    expect(INDIA_2026.protestPenalty).toBe(15);
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(INDIA_2026))).toEqual(INDIA_2026);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/rulesets`
Expected: FAIL, cannot resolve `../../src/rulesets`.

- [ ] **Step 3: Implement the types**

`src/engine/types.ts`:

```ts
export type PanelId = 'scrutineering' | 'design_engineering' | 'project_management' | 'enterprise' | 'verbal';
export type CategoryId =
  | 'specification'
  | 'design-engineering'
  | 'project-management'
  | 'enterprise'
  | 'verbal'
  | 'racing';

export interface Band { min: number; max: number }
export interface Criterion { id: string; name: string; max: number; bands: Band[] }

export interface Area {
  id: string;
  name: string;
  categoryId: CategoryId;
  /** scorecard = scored by judges; derived = computed or entered by other modules (later phases). */
  kind: 'scorecard' | 'derived';
  panel: PanelId | null;
  max: number;
  criteria: Criterion[];
}

export interface Category { id: CategoryId; name: string }

export interface Ruleset {
  id: string;
  name: string;
  version: number;
  issued: string;
  source: string;
  categories: Category[];
  areas: Area[];
  /** Area whose score breaks ties in the final ranking (C3.4). */
  tieBreakAreaId: string;
  /** Points deducted for an unsuccessful protest or appeal (C11.3). */
  protestPenalty: number;
}
```

- [ ] **Step 4: Implement the ruleset**

`src/rulesets/india-2026.ts`:

```ts
import type { Area, Band, CategoryId, Criterion, PanelId, Ruleset } from '../engine/types';

// Band ranges as printed on the India National Finals 2026 scorecards.
const BANDS: Record<number, Band[]> = {
  20: [{ min: 0, max: 5 }, { min: 6, max: 10 }, { min: 11, max: 15 }, { min: 16, max: 20 }],
  15: [{ min: 0, max: 3 }, { min: 4, max: 7 }, { min: 8, max: 11 }, { min: 12, max: 15 }],
  10: [{ min: 0, max: 2 }, { min: 3, max: 4 }, { min: 5, max: 7 }, { min: 8, max: 10 }],
};

const crit = (id: string, name: string, max: 20 | 15 | 10): Criterion => ({
  id, name, max, bands: BANDS[max].map((b) => ({ ...b })),
});

const card = (id: string, name: string, categoryId: CategoryId, panel: PanelId, criteria: Criterion[]): Area => ({
  id, name, categoryId, kind: 'scorecard', panel, max: criteria.reduce((s, c) => s + c.max, 0), criteria,
});

const derived = (id: string, name: string, categoryId: CategoryId, max: number): Area => ({
  id, name, categoryId, kind: 'derived', panel: null, max, criteria: [],
});

export const INDIA_2026: Ruleset = {
  id: 'india-national-finals-2026',
  name: 'STEM Racing India National Finals 2026',
  version: 1,
  issued: '2026',
  source: 'STEM Racing India National Finals 2026 Competition Regulations (STEM Racing at The British School, New Delhi)',
  categories: [
    { id: 'specification', name: 'Specification & Scrutineering' },
    { id: 'design-engineering', name: 'Design & Engineering' },
    { id: 'project-management', name: 'Project Management' },
    { id: 'enterprise', name: 'Enterprise' },
    { id: 'verbal', name: 'Verbal Presentation' },
    { id: 'racing', name: 'Racing' },
  ],
  areas: [
    derived('specifications', 'Specifications', 'specification', 100),
    card('engineering-drawings', 'Engineering Drawings', 'specification', 'scrutineering', [
      crit('engineering-drawings', 'Engineering Drawings', 20),
    ]),
    card('renders', '3D Renders', 'specification', 'scrutineering', [crit('renders', 'Rendering', 20)]),
    card('finish-assembly', 'Quality of Finish and Assembly', 'specification', 'scrutineering', [
      crit('finish-assembly', 'Quality of Finish and Assembly', 20),
    ]),

    card('de-portfolio', 'Design & Engineering Portfolio', 'design-engineering', 'design_engineering', [
      crit('design-concepts', 'Design Concepts', 20),
      crit('3d-modelling', '3D Modelling', 20),
      crit('computer-aided-analysis', 'Application of Computer Aided Analysis', 20),
      crit('cam-cnc', 'Use of CAM/CNC', 20),
      crit('manufacturing-assembly', 'Other Manufacturing & Assembly', 20),
      crit('research-development', 'Research & Development', 20),
      crit('testing', 'Testing', 20),
      crit('design-process-evaluation', 'Design Process Evaluation', 20),
      crit('document-presentation', 'Document Presentation', 20),
    ]),

    card('pm-initiating', 'Project Management: Initiating', 'project-management', 'project_management', [
      crit('initiation-process', 'Initiation Process', 20),
      crit('project-schedule', 'Project Schedule', 15),
    ]),
    card('pm-planning', 'Project Management: Planning', 'project-management', 'project_management', [
      crit('budget-resource', 'Budget and Resource Management', 15),
      crit('roles-responsibilities', 'Roles and Responsibilities', 10),
    ]),
    card('pm-executing', 'Project Management: Executing', 'project-management', 'project_management', [
      crit('team-stakeholder-communications', 'Team & Stakeholder Communications', 10),
      crit('risk-management', 'Risk Management', 10),
    ]),
    card('pm-monitoring', 'Project Management: Monitoring and Controlling', 'project-management', 'project_management', [
      crit('monitoring-controlling', 'Monitoring & Controlling', 10),
    ]),

    card('enterprise-portfolio', 'Enterprise Portfolio', 'enterprise', 'enterprise', [
      crit('marketing-strategy', 'Marketing Strategy', 20),
      crit('sponsorship-return', 'Sponsorship & Return on Investment', 20),
      crit('digital-media-proficiency', 'Digital Media Proficiency', 20),
      crit('sustainability', 'Sustainability', 20),
      crit('document-presentation', 'Document Presentation', 20),
    ]),
    card('team-identity', 'Team Identity', 'enterprise', 'enterprise', [
      crit('overall-team-identity', 'Overall Team Identity', 20),
    ]),
    card('pit-display', 'Pit Display', 'enterprise', 'enterprise', [
      crit('pit-display-design', 'Pit Display Design', 20),
      crit('pit-display-content', 'Pit Display Content', 20),
      crit('functionality-user-experience', 'Functionality & User Experience', 20),
    ]),

    card('verbal-technique', 'Verbal Presentation: Technique', 'verbal', 'verbal', [
      crit('engagement-presentation-dynamics', 'Engagement & Presentation Dynamics', 20),
      crit('team-contribution', 'Team Contribution', 20),
    ]),
    card('verbal-composition', 'Verbal Presentation: Composition', 'verbal', 'verbal', [
      crit('content-quality', 'Content Quality, Relevance & Subject Understanding', 20),
      crit('time-clarity-structure', 'Time, Clarity and Structure of Content', 20),
    ]),
    card('verbal-subject', 'Verbal Presentation: Subject', 'verbal', 'verbal', [
      crit('innovation', 'Innovation', 20),
      crit('collaboration', 'Collaboration', 20),
      crit('stem-racing-learning-journey', 'STEM Racing Learning Journey', 20),
    ]),

    derived('reaction', 'Reaction Racing', 'racing', 105),
    derived('knockout', 'Knock-Out Racing', 'racing', 135),
    derived('fastest-car', 'Fastest Car Bonus', 'racing', 10),
  ],
  tieBreakAreaId: 'knockout',
  protestPenalty: 15,
};
```

`src/rulesets/index.ts`:

```ts
export { INDIA_2026 } from './india-2026';
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/rulesets && npx tsc --noEmit`
Expected: all ruleset tests PASS.

- [ ] **Step 6: Verify the data against the official PDF**

Open `/Users/rg/Downloads/tbs-competition-regulations-2.pdf` pages 32 to 41 (the scorecards, starting at "Scrutineering Judging Scorecard"). Check each criterion's name and maximum against `india-2026.ts`. Wrapped names are the risk: confirm the third lines of "Marketing Strategy ...", "Sponsorship & Return on ..." and "STEM Racing ... learning journey", the 15- and 10-point band rows of Team & Stakeholder Communications, Risk Management and Monitoring & Controlling, and the criterion name "Application of Computer Aided Analysis". Correct any name that differs; if a band row differs, fix `BANDS` and add a test line for it.

- [ ] **Step 7: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): India 2026 ruleset data with scorecard criteria and bands" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scorecard engine

**Files:**
- Create: `platform/src/engine/scorecard.ts`
- Test: `platform/tests/engine/scorecard.test.ts`

**Interfaces:**
- Consumes: `Area`, `Criterion` (Task 2).
- Produces (exact):
  - `interface ScoreProblem { criterionId: string; kind: 'unknown' | 'not-integer' | 'out-of-range' | 'missing'; message: string }`
  - `validateScores(area: Area, scores: Record<string, number>, opts: { complete: boolean }): ScoreProblem[]`
  - `areaTotal(area: Area, scores: Record<string, number>): number` (sum of scores present; call after validating)
  - `bandIndex(criterion: Criterion, score: number): number` (0 to 3, or -1 when out of range)
  - `round1(n: number): number`

- [ ] **Step 1: Write the failing tests**

`tests/engine/scorecard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { areaTotal, bandIndex, round1, validateScores } from '../../src/engine/scorecard';
import { INDIA_2026 } from '../../src/rulesets';

const technique = INDIA_2026.areas.find((a) => a.id === 'verbal-technique')!;
const schedule = INDIA_2026.areas.find((a) => a.id === 'pm-initiating')!;

describe('validateScores', () => {
  it('accepts whole numbers within 0..max, including both limits', () => {
    expect(validateScores(technique, { 'engagement-presentation-dynamics': 0, 'team-contribution': 20 }, { complete: true })).toEqual([]);
  });

  it('rejects out-of-range and non-integer scores with the criterion named', () => {
    const p = validateScores(technique, { 'engagement-presentation-dynamics': 21, 'team-contribution': 4.5 }, { complete: false });
    expect(p.map((x) => [x.criterionId, x.kind])).toEqual([
      ['engagement-presentation-dynamics', 'out-of-range'],
      ['team-contribution', 'not-integer'],
    ]);
    expect(p[0].message).toContain('0 to 20');
  });

  it('rejects negatives, NaN and Infinity', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = validateScores(technique, { 'team-contribution': bad }, { complete: false });
      expect(p, String(bad)).toHaveLength(1);
    }
  });

  it('rejects unknown criteria', () => {
    const p = validateScores(technique, { nonsense: 5 }, { complete: false });
    expect(p).toEqual([expect.objectContaining({ criterionId: 'nonsense', kind: 'unknown' })]);
  });

  it('allows missing criteria when not complete, and flags them when complete', () => {
    expect(validateScores(technique, { 'team-contribution': 10 }, { complete: false })).toEqual([]);
    const p = validateScores(technique, { 'team-contribution': 10 }, { complete: true });
    expect(p).toEqual([expect.objectContaining({ criterionId: 'engagement-presentation-dynamics', kind: 'missing' })]);
  });

  it('uses each criterion own maximum (15-point schedule)', () => {
    const p = validateScores(schedule, { 'initiation-process': 20, 'project-schedule': 16 }, { complete: true });
    expect(p.map((x) => x.criterionId)).toEqual(['project-schedule']);
  });
});

describe('areaTotal and bandIndex', () => {
  it('sums the scores present', () => {
    expect(areaTotal(technique, { 'engagement-presentation-dynamics': 14, 'team-contribution': 9 })).toBe(23);
    expect(areaTotal(technique, {})).toBe(0);
  });

  it('finds the band for a score at every boundary', () => {
    const c = technique.criteria[0];
    expect([0, 5, 6, 10, 11, 15, 16, 20].map((s) => bandIndex(c, s))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(bandIndex(c, 21)).toBe(-1);
    expect(bandIndex(c, -1)).toBe(-1);
    expect(bandIndex(c, 5.5)).toBe(-1);
  });
});

describe('round1', () => {
  it('rounds half up to one decimal without float surprises', () => {
    expect(round1(91.45)).toBe(91.5);
    expect(round1(1.3333333)).toBe(1.3);
    expect(round1(2.25)).toBe(2.3);
    expect(round1(0.1 + 0.2)).toBe(0.3);
    expect(round1(94.5)).toBe(94.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine/scorecard.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/scorecard`.

- [ ] **Step 3: Implement**

`src/engine/scorecard.ts`:

```ts
import type { Area, Criterion } from './types';

export interface ScoreProblem {
  criterionId: string;
  kind: 'unknown' | 'not-integer' | 'out-of-range' | 'missing';
  message: string;
}

export const round1 = (n: number): number => Math.round((n + Number.EPSILON) * 10 + 1e-9) / 10;

export function validateScores(area: Area, scores: Record<string, number>, opts: { complete: boolean }): ScoreProblem[] {
  const problems: ScoreProblem[] = [];
  const byId = new Map(area.criteria.map((c) => [c.id, c]));
  // Walk the area's criteria first so problems come out in scorecard order.
  for (const c of area.criteria) {
    if (!(c.id in scores)) {
      if (opts.complete) problems.push({ criterionId: c.id, kind: 'missing', message: `${c.name} has no score` });
      continue;
    }
    const v = scores[c.id];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
      problems.push({ criterionId: c.id, kind: 'not-integer', message: `${c.name}: enter a whole number from 0 to ${c.max}` });
    } else if (v < 0 || v > c.max) {
      problems.push({ criterionId: c.id, kind: 'out-of-range', message: `${c.name}: score must be 0 to ${c.max}` });
    }
  }
  for (const id of Object.keys(scores)) {
    if (!byId.has(id)) problems.push({ criterionId: id, kind: 'unknown', message: `${id} is not a criterion of ${area.name}` });
  }
  return problems;
}

export function areaTotal(area: Area, scores: Record<string, number>): number {
  return area.criteria.reduce((sum, c) => sum + (typeof scores[c.id] === 'number' ? scores[c.id] : 0), 0);
}

export function bandIndex(criterion: Criterion, score: number): number {
  if (!Number.isInteger(score)) return -1;
  return criterion.bands.findIndex((b) => score >= b.min && score <= b.max);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/engine && npx tsc --noEmit`
Expected: PASS. Note the problem order in test 2 (criteria order, then unknown ids) matches the implementation.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): scorecard validation, totals and band lookup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ranking engine and canonical hash

**Files:**
- Create: `platform/src/engine/ranking.ts`, `platform/src/engine/hash.ts`, `platform/src/engine/index.ts`
- Test: `platform/tests/engine/ranking.test.ts`, `platform/tests/engine/hash.test.ts`

**Interfaces:**
- Consumes: `Ruleset`, `Area`, `validateScores`, `areaTotal`, `round1` (Tasks 2 and 3).
- Produces (exact):
  - `interface CardInput { teamId: string; areaId: string; judgeId: string; scores: Record<string, number> }`
  - `interface OverrideInput { teamId: string; areaId: string; value: number }`
  - `interface PenaltyInput { teamId: string; points: number }`
  - `interface TeamInput { id: string; number: string; name: string }`
  - `interface RankInputs { ruleset: Ruleset; teams: TeamInput[]; cards: CardInput[]; overrides: OverrideInput[]; penalties: PenaltyInput[]; derived?: Record<string, Record<string, number>> }` (derived is `teamId -> areaId -> value`)
  - `interface RankRow { rank: number; teamId: string; number: string; name: string; areas: Record<string, number | null>; categories: Record<string, number>; subtotal: number; penalties: number; total: number; judgedComplete: boolean; tied: boolean }`
  - `interface Ranking { rows: RankRow[]; maxAvailable: number; provisional: boolean; ties: string[][] }`
  - `class RankingInputError extends Error`
  - `rank(inputs: RankInputs): Ranking`
  - `canonicalJson(value: unknown): string`; `sha256Hex(text: string): Promise<string>`; `sha256Fallback(text: string): string` (pure JS, used when `crypto.subtle` is missing)
  - `src/engine/index.ts` re-exports everything from `types`, `scorecard`, `ranking`, `hash`.

- [ ] **Step 1: Write the failing tests**

`tests/engine/hash.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256Fallback, sha256Hex } from '../../src/engine/hash';

describe('canonicalJson', () => {
  it('is independent of key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('keeps array order and distinguishes values', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
  it('drops undefined object members like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('sha256', () => {
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  it('the built-in fallback matches the known SHA-256 vectors', () => {
    for (const [input, output] of vectors) expect(sha256Fallback(input), input).toBe(output);
  });
  it('sha256Hex agrees with the fallback, including for non-ASCII text and long input', async () => {
    for (const t of ['abc', 'स्टेम रेसिंग 🚗', 'x'.repeat(10_000)]) expect(await sha256Hex(t)).toBe(sha256Fallback(t));
  });
  it('falls back when crypto.subtle is unavailable (plain http origins)', async () => {
    vi.stubGlobal('crypto', {});
    try {
      expect(await sha256Hex('abc')).toBe(vectors[1][1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('is 64 lowercase hex characters', async () => {
    expect(await sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

`tests/engine/ranking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RankingInputError, rank, type CardInput, type RankInputs } from '../../src/engine';
import { INDIA_2026 } from '../../src/rulesets';

const area = (id: string) => INDIA_2026.areas.find((a) => a.id === id)!;
const all = (areaId: string, n: number) => Object.fromEntries(area(areaId).criteria.map((c) => [c.id, Math.min(n, c.max)]));
const card = (teamId: string, areaId: string, judgeId: string, n: number): CardInput => ({ teamId, areaId, judgeId, scores: all(areaId, n) });
const teams = [
  { id: 't1', number: '1', name: 'One' },
  { id: 't2', number: '2', name: 'Two' },
  { id: 't10', number: '10', name: 'Ten' },
];
const base = (over: Partial<RankInputs> = {}): RankInputs => ({
  ruleset: INDIA_2026, teams, cards: [], overrides: [], penalties: [], ...over,
});

describe('rank: empty and partial data', () => {
  it('ranks nothing as null areas, zero totals, provisional, all tied', () => {
    const r = rank(base());
    expect(r.rows.map((x) => x.total)).toEqual([0, 0, 0]);
    expect(r.rows[0].areas['de-portfolio']).toBeNull();
    expect(r.rows.every((x) => !x.judgedComplete)).toBe(true);
    expect(r.provisional).toBe(true);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1, 1]);
    expect(r.ties).toEqual([['t1', 't2', 't10']]);
    expect(r.rows.map((x) => x.number)).toEqual(['1', '2', '10']);
  });

  it('counts only the points that are available: 650 judged, derived areas only when supplied', () => {
    expect(rank(base()).maxAvailable).toBe(650);
    expect(rank(base({ derived: { t1: { knockout: 30 } } })).maxAvailable).toBe(785);
  });
});

describe('rank: combining judges', () => {
  it('uses the mean of submitted cards, to one decimal', () => {
    const r = rank(base({ cards: [card('t1', 'de-portfolio', 'jA', 10), card('t1', 'de-portfolio', 'jB', 11)] }));
    expect(r.rows.find((x) => x.teamId === 't1')!.areas['de-portfolio']).toBe(94.5); // (90 + 99) / 2
  });

  it('rounds a repeating mean to one decimal', () => {
    const cards = [card('t1', 'engineering-drawings', 'a', 1), card('t1', 'engineering-drawings', 'b', 1), card('t1', 'engineering-drawings', 'c', 2)];
    expect(rank(base({ cards })).rows.find((x) => x.teamId === 't1')!.areas['engineering-drawings']).toBe(1.3);
  });

  it('a chair override replaces the judges mean', () => {
    const r = rank(base({
      cards: [card('t1', 'de-portfolio', 'jA', 10)],
      overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 120 }],
    }));
    expect(r.rows.find((x) => x.teamId === 't1')!.areas['de-portfolio']).toBe(120);
  });

  it('an override can stand in for an area with no cards', () => {
    const r = rank(base({ overrides: [{ teamId: 't2', areaId: 'pit-display', value: 40 }] }));
    expect(r.rows.find((x) => x.teamId === 't2')!.total).toBe(40);
  });
});

describe('rank: totals, categories, penalties and completeness', () => {
  const fullJudged = (teamId: string, n: number): CardInput[] =>
    INDIA_2026.areas.filter((a) => a.kind === 'scorecard').map((a) => card(teamId, a.id, 'j1', n));

  it('sums areas into categories and subtracts protest penalties', () => {
    const r = rank(base({
      cards: [card('t1', 'de-portfolio', 'j', 10), card('t1', 'verbal-technique', 'j', 10)],
      penalties: [{ teamId: 't1', points: 15 }],
    }));
    const row = r.rows.find((x) => x.teamId === 't1')!;
    expect(row.categories['design-engineering']).toBe(90);
    expect(row.categories.verbal).toBe(20);
    expect(row.subtotal).toBe(110);
    expect(row.penalties).toBe(15);
    expect(row.total).toBe(95);
  });

  it('marks a team judgedComplete only when every scorecard area has a score', () => {
    const r = rank(base({ cards: fullJudged('t1', 10) }));
    expect(r.rows.find((x) => x.teamId === 't1')!.judgedComplete).toBe(true);
    expect(r.rows.find((x) => x.teamId === 't2')!.judgedComplete).toBe(false);
    expect(r.provisional).toBe(true);
    expect(rank(base({ cards: [...fullJudged('t1', 10), ...fullJudged('t2', 9), ...fullJudged('t10', 8)] })).provisional).toBe(false);
  });

  it('adds derived areas such as knock-out', () => {
    const r = rank(base({ derived: { t1: { knockout: 85, specifications: 92 } } }));
    expect(r.rows.find((x) => x.teamId === 't1')!.total).toBe(177);
  });
});

describe('rank: ordering, ties and the knock-out tie-break', () => {
  it('orders by total descending with competition ranking', () => {
    const r = rank(base({ cards: [card('t1', 'de-portfolio', 'j', 5), card('t2', 'de-portfolio', 'j', 10), card('t10', 'de-portfolio', 'j', 5)] }));
    expect(r.rows.map((x) => [x.teamId, x.rank])).toEqual([['t2', 1], ['t1', 2], ['t10', 2]]);
    expect(r.ties).toEqual([['t1', 't10']]);
    expect(r.rows.map((x) => x.tied)).toEqual([false, true, true]);
  });

  it('equal totals, different knock-out scores: knock-out decides and no tie is flagged', () => {
    const r = rank(base({
      derived: { t1: { knockout: 52, reaction: 0 }, t2: { knockout: 26, reaction: 26 } },
    }));
    expect(r.rows.slice(0, 2).map((x) => x.total)).toEqual([52, 52]);
    expect(r.rows.slice(0, 2).map((x) => x.teamId)).toEqual(['t1', 't2']);
    expect(r.rows.slice(0, 2).map((x) => x.rank)).toEqual([1, 2]);
    expect(r.rows.slice(0, 2).some((x) => x.tied)).toBe(false);
  });

  it('flags equal total and equal knock-out as a tie for the Chair', () => {
    const r = rank(base({ derived: { t1: { knockout: 52 }, t2: { knockout: 52 } } }));
    expect(r.ties[0]).toEqual(['t1', 't2']);
  });

  it('ties in the middle share a rank and the next rank skips', () => {
    const cards = [card('t1', 'de-portfolio', 'j', 10), card('t2', 'de-portfolio', 'j', 8), card('t10', 'de-portfolio', 'j', 8)];
    const r = rank(base({ cards, teams: [...teams, { id: 't3', number: '3', name: 'Three' }] }));
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 2, 4]);
  });
});

describe('rank: bad input is refused loudly', () => {
  it('throws on an unknown area, a derived area card, or unknown criteria', () => {
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'nope', judgeId: 'j', scores: {} }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'knockout', judgeId: 'j', scores: {} }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { x: 1 } }] }))).toThrow(RankingInputError);
  });

  it('throws on an incomplete or out-of-range submitted card', () => {
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { 'team-contribution': 5 } }] }))).toThrow(/no score/);
    expect(() => rank(base({ cards: [{ teamId: 't1', areaId: 'verbal-technique', judgeId: 'j', scores: { 'team-contribution': 25, 'engagement-presentation-dynamics': 1 } }] }))).toThrow(RankingInputError);
  });

  it('throws on an override above the area maximum, below zero, or for a derived area', () => {
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: 181 }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'de-portfolio', value: -1 }] }))).toThrow(RankingInputError);
    expect(() => rank(base({ overrides: [{ teamId: 't1', areaId: 'knockout', value: 5 }] }))).toThrow(RankingInputError);
  });

  it('ignores cards, overrides and penalties for teams that are not in the event, but throws on bad penalty points', () => {
    expect(rank(base({ cards: [card('ghost', 'de-portfolio', 'j', 10)] })).rows.every((x) => x.total === 0)).toBe(true);
    expect(() => rank(base({ penalties: [{ teamId: 't1', points: -5 }] }))).toThrow(RankingInputError);
  });
});

describe('rank: scale and determinism', () => {
  it('ranks 80 teams with 3 judges on every scorecard area quickly and identically twice', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, number: String(i + 1), name: `Team ${i + 1}` }));
    const cards: CardInput[] = [];
    for (const t of many) for (const a of INDIA_2026.areas.filter((x) => x.kind === 'scorecard')) for (const j of ['a', 'b', 'c']) cards.push(card(t.id, a.id, j, (Number(t.id.slice(1)) % 15) + 1));
    const start = Date.now();
    const r1 = rank({ ruleset: INDIA_2026, teams: many, cards, overrides: [], penalties: [] });
    expect(Date.now() - start).toBeLessThan(1500);
    const r2 = rank({ ruleset: INDIA_2026, teams: [...many].reverse(), cards: [...cards].reverse(), overrides: [], penalties: [] });
    expect(r2.rows.map((x) => [x.teamId, x.rank, x.total])).toEqual(r1.rows.map((x) => [x.teamId, x.rank, x.total]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/engine/ranking.test.ts tests/engine/hash.test.ts`
Expected: FAIL, cannot resolve `../../src/engine` and `../../src/engine/hash`.

- [ ] **Step 3: Implement hash.ts**

`src/engine/hash.ts`:

```ts
/** JSON with object keys sorted at every depth, so equal data always gives equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** Pure SHA-256, for browsers that expose no crypto.subtle (plain http origins, such as a venue LAN address). */
export function sha256Fallback(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const hash = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d; hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
  }
  return Array.from(hash, (x) => x.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Fallback(text);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Implement ranking.ts**

`src/engine/ranking.ts`:

```ts
import { areaTotal, round1, validateScores } from './scorecard';
import type { Area, Ruleset } from './types';

export interface CardInput { teamId: string; areaId: string; judgeId: string; scores: Record<string, number> }
export interface OverrideInput { teamId: string; areaId: string; value: number }
export interface PenaltyInput { teamId: string; points: number }
export interface TeamInput { id: string; number: string; name: string }

export interface RankInputs {
  ruleset: Ruleset;
  teams: TeamInput[];
  cards: CardInput[];
  overrides: OverrideInput[];
  penalties: PenaltyInput[];
  /** teamId -> areaId -> value, for derived areas filled by later phases (specifications, racing). */
  derived?: Record<string, Record<string, number>>;
}

export interface RankRow {
  rank: number;
  teamId: string;
  number: string;
  name: string;
  areas: Record<string, number | null>;
  categories: Record<string, number>;
  subtotal: number;
  penalties: number;
  total: number;
  judgedComplete: boolean;
  tied: boolean;
}

export interface Ranking {
  rows: RankRow[];
  maxAvailable: number;
  provisional: boolean;
  /** Groups of team ids sharing a rank that the Chair must settle. */
  ties: string[][];
}

export class RankingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankingInputError';
  }
}

const key = (teamId: string, areaId: string) => `${teamId}\u0000${areaId}`;
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export function rank(inputs: RankInputs): Ranking {
  const { ruleset, teams } = inputs;
  const areas = new Map(ruleset.areas.map((a) => [a.id, a]));
  const teamIds = new Set(teams.map((t) => t.id));

  const totalsByTeamArea = new Map<string, number[]>();
  for (const c of inputs.cards) {
    const area = areas.get(c.areaId);
    if (!area) throw new RankingInputError(`Scorecard for unknown area ${c.areaId}`);
    if (area.kind !== 'scorecard') throw new RankingInputError(`${area.name} is not scored on a scorecard`);
    const problems = validateScores(area, c.scores, { complete: true });
    if (problems.length > 0) throw new RankingInputError(`${area.name}, judge ${c.judgeId}: ${problems[0].message}`);
    if (!teamIds.has(c.teamId)) continue;
    const list = totalsByTeamArea.get(key(c.teamId, c.areaId)) ?? [];
    list.push(areaTotal(area, c.scores));
    totalsByTeamArea.set(key(c.teamId, c.areaId), list);
  }

  const overrides = new Map<string, number>();
  for (const o of inputs.overrides) {
    const area = areas.get(o.areaId);
    if (!area || area.kind !== 'scorecard') throw new RankingInputError(`Override for ${o.areaId}: only scorecard areas can be overridden`);
    if (!Number.isFinite(o.value) || o.value < 0 || o.value > area.max) {
      throw new RankingInputError(`Override for ${area.name} must be between 0 and ${area.max}`);
    }
    overrides.set(key(o.teamId, o.areaId), o.value);
  }

  const penaltyByTeam = new Map<string, number>();
  for (const p of inputs.penalties) {
    if (!Number.isFinite(p.points) || p.points < 0) throw new RankingInputError('Penalty points must be zero or more');
    penaltyByTeam.set(p.teamId, (penaltyByTeam.get(p.teamId) ?? 0) + p.points);
  }

  const derived = inputs.derived ?? {};
  const tieArea = ruleset.tieBreakAreaId;
  const scorecardAreas = ruleset.areas.filter((a) => a.kind === 'scorecard');
  const available = new Set<string>(scorecardAreas.map((a) => a.id));
  for (const perTeam of Object.values(derived)) for (const id of Object.keys(perTeam)) if (areas.get(id)?.kind === 'derived') available.add(id);
  const maxAvailable = ruleset.areas.filter((a) => available.has(a.id)).reduce((s, a) => s + a.max, 0);

  const scoreFor = (teamId: string, area: Area): number | null => {
    if (area.kind === 'derived') return derived[teamId]?.[area.id] ?? null;
    const ov = overrides.get(key(teamId, area.id));
    if (ov !== undefined) return ov;
    const list = totalsByTeamArea.get(key(teamId, area.id));
    if (!list || list.length === 0) return null;
    return round1(list.reduce((a, b) => a + b, 0) / list.length);
  };

  const rows = teams.map((t): RankRow => {
    const areaScores: Record<string, number | null> = {};
    const categories: Record<string, number> = {};
    let subtotal = 0;
    for (const a of ruleset.areas) {
      const v = scoreFor(t.id, a);
      areaScores[a.id] = v;
      if (v !== null) {
        subtotal += v;
        categories[a.categoryId] = round1((categories[a.categoryId] ?? 0) + v);
      }
    }
    const penalties = penaltyByTeam.get(t.id) ?? 0;
    return {
      rank: 0, teamId: t.id, number: t.number, name: t.name, areas: areaScores, categories,
      subtotal: round1(subtotal), penalties, total: round1(subtotal - penalties),
      judgedComplete: scorecardAreas.every((a) => areaScores[a.id] !== null), tied: false,
    };
  });

  const tie = (r: RankRow) => r.areas[tieArea] ?? 0;
  rows.sort((a, b) => b.total - a.total || tie(b) - tie(a) || natural(a.number, b.number));

  const ties: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    const same = prev && prev.total === rows[i].total && tie(prev) === tie(rows[i]);
    rows[i].rank = same ? prev.rank : i + 1;
  }
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].rank === rows[i].rank) j++;
    if (j - i > 1) {
      ties.push(rows.slice(i, j).map((r) => r.teamId));
      for (let k = i; k < j; k++) rows[k].tied = true;
    }
    i = j;
  }

  return { rows, maxAvailable, provisional: rows.some((r) => !r.judgedComplete), ties };
}
```

`src/engine/index.ts`:

```ts
export * from './types';
export * from './scorecard';
export * from './ranking';
export * from './hash';
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests so far PASS. If the "equal totals, different knock-out scores" test fails because totals are not equal, recheck: t1 has knockout 52 + reaction 0 = 52, t2 has 26 + 26 = 52; both totals 52. If the 80-team test is slow, the cause is the per-card validation, not sorting: leave it as is, 1500 ms is a generous bound.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): ranking engine with overrides, penalties, ties and canonical hash" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Database core (events, teams, roles, invitations, audit) and the SQL test harness

**Files:**
- Create: `platform/supabase/migrations/0001_core.sql`, `platform/tests/sql/harness.ts`
- Test: `platform/tests/sql/core.test.ts`

**Interfaces:**
- Consumes: `INDIA_2026` (Task 2) for the seeded event's ruleset.
- Produces (SQL): enums `app_role`, `judging_panel`; tables `events, teams, event_roles, invitations, audit_log`; functions `is_member(uuid)`, `has_role(uuid, app_role)`, `is_chair_or_organiser(uuid)`, `judges_panel(uuid, judging_panel)`, `leads_panel(uuid, judging_panel)`, `manages_team(uuid, uuid)`, `sees_all_teams(uuid)`, `event_released(uuid)`, `create_event(text, date, jsonb) returns events`, `claim_invitations() returns int`, `audit_write(uuid, text, text, text, jsonb)`, trigger function `audit_row()`.
- Produces (TS, `tests/sql/harness.ts`):
  - `ids` (user uuids: `organiser, chair, judgeV, judgeD, leadV, mgr1, mgr2, outsider, invitee`), `EMAIL`, `type Who`, `type Q`
  - `makeDb(): Promise<PGlite>` (creates `auth` stubs and roles, applies every migration in order)
  - `seedWorld(db): Promise<World>` where `World = { db: PGlite; eventId: string; team1: string; team2: string }`
  - `as<T>(db, who: Who | null, fn: (q: Q) => Promise<T>): Promise<T>` (runs as that user, or as `anon` when null)
  - `denied(p: Promise<{ rows: unknown[]; affectedRows?: number }>): Promise<void>` (passes when the statement throws or changes zero rows)

- [ ] **Step 1: Write the harness**

`tests/sql/harness.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { INDIA_2026 } from '../../src/rulesets';

export const ids = {
  organiser: '00000000-0000-4000-8000-000000000001',
  chair: '00000000-0000-4000-8000-000000000002',
  judgeV: '00000000-0000-4000-8000-000000000003',
  judgeD: '00000000-0000-4000-8000-000000000004',
  leadV: '00000000-0000-4000-8000-000000000005',
  mgr1: '00000000-0000-4000-8000-000000000006',
  mgr2: '00000000-0000-4000-8000-000000000007',
  outsider: '00000000-0000-4000-8000-000000000008',
  invitee: '00000000-0000-4000-8000-000000000009',
} as const;
export type Who = keyof typeof ids;

export const EMAIL: Record<Who, string> = {
  organiser: 'organiser@x.test', chair: 'chair@x.test', judgeV: 'judgev@x.test', judgeD: 'judged@x.test',
  leadV: 'leadv@x.test', mgr1: 'mgr1@x.test', mgr2: 'mgr2@x.test', outsider: 'outsider@x.test',
  invitee: 'New.Judge@X.TEST',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>;

export interface World { db: PGlite; eventId: string; team1: string; team2: string }

export async function makeDb(): Promise<PGlite> {
  const db = new PGlite();
  // Stand-ins for what Supabase provides: the auth schema, its helpers and the two API roles.
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  for (const [who, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id, email) values ($1, $2)', [id, EMAIL[who as Who]]);
  }
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  return db;
}

export async function seedWorld(db: PGlite): Promise<World> {
  const eventId = randomUUID();
  const team1 = randomUUID();
  const team2 = randomUUID();
  await db.query('insert into events(id, name, ruleset, created_by) values ($1, $2, $3::jsonb, $4)', [
    eventId, 'Test event', JSON.stringify(INDIA_2026), ids.organiser,
  ]);
  await db.query('insert into teams(id, event_id, number, name) values ($1, $2, $3, $4), ($5, $2, $6, $7)', [
    team1, eventId, '1', 'Team One', team2, '2', 'Team Two',
  ]);
  const roles: [Who, string, string | null, string | null][] = [
    ['organiser', 'organiser', null, null],
    ['chair', 'chair', null, null],
    ['judgeV', 'judge', 'verbal', null],
    ['judgeD', 'judge', 'design_engineering', null],
    ['leadV', 'lead_judge', 'verbal', null],
    ['mgr1', 'team_manager', null, team1],
    ['mgr2', 'team_manager', null, team2],
  ];
  for (const [who, role, panel, team] of roles) {
    await db.query(
      'insert into event_roles(event_id, user_id, role, panel, team_id, email) values ($1, $2, $3::app_role, $4::judging_panel, $5, $6)',
      [eventId, ids[who], role, panel, team, EMAIL[who].toLowerCase()],
    );
  }
  return { db, eventId, team1, team2 };
}

/** Run `fn` as a signed-in user (or as the anonymous role when `who` is null), then restore superuser. */
export async function as<T>(db: PGlite, who: Who | null, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    who ? JSON.stringify({ sub: ids[who], email: EMAIL[who] }) : '{}',
  ]);
  try {
    return await fn((sql, params) => db.query(sql, params) as ReturnType<Q>);
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/** Row-level security blocks either by raising an error or by touching zero rows. Both count as denied. */
export async function denied(p: Promise<{ rows: unknown[]; affectedRows?: number }>): Promise<void> {
  let changed: number;
  try {
    const r = await p;
    changed = r.affectedRows ?? r.rows.length;
  } catch {
    return;
  }
  if (changed !== 0) throw new Error(`expected the statement to be denied but ${changed} row(s) were affected`);
}
```

- [ ] **Step 2: Write the failing tests**

`tests/sql/core.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';
import { as, denied, ids, makeDb, seedWorld, type World } from './harness';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

describe('create_event', () => {
  it('creates the event, makes the caller its organiser and audits it', async () => {
    const ev = await as(w.db, 'outsider', async (q) =>
      (await q('select * from create_event($1, $2, $3::jsonb)', ['Nationals', '2026-11-01', JSON.stringify(INDIA_2026)])).rows[0]);
    expect(ev.name).toBe('Nationals');
    expect(ev.results_released).toBe(false);
    const roles = await as(w.db, 'outsider', async (q) => (await q('select role from event_roles where event_id = $1', [ev.id])).rows);
    expect(roles).toEqual([{ role: 'organiser' }]);
    const audit = await as(w.db, 'outsider', async (q) => (await q('select entity, action from audit_log where event_id = $1', [ev.id])).rows);
    expect(audit).toContainEqual({ entity: 'event_roles', action: 'insert' });
  });

  it('needs a signed-in user and a ruleset with areas', async () => {
    await expect(as(w.db, null, (q) => q(`select * from create_event('x', null, '{"areas":[]}'::jsonb)`))).rejects.toThrow(/sign in/);
    await expect(as(w.db, 'judgeV', (q) => q(`select * from create_event('x', null, '{}'::jsonb)`))).rejects.toThrow();
  });
});

describe('events', () => {
  it('shows an event only to its members until results are released', async () => {
    const mine = await as(w.db, 'organiser', async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
    expect(mine).toHaveLength(1);
    for (const who of ['outsider', null] as const) {
      const rows = await as(w.db, who, async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
      expect(rows, String(who)).toEqual([]);
    }
  });

  it('freezes the pinned ruleset', async () => {
    await expect(as(w.db, 'organiser', (q) => q(`update events set ruleset = '{"areas":[]}'::jsonb where id = $1`, [w.eventId]))).rejects.toThrow(/ruleset/);
  });

  it('lets only the Chair or Organiser release results, and hides them again when withdrawn', async () => {
    await denied(as(w.db, 'judgeV', (q) => q('update events set results_released = true where id = $1', [w.eventId])));
    await as(w.db, 'chair', (q) => q('update events set results_released = true where id = $1', [w.eventId]));
    try {
      for (const who of ['outsider', null] as const) {
        const ev = await as(w.db, who, async (q) => (await q('select id from events where id = $1', [w.eventId])).rows);
        const teams = await as(w.db, who, async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
        expect(ev, String(who)).toHaveLength(1);
        expect(teams.length, String(who)).toBeGreaterThanOrEqual(2);
      }
    } finally {
      await as(w.db, 'organiser', (q) => q('update events set results_released = false where id = $1', [w.eventId]));
    }
    const hidden = await as(w.db, null, async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(hidden).toEqual([]);
    const audit = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where event_id = $1 and entity = 'events'`, [w.eventId])).rows);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe('teams', () => {
  it('lets the organiser add teams and keeps hostile text as text', async () => {
    const t = await as(w.db, 'organiser', async (q) =>
      (await q('insert into teams(event_id, number, name, school) values ($1, $2, $3, $4) returning name, school', [
        w.eventId, 'H1', '<script>alert(1)</script> 🚗 "quoted"', "O'Brien & Sons",
      ])).rows[0]);
    expect(t).toEqual({ name: '<script>alert(1)</script> 🚗 "quoted"', school: "O'Brien & Sons" });
  });

  it('rejects duplicate numbers ignoring case and spaces, and over-long names', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, 'D1', 'One')`, [w.eventId]));
    await expect(as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, ' d1 ', 'Two')`, [w.eventId]))).rejects.toThrow();
    await expect(as(w.db, 'organiser', (q) => q(`insert into teams(event_id, number, name) values ($1, 'D2', $2)`, [w.eventId, 'x'.repeat(81)]))).rejects.toThrow();
  });

  it('refuses team changes from anyone but the Chair or Organiser', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into teams(event_id, number, name) values ($1, 'J1', 'Nope')`, [w.eventId])));
    await denied(as(w.db, 'mgr1', (q) => q(`update teams set name = 'Hacked' where id = $1`, [w.team1])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from teams where id = $1', [w.team1])));
  });

  it('shows a team manager only their own team, and staff every team', async () => {
    const mine = await as(w.db, 'mgr1', async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(mine).toEqual([{ id: w.team1 }]);
    const staff = await as(w.db, 'judgeV', async (q) => (await q('select id from teams where event_id = $1', [w.eventId])).rows);
    expect(staff.length).toBeGreaterThanOrEqual(2);
  });
});

describe('roles and invitations', () => {
  it('stops a judge granting themselves a role', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into event_roles(event_id, user_id, role) values ($1, $2, 'chair')`, [w.eventId, ids.judgeV])));
    await denied(as(w.db, 'outsider', (q) => q(`insert into event_roles(event_id, user_id, role) values ($1, $2, 'organiser')`, [w.eventId, ids.outsider])));
    await denied(as(w.db, 'judgeV', (q) => q(`update event_roles set role = 'chair' where user_id = $1`, [ids.judgeV])));
  });

  it('shows a judge only their own role row, and the Organiser everyone', async () => {
    const own = await as(w.db, 'judgeV', async (q) => (await q('select user_id from event_roles where event_id = $1', [w.eventId])).rows);
    expect(own).toEqual([{ user_id: ids.judgeV }]);
    const all = await as(w.db, 'organiser', async (q) => (await q('select user_id from event_roles where event_id = $1', [w.eventId])).rows);
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it('requires judge roles to carry a panel and team managers a team', async () => {
    await expect(as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role) values ($1, 'a@x.test', 'judge')`, [w.eventId]))).rejects.toThrow();
    await expect(as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role) values ($1, 'a@x.test', 'team_manager')`, [w.eventId]))).rejects.toThrow();
  });

  it('lets only the Organiser or Chair invite', async () => {
    await denied(as(w.db, 'judgeV', (q) => q(`insert into invitations(event_id, email, role, panel) values ($1, 'z@x.test', 'judge', 'verbal')`, [w.eventId])));
  });

  it('turns an invitation into a role once, matching the email case-insensitively', async () => {
    await as(w.db, 'organiser', (q) => q(`insert into invitations(event_id, email, role, panel) values ($1, 'new.judge@x.test', 'judge', 'enterprise')`, [w.eventId]));
    expect(await as(w.db, 'outsider', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
    expect(await as(w.db, 'invitee', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(1);
    const role = await as(w.db, 'invitee', async (q) => (await q('select role, panel from event_roles where event_id = $1', [w.eventId])).rows);
    expect(role).toEqual([{ role: 'judge', panel: 'enterprise' }]);
    expect(await as(w.db, 'invitee', async (q) => (await q('select claim_invitations() as n')).rows[0].n)).toBe(0);
    const left = await as(w.db, 'organiser', async (q) => (await q(`select id from invitations where email = 'new.judge@x.test'`)).rows);
    expect(left).toEqual([]);
  });
});

describe('audit log', () => {
  it('is readable by the Chair and Organiser only', async () => {
    const chair = await as(w.db, 'chair', async (q) => (await q('select id from audit_log where event_id = $1', [w.eventId])).rows);
    expect(chair.length).toBeGreaterThan(0);
    for (const who of ['judgeV', 'mgr1', 'outsider', null] as const) {
      const rows = await as(w.db, who, async (q) => (await q('select id from audit_log').catch(() => ({ rows: [] }))).rows);
      expect(rows, String(who)).toEqual([]);
    }
  });

  it('cannot be written or changed by users', async () => {
    await denied(as(w.db, 'chair', (q) => q(`insert into audit_log(event_id, action, entity) values ($1, 'x', 'y')`, [w.eventId])));
    await denied(as(w.db, 'chair', (q) => q('delete from audit_log')));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/sql/core.test.ts`
Expected: FAIL in `beforeAll` (no migration files, so `relation "events" does not exist`).

- [ ] **Step 4: Write the migration**

`supabase/migrations/0001_core.sql`:

```sql
-- Core: events, teams, roles, invitations, audit log, helper functions, row-level security.

create type app_role as enum ('organiser', 'chair', 'lead_judge', 'judge', 'scrutineer', 'race_official', 'team_manager');
create type judging_panel as enum ('scrutineering', 'design_engineering', 'project_management', 'enterprise', 'verbal');

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  starts_on date,
  ruleset jsonb not null check (coalesce(jsonb_typeof(ruleset -> 'areas'), '') = 'array'),
  results_released boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  number text not null check (char_length(btrim(number)) between 1 and 12),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  school text not null default '' check (char_length(school) <= 120),
  created_at timestamptz not null default now()
);
create unique index teams_event_number on teams (event_id, lower(btrim(number)));

create table event_roles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  panel judging_panel,
  team_id uuid references teams on delete cascade,
  email text,
  constraint roles_panel check ((role in ('judge', 'lead_judge')) = (panel is not null)),
  constraint roles_team check ((role = 'team_manager') = (team_id is not null))
);
create unique index event_roles_unique on event_roles (event_id, user_id, role, coalesce(panel::text, ''), coalesce(team_id::text, ''));

create table invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role app_role not null,
  panel judging_panel,
  team_id uuid references teams on delete cascade,
  created_at timestamptz not null default now(),
  constraint inv_panel check ((role in ('judge', 'lead_judge')) = (panel is not null)),
  constraint inv_team check ((role = 'team_manager') = (team_id is not null))
);
create unique index invitations_unique on invitations (event_id, email, role, coalesce(panel::text, ''), coalesce(team_id::text, ''));

create table audit_log (
  id bigserial primary key,
  event_id uuid references events on delete cascade,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Helpers. security definer so policies can ask about roles without recursing into event_roles' own policy.
create function is_member(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid()) $$;

create function has_role(ev uuid, r app_role) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = r) $$;

create function is_chair_or_organiser(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role in ('chair', 'organiser')) $$;

create function judges_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge' and panel = p) $$;

create function leads_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge' and panel = p) $$;

create function manages_team(ev uuid, t uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'team_manager' and team_id = t) $$;

create function sees_all_teams(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role <> 'team_manager') $$;

create function event_released(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select results_released from events where id = ev), false) $$;

-- Audit.
create function audit_write(p_event uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb) returns void
language sql security definer set search_path = public as
$$ insert into audit_log (event_id, actor, action, entity, entity_id, detail) values (p_event, auth.uid(), p_action, p_entity, p_entity_id, p_detail) $$;

create function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb; ev uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ev := case when tg_table_name = 'events' then (r ->> 'id')::uuid else (r ->> 'event_id')::uuid end;
  insert into audit_log (event_id, actor, action, entity, entity_id, detail)
  values (ev, auth.uid(), lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'team_id'),
          jsonb_build_object('old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
                             'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end));
  return null;
end $$;

create trigger events_audit after update on events for each row
  when (old.results_released is distinct from new.results_released) execute function audit_row();
create trigger roles_audit after insert or delete on event_roles for each row execute function audit_row();

create function events_freeze() returns trigger language plpgsql as $$
begin
  if new.ruleset is distinct from old.ruleset then
    raise exception 'the pinned ruleset of an event cannot change' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger events_freeze before update on events for each row execute function events_freeze();

-- RPCs.
create function create_event(p_name text, p_starts_on date, p_ruleset jsonb) returns events
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  insert into events (name, starts_on, ruleset, created_by) values (p_name, p_starts_on, p_ruleset, auth.uid()) returning * into e;
  insert into event_roles (event_id, user_id, role, email) values (e.id, auth.uid(), 'organiser', lower(btrim(auth.jwt() ->> 'email')));
  return e;
end $$;

create function claim_invitations() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; inv record; me text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if auth.uid() is null or me = '' then return 0; end if;
  for inv in select * from invitations where email = me loop
    insert into event_roles (event_id, user_id, role, panel, team_id, email)
    values (inv.event_id, auth.uid(), inv.role, inv.panel, inv.team_id, me) on conflict do nothing;
    delete from invitations where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Row-level security.
alter table events enable row level security;
alter table teams enable row level security;
alter table event_roles enable row level security;
alter table invitations enable row level security;
alter table audit_log enable row level security;

create policy events_select on events for select to anon, authenticated using (results_released or is_member(id));
create policy events_update on events for update to authenticated using (is_chair_or_organiser(id)) with check (is_chair_or_organiser(id));

create policy teams_select on teams for select to anon, authenticated
  using (event_released(event_id) or sees_all_teams(event_id) or manages_team(event_id, id));
create policy teams_insert on teams for insert to authenticated with check (is_chair_or_organiser(event_id));
create policy teams_update on teams for update to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));
create policy teams_delete on teams for delete to authenticated using (is_chair_or_organiser(event_id));

create policy roles_select on event_roles for select to authenticated using (user_id = auth.uid() or is_chair_or_organiser(event_id));
create policy roles_insert on event_roles for insert to authenticated with check (is_chair_or_organiser(event_id));
create policy roles_update on event_roles for update to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));
create policy roles_delete on event_roles for delete to authenticated using (is_chair_or_organiser(event_id));

create policy inv_all on invitations for all to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));

create policy audit_select on audit_log for select to authenticated using (is_chair_or_organiser(event_id));
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/sql/core.test.ts`
Expected: PASS. Debug notes if something fails: (a) `denied` passes when the statement throws, so a failing test in the "refuses" group means the statement succeeded, i.e. a missing policy; (b) `42501 permission denied for table` from the audit-log `select` is swallowed by `.catch` in the test on purpose (anon has no grant yet; Task 7 revokes it explicitly); (c) if PGlite rejects `create role` because roles persist across `new PGlite()` instances, each instance is isolated in memory, so this should not happen.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): database core with roles, invitations, audit and PGlite-tested row-level security" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Database judging (conflicts, scorecards, scores, reopen)

**Files:**
- Create: `platform/supabase/migrations/0002_judging.sql`
- Test: `platform/tests/sql/judging.test.ts`

**Interfaces:**
- Consumes: Task 5 helpers and the harness.
- Produces (SQL): enum `card_status`; tables `judge_conflicts(event_id, judge_id, team_id)`, `scorecards(id, event_id, team_id, area_id, panel, judge_id, status, reopened_count, submitted_at)`, `scorecard_scores(scorecard_id, criterion_id, score int, comment)`; functions `area_def(uuid, text) returns jsonb`, `is_conflicted(uuid, uuid)`, `reopen_scorecard(uuid, text)`.
- Behaviour contract used by Tasks 8 and 9: a judge creates a card by inserting `(event_id, team_id, area_id)` (panel and judge are filled in); scores are upserted per criterion; submitting is `update scorecards set status = 'submitted'`; error codes: `42501` forbidden, `55000` locked, `23514` or `22023` invalid, `23505` duplicate.

- [ ] **Step 1: Write the failing tests**

`tests/sql/judging.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { as, denied, ids, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
let n = 0;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

const newTeam = async () =>
  (await w.db.query<{ id: string }>('insert into teams(event_id, number, name) values ($1, $2, $3) returning id', [w.eventId, `X${++n}`, `Team X${n}`])).rows[0].id;
const makeCard = (who: Who, team: string, area: string) =>
  as(w.db, who, async (q) =>
    (await q('insert into scorecards(event_id, team_id, area_id) values ($1, $2, $3) returning id, panel, status, judge_id', [w.eventId, team, area])).rows[0]);
const setScore = (who: Who, card: string, crit: string, v: number | string) =>
  as(w.db, who, (q) =>
    q('insert into scorecard_scores(scorecard_id, criterion_id, score) values ($1, $2, $3) on conflict (scorecard_id, criterion_id) do update set score = excluded.score', [card, crit, v]));
const fill = async (who: Who, card: string) => {
  await setScore(who, card, 'engagement-presentation-dynamics', 14);
  await setScore(who, card, 'team-contribution', 12);
};
const submit = (who: Who, card: string) => as(w.db, who, (q) => q(`update scorecards set status = 'submitted' where id = $1 returning id`, [card]));
const statusOf = async (card: string) => (await w.db.query<{ status: string; reopened_count: number }>('select status, reopened_count from scorecards where id = $1', [card])).rows[0];

describe('creating a scorecard', () => {
  it('fills in the panel and judge, and starts as a draft', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    expect(c).toMatchObject({ panel: 'verbal', status: 'draft', judge_id: ids.judgeV });
  });

  it('refuses another panel, unknown areas, derived areas and impersonation', async () => {
    const t = await newTeam();
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'de-portfolio')`, [w.eventId, t])));
    await expect(makeCard('judgeV', t, 'nope')).rejects.toThrow(/unknown scorecard area/);
    await expect(makeCard('judgeV', t, 'knockout')).rejects.toThrow(/unknown scorecard area/);
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id, judge_id) values ($1, $2, 'verbal-technique', $3)`, [w.eventId, t, ids.judgeD])));
    await denied(as(w.db, 'mgr1', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
    await denied(as(w.db, 'outsider', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
    await denied(as(w.db, null, (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
  });

  it('refuses a team from another event', async () => {
    const other = (await w.db.query<{ id: string }>(`insert into events(name, ruleset, created_by) select 'Other', ruleset, created_by from events where id = $1 returning id`, [w.eventId])).rows[0].id;
    const foreign = (await w.db.query<{ id: string }>(`insert into teams(event_id, number, name) values ($1, 'F1', 'Foreign') returning id`, [other])).rows[0].id;
    await expect(makeCard('judgeV', foreign, 'verbal-technique')).rejects.toThrow();
  });

  it('allows one card per judge, team and area', async () => {
    const t = await newTeam();
    await makeCard('judgeV', t, 'verbal-composition');
    await expect(makeCard('judgeV', t, 'verbal-composition')).rejects.toThrow();
  });
});

describe('conflicts of interest', () => {
  it('blocks scoring a team the judge declared a conflict with, until the Chair clears it', async () => {
    const t = await newTeam();
    await as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t]));
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-subject')`, [w.eventId, t])));
    await expect(makeCard('judgeD', t, 'de-portfolio')).resolves.toMatchObject({ status: 'draft' });
    await denied(as(w.db, 'judgeV', (q) => q('delete from judge_conflicts where team_id = $1', [t])));
    await as(w.db, 'chair', (q) => q('delete from judge_conflicts where team_id = $1', [t]));
    await expect(makeCard('judgeV', t, 'verbal-subject')).resolves.toMatchObject({ status: 'draft' });
  });

  it('blocks submitting a card once a conflict is declared against its team', async () => {
    const t = await newTeam();
    const c = await makeCard('judgeV', t, 'verbal-technique');
    await fill('judgeV', c.id);
    await as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t]));
    await denied(submit('judgeV', c.id));
    expect((await statusOf(c.id)).status).toBe('draft');
  });

  it('lets a judge declare conflicts for themselves only', async () => {
    const t = await newTeam();
    await denied(as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, judge_id, team_id) values ($1, $2, $3)', [w.eventId, ids.judgeD, t])));
    await denied(as(w.db, 'outsider', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t])));
  });
});

describe('scores', () => {
  it('accepts 0 and the maximum, and updates an existing score', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 0);
    await setScore('judgeV', c.id, 'team-contribution', 20);
    await setScore('judgeV', c.id, 'team-contribution', 11);
    const rows = (await w.db.query('select score from scorecard_scores where scorecard_id = $1', [c.id])).rows;
    expect(rows).toEqual([{ score: 11 }]);
  });

  it('rejects out-of-range, unknown-criterion and non-integer scores', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await expect(setScore('judgeV', c.id, 'team-contribution', 21)).rejects.toThrow(/outside 0\.\.20/);
    await expect(setScore('judgeV', c.id, 'team-contribution', -1)).rejects.toThrow();
    await expect(setScore('judgeV', c.id, 'not-a-criterion', 5)).rejects.toThrow(/unknown criterion/);
    await expect(setScore('judgeV', c.id, 'team-contribution', '4.5')).rejects.toThrow();
  });

  it('uses the criterion own maximum for 15 and 10 point criteria', async () => {
    const t = await newTeam();
    await as(w.db, 'organiser', (q) =>
      q(`insert into event_roles(event_id, user_id, role, panel) values ($1, $2, 'judge', 'project_management')`, [w.eventId, ids.invitee]));
    const card = await makeCard('invitee', t, 'pm-initiating');
    await setScore('invitee', card.id, 'project-schedule', 15);
    await expect(setScore('invitee', card.id, 'project-schedule', 16)).rejects.toThrow(/outside 0\.\.15/);
  });
});

describe('submitting and locking', () => {
  it('refuses to submit until every criterion has a score', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 12);
    await expect(submit('judgeV', c.id)).rejects.toThrow(/no score/);
    expect((await statusOf(c.id)).status).toBe('draft');
  });

  it('submits a complete card, stamps the time and audits the change', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    expect((await submit('judgeV', c.id)).rows).toHaveLength(1);
    const row = (await w.db.query('select status, submitted_at from scorecards where id = $1', [c.id])).rows[0];
    expect(row.status).toBe('submitted');
    expect(row.submitted_at).not.toBeNull();
    const audit = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where entity = 'scorecards' and entity_id = $1`, [c.id])).rows);
    expect(audit).toContainEqual({ action: 'update' });
  });

  it('locks a submitted card against edits, deletion, new scores and a second submit', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await denied(setScore('judgeV', c.id, 'team-contribution', 3));
    await denied(as(w.db, 'judgeV', (q) => q('delete from scorecard_scores where scorecard_id = $1', [c.id])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from scorecards where id = $1', [c.id])));
    await denied(as(w.db, 'judgeV', (q) => q(`update scorecards set status = 'draft' where id = $1`, [c.id])));
    await denied(submit('judgeV', c.id));
    const scores = (await w.db.query('select criterion_id, score from scorecard_scores where scorecard_id = $1 order by criterion_id', [c.id])).rows;
    expect(scores).toEqual([{ criterion_id: 'engagement-presentation-dynamics', score: 14 }, { criterion_id: 'team-contribution', score: 12 }]);
  });

  it('lets a judge delete their own draft card', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    const r = await as(w.db, 'judgeV', (q) => q('delete from scorecards where id = $1 returning id', [c.id]));
    expect(r.rows).toHaveLength(1);
  });

  it('does not let a judge move a card to another team or judge', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await expect(as(w.db, 'judgeV', (q) => q('update scorecards set team_id = $2 where id = $1', [c.id, w.team1]))).rejects.toThrow(/identity/);
  });
});

describe('reopening', () => {
  it('lets only the Chair reopen, with a reason, and records it', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    for (const who of ['judgeV', 'organiser', 'leadV'] as const) {
      await expect(as(w.db, who, (q) => q('select reopen_scorecard($1, $2)', [c.id, 'please']))).rejects.toThrow(/Chair/);
    }
    await expect(as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [c.id, ' ']))).rejects.toThrow(/reason/);
    await as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [c.id, 'Judge asked to correct a typo']));
    expect(await statusOf(c.id)).toEqual({ status: 'draft', reopened_count: 1 });
    const audit = await as(w.db, 'chair', async (q) => (await q(`select detail from audit_log where action = 'reopen' and entity_id = $1`, [c.id])).rows);
    expect(audit[0].detail.reason).toBe('Judge asked to correct a typo');
    await setScore('judgeV', c.id, 'team-contribution', 15);
    await submit('judgeV', c.id);
    expect((await statusOf(c.id)).status).toBe('submitted');
  });

  it('cannot be forced by a direct status update, even by the Chair', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await denied(as(w.db, 'chair', (q) => q(`update scorecards set status = 'draft' where id = $1`, [c.id])));
    expect((await statusOf(c.id)).status).toBe('submitted');
  });
});

describe('who can read a scorecard', () => {
  it('shows a judge only their own cards, a lead judge their panel, and the Chair everything', async () => {
    const t = await newTeam();
    const mine = await makeCard('judgeV', t, 'verbal-technique');
    const design = await makeCard('judgeD', t, 'de-portfolio');
    const ids2 = (rows: { id: string }[]) => rows.map((r) => r.id);
    const sees = (who: Who | null) => as(w.db, who, async (q) => ids2((await q('select id from scorecards where team_id = $1', [t]).catch(() => ({ rows: [] }))).rows));
    expect(await sees('judgeV')).toEqual([mine.id]);
    expect(await sees('judgeD')).toEqual([design.id]);
    expect(await sees('leadV')).toEqual([mine.id]);
    expect((await sees('chair')).sort()).toEqual([mine.id, design.id].sort());
    expect((await sees('organiser')).sort()).toEqual([mine.id, design.id].sort());
    expect(await sees('outsider')).toEqual([]);
    expect(await sees('mgr1')).toEqual([]);
    expect(await sees(null)).toEqual([]);
  });

  it('lets a team manager read only their own team cards and scores, and only after release', async () => {
    const c = await makeCard('judgeV', w.team1, 'verbal-subject');
    const other = await makeCard('judgeV', w.team2, 'verbal-subject');
    await setScore('judgeV', c.id, 'innovation', 9);
    await setScore('judgeV', other.id, 'innovation', 8);
    const read = () => as(w.db, 'mgr1', async (q) => ({
      cards: (await q('select id from scorecards where id = any($1)', [[c.id, other.id]])).rows,
      scores: (await q('select scorecard_id from scorecard_scores where scorecard_id = any($1)', [[c.id, other.id]])).rows,
    }));
    expect(await read()).toEqual({ cards: [], scores: [] });
    await as(w.db, 'chair', (q) => q('update events set results_released = true where id = $1', [w.eventId]));
    try {
      const after = await read();
      expect(after.cards).toEqual([{ id: c.id }]);
      expect(after.scores).toEqual([{ scorecard_id: c.id }]);
    } finally {
      await as(w.db, 'chair', (q) => q('update events set results_released = false where id = $1', [w.eventId]));
    }
    expect(await read()).toEqual({ cards: [], scores: [] });
  });

  it('keeps one judge from reading or editing another judge scores', async () => {
    const t = await newTeam();
    const c = await makeCard('judgeV', t, 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 10);
    const seen = await as(w.db, 'judgeD', async (q) => (await q('select score from scorecard_scores where scorecard_id = $1', [c.id])).rows);
    expect(seen).toEqual([]);
    await denied(setScore('judgeD', c.id, 'team-contribution', 1));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sql/judging.test.ts`
Expected: FAIL (`relation "scorecards" does not exist`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0002_judging.sql`:

```sql
-- Judging: conflicts of interest, scorecards, scores, locking and reopening.

create type card_status as enum ('draft', 'submitted');

create function judges_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge') $$;
create function leads_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge') $$;

create table judge_conflicts (
  event_id uuid not null references events on delete cascade,
  judge_id uuid not null default auth.uid(),
  team_id uuid not null references teams on delete cascade,
  declared_at timestamptz not null default now(),
  primary key (event_id, judge_id, team_id)
);

create table scorecards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  team_id uuid not null references teams on delete cascade,
  area_id text not null,
  panel judging_panel not null,
  judge_id uuid not null default auth.uid(),
  status card_status not null default 'draft',
  reopened_count int not null default 0,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, team_id, area_id, judge_id)
);

create table scorecard_scores (
  scorecard_id uuid not null references scorecards on delete cascade,
  criterion_id text not null,
  score int not null check (score >= 0),
  comment text not null default '' check (char_length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (scorecard_id, criterion_id)
);

-- The area definition (with its criteria) from the event's pinned ruleset, or null.
create function area_def(ev uuid, area text) returns jsonb language sql stable security definer set search_path = public as
$$ select a from events e, jsonb_array_elements(e.ruleset -> 'areas') as a where e.id = ev and a ->> 'id' = area $$;

create function is_conflicted(ev uuid, t uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from judge_conflicts where event_id = ev and judge_id = auth.uid() and team_id = t) $$;

create function scorecards_fill() returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := area_def(new.event_id, new.area_id);
  if a is null or a ->> 'kind' <> 'scorecard' then
    raise exception 'unknown scorecard area %', new.area_id using errcode = '22023';
  end if;
  if not exists (select 1 from teams where id = new.team_id and event_id = new.event_id) then
    raise exception 'team does not belong to this event' using errcode = '22023';
  end if;
  new.panel := (a ->> 'panel')::judging_panel;
  new.judge_id := coalesce(new.judge_id, auth.uid());
  return new;
end $$;
create trigger scorecards_fill before insert on scorecards for each row execute function scorecards_fill();

create function scorecards_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb; c record;
begin
  if (new.event_id, new.team_id, new.area_id, new.judge_id, new.panel) is distinct from (old.event_id, old.team_id, old.area_id, old.judge_id, old.panel) then
    raise exception 'scorecard identity cannot change' using errcode = '55000';
  end if;
  if old.status = 'draft' and new.status = 'submitted' then
    a := area_def(new.event_id, new.area_id);
    for c in select t.value from jsonb_array_elements(a -> 'criteria') as t loop
      if not exists (select 1 from scorecard_scores s where s.scorecard_id = new.id and s.criterion_id = c.value ->> 'id') then
        raise exception 'criterion % has no score', c.value ->> 'name' using errcode = '23514';
      end if;
    end loop;
    new.submitted_at := now();
  elsif old.status = 'submitted' and new.status = 'draft' then
    if coalesce(current_setting('app.reopen', true), '') <> 'on' then
      raise exception 'only the Chair can reopen a submitted scorecard' using errcode = '55000';
    end if;
    new.reopened_count := old.reopened_count + 1;
    new.submitted_at := null;
  end if;
  return new;
end $$;
create trigger scorecards_guard before update on scorecards for each row execute function scorecards_guard();

create function scores_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare card record; a jsonb; crit jsonb;
begin
  select * into card from scorecards where id = new.scorecard_id;
  if not found then raise exception 'scorecard not found' using errcode = '22023'; end if;
  a := area_def(card.event_id, card.area_id);
  select t.value into crit from jsonb_array_elements(a -> 'criteria') as t where t.value ->> 'id' = new.criterion_id;
  if crit is null then raise exception 'unknown criterion %', new.criterion_id using errcode = '22023'; end if;
  if new.score < 0 or new.score > (crit ->> 'max')::int then
    raise exception 'score % is outside 0..%', new.score, crit ->> 'max' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger scores_guard before insert or update on scorecard_scores for each row execute function scores_guard();

create function reopen_scorecard(p_card uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare c scorecards;
begin
  select * into c from scorecards where id = p_card;
  if not found then raise exception 'scorecard not found' using errcode = 'P0002'; end if;
  if not has_role(c.event_id, 'chair') then raise exception 'only the Chair can reopen a scorecard' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to reopen a scorecard' using errcode = '22023'; end if;
  perform set_config('app.reopen', 'on', true);
  update scorecards set status = 'draft' where id = p_card and status = 'submitted';
  perform set_config('app.reopen', 'off', true);
  perform audit_write(c.event_id, 'reopen', 'scorecards', p_card::text, jsonb_build_object('reason', p_reason, 'judge', c.judge_id));
end $$;

create trigger scorecards_audit after update of status on scorecards for each row
  when (old.status is distinct from new.status) execute function audit_row();
create trigger conflicts_audit after insert or delete on judge_conflicts for each row execute function audit_row();

alter table judge_conflicts enable row level security;
alter table scorecards enable row level security;
alter table scorecard_scores enable row level security;

create policy conflicts_select on judge_conflicts for select to authenticated using (judge_id = auth.uid() or is_chair_or_organiser(event_id));
create policy conflicts_insert on judge_conflicts for insert to authenticated
  with check (judge_id = auth.uid() and (judges_panel_any(event_id) or leads_panel_any(event_id)));
create policy conflicts_delete on judge_conflicts for delete to authenticated using (is_chair_or_organiser(event_id));

create policy cards_select on scorecards for select to authenticated using (
  judge_id = auth.uid()
  or is_chair_or_organiser(event_id)
  or leads_panel(event_id, panel)
  or (event_released(event_id) and manages_team(event_id, team_id))
);
create policy cards_insert on scorecards for insert to authenticated
  with check (judge_id = auth.uid() and status = 'draft' and judges_panel(event_id, panel) and not is_conflicted(event_id, team_id));
create policy cards_update on scorecards for update to authenticated
  using (judge_id = auth.uid() and status = 'draft')
  with check (judge_id = auth.uid() and judges_panel(event_id, panel) and not is_conflicted(event_id, team_id));
create policy cards_delete on scorecards for delete to authenticated using (judge_id = auth.uid() and status = 'draft');

create policy scores_select on scorecard_scores for select to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id));
create policy scores_insert on scorecard_scores for insert to authenticated
  with check (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'));
create policy scores_update on scorecard_scores for update to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'))
  with check (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'));
create policy scores_delete on scorecard_scores for delete to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'));
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sql`
Expected: core and judging suites PASS. Debug notes: (a) the case `denied(... update scorecards set status='draft' ...)` by a judge passes because the update policy requires `status = 'draft'` to select the row; (b) for the Chair "cannot be forced" test, the Chair has no update policy, so zero rows change; (c) if `audit_log` for `reopen` is empty, check `audit_write` is called after the update (it is) and that the `detail` column is read as an object (PGlite returns jsonb as a parsed object).

- [ ] **Step 5: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): judging schema with conflicts, locked scorecards, validation and Chair reopen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Database results (overrides, penalties, snapshots, public access)

**Files:**
- Create: `platform/supabase/migrations/0003_results.sql`
- Test: `platform/tests/sql/results.test.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces (SQL): tables `score_overrides(event_id, team_id, area_id, value numeric, reason, set_by, updated_at)`, `penalties(id, event_id, team_id, points numeric, reason, decided_by, created_at)`, `ranking_snapshots(id, event_id, created_by, created_at, ruleset_id, input_hash, inputs jsonb, rows jsonb, released boolean)`; public read grants limited to `events`, `teams`, `ranking_snapshots`.

- [ ] **Step 1: Write the failing tests**

`tests/sql/results.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { as, denied, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

const HASH = 'a'.repeat(64);
const setOverride = (who: Who, team: string, area: string, value: number, reason = 'Cross-moderated by the Chair') =>
  as(w.db, who, (q) => q('insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, $3, $4, $5) on conflict (event_id, team_id, area_id) do update set value = excluded.value, reason = excluded.reason returning value', [w.eventId, team, area, value, reason]));
const snapshot = (who: Who, released = true, hash = HASH) =>
  as(w.db, who, (q) => q('insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows, released) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) returning id', [w.eventId, 'india-national-finals-2026', hash, '{"cards":[]}', '[{"rank":1,"teamId":"t","total":1}]', released]));
const release = (on: boolean) => as(w.db, 'chair', (q) => q('update events set results_released = $2 where id = $1', [w.eventId, on]));

describe('score overrides', () => {
  it('lets the Chair set and change an override within the area maximum, with a reason', async () => {
    expect((await setOverride('chair', w.team1, 'de-portfolio', 150)).rows).toEqual([{ value: '150.0' }]);
    expect((await setOverride('chair', w.team1, 'de-portfolio', 151.5)).rows).toEqual([{ value: '151.5' }]);
    const rows = (await w.db.query('select set_by from score_overrides where team_id = $1', [w.team1])).rows;
    expect(rows).toHaveLength(1);
  });

  it('rejects values above the maximum, negatives, derived areas and thin reasons', async () => {
    await expect(setOverride('chair', w.team1, 'de-portfolio', 181)).rejects.toThrow(/exceeds/);
    await expect(setOverride('chair', w.team1, 'de-portfolio', -1)).rejects.toThrow();
    await expect(setOverride('chair', w.team1, 'knockout', 5)).rejects.toThrow(/scorecard areas only/);
    await expect(setOverride('chair', w.team1, 'pit-display', 10, 'x')).rejects.toThrow();
  });

  it('is refused for everyone but the Chair, and read only by the Chair and Organiser', async () => {
    for (const who of ['organiser', 'judgeV', 'leadV', 'mgr1', 'outsider'] as const) {
      await denied(setOverride(who, w.team2, 'pit-display', 10));
    }
    await denied(as(w.db, null, (q) => q('insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, $3, 10, $4)', [w.eventId, w.team2, 'pit-display', 'anonymous try'])));
    await setOverride('chair', w.team2, 'pit-display', 40);
    const read = (who: Who | null) => as(w.db, who, async (q) => (await q('select value from score_overrides').catch(() => ({ rows: [] }))).rows);
    expect((await read('organiser')).length).toBeGreaterThan(0);
    for (const who of ['judgeV', 'mgr1', 'outsider', null] as const) expect(await read(who), String(who)).toEqual([]);
  });

  it('audits changes', async () => {
    const rows = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where entity = 'score_overrides'`)).rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('penalties', () => {
  it('lets the Chair record and remove a penalty with a reason, and nobody else', async () => {
    const p = await as(w.db, 'chair', async (q) => (await q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 15, 'Unsuccessful appeal') returning id, points`, [w.eventId, w.team1])).rows[0]);
    expect(p.points).toBe('15.0');
    await denied(as(w.db, 'organiser', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 15, 'nope')`, [w.eventId, w.team1])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from penalties where id = $1', [p.id])));
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 0, 'zero')`, [w.eventId, w.team1]))).rejects.toThrow();
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, -5, 'negative')`, [w.eventId, w.team1]))).rejects.toThrow();
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 5, '')`, [w.eventId, w.team1]))).rejects.toThrow();
  });

  it('shows a team manager only their own team penalties and only after release', async () => {
    const read = (who: Who) => as(w.db, who, async (q) => (await q('select team_id from penalties')).rows.map((r: { team_id: string }) => r.team_id));
    expect(await read('mgr1')).toEqual([]);
    await release(true);
    try {
      expect(await read('mgr1')).toEqual([w.team1]);
      expect(await read('mgr2')).toEqual([]);
    } finally {
      await release(false);
    }
    expect(await read('mgr1')).toEqual([]);
  });
});

describe('ranking snapshots', () => {
  it('can be inserted by the Chair only, with a well-formed hash', async () => {
    expect((await snapshot('chair')).rows).toHaveLength(1);
    await denied(snapshot('organiser'));
    await denied(snapshot('judgeV'));
    await denied(snapshot('mgr1'));
    await denied(as(w.db, null, (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'x', $2, '{}', '[]')`, [w.eventId, HASH])));
    await expect(snapshot('chair', true, 'not-a-hash')).rejects.toThrow();
  });

  it('is immutable: the Chair cannot change or delete one', async () => {
    const id = (await snapshot('chair')).rows[0].id;
    await denied(as(w.db, 'chair', (q) => q(`update ranking_snapshots set rows = '[]' where id = $1`, [id])));
    await denied(as(w.db, 'chair', (q) => q('delete from ranking_snapshots where id = $1', [id])));
    expect((await w.db.query('select rows from ranking_snapshots where id = $1', [id])).rows[0].rows).toHaveLength(1);
  });

  it('is public only while the event is released, and only the released snapshots', async () => {
    const hidden = (await snapshot('chair', false)).rows[0].id;
    const shown = (await snapshot('chair', true)).rows[0].id;
    const publicIds = () => as(w.db, null, async (q) => (await q('select id from ranking_snapshots where event_id = $1', [w.eventId])).rows.map((r: { id: string }) => r.id));
    expect(await publicIds()).toEqual([]);
    await release(true);
    try {
      const open = await publicIds();
      expect(open).toContain(shown);
      expect(open).not.toContain(hidden);
    } finally {
      await release(false);
    }
    expect(await publicIds()).toEqual([]);
    const staff = await as(w.db, 'organiser', async (q) => (await q('select id from ranking_snapshots where event_id = $1', [w.eventId])).rows.map((r: { id: string }) => r.id));
    expect(staff).toContain(hidden);
    const judge = await as(w.db, 'judgeV', async (q) => (await q('select id from ranking_snapshots')).rows);
    expect(judge).toEqual([]);
  });
});

describe('anonymous access', () => {
  it('cannot read anything except released events, teams and snapshots', async () => {
    for (const table of ['scorecards', 'scorecard_scores', 'score_overrides', 'penalties', 'event_roles', 'invitations', 'audit_log', 'judge_conflicts']) {
      await expect(as(w.db, null, (q) => q(`select * from ${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sql/results.test.ts`
Expected: FAIL (`relation "score_overrides" does not exist`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0003_results.sql`:

```sql
-- Results: Chair overrides, protest penalties, immutable ranking snapshots, public read access.

create table score_overrides (
  event_id uuid not null references events on delete cascade,
  team_id uuid not null references teams on delete cascade,
  area_id text not null,
  value numeric(5, 1) not null check (value >= 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  set_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (event_id, team_id, area_id)
);

create function overrides_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := area_def(new.event_id, new.area_id);
  if a is null or a ->> 'kind' <> 'scorecard' then
    raise exception 'overrides apply to scorecard areas only' using errcode = '22023';
  end if;
  if new.value > (a ->> 'max')::numeric then
    raise exception 'override % exceeds the area maximum %', new.value, a ->> 'max' using errcode = '23514';
  end if;
  new.set_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger overrides_guard before insert or update on score_overrides for each row execute function overrides_guard();
create trigger overrides_audit after insert or update or delete on score_overrides for each row execute function audit_row();

create table penalties (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  team_id uuid not null references teams on delete cascade,
  points numeric(5, 1) not null check (points > 0 and points <= 100),
  reason text not null check (char_length(btrim(reason)) >= 3),
  decided_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger penalties_audit after insert or delete on penalties for each row execute function audit_row();

create table ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  ruleset_id text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  inputs jsonb not null,
  rows jsonb not null,
  released boolean not null default true
);
create trigger snapshots_audit after insert on ranking_snapshots for each row execute function audit_row();

alter table score_overrides enable row level security;
alter table penalties enable row level security;
alter table ranking_snapshots enable row level security;

create policy overrides_select on score_overrides for select to authenticated using (is_chair_or_organiser(event_id));
create policy overrides_insert on score_overrides for insert to authenticated with check (has_role(event_id, 'chair'));
create policy overrides_update on score_overrides for update to authenticated using (has_role(event_id, 'chair')) with check (has_role(event_id, 'chair'));
create policy overrides_delete on score_overrides for delete to authenticated using (has_role(event_id, 'chair'));

create policy penalties_select on penalties for select to authenticated
  using (is_chair_or_organiser(event_id) or (event_released(event_id) and manages_team(event_id, team_id)));
create policy penalties_insert on penalties for insert to authenticated with check (has_role(event_id, 'chair'));
create policy penalties_delete on penalties for delete to authenticated using (has_role(event_id, 'chair'));

create policy snapshots_select on ranking_snapshots for select to anon, authenticated
  using (is_chair_or_organiser(event_id) or (released and event_released(event_id)));
create policy snapshots_insert on ranking_snapshots for insert to authenticated
  with check (has_role(event_id, 'chair') and created_by = auth.uid());

-- Snapshots are immutable and the public sees only released data.
revoke update, delete on ranking_snapshots from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on events, teams, ranking_snapshots to anon;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sql && npx tsc --noEmit`
Expected: all SQL suites PASS. Debug notes: `numeric(5,1)` values come back from PGlite as strings (`'150.0'`), which the assertions expect. In the "anonymous access" test every table must raise `permission denied`, which is what the `revoke ... from anon` produces; if one table still returns rows, a default grant slipped through, so re-run the revoke after the last `create table`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): overrides, penalties and immutable ranking snapshots with public read gating" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Api interface and the in-memory implementation

**Files:**
- Create: `platform/src/api/types.ts`, `platform/src/api/memory.ts`, `platform/src/api/index.ts`
- Test: `platform/tests/api/memory.test.ts`

**Interfaces:**
- Consumes: `Ruleset`, `Area`, `PanelId`, `RankRow`, `validateScores` (Tasks 2 to 4), `INDIA_2026`.
- Produces (exact, used by every later task):

```ts
export type Role = 'organiser' | 'chair' | 'lead_judge' | 'judge' | 'scrutineer' | 'race_official' | 'team_manager';
export type Panel = PanelId;
export interface Session { userId: string; email: string }
export interface EventRow { id: string; name: string; startsOn: string | null; ruleset: Ruleset; resultsReleased: boolean }
export interface TeamRow { id: string; eventId: string; number: string; name: string; school: string }
export interface RoleRow { id: string; eventId: string; userId: string; role: Role; panel: Panel | null; teamId: string | null; email: string | null }
export interface InviteRow { id: string; eventId: string; email: string; role: Role; panel: Panel | null; teamId: string | null }
export interface CardRow { id: string; eventId: string; teamId: string; areaId: string; panel: Panel; judgeId: string; status: 'draft' | 'submitted'; reopenedCount: number; scores: Record<string, number>; comments: Record<string, string> }
export interface OverrideRow { eventId: string; teamId: string; areaId: string; value: number; reason: string }
export interface PenaltyRow { id: string; eventId: string; teamId: string; points: number; reason: string }
export interface SnapshotRow { id: string; eventId: string; createdAt: string; rulesetId: string; inputHash: string; rows: RankRow[]; released: boolean }
export interface NewSnapshot { rulesetId: string; inputHash: string; inputs: unknown; rows: RankRow[]; released?: boolean }
export type ApiErrorCode = 'forbidden' | 'locked' | 'invalid' | 'duplicate' | 'not-found' | 'network' | 'unknown';
export class ApiError extends Error { code: ApiErrorCode }
export interface Api {
  getSession(): Promise<Session | null>;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  claimInvitations(): Promise<number>;
  listEvents(): Promise<EventRow[]>;
  createEvent(i: { name: string; startsOn?: string }): Promise<EventRow>;
  getEvent(id: string): Promise<EventRow | null>;
  setReleased(eventId: string, released: boolean): Promise<void>;
  myRoles(eventId: string): Promise<RoleRow[]>;
  listRoles(eventId: string): Promise<RoleRow[]>;
  listInvitations(eventId: string): Promise<InviteRow[]>;
  invite(eventId: string, i: { email: string; role: Role; panel?: Panel; teamId?: string }): Promise<void>;
  removeRole(roleId: string): Promise<void>;
  removeInvitation(inviteId: string): Promise<void>;
  listTeams(eventId: string): Promise<TeamRow[]>;
  createTeam(eventId: string, i: { number: string; name: string; school?: string }): Promise<TeamRow>;
  declareConflict(eventId: string, teamId: string): Promise<void>;
  myConflicts(eventId: string): Promise<string[]>;
  openCard(eventId: string, teamId: string, areaId: string): Promise<CardRow>;
  saveScore(cardId: string, criterionId: string, score: number, comment?: string): Promise<void>;
  submitCard(cardId: string): Promise<void>;
  reopenCard(cardId: string, reason: string): Promise<void>;
  listCards(eventId: string): Promise<CardRow[]>;
  listOverrides(eventId: string): Promise<OverrideRow[]>;
  setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string): Promise<void>;
  listPenalties(eventId: string): Promise<PenaltyRow[]>;
  addPenalty(eventId: string, teamId: string, points: number, reason: string): Promise<void>;
  publishSnapshot(eventId: string, s: NewSnapshot): Promise<SnapshotRow>;
  latestSnapshot(eventId: string): Promise<SnapshotRow | null>;
}
```
  - `class MemoryApi implements Api` (a no-argument constructor).

- [ ] **Step 1: Write the failing tests**

`tests/api/memory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';

const ORG = 'org@x.test';
const CHAIR = 'chair@x.test';
const JUDGE = 'judge@x.test';
const MGR = 'mgr@x.test';
const HASH = 'b'.repeat(64);

async function world() {
  const api = new MemoryApi();
  await api.signIn(ORG);
  const ev = await api.createEvent({ name: 'Nationals', startsOn: '2026-11-01' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'One' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Two' });
  await api.invite(ev.id, { email: CHAIR, role: 'chair' });
  await api.invite(ev.id, { email: JUDGE, role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: MGR, role: 'team_manager', teamId: t1.id });
  for (const e of [CHAIR, JUDGE, MGR]) {
    await api.signIn(e);
    expect(await api.claimInvitations()).toBe(1);
  }
  return { api, ev, t1, t2 };
}
const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { if (e instanceof ApiError) return e.code; throw e; }
  return 'ok';
};
const fillTechnique = async (api: MemoryApi, cardId: string) => {
  await api.saveScore(cardId, 'engagement-presentation-dynamics', 14);
  await api.saveScore(cardId, 'team-contribution', 12, 'Clear roles');
};

describe('events, teams and roles', () => {
  it('makes the creator the organiser and pins the India ruleset', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    expect(ev.ruleset.id).toBe('india-national-finals-2026');
    expect((await api.myRoles(ev.id)).map((r) => r.role)).toEqual(['organiser']);
    expect((await api.listEvents()).map((e) => e.id)).toEqual([ev.id]);
  });

  it('refuses duplicate team numbers (ignoring case and spaces), blank names and non-organisers', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    expect(await code(api.createTeam(ev.id, { number: ' 1 ', name: 'Again' }))).toBe('duplicate');
    expect(await code(api.createTeam(ev.id, { number: '9', name: '   ' }))).toBe('invalid');
    const hostile = await api.createTeam(ev.id, { number: '3', name: '<script>alert(1)</script>' });
    expect(hostile.name).toBe('<script>alert(1)</script>');
    await api.signIn(JUDGE);
    expect(await code(api.createTeam(ev.id, { number: '4', name: 'Nope' }))).toBe('forbidden');
  });

  it('validates invitations and lets only the organiser or chair invite', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(ORG);
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'judge' }))).toBe('invalid');
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'team_manager' }))).toBe('invalid');
    expect(await code(api.invite(ev.id, { email: 'not-an-email', role: 'chair' }))).toBe('invalid');
    await api.invite(ev.id, { email: 'A@X.test', role: 'team_manager', teamId: t1.id });
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'team_manager', teamId: t1.id }))).toBe('duplicate');
    await api.signIn(JUDGE);
    expect(await code(api.invite(ev.id, { email: 'b@x.test', role: 'chair' }))).toBe('forbidden');
  });

  it('shows a judge only their own role, and a team manager only their team', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    expect((await api.listRoles(ev.id)).map((r) => r.userId)).toEqual(['user:judge@x.test']);
    expect((await api.listInvitations(ev.id))).toEqual([]);
    await api.signIn(MGR);
    expect((await api.listTeams(ev.id)).map((t) => t.id)).toEqual([t1.id]);
  });
});

describe('scorecards', () => {
  it('lets a judge create one card per team and area, in their own panel only', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const a = await api.openCard(ev.id, t1.id, 'verbal-technique');
    const b = await api.openCard(ev.id, t1.id, 'verbal-technique');
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ panel: 'verbal', status: 'draft', scores: {} });
    expect(await code(api.openCard(ev.id, t1.id, 'de-portfolio'))).toBe('forbidden');
    expect(await code(api.openCard(ev.id, t1.id, 'knockout'))).toBe('invalid');
    await api.signIn(MGR);
    expect(await code(api.openCard(ev.id, t1.id, 'verbal-technique'))).toBe('forbidden');
  });

  it('blocks a conflicted team', async () => {
    const { api, ev, t2 } = await world();
    await api.signIn(JUDGE);
    await api.declareConflict(ev.id, t2.id);
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
    expect(await code(api.openCard(ev.id, t2.id, 'verbal-technique'))).toBe('forbidden');
  });

  it('validates scores, refuses an incomplete submit, then locks the submitted card', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    expect(await code(api.saveScore(card.id, 'team-contribution', 21))).toBe('invalid');
    expect(await code(api.saveScore(card.id, 'team-contribution', 4.5))).toBe('invalid');
    expect(await code(api.saveScore(card.id, 'nope', 4))).toBe('invalid');
    await api.saveScore(card.id, 'team-contribution', 12);
    expect(await code(api.submitCard(card.id))).toBe('invalid');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    expect(await code(api.saveScore(card.id, 'team-contribution', 3))).toBe('locked');
    expect(await code(api.submitCard(card.id))).toBe('locked');
    const [mine] = await api.listCards(ev.id);
    expect(mine).toMatchObject({ status: 'submitted', scores: { 'engagement-presentation-dynamics': 14, 'team-contribution': 12 }, comments: { 'team-contribution': 'Clear roles' } });
  });

  it('lets only the Chair reopen, with a reason', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    expect(await code(api.reopenCard(card.id, 'please'))).toBe('forbidden');
    await api.signIn(CHAIR);
    expect(await code(api.reopenCard(card.id, ' '))).toBe('invalid');
    await api.reopenCard(card.id, 'Typo in a score');
    await api.signIn(JUDGE);
    expect((await api.listCards(ev.id))[0]).toMatchObject({ status: 'draft', reopenedCount: 1 });
    await api.saveScore(card.id, 'team-contribution', 15);
  });

  it('shows cards only to their judge, the Chair, and (after release) the team manager', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.openCard(ev.id, t2.id, 'verbal-technique');
    await api.signIn(CHAIR);
    expect(await api.listCards(ev.id)).toHaveLength(2);
    await api.signIn(MGR);
    expect(await api.listCards(ev.id)).toEqual([]);
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, true);
    await api.signIn(MGR);
    expect((await api.listCards(ev.id)).map((c) => c.teamId)).toEqual([t1.id]);
    await api.signOut();
    expect(await api.listCards(ev.id)).toEqual([]);
  });
});

describe('results', () => {
  it('limits overrides, penalties and snapshots to the Chair and validates them', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'reason'))).toBe('forbidden');
    expect(await code(api.addPenalty(ev.id, t1.id, 15, 'reason'))).toBe('forbidden');
    await api.signIn(CHAIR);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 181, 'reason'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'knockout', 5, 'reason'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'x'))).toBe('invalid');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'Moderated');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 110, 'Moderated again');
    expect(await api.listOverrides(ev.id)).toEqual([{ eventId: ev.id, teamId: t1.id, areaId: 'de-portfolio', value: 110, reason: 'Moderated again' }]);
    expect(await code(api.addPenalty(ev.id, t1.id, 0, 'zero'))).toBe('invalid');
    await api.addPenalty(ev.id, t1.id, 15, 'Unsuccessful appeal');
    expect((await api.listPenalties(ev.id)).map((p) => p.points)).toEqual([15]);
  });

  it('keeps snapshots hidden from the public until the event is released', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: 'bad', inputs: {}, rows: [] }))).toBe('invalid');
    const snap = await api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: HASH, inputs: {}, rows: [] });
    expect((await api.latestSnapshot(ev.id))?.id).toBe(snap.id);
    await api.signIn(JUDGE);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: HASH, inputs: {}, rows: [] }))).toBe('forbidden');
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    await api.signOut();
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, true);
    await api.signOut();
    expect((await api.latestSnapshot(ev.id))?.id).toBe(snap.id);
    expect((await api.getEvent(ev.id))?.name).toBe('Nationals');
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, false);
    await api.signOut();
    expect(await api.getEvent(ev.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/memory.test.ts`
Expected: FAIL, cannot resolve `../../src/api`.

- [ ] **Step 3: Implement the types**

`src/api/types.ts`: write the interfaces and `ApiError` exactly as listed under Interfaces above, with these imports and the error class:

```ts
import type { PanelId, RankRow, Ruleset } from '../engine';

// ... the interfaces from the Interfaces block above ...

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
```

`src/api/index.ts`:

```ts
export * from './types';
export { MemoryApi } from './memory';
```

- [ ] **Step 4: Implement MemoryApi**

`src/api/memory.ts`:

```ts
import { validateScores, type Area } from '../engine';
import { INDIA_2026 } from '../rulesets';
import {
  ApiError, type Api, type CardRow, type EventRow, type InviteRow, type NewSnapshot, type OverrideRow, type Panel,
  type PenaltyRow, type Role, type RoleRow, type Session, type SnapshotRow, type TeamRow,
} from './types';

let seq = 0;
const nid = (prefix: string) => `${prefix}-${++seq}`;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const JUDGE_ROLES: Role[] = ['judge', 'lead_judge'];
const normNumber = (n: string) => n.trim().toLowerCase().replace(/\s+/g, '');

/** A complete in-memory backend with the same rules as the database. Used by tests and demo mode. */
export class MemoryApi implements Api {
  private me: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  private events: EventRow[] = [];
  private roles: RoleRow[] = [];
  private invites: InviteRow[] = [];
  private teams: TeamRow[] = [];
  private conflicts: { eventId: string; judgeId: string; teamId: string }[] = [];
  private cards: CardRow[] = [];
  private overrides: OverrideRow[] = [];
  private penalties: PenaltyRow[] = [];
  private snapshots: SnapshotRow[] = [];

  // ---- session
  async getSession() { return this.me; }
  async signIn(email: string) {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new ApiError('invalid', 'Enter a valid email address');
    this.setSession({ userId: `user:${e}`, email: e });
  }
  async signOut() { this.setSession(null); }
  onAuthChange(cb: (s: Session | null) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private setSession(s: Session | null) {
    this.me = s;
    this.listeners.forEach((l) => l(s));
  }
  async claimInvitations() {
    if (!this.me) return 0;
    const me = this.me;
    const mine = this.invites.filter((i) => i.email === me.email);
    for (const i of mine) {
      const dupe = this.roles.some((r) => r.eventId === i.eventId && r.userId === me.userId && r.role === i.role && r.panel === i.panel && r.teamId === i.teamId);
      if (!dupe) this.roles.push({ id: nid('role'), eventId: i.eventId, userId: me.userId, role: i.role, panel: i.panel, teamId: i.teamId, email: me.email });
    }
    this.invites = this.invites.filter((i) => i.email !== me.email);
    return mine.length;
  }

  // ---- helpers
  private rolesOf(eventId: string) { return this.roles.filter((r) => r.eventId === eventId && !!this.me && r.userId === this.me.userId); }
  private has(eventId: string, ...roles: Role[]) { return this.rolesOf(eventId).some((r) => roles.includes(r.role)); }
  private require(eventId: string, ...roles: Role[]) {
    if (!this.has(eventId, ...roles)) throw new ApiError('forbidden', 'You do not have permission to do that');
  }
  private eventOrThrow(eventId: string) {
    const e = this.events.find((x) => x.id === eventId);
    if (!e) throw new ApiError('not-found', 'Event not found');
    return e;
  }
  private released(eventId: string) { return this.events.find((e) => e.id === eventId)?.resultsReleased ?? false; }
  private area(eventId: string, areaId: string): Area | undefined {
    return this.eventOrThrow(eventId).ruleset.areas.find((a) => a.id === areaId);
  }
  private text(v: string, label: string, max: number) {
    const t = v.trim();
    if (t.length === 0) throw new ApiError('invalid', `${label} is required`);
    if (t.length > max) throw new ApiError('invalid', `${label} must be ${max} characters or fewer`);
    return t;
  }

  // ---- events
  async listEvents() {
    return copy(this.events.filter((e) => e.resultsReleased || this.rolesOf(e.id).length > 0));
  }
  async createEvent(i: { name: string; startsOn?: string }) {
    if (!this.me) throw new ApiError('forbidden', 'Sign in first');
    const ev: EventRow = { id: nid('event'), name: this.text(i.name, 'Event name', 120), startsOn: i.startsOn ?? null, ruleset: copy(INDIA_2026), resultsReleased: false };
    this.events.push(ev);
    this.roles.push({ id: nid('role'), eventId: ev.id, userId: this.me.userId, role: 'organiser', panel: null, teamId: null, email: this.me.email });
    return copy(ev);
  }
  async getEvent(id: string) {
    const e = this.events.find((x) => x.id === id);
    if (!e || !(e.resultsReleased || this.rolesOf(id).length > 0)) return null;
    return copy(e);
  }
  async setReleased(eventId: string, released: boolean) {
    this.require(eventId, 'chair', 'organiser');
    this.eventOrThrow(eventId).resultsReleased = released;
  }

  // ---- roles and invitations
  async myRoles(eventId: string) { return copy(this.rolesOf(eventId)); }
  async listRoles(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.roles.filter((r) => r.eventId === eventId) : this.rolesOf(eventId));
  }
  async listInvitations(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.invites.filter((i) => i.eventId === eventId) : []);
  }
  async invite(eventId: string, i: { email: string; role: Role; panel?: Panel; teamId?: string }) {
    this.require(eventId, 'chair', 'organiser');
    const email = i.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ApiError('invalid', 'Enter a valid email address');
    const isJudge = JUDGE_ROLES.includes(i.role);
    if (isJudge !== (i.panel !== undefined)) throw new ApiError('invalid', isJudge ? 'Choose a judging panel' : 'Only judges have a panel');
    if ((i.role === 'team_manager') !== (i.teamId !== undefined)) throw new ApiError('invalid', i.role === 'team_manager' ? 'Choose a team' : 'Only team managers have a team');
    const panel = i.panel ?? null;
    const teamId = i.teamId ?? null;
    if (this.invites.some((x) => x.eventId === eventId && x.email === email && x.role === i.role && x.panel === panel && x.teamId === teamId)) {
      throw new ApiError('duplicate', 'That person is already invited for this role');
    }
    this.invites.push({ id: nid('invite'), eventId, email, role: i.role, panel, teamId });
  }
  async removeRole(roleId: string) {
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) return;
    this.require(r.eventId, 'chair', 'organiser');
    this.roles = this.roles.filter((x) => x.id !== roleId);
  }
  async removeInvitation(inviteId: string) {
    const i = this.invites.find((x) => x.id === inviteId);
    if (!i) return;
    this.require(i.eventId, 'chair', 'organiser');
    this.invites = this.invites.filter((x) => x.id !== inviteId);
  }

  // ---- teams
  async listTeams(eventId: string) {
    const staff = this.rolesOf(eventId).some((r) => r.role !== 'team_manager');
    const managed = this.rolesOf(eventId).filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    const released = this.released(eventId);
    return copy(this.teams.filter((t) => t.eventId === eventId && (released || staff || managed.includes(t.id))));
  }
  async createTeam(eventId: string, i: { number: string; name: string; school?: string }) {
    this.require(eventId, 'chair', 'organiser');
    const number = this.text(i.number, 'Team number', 12);
    const name = this.text(i.name, 'Team name', 80);
    const school = (i.school ?? '').trim();
    if (school.length > 120) throw new ApiError('invalid', 'School must be 120 characters or fewer');
    if (this.teams.some((t) => t.eventId === eventId && normNumber(t.number) === normNumber(number))) {
      throw new ApiError('duplicate', `Team number ${number} is already used in this event`);
    }
    const team: TeamRow = { id: nid('team'), eventId, number, name, school };
    this.teams.push(team);
    return copy(team);
  }

  // ---- conflicts and scorecards
  async declareConflict(eventId: string, teamId: string) {
    this.require(eventId, ...JUDGE_ROLES);
    const judgeId = this.me!.userId;
    if (!this.conflicts.some((c) => c.eventId === eventId && c.judgeId === judgeId && c.teamId === teamId)) this.conflicts.push({ eventId, judgeId, teamId });
  }
  async myConflicts(eventId: string) {
    return this.conflicts.filter((c) => c.eventId === eventId && !!this.me && c.judgeId === this.me.userId).map((c) => c.teamId);
  }
  private conflicted(eventId: string, teamId: string) {
    return this.conflicts.some((c) => c.eventId === eventId && c.teamId === teamId && !!this.me && c.judgeId === this.me.userId);
  }
  private myCard(cardId: string) {
    const c = this.cards.find((x) => x.id === cardId);
    if (!c || !this.me || c.judgeId !== this.me.userId) throw new ApiError('forbidden', 'That scorecard is not yours');
    return c;
  }
  async openCard(eventId: string, teamId: string, areaId: string) {
    const area = this.area(eventId, areaId);
    if (!area || area.kind !== 'scorecard') throw new ApiError('invalid', 'That area is not scored on a scorecard');
    if (!this.teams.some((t) => t.id === teamId && t.eventId === eventId)) throw new ApiError('not-found', 'Team not found');
    const isPanelJudge = this.rolesOf(eventId).some((r) => r.role === 'judge' && r.panel === area.panel);
    if (!isPanelJudge) throw new ApiError('forbidden', 'You do not judge this panel');
    if (this.conflicted(eventId, teamId)) throw new ApiError('forbidden', 'You declared a conflict of interest with this team');
    const me = this.me!.userId;
    let card = this.cards.find((c) => c.eventId === eventId && c.teamId === teamId && c.areaId === areaId && c.judgeId === me);
    if (!card) {
      card = { id: nid('card'), eventId, teamId, areaId, panel: area.panel as Panel, judgeId: me, status: 'draft', reopenedCount: 0, scores: {}, comments: {} };
      this.cards.push(card);
    }
    return copy(card);
  }
  async saveScore(cardId: string, criterionId: string, score: number, comment = '') {
    const card = this.myCard(cardId);
    if (card.status === 'submitted') throw new ApiError('locked', 'This scorecard has been submitted');
    const area = this.area(card.eventId, card.areaId)!;
    const problems = validateScores(area, { [criterionId]: score }, { complete: false });
    if (problems.length > 0) throw new ApiError('invalid', problems[0].message);
    if (comment.length > 1000) throw new ApiError('invalid', 'Comments must be 1000 characters or fewer');
    card.scores[criterionId] = score;
    card.comments[criterionId] = comment;
  }
  async submitCard(cardId: string) {
    const card = this.myCard(cardId);
    if (card.status === 'submitted') throw new ApiError('locked', 'This scorecard has already been submitted');
    if (this.conflicted(card.eventId, card.teamId)) throw new ApiError('forbidden', 'You declared a conflict of interest with this team');
    const problems = validateScores(this.area(card.eventId, card.areaId)!, card.scores, { complete: true });
    if (problems.length > 0) throw new ApiError('invalid', problems[0].message);
    card.status = 'submitted';
  }
  async reopenCard(cardId: string, reason: string) {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) throw new ApiError('not-found', 'Scorecard not found');
    this.require(card.eventId, 'chair');
    if (reason.trim().length < 3) throw new ApiError('invalid', 'A reason is required to reopen a scorecard');
    if (card.status === 'submitted') {
      card.status = 'draft';
      card.reopenedCount += 1;
    }
  }
  async listCards(eventId: string) {
    if (!this.me) return [];
    const me = this.me.userId;
    const staff = this.has(eventId, 'chair', 'organiser');
    const released = this.released(eventId);
    const leadPanels = this.rolesOf(eventId).filter((r) => r.role === 'lead_judge').map((r) => r.panel);
    const managed = this.rolesOf(eventId).filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy(this.cards.filter((c) => c.eventId === eventId && (staff || c.judgeId === me || leadPanels.includes(c.panel) || (released && managed.includes(c.teamId)))));
  }

  // ---- overrides, penalties, snapshots
  async listOverrides(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.overrides.filter((o) => o.eventId === eventId) : []);
  }
  async setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string) {
    this.require(eventId, 'chair');
    const area = this.area(eventId, areaId);
    if (!area || area.kind !== 'scorecard') throw new ApiError('invalid', 'Overrides apply to scorecard areas only');
    if (!Number.isFinite(value) || value < 0 || value > area.max) throw new ApiError('invalid', `Override must be between 0 and ${area.max}`);
    if (reason.trim().length < 3) throw new ApiError('invalid', 'A reason is required');
    const existing = this.overrides.find((o) => o.eventId === eventId && o.teamId === teamId && o.areaId === areaId);
    if (existing) { existing.value = value; existing.reason = reason.trim(); }
    else this.overrides.push({ eventId, teamId, areaId, value, reason: reason.trim() });
  }
  async listPenalties(eventId: string) {
    if (this.has(eventId, 'chair', 'organiser')) return copy(this.penalties.filter((p) => p.eventId === eventId));
    const managed = this.rolesOf(eventId).filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy(this.penalties.filter((p) => p.eventId === eventId && this.released(eventId) && managed.includes(p.teamId)));
  }
  async addPenalty(eventId: string, teamId: string, points: number, reason: string) {
    this.require(eventId, 'chair');
    if (!Number.isFinite(points) || points <= 0 || points > 100) throw new ApiError('invalid', 'Penalty points must be above 0 and at most 100');
    if (reason.trim().length < 3) throw new ApiError('invalid', 'A reason is required');
    this.penalties.push({ id: nid('penalty'), eventId, teamId, points, reason: reason.trim() });
  }
  async publishSnapshot(eventId: string, s: NewSnapshot) {
    this.require(eventId, 'chair');
    if (!/^[0-9a-f]{64}$/.test(s.inputHash)) throw new ApiError('invalid', 'The snapshot hash is malformed');
    const row: SnapshotRow = {
      id: nid('snapshot'), eventId, createdAt: new Date().toISOString(), rulesetId: s.rulesetId,
      inputHash: s.inputHash, rows: copy(s.rows), released: s.released ?? true,
    };
    this.snapshots.push(row);
    return copy(row);
  }
  async latestSnapshot(eventId: string) {
    const staff = this.has(eventId, 'chair', 'organiser');
    const visible = this.snapshots.filter((s) => s.eventId === eventId && (staff || (s.released && this.released(eventId))));
    return visible.length === 0 ? null : copy(visible[visible.length - 1]);
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/api && npx tsc --noEmit`
Expected: PASS. The test `expect(await api.listEvents()...` runs as the organiser after `world()` left the session as the manager, which is why the test calls `api.signIn(ORG)` first.

- [ ] **Step 6: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): Api interface and in-memory backend mirroring the database rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Supabase Api implementation

**Files:**
- Create: `platform/src/api/mappers.ts`, `platform/src/api/supabase.ts`
- Modify: `platform/src/api/index.ts` (export `createSupabaseApi`)
- Test: `platform/tests/api/mappers.test.ts`

**Interfaces:**
- Consumes: `Api` and row types (Task 8); the database contract from Tasks 5 to 7.
- Produces (exact):
  - `mapPgError(e: { message: string; code?: string }): ApiError`
  - `toEventRow(r)`, `toTeamRow(r)`, `toRoleRow(r)`, `toInviteRow(r)`, `toCardRow(r)`, `toSnapshotRow(r)` from snake_case database rows
  - `createSupabaseApi(url: string, anonKey: string): Api`

- [ ] **Step 1: Write the failing tests**

`tests/api/mappers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapPgError, toCardRow, toEventRow, toRoleRow, toSnapshotRow } from '../../src/api/mappers';

describe('mapPgError', () => {
  it('maps Postgres codes to API error codes', () => {
    expect(mapPgError({ message: 'x', code: '42501' }).code).toBe('forbidden');
    expect(mapPgError({ message: 'x', code: '55000' }).code).toBe('locked');
    expect(mapPgError({ message: 'x', code: '23505' }).code).toBe('duplicate');
    for (const c of ['23514', '22023', '22P02', '23502']) expect(mapPgError({ message: 'x', code: c }).code, c).toBe('invalid');
    expect(mapPgError({ message: 'x', code: 'P0002' }).code).toBe('not-found');
  });

  it('treats a failed fetch as a network error, and keeps the message', () => {
    expect(mapPgError({ message: 'TypeError: Failed to fetch' }).code).toBe('network');
    expect(mapPgError({ message: 'NetworkError when attempting to fetch resource.' }).code).toBe('network');
    expect(mapPgError({ message: 'something odd' }).code).toBe('unknown');
    expect(mapPgError({ message: 'criterion Team Contribution has no score', code: '23514' }).message).toContain('no score');
  });

  it('maps row level security violations to forbidden', () => {
    expect(mapPgError({ message: 'new row violates row-level security policy for table "scorecards"', code: '42501' }).code).toBe('forbidden');
  });
});

describe('row mappers', () => {
  it('maps events and roles to camelCase', () => {
    expect(toEventRow({ id: 'e', name: 'N', starts_on: '2026-11-01', ruleset: { id: 'r' }, results_released: true })).toEqual({
      id: 'e', name: 'N', startsOn: '2026-11-01', ruleset: { id: 'r' }, resultsReleased: true,
    });
    expect(toRoleRow({ id: 'r', event_id: 'e', user_id: 'u', role: 'judge', panel: 'verbal', team_id: null, email: 'a@x.test' })).toEqual({
      id: 'r', eventId: 'e', userId: 'u', role: 'judge', panel: 'verbal', teamId: null, email: 'a@x.test',
    });
  });

  it('folds nested score rows into scores and comments', () => {
    const card = toCardRow({
      id: 'c', event_id: 'e', team_id: 't', area_id: 'verbal-technique', panel: 'verbal', judge_id: 'j', status: 'draft', reopened_count: 2,
      scorecard_scores: [{ criterion_id: 'team-contribution', score: 12, comment: 'Clear roles' }, { criterion_id: 'engagement-presentation-dynamics', score: 14, comment: '' }],
    });
    expect(card.scores).toEqual({ 'team-contribution': 12, 'engagement-presentation-dynamics': 14 });
    expect(card.comments['team-contribution']).toBe('Clear roles');
    expect(card.reopenedCount).toBe(2);
    expect(toCardRow({ id: 'c', event_id: 'e', team_id: 't', area_id: 'a', panel: 'verbal', judge_id: 'j', status: 'draft', reopened_count: 0 }).scores).toEqual({});
  });

  it('maps snapshots', () => {
    expect(toSnapshotRow({ id: 's', event_id: 'e', created_at: '2026-11-01T00:00:00Z', ruleset_id: 'r', input_hash: 'h', rows: [], released: true })).toEqual({
      id: 's', eventId: 'e', createdAt: '2026-11-01T00:00:00Z', rulesetId: 'r', inputHash: 'h', rows: [], released: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/mappers.test.ts`
Expected: FAIL, cannot resolve `../../src/api/mappers`.

- [ ] **Step 3: Implement the mappers**

`src/api/mappers.ts`:

```ts
import {
  ApiError, type ApiErrorCode, type CardRow, type EventRow, type InviteRow, type RoleRow, type SnapshotRow, type TeamRow,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const CODES: Record<string, ApiErrorCode> = {
  '42501': 'forbidden',
  '55000': 'locked',
  '23505': 'duplicate',
  '23514': 'invalid',
  '23502': 'invalid',
  '22023': 'invalid',
  '22P02': 'invalid',
  P0002: 'not-found',
};

export function mapPgError(e: { message: string; code?: string }): ApiError {
  if (e.code && CODES[e.code]) return new ApiError(CODES[e.code], e.message);
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(e.message)) {
    return new ApiError('network', 'No connection to the server');
  }
  return new ApiError('unknown', e.message);
}

export const toEventRow = (r: Row): EventRow => ({
  id: r.id, name: r.name, startsOn: r.starts_on ?? null, ruleset: r.ruleset, resultsReleased: !!r.results_released,
});
export const toTeamRow = (r: Row): TeamRow => ({ id: r.id, eventId: r.event_id, number: r.number, name: r.name, school: r.school ?? '' });
export const toRoleRow = (r: Row): RoleRow => ({
  id: r.id, eventId: r.event_id, userId: r.user_id, role: r.role, panel: r.panel ?? null, teamId: r.team_id ?? null, email: r.email ?? null,
});
export const toInviteRow = (r: Row): InviteRow => ({
  id: r.id, eventId: r.event_id, email: r.email, role: r.role, panel: r.panel ?? null, teamId: r.team_id ?? null,
});
export const toCardRow = (r: Row): CardRow => {
  const scores: Record<string, number> = {};
  const comments: Record<string, string> = {};
  for (const s of (r.scorecard_scores ?? []) as Row[]) {
    scores[s.criterion_id] = s.score;
    comments[s.criterion_id] = s.comment ?? '';
  }
  return {
    id: r.id, eventId: r.event_id, teamId: r.team_id, areaId: r.area_id, panel: r.panel, judgeId: r.judge_id,
    status: r.status, reopenedCount: r.reopened_count ?? 0, scores, comments,
  };
};
export const toSnapshotRow = (r: Row): SnapshotRow => ({
  id: r.id, eventId: r.event_id, createdAt: r.created_at, rulesetId: r.ruleset_id, inputHash: r.input_hash, rows: r.rows, released: !!r.released,
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/api/mappers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Supabase adapter**

`src/api/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { INDIA_2026 } from '../rulesets';
import { mapPgError, toCardRow, toEventRow, toInviteRow, toRoleRow, toSnapshotRow, toTeamRow } from './mappers';
import type { Api, Session } from './types';
import { ApiError } from './types';

type Failure = { message: string; code?: string } | null;

function ok<T>(res: { data: T | null; error: Failure }): T {
  if (res.error) throw mapPgError(res.error);
  return res.data as T;
}

/** supabase-js throws on network failure from some calls and returns it as an error from others. */
async function guard<T>(run: () => PromiseLike<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw mapPgError({ message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
}

const CARD_SELECT = 'id,event_id,team_id,area_id,panel,judge_id,status,reopened_count,scorecard_scores(criterion_id,score,comment)';

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
    u ? { userId: u.id, email: (u.email ?? '').toLowerCase() } : null;

  return {
    async getSession() {
      const { data } = await guard(() => sb.auth.getSession());
      return toSession(data.session?.user);
    },
    async signIn(email) {
      const { error } = await guard(() => sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: window.location.origin + window.location.pathname } }));
      if (error) throw mapPgError({ message: error.message });
    },
    async signOut() {
      await guard(() => sb.auth.signOut());
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toSession(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async claimInvitations() {
      return Number(ok(await guard(() => sb.rpc('claim_invitations'))) ?? 0);
    },

    async listEvents() {
      return ok(await guard(() => sb.from('events').select('*').order('created_at', { ascending: false }))).map(toEventRow);
    },
    async createEvent(i) {
      const row = ok(await guard(() => sb.rpc('create_event', { p_name: i.name, p_starts_on: i.startsOn ?? null, p_ruleset: INDIA_2026 })));
      return toEventRow(row as never);
    },
    async getEvent(id) {
      const row = ok(await guard(() => sb.from('events').select('*').eq('id', id).maybeSingle()));
      return row ? toEventRow(row) : null;
    },
    async setReleased(eventId, released) {
      const rows = ok(await guard(() => sb.from('events').update({ results_released: released }).eq('id', eventId).select('id')));
      if (rows.length === 0) throw new ApiError('forbidden', 'You do not have permission to do that');
    },

    async myRoles(eventId) {
      const s = await this.getSession();
      if (!s) return [];
      return ok(await guard(() => sb.from('event_roles').select('*').eq('event_id', eventId).eq('user_id', s.userId))).map(toRoleRow);
    },
    async listRoles(eventId) {
      return ok(await guard(() => sb.from('event_roles').select('*').eq('event_id', eventId))).map(toRoleRow);
    },
    async listInvitations(eventId) {
      return ok(await guard(() => sb.from('invitations').select('*').eq('event_id', eventId))).map(toInviteRow);
    },
    async invite(eventId, i) {
      ok(await guard(() => sb.from('invitations').insert({
        event_id: eventId, email: i.email.trim().toLowerCase(), role: i.role, panel: i.panel ?? null, team_id: i.teamId ?? null,
      })));
    },
    async removeRole(roleId) {
      ok(await guard(() => sb.from('event_roles').delete().eq('id', roleId)));
    },
    async removeInvitation(inviteId) {
      ok(await guard(() => sb.from('invitations').delete().eq('id', inviteId)));
    },

    async listTeams(eventId) {
      return ok(await guard(() => sb.from('teams').select('*').eq('event_id', eventId))).map(toTeamRow)
        .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    },
    async createTeam(eventId, i) {
      const row = ok(await guard(() => sb.from('teams').insert({ event_id: eventId, number: i.number.trim(), name: i.name.trim(), school: (i.school ?? '').trim() }).select('*').single()));
      return toTeamRow(row);
    },

    async declareConflict(eventId, teamId) {
      const { error } = await guard(() => sb.from('judge_conflicts').upsert({ event_id: eventId, team_id: teamId }, { onConflict: 'event_id,judge_id,team_id', ignoreDuplicates: true }));
      if (error) throw mapPgError(error);
    },
    async myConflicts(eventId) {
      const s = await this.getSession();
      if (!s) return [];
      return ok(await guard(() => sb.from('judge_conflicts').select('team_id').eq('event_id', eventId).eq('judge_id', s.userId))).map((r) => r.team_id as string);
    },

    async openCard(eventId, teamId, areaId) {
      const s = await this.getSession();
      if (!s) throw new ApiError('forbidden', 'Sign in first');
      const find = async () => ok(await guard(() => sb.from('scorecards').select(CARD_SELECT).eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).eq('judge_id', s.userId).maybeSingle()));
      const existing = await find();
      if (existing) return toCardRow(existing);
      const { error } = await guard(() => sb.from('scorecards').insert({ event_id: eventId, team_id: teamId, area_id: areaId }));
      if (error && error.code !== '23505') throw mapPgError(error);
      const created = await find();
      if (!created) throw new ApiError('forbidden', 'You cannot score this team in this area');
      return toCardRow(created);
    },
    async saveScore(cardId, criterionId, score, comment = '') {
      ok(await guard(() => sb.from('scorecard_scores').upsert({ scorecard_id: cardId, criterion_id: criterionId, score, comment }, { onConflict: 'scorecard_id,criterion_id' })));
    },
    async submitCard(cardId) {
      const rows = ok(await guard(() => sb.from('scorecards').update({ status: 'submitted' }).eq('id', cardId).select('id')));
      if (rows.length === 0) throw new ApiError('locked', 'This scorecard cannot be submitted (already submitted, or not yours)');
    },
    async reopenCard(cardId, reason) {
      ok(await guard(() => sb.rpc('reopen_scorecard', { p_card: cardId, p_reason: reason })));
    },
    async listCards(eventId) {
      return ok(await guard(() => sb.from('scorecards').select(CARD_SELECT).eq('event_id', eventId))).map(toCardRow);
    },

    async listOverrides(eventId) {
      return ok(await guard(() => sb.from('score_overrides').select('*').eq('event_id', eventId))).map((r) => ({
        eventId: r.event_id, teamId: r.team_id, areaId: r.area_id, value: Number(r.value), reason: r.reason,
      }));
    },
    async setOverride(eventId, teamId, areaId, value, reason) {
      ok(await guard(() => sb.from('score_overrides').upsert({ event_id: eventId, team_id: teamId, area_id: areaId, value, reason: reason.trim() }, { onConflict: 'event_id,team_id,area_id' })));
    },
    async listPenalties(eventId) {
      return ok(await guard(() => sb.from('penalties').select('*').eq('event_id', eventId))).map((r) => ({
        id: r.id, eventId: r.event_id, teamId: r.team_id, points: Number(r.points), reason: r.reason,
      }));
    },
    async addPenalty(eventId, teamId, points, reason) {
      ok(await guard(() => sb.from('penalties').insert({ event_id: eventId, team_id: teamId, points, reason: reason.trim() })));
    },
    async publishSnapshot(eventId, s) {
      const row = ok(await guard(() => sb.from('ranking_snapshots').insert({
        event_id: eventId, ruleset_id: s.rulesetId, input_hash: s.inputHash, inputs: s.inputs, rows: s.rows, released: s.released ?? true,
      }).select('*').single()));
      return toSnapshotRow(row);
    },
    async latestSnapshot(eventId) {
      const rows = ok(await guard(() => sb.from('ranking_snapshots').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(1)));
      return rows.length > 0 ? toSnapshotRow(rows[0]) : null;
    },
  };
}
```

Add to `src/api/index.ts`: `export { createSupabaseApi } from './supabase';`

Note: `this.getSession()` inside object-literal methods relies on method calls through the returned object; do not destructure the returned `Api` object anywhere (always call `api.method(...)`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS. The adapter's network behaviour is verified end to end in Task 16 against a local Supabase, since it cannot run offline. If `sb.rpc('create_event', ...)` returns an array in your supabase-js version, take the first element (`Array.isArray(row) ? row[0] : row`) and add a mapper test for that shape.

- [ ] **Step 7: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): Supabase adapter with tested error and row mapping" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Offline score queue

**Files:**
- Create: `platform/src/api/queue.ts`
- Modify: `platform/src/api/index.ts` (export the queue)
- Test: `platform/tests/api/queue.test.ts`

**Interfaces:**
- Consumes: `Api['saveScore']`, `ApiError` (Task 8).
- Produces (exact):
  - `interface KV { get(): string | null; set(v: string): void }`; `memoryKV(): KV`; `localStorageKV(key: string): KV`
  - `interface QueuedScore { cardId: string; criterionId: string; score: number; comment: string; at: number }`
  - `type QueueEvent = { kind: 'saved'; pending: number } | { kind: 'offline'; pending: number } | { kind: 'dropped'; item: QueuedScore; reason: string }`
  - `class ScoreQueue { constructor(api: Pick<Api, 'saveScore'>, kv: KV, clock?: () => number); subscribe(cb: (e: QueueEvent) => void): () => void; enqueue(item: { cardId: string; criterionId: string; score: number; comment: string }): void; pending(): number; pendingFor(cardId: string): QueuedScore[]; flush(): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

`tests/api/queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, ScoreQueue, memoryKV, type QueueEvent } from '../../src/api';

type Call = { cardId: string; criterionId: string; score: number; comment: string };
function fakeApi(plan: (c: Call, n: number) => Promise<void> | void) {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      async saveScore(cardId: string, criterionId: string, score: number, comment = '') {
        const c = { cardId, criterionId, score, comment };
        calls.push(c);
        await plan(c, calls.length);
      },
    },
  };
}
const item = (criterionId: string, score: number, comment = '') => ({ cardId: 'c1', criterionId, score, comment });
const net = () => { throw new ApiError('network', 'offline'); };

describe('ScoreQueue', () => {
  it('sends queued scores in order and empties itself', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    q.enqueue(item('b', 6));
    expect(q.pending()).toBe(2);
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
    expect(q.pending()).toBe(0);
  });

  it('keeps scores while offline, survives a reload, and sends them when back online', async () => {
    const kv = memoryKV();
    let online = false;
    const { api, calls } = fakeApi(() => { if (!online) net(); });
    const events: QueueEvent[] = [];
    const q1 = new ScoreQueue(api, kv);
    q1.subscribe((e) => events.push(e));
    q1.enqueue(item('a', 5, 'good'));
    await q1.flush();
    expect(q1.pending()).toBe(1);
    expect(events.at(-1)).toEqual({ kind: 'offline', pending: 1 });

    const q2 = new ScoreQueue(api, kv); // a page reload
    expect(q2.pendingFor('c1')).toEqual([expect.objectContaining({ criterionId: 'a', score: 5, comment: 'good' })]);
    online = true;
    await q2.flush();
    expect(q2.pending()).toBe(0);
    expect(calls.at(-1)).toEqual({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'good' });
    expect(new ScoreQueue(api, kv).pending()).toBe(0);
  });

  it('keeps only the latest value for a criterion', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    q.enqueue(item('a', 9));
    q.enqueue(item('a', 12));
    expect(q.pending()).toBe(1);
    await q.flush();
    expect(calls.map((c) => c.score)).toEqual([12]);
  });

  it('does not lose an edit made while the previous value is being sent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api, calls } = fakeApi(async (_c, n) => { if (n === 1) await gate; });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    const first = q.flush();
    q.enqueue(item('a', 7)); // typed while 5 is in flight
    release();
    await first;
    await q.flush();
    expect(calls.map((c) => c.score)).toEqual([5, 7]);
    expect(q.pending()).toBe(0);
  });

  it('drops an edit the server refuses (card locked or reopened elsewhere), says so, and carries on', async () => {
    const { api, calls } = fakeApi((c) => { if (c.criterionId === 'a') throw new ApiError('locked', 'This scorecard has been submitted'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 5));
    q.enqueue(item('b', 6));
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
    expect(q.pending()).toBe(0);
    expect(events).toContainEqual({ kind: 'dropped', item: expect.objectContaining({ criterionId: 'a' }), reason: expect.stringContaining('submitted') });
    expect(events.at(-1)).toEqual({ kind: 'saved', pending: 0 });
  });

  it('retries on an unknown server error instead of dropping the score', async () => {
    let fail = true;
    const { api } = fakeApi(() => { if (fail) throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    await q.flush();
    expect(q.pending()).toBe(1);
    fail = false;
    await q.flush();
    expect(q.pending()).toBe(0);
  });

  it('shares one flush between concurrent callers', async () => {
    const { api, calls } = fakeApi(async () => { await Promise.resolve(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    await Promise.all([q.flush(), q.flush(), q.flush()]);
    expect(calls).toHaveLength(1);
  });

  it('ignores corrupt or hostile stored data', () => {
    const { api } = fakeApi(() => {});
    for (const bad of ['not json', '{"a":1}', '[1,2]', '[{"cardId":1}]', 'null']) {
      const kv = memoryKV();
      kv.set(bad);
      expect(new ScoreQueue(api, kv).pending(), bad).toBe(0);
    }
  });

  it('reports pending items per card', () => {
    const { api } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 1, comment: '' });
    q.enqueue({ cardId: 'c2', criterionId: 'a', score: 2, comment: '' });
    expect(q.pendingFor('c2')).toHaveLength(1);
    expect(q.pendingFor('c3')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/queue.test.ts`
Expected: FAIL (`ScoreQueue` is not exported from `../../src/api`).

- [ ] **Step 3: Implement**

`src/api/queue.ts`:

```ts
import { ApiError, type Api, type ApiErrorCode } from './types';

export interface KV { get(): string | null; set(v: string): void }

export function memoryKV(): KV {
  let value: string | null = null;
  return { get: () => value, set: (v) => { value = v; } };
}

export function localStorageKV(key: string): KV {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(key, v); } catch { /* storage full or blocked: the queue still works in memory */ } },
  };
}

export interface QueuedScore { cardId: string; criterionId: string; score: number; comment: string; at: number }

export type QueueEvent =
  | { kind: 'saved'; pending: number }
  | { kind: 'offline'; pending: number }
  | { kind: 'dropped'; item: QueuedScore; reason: string };

const RETRY: ApiErrorCode[] = ['network', 'unknown'];

const REASONS: Partial<Record<ApiErrorCode, string>> = {
  locked: 'This scorecard was submitted or reopened elsewhere, so your latest change was not saved.',
  forbidden: 'You no longer have permission to score this team, so your latest change was not saved.',
  'not-found': 'This scorecard no longer exists, so your latest change was not saved.',
};

function load(raw: string | null): QueuedScore[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is QueuedScore =>
      !!x && typeof x === 'object' && typeof x.cardId === 'string' && typeof x.criterionId === 'string'
      && typeof x.score === 'number' && Number.isFinite(x.score) && typeof x.comment === 'string' && typeof x.at === 'number');
  } catch {
    return [];
  }
}

export class ScoreQueue {
  private items: QueuedScore[];
  private listeners = new Set<(e: QueueEvent) => void>();
  private flushing: Promise<void> | null = null;
  private inFlight: QueuedScore | null = null;

  constructor(private api: Pick<Api, 'saveScore'>, private kv: KV, private clock: () => number = Date.now) {
    this.items = load(kv.get());
  }

  subscribe(cb: (e: QueueEvent) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  pending() { return this.items.length; }
  pendingFor(cardId: string) { return this.items.filter((i) => i.cardId === cardId).map((i) => ({ ...i })); }

  enqueue(i: { cardId: string; criterionId: string; score: number; comment: string }) {
    const next: QueuedScore = { ...i, at: this.clock() };
    // Replace an older unsent value for the same criterion, but never the one being sent right now.
    const idx = this.items.findIndex((x) => x !== this.inFlight && x.cardId === i.cardId && x.criterionId === i.criterionId);
    if (idx >= 0) this.items[idx] = next;
    else this.items.push(next);
    this.persist();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run() {
    while (this.items.length > 0) {
      const item = this.items[0];
      this.inFlight = item;
      try {
        await this.api.saveScore(item.cardId, item.criterionId, item.score, item.comment);
        this.remove(item);
      } catch (e) {
        const code: ApiErrorCode = e instanceof ApiError ? e.code : 'network';
        if (RETRY.includes(code)) {
          this.emit({ kind: 'offline', pending: this.items.length });
          return;
        }
        this.remove(item);
        const reason = e instanceof ApiError && code === 'invalid' ? e.message : (REASONS[code] ?? 'The change could not be saved.');
        this.emit({ kind: 'dropped', item, reason });
      } finally {
        this.inFlight = null;
      }
    }
    this.emit({ kind: 'saved', pending: 0 });
  }

  private remove(item: QueuedScore) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.persist();
  }

  private persist() { this.kv.set(JSON.stringify(this.items)); }
  private emit(e: QueueEvent) { this.listeners.forEach((l) => l(e)); }
}
```

Add to `src/api/index.ts`: `export { ScoreQueue, memoryKV, localStorageKV, type KV, type QueuedScore, type QueueEvent } from './queue';`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS. If the "edit made while the previous value is being sent" test fails with `[5]` only, the in-flight guard in `enqueue` is not excluding the sent item.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): offline score queue with coalescing, in-flight safety and visible drops" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: UI foundation (router, shell, sign-in, events list) and the app boot

**Files:**
- Create: `platform/src/ui/dom.ts` (copied), `router.ts`, `ctx.ts`, `common.ts`, `labels.ts`, `shell.ts`, `login.ts`, `events.ts`, `demo.ts`, `platform/src/styles/platform.css`
- Modify: `platform/src/main.ts` (replace the placeholder)
- Test: `platform/tests/ui/dom.test.ts` (copied), `router.test.ts`, `helpers.ts`, `login.test.ts`, `events.test.ts`

**Interfaces:**
- Consumes: `Api`, `MemoryApi`, `ScoreQueue`, `ApiError` (Tasks 8 to 10).
- Produces (exact):
  - `h(tag, props, ...children)` and `type Child` (same as the scrutineering app's `dom.ts`)
  - `type Route = { name: 'home' } | { name: 'event'; eventId: string } | { name: 'teams'; eventId: string } | { name: 'people'; eventId: string } | { name: 'score'; eventId: string } | { name: 'scorecard'; eventId: string; teamId: string; areaId: string } | { name: 'moderate'; eventId: string } | { name: 'rankings'; eventId: string } | { name: 'results'; eventId: string }`
  - `parseHash(hash: string): Route`, `routeHref(r: Route): string`, `startRouter(onRoute: (r: Route) => void): void`
  - `interface Ctx { api: Api; queue: ScoreQueue; main: HTMLElement; demo: boolean; rerender(): void; onLeave(fn: () => void): void }`
  - `errorText(e: unknown): string`, `notFound(message: string, backHref?: string, backLabel?: string): HTMLElement`, `tag(text: string, tone?: 'pass' | 'fail' | 'risk' | 'todo' | 'class'): HTMLElement` in `common.ts`
  - `ROLE_LABEL: Record<Role, string>`, `PANEL_LABEL: Record<Panel, string>`, `INVITABLE: Role[]` in `labels.ts`
  - `mountShell(root): { main: HTMLElement; demoBar: HTMLElement; setUser(session: Session | null, onSignOut: () => void): void }`
  - `loginScreen(ctx: Ctx): HTMLElement`, `eventsScreen(ctx: Ctx): Promise<HTMLElement>`
  - `DEMO_PERSONAS`, `seedDemo(api: MemoryApi): Promise<string>`
  - Test helpers in `tests/ui/helpers.ts`: `EMAILS`, `world()`, `makeCtx(api, queueApi?)`, `text(el)`

- [ ] **Step 1: Copy the shared DOM helper and its test**

```bash
cp ../src/ui/dom.ts src/ui/dom.ts
{ echo '// @vitest-environment jsdom'; cat ../tests/ui/dom.test.ts; } > tests/ui/dom.test.ts
```

- [ ] **Step 2: Write the test helpers and the failing tests**

`tests/ui/helpers.ts`:

```ts
import { vi } from 'vitest';
import { MemoryApi, ScoreQueue, memoryKV, type Api } from '../../src/api';
import type { Ctx } from '../../src/ui/ctx';

export const EMAILS = { org: 'org@x.test', chair: 'chair@x.test', judge: 'judge@x.test', lead: 'lead@x.test', mgr: 'mgr@x.test' } as const;

/** An event with two teams and one person in each role. Leaves the session signed in as the team manager. */
export async function world() {
  const api = new MemoryApi();
  await api.signIn(EMAILS.org);
  const ev = await api.createEvent({ name: 'Nationals', startsOn: '2026-11-01' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'One' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Two' });
  await api.invite(ev.id, { email: EMAILS.chair, role: 'chair' });
  await api.invite(ev.id, { email: EMAILS.judge, role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: EMAILS.lead, role: 'lead_judge', panel: 'verbal' });
  await api.invite(ev.id, { email: EMAILS.mgr, role: 'team_manager', teamId: t1.id });
  for (const e of [EMAILS.chair, EMAILS.judge, EMAILS.lead, EMAILS.mgr]) {
    await api.signIn(e);
    await api.claimInvitations();
  }
  return { api, ev, t1, t2 };
}

export function makeCtx(api: Api, queueApi: Pick<Api, 'saveScore'> = api) {
  const main = document.createElement('div');
  const leaves: Array<() => void> = [];
  const ctx: Ctx = {
    api, queue: new ScoreQueue(queueApi, memoryKV()), main, demo: false,
    rerender: vi.fn(), onLeave: (f) => { leaves.push(f); },
  };
  return { ctx, leaves };
}

export const text = (el: Element) => el.textContent ?? '';
```

`tests/ui/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseHash, routeHref, type Route } from '../../src/ui/router';

describe('router', () => {
  it('parses every route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/event/e1')).toEqual({ name: 'event', eventId: 'e1' });
    expect(parseHash('#/event/e1/teams')).toEqual({ name: 'teams', eventId: 'e1' });
    expect(parseHash('#/event/e1/people')).toEqual({ name: 'people', eventId: 'e1' });
    expect(parseHash('#/event/e1/score')).toEqual({ name: 'score', eventId: 'e1' });
    expect(parseHash('#/event/e1/score/t1/verbal-technique')).toEqual({ name: 'scorecard', eventId: 'e1', teamId: 't1', areaId: 'verbal-technique' });
    expect(parseHash('#/event/e1/moderate')).toEqual({ name: 'moderate', eventId: 'e1' });
    expect(parseHash('#/event/e1/rankings')).toEqual({ name: 'rankings', eventId: 'e1' });
    expect(parseHash('#/event/e1/results')).toEqual({ name: 'results', eventId: 'e1' });
  });

  it('falls back to home for anything unknown or malformed', () => {
    for (const h of ['#/nonsense', '#/event', '#/event/', '#/event/e1/nope', '#/event/e1/score/t1', '#/event/e1/teams/extra', '#/event/%E0%A4%A', '#/event//teams']) {
      expect(parseHash(h), h).toEqual({ name: 'home' });
    }
  });

  it('round-trips ids containing spaces, slashes and non-Latin text', () => {
    const routes: Route[] = [
      { name: 'home' }, { name: 'event', eventId: 'a b' }, { name: 'teams', eventId: 'a/b' },
      { name: 'scorecard', eventId: 'e 1', teamId: 'स्टेम', areaId: 'x/y' }, { name: 'results', eventId: 'é' },
    ];
    for (const r of routes) expect(parseHash(routeHref(r))).toEqual(r);
  });
});
```

`tests/ui/login.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';
import { loginScreen } from '../../src/ui/login';
import { makeCtx, text } from './helpers';

const submit = (el: HTMLElement, email: string) => {
  (el.querySelector('input[name=email]') as HTMLInputElement).value = email;
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
};

describe('loginScreen', () => {
  it('signs in and asks the app to re-render', async () => {
    const api = new MemoryApi();
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'Person@X.test');
    await new Promise((r) => setTimeout(r, 0));
    expect((await api.getSession())?.email).toBe('person@x.test');
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it('shows a readable message for a bad address and does not sign in', async () => {
    const api = new MemoryApi();
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'not an email');
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('valid email');
    expect(await api.getSession()).toBeNull();
  });

  it('says what happens when the link has to be opened from an email', async () => {
    const api = new MemoryApi();
    api.getSession = async () => null; // a real backend does not sign in until the link is opened
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'a@x.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=status]')!)).toContain('a@x.test');
  });
});
```

`tests/ui/events.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { eventsScreen } from '../../src/ui/events';
import { makeCtx, text, world } from './helpers';

describe('eventsScreen', () => {
  it('lists the events the person belongs to as links, with the date', async () => {
    const { api, ev } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const link = el.querySelector(`a[href="#/event/${ev.id}"]`)!;
    expect(text(link)).toBe('Nationals');
    expect(text(el)).toContain('2026-11-01');
  });

  it('says so when there are no events, and offers to create one', async () => {
    const { api } = await world();
    await api.signIn('stranger@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    expect(text(el)).toContain('No events yet');
    expect(el.querySelector('input[name=name]')).not.toBeNull();
  });

  it('creates an event and goes to it, or shows why not', async () => {
    const { api } = await world();
    await api.signIn('new@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const form = el.querySelector('form')!;
    (form.querySelector('input[name=name]') as HTMLInputElement).value = '   ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('Event name is required');
    (form.querySelector('input[name=name]') as HTMLInputElement).value = 'Regional';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(location.hash).toMatch(/^#\/event\/event-/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/ui`
Expected: `dom.test.ts` PASSES (the copied helper), the others FAIL (modules missing).

- [ ] **Step 4: Implement the router, context and common helpers**

`src/ui/router.ts`:

```ts
export type Route =
  | { name: 'home' }
  | { name: 'event'; eventId: string }
  | { name: 'teams'; eventId: string }
  | { name: 'people'; eventId: string }
  | { name: 'score'; eventId: string }
  | { name: 'scorecard'; eventId: string; teamId: string; areaId: string }
  | { name: 'moderate'; eventId: string }
  | { name: 'rankings'; eventId: string }
  | { name: 'results'; eventId: string };

const HOME: Route = { name: 'home' };
const SECTIONS = ['teams', 'people', 'score', 'moderate', 'rankings', 'results'] as const;

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  let decoded: string[];
  try {
    decoded = parts.map((p) => decodeURIComponent(p));
  } catch {
    return HOME;
  }
  if (decoded[0] !== 'event' || !decoded[1]) return HOME;
  const eventId = decoded[1];
  if (decoded.length === 2) return { name: 'event', eventId };
  const section = decoded[2] as (typeof SECTIONS)[number];
  if (decoded.length === 3 && (SECTIONS as readonly string[]).includes(section)) return { name: section, eventId };
  if (decoded.length === 5 && decoded[2] === 'score' && decoded[3] && decoded[4]) {
    return { name: 'scorecard', eventId, teamId: decoded[3], areaId: decoded[4] };
  }
  return HOME;
}

const e = encodeURIComponent;

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'event': return `#/event/${e(r.eventId)}`;
    case 'scorecard': return `#/event/${e(r.eventId)}/score/${e(r.teamId)}/${e(r.areaId)}`;
    default: return `#/event/${e(r.eventId)}/${r.name}`;
  }
}

export function startRouter(onRoute: (r: Route) => void): void {
  const run = () => onRoute(parseHash(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
```

`src/ui/ctx.ts`:

```ts
import type { Api, ScoreQueue } from '../api';

export interface Ctx {
  api: Api;
  queue: ScoreQueue;
  main: HTMLElement;
  demo: boolean;
  /** Re-render the current route. */
  rerender(): void;
  /** Register cleanup to run when the current screen is replaced. */
  onLeave(fn: () => void): void;
}
```

`src/ui/common.ts`:

```ts
import { ApiError } from '../api';
import { h } from './dom';

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export function notFound(message: string, backHref = '#/', backLabel = 'Back'): HTMLElement {
  return h('div', { class: 'stack' }, h('p', null, message), h('a', { class: 'back', href: backHref }, backLabel));
}

/** Status is always a word, never colour alone. */
export const tag = (label: string, tone: 'pass' | 'fail' | 'risk' | 'todo' | 'class' = 'todo') =>
  h('span', { class: `tag tag--${tone}` }, label);
```

`src/ui/labels.ts`:

```ts
import type { Panel, Role } from '../api';

export const ROLE_LABEL: Record<Role, string> = {
  organiser: 'Organiser', chair: 'Chair of Judges', lead_judge: 'Lead Judge', judge: 'Judge',
  scrutineer: 'Scrutineer', race_official: 'Race official', team_manager: 'Team manager',
};

export const PANEL_LABEL: Record<Panel, string> = {
  scrutineering: 'Specification & Scrutineering', design_engineering: 'Design & Engineering',
  project_management: 'Project Management', enterprise: 'Enterprise', verbal: 'Verbal Presentation',
};

/** Roles an organiser or chair can invite people into (the organiser role is created with the event). */
export const INVITABLE: Role[] = ['chair', 'lead_judge', 'judge', 'scrutineer', 'race_official', 'team_manager'];
```

- [ ] **Step 5: Implement shell, login, events and demo**

`src/ui/shell.ts`:

```ts
import type { Session } from '../api';
import { h } from './dom';

export interface Shell {
  main: HTMLElement;
  demoBar: HTMLElement;
  setUser(session: Session | null, onSignOut: () => void): void;
}

export function mountShell(root: HTMLElement): Shell {
  const main = h('main', { id: 'main', tabindex: '-1' });
  const who = h('div', { class: 'who' });
  const demoBar = h('div', { class: 'demo-bar', hidden: true });
  root.replaceChildren(
    h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    demoBar,
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { href: '#/', 'aria-label': 'STEM Racing India event platform home' },
          h('img', { src: '/brand/logo-full-colour-white.png', alt: 'STEM Racing', height: 44 })),
        who,
      ),
    ),
    main,
  );
  return {
    main,
    demoBar,
    setUser(session, onSignOut) {
      who.replaceChildren(
        ...(session
          ? [h('span', { class: 'muted' }, session.email), h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: onSignOut }, 'Sign out')]
          : []),
      );
    },
  };
}
```

`src/ui/login.ts`:

```ts
import type { Ctx } from './ctx';
import { errorText } from './common';
import { h } from './dom';

export function loginScreen(ctx: Ctx): HTMLElement {
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email' });
  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), email),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send sign-in link'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    notice.hidden = true;
    try {
      await ctx.api.signIn(email.value);
      if (await ctx.api.getSession()) {
        ctx.rerender();
      } else {
        notice.textContent = `We sent a sign-in link to ${email.value.trim()}. Open it on this device to continue.`;
        notice.hidden = false;
      }
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  });
  return h('div', { class: 'stack stack--lg' },
    h('h1', null, 'Sign in'),
    h('p', { class: 'lead' }, 'Use the email address your event organiser invited.'),
    notice, error, form,
    h('p', { class: 'muted small' }, 'Results that have been released can be viewed without signing in.'),
  );
}
```

`src/ui/events.ts`:

```ts
import type { Ctx } from './ctx';
import { errorText } from './common';
import { h } from './dom';
import { routeHref } from './router';

const today = () => new Date().toISOString().slice(0, 10);

export async function eventsScreen(ctx: Ctx): Promise<HTMLElement> {
  const events = await ctx.api.listEvents();
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today() })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const f = new FormData(form);
    try {
      const ev = await ctx.api.createEvent({ name: String(f.get('name')), startsOn: String(f.get('date') ?? '') || undefined });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  });
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'STEM Racing India National Finals'), h('h1', null, 'Events'),
      h('p', { class: 'lead' }, 'Judging, racing and results for each event, in one place.')),
    h('section', { class: 'section' },
      events.length === 0
        ? h('p', { class: 'muted' }, 'No events yet. Create one, or ask an organiser to invite you.')
        : h('ul', { class: 'list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, e.startsOn ?? ''), e.resultsReleased ? h('span', { class: 'tag tag--pass' }, 'Results released') : null)))),
    h('section', { class: 'section' }, h('h2', null, 'New event'), error, form),
  );
}
```

`src/ui/demo.ts`:

```ts
import type { MemoryApi } from '../api';

export const DEMO_PERSONAS = [
  { email: 'organiser@demo.test', label: 'Organiser' },
  { email: 'chair@demo.test', label: 'Chair of Judges' },
  { email: 'judge-verbal@demo.test', label: 'Judge: Verbal Presentation' },
  { email: 'judge-design@demo.test', label: 'Judge: Design & Engineering' },
  { email: 'team1@demo.test', label: 'Team manager: Sample team 1' },
] as const;

/** Fills the in-memory backend with clearly labelled sample data. Leaves the session signed in as the organiser. */
export async function seedDemo(api: MemoryApi): Promise<string> {
  await api.signIn('organiser@demo.test');
  const ev = await api.createEvent({ name: 'Sample event (demo data)', startsOn: new Date().toISOString().slice(0, 10) });
  const teams = [];
  for (const n of [1, 2, 3]) teams.push(await api.createTeam(ev.id, { number: String(n), name: `Sample team ${n}`, school: 'Sample school' }));
  await api.invite(ev.id, { email: 'chair@demo.test', role: 'chair' });
  await api.invite(ev.id, { email: 'judge-verbal@demo.test', role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: 'judge-design@demo.test', role: 'judge', panel: 'design_engineering' });
  await api.invite(ev.id, { email: 'team1@demo.test', role: 'team_manager', teamId: teams[0].id });
  for (const p of DEMO_PERSONAS.slice(1)) {
    await api.signIn(p.email);
    await api.claimInvitations();
  }
  await api.signIn('organiser@demo.test');
  return ev.id;
}
```

- [ ] **Step 6: Add the platform styles**

`src/styles/platform.css`:

```css
/* Layout for the event platform, on top of the brand components. */
[hidden] { display: none !important; }
.notice { padding: 12px 16px; border: 2px solid var(--fg-muted); border-radius: var(--radius-button); color: var(--fg-strong); }
.table-wrap { overflow-x: auto; }
.table { border-collapse: collapse; width: 100%; font-size: 15px; }
.table th, .table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
.table th { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-muted); font-weight: 500; }
.table .num { text-align: right; font-variant-numeric: tabular-nums; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px; }
.tile { display: flex; flex-direction: column; gap: 8px; padding: 20px; min-height: 120px; border: 1px solid var(--carbon-800); border-radius: var(--radius-card); background: var(--bg-raised); color: inherit; text-decoration: none; }
.tile:hover { border-color: var(--fg-strong); }
.demo-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px var(--gutter); background: var(--ignite-indigo); color: var(--white); font-size: 14px; }
.demo-bar select { min-height: 44px; background: var(--carbon-shadow); color: var(--white); border: 2px solid var(--white); border-radius: var(--radius-button); padding: 4px 8px; font: inherit; }
.field textarea { min-height: 72px; width: 100%; padding: 8px 12px; border: 2px solid var(--carbon-500); border-radius: var(--radius-button); background: var(--carbon-shadow); color: var(--fg-strong); font: inherit; font-size: 16px; resize: vertical; }
.field select { min-height: 48px; }
.bands { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--fg-muted); }
.bands [aria-current="true"] { color: var(--fg-strong); font-weight: 700; text-decoration: underline; text-decoration-color: var(--pitlane-pink); text-underline-offset: .22em; }
.inline-form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.who { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.linkish { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; text-decoration-color: var(--pitlane-pink); cursor: pointer; min-height: 44px; }
```

- [ ] **Step 7: Replace main.ts**

`src/main.ts`:

```ts
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import './styles/platform.css';
import { MemoryApi, ScoreQueue, createSupabaseApi, localStorageKV, memoryKV, type Api } from './api';
import { notFound } from './ui/common';
import type { Ctx } from './ui/ctx';
import { DEMO_PERSONAS, seedDemo } from './ui/demo';
import { h } from './ui/dom';
import { eventsScreen } from './ui/events';
import { loginScreen } from './ui/login';
import { startRouter, type Route } from './ui/router';
import { mountShell } from './ui/shell';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const demo = !(url && key);

async function boot(): Promise<void> {
  const shell = mountShell(document.getElementById('app')!);
  const api: Api = demo ? new MemoryApi() : createSupabaseApi(url!, key!);
  if (demo) await seedDemo(api as MemoryApi);

  const queue = new ScoreQueue(api, demo ? memoryKV() : localStorageKV('stem-racing-india-score-queue'));
  window.addEventListener('online', () => void queue.flush());
  void queue.flush();

  let current: Route = { name: 'home' };
  let token = 0;
  let leaves: Array<() => void> = [];
  const ctx: Ctx = {
    api, queue, main: shell.main, demo,
    rerender: () => void render(current),
    onLeave: (fn) => { leaves.push(fn); },
  };

  if (demo) {
    shell.demoBar.hidden = false;
    const select = h('select', { 'aria-label': 'Demo persona' },
      DEMO_PERSONAS.map((p) => h('option', { value: p.email }, p.label)));
    select.addEventListener('change', async () => {
      await api.signIn(select.value);
      await api.claimInvitations();
      location.hash = '#/';
      ctx.rerender();
    });
    shell.demoBar.replaceChildren(h('strong', null, 'Demo mode'), 'Sample data in memory, not saved. View as:', select);
  }

  const signOut = async () => { await api.signOut(); location.hash = '#/'; ctx.rerender(); };

  async function render(route: Route): Promise<void> {
    current = route;
    const mine = ++token;
    leaves.forEach((fn) => fn());
    leaves = [];
    try {
      const session = await api.getSession();
      shell.setUser(session, () => void signOut());
      if (session) await api.claimInvitations().catch(() => 0);
      let node: HTMLElement;
      if (!session && route.name !== 'results') node = loginScreen(ctx);
      else node = await screenFor(route, ctx);
      if (mine !== token) return;
      shell.main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch {
      if (mine !== token) return;
      shell.main.replaceChildren(h('h1', null, 'Something went wrong'), h('p', { class: 'alert', role: 'alert' }, 'Could not load this screen. Go back and try again.'), h('a', { href: '#/' }, 'Back to events'));
    }
  }

  api.onAuthChange(() => void render(current));
  startRouter((route) => void render(route));
}

/** Later tasks add one case per screen. */
async function screenFor(route: Route, ctx: Ctx): Promise<HTMLElement> {
  switch (route.name) {
    case 'home': return eventsScreen(ctx);
    default: return notFound('This screen is not built yet.', '#/', 'Back to events');
  }
}

void boot();
```

Add to `src/api/index.ts` (if not already): `export { createSupabaseApi } from './supabase';`.

- [ ] **Step 8: Run to verify pass, then check in the browser**

Run: `npx vitest run tests/ui && npx tsc --noEmit && npm run dev`
Expected: all UI tests PASS. In the browser at the dev URL (demo mode, no `.env`): the demo bar shows, the page shows "Sample event (demo data)" in the events list for the Organiser, the header shows the logo and email with a Sign out button, and every control has the gold focus ring. Switching the persona to "Judge: Verbal Presentation" re-renders the list.

- [ ] **Step 9: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): router, shell, sign-in, events list and app boot with demo mode" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Event home, teams and people screens

**Files:**
- Create: `platform/src/ui/event-home.ts`, `teams.ts`, `people.ts`
- Modify: `platform/src/main.ts` (add cases to `screenFor`)
- Test: `platform/tests/ui/event-home.test.ts`, `teams.test.ts`, `people.test.ts`

**Interfaces:**
- Consumes: Task 11 (`Ctx`, `h`, `routeHref`, `tag`, `notFound`, `errorText`, labels) and `Api`.
- Produces (exact): `eventHomeScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`, `teamsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`, `peopleScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/event-home.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { eventHomeScreen } from '../../src/ui/event-home';
import { EMAILS, makeCtx, text, world } from './helpers';

const tiles = async (email: string | null) => {
  const { api, ev } = await world();
  if (email) await api.signIn(email); else await api.signOut();
  const { ctx } = makeCtx(api);
  const el = await eventHomeScreen(ctx, ev.id);
  return [...el.querySelectorAll('a.tile')].map((a) => text(a.querySelector('h3')!));
};

describe('eventHomeScreen', () => {
  it('shows each role the tiles it can use', async () => {
    expect(await tiles(EMAILS.org)).toEqual(['Teams', 'People', 'Rankings', 'Results']);
    expect(await tiles(EMAILS.chair)).toEqual(['Teams', 'People', 'Moderation', 'Rankings', 'Results']);
    expect(await tiles(EMAILS.judge)).toEqual(['My scorecards', 'Results']);
    expect(await tiles(EMAILS.lead)).toEqual(['Moderation', 'Results']);
    expect(await tiles(EMAILS.mgr)).toEqual(['Results']);
  });

  it('shows the public only the results tile for a released event, and nothing for an unreleased one', async () => {
    const { api, ev } = await world();
    const { ctx } = makeCtx(api);
    await api.signOut();
    expect(text(await eventHomeScreen(ctx, ev.id))).toContain('not found');
    await api.signIn(EMAILS.chair);
    await api.setReleased(ev.id, true);
    await api.signOut();
    const el = await eventHomeScreen(ctx, ev.id);
    expect([...el.querySelectorAll('a.tile h3')].map(text)).toEqual(['Results']);
    expect(text(el)).toContain('Nationals');
  });

  it('names the person roles for this event', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    expect(text(await eventHomeScreen(ctx, ev.id))).toContain('Judge: Verbal Presentation');
  });
});
```

`tests/ui/teams.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { teamsScreen } from '../../src/ui/teams';
import { EMAILS, makeCtx, text, world } from './helpers';

const add = async (el: HTMLElement, number: string, name: string, school = '') => {
  const form = el.querySelector('form')!;
  (form.querySelector('input[name=number]') as HTMLInputElement).value = number;
  (form.querySelector('input[name=name]') as HTMLInputElement).value = name;
  (form.querySelector('input[name=school]') as HTMLInputElement).value = school;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
};

describe('teamsScreen', () => {
  it('lists teams in natural number order', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.createTeam(ev.id, { number: '10', name: 'Ten' });
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    expect([...el.querySelectorAll('.list li strong')].map(text)).toEqual(['Team 1 · One', 'Team 2 · Two', 'Team 10 · Ten']);
  });

  it('adds a team and shows it, keeping hostile text as text', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '7', '<img src=x onerror=alert(1)> 🚗', "O'Brien");
    expect(el.querySelector('img')).toBeNull();
    expect(text(el)).toContain('Team 7 · <img src=x onerror=alert(1)> 🚗');
    expect(text(el)).toContain("O'Brien");
  });

  it('shows duplicate numbers as a readable message and keeps the list unchanged', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, ' 1 ', 'Again');
    expect(text(el.querySelector('[role=alert]')!)).toContain('already used');
    expect(el.querySelectorAll('.list li')).toHaveLength(2);
  });

  it('gives judges and team managers the list without the form', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelectorAll('.list li')).toHaveLength(2);
    await api.signIn(EMAILS.mgr);
    expect((await teamsScreen(ctx, ev.id)).querySelectorAll('.list li')).toHaveLength(1);
  });
});
```

`tests/ui/people.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { peopleScreen } from '../../src/ui/people';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));
const pick = (el: HTMLElement, name: string, value: string) => {
  const s = el.querySelector(`[name=${name}]`) as HTMLSelectElement | HTMLInputElement;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('peopleScreen', () => {
  it('lists the roles with email, role and panel or team', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('judge@x.test');
    expect(t).toContain('Judge');
    expect(t).toContain('Verbal Presentation');
    expect(t).toContain('Team 1');
  });

  it('shows the panel choice only for judge roles and the team choice only for team managers', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    const panel = el.querySelector('[data-field=panel]') as HTMLElement;
    const team = el.querySelector('[data-field=team]') as HTMLElement;
    pick(el, 'role', 'chair');
    expect([panel.hidden, team.hidden]).toEqual([true, true]);
    pick(el, 'role', 'judge');
    expect([panel.hidden, team.hidden]).toEqual([false, true]);
    pick(el, 'role', 'team_manager');
    expect([panel.hidden, team.hidden]).toEqual([true, false]);
  });

  it('invites someone, shows the pending invitation, and lets it be withdrawn', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'judge');
    pick(el, 'panel', 'enterprise');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'New@X.test';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(text(el)).toContain('new@x.test');
    expect(text(el.querySelector('[data-section=invitations]')!)).toContain('Enterprise');
    (el.querySelector('[data-section=invitations] button') as HTMLButtonElement).click();
    await wait();
    expect(el.querySelector('[data-section=invitations] li')).toBeNull();
  });

  it('explains invalid or duplicate invitations', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'nope';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('valid email');
  });

  it('is not available to a judge', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    expect(text(await peopleScreen(ctx, ev.id))).toContain('Only the organiser or chair');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/event-home.test.ts tests/ui/teams.test.ts tests/ui/people.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the event home**

`src/ui/event-home.ts`:

```ts
import type { Role } from '../api';
import type { Ctx } from './ctx';
import { notFound } from './common';
import { h } from './dom';
import { PANEL_LABEL, ROLE_LABEL } from './labels';
import { routeHref, type Route } from './router';

export async function eventHomeScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found, or its results have not been released.', '#/', 'All events');
  const has = (...r: Role[]) => roles.some((x) => r.includes(x.role));

  const tile = (title: string, body: string, route: Route) =>
    h('a', { class: 'tile', href: routeHref(route) }, h('h3', null, title), h('p', { class: 'muted' }, body));

  const tiles: HTMLElement[] = [];
  if (has('organiser', 'chair')) tiles.push(tile('Teams', 'Add and review the teams entered.', { name: 'teams', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('People', 'Invite judges, officials and team managers.', { name: 'people', eventId }));
  if (has('judge')) tiles.push(tile('My scorecards', 'Score the teams in your panel.', { name: 'score', eventId }));
  if (has('chair', 'lead_judge')) tiles.push(tile('Moderation', 'Review judges\' scores, override and reopen.', { name: 'moderate', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('Rankings', 'Combine scores, add penalties, publish and release.', { name: 'rankings', eventId }));
  tiles.push(tile('Results', event.resultsReleased ? 'Released results.' : 'Not released yet.', { name: 'results', eventId }));

  const mine = roles.map((r) => (r.panel ? `${ROLE_LABEL[r.role]}: ${PANEL_LABEL[r.panel]}` : ROLE_LABEL[r.role]));
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, 'All events'),
      h('p', { class: 'eyebrow' }, [event.startsOn, event.resultsReleased ? 'Results released' : null].filter(Boolean).join(' · ')),
      h('h1', null, event.name),
      mine.length > 0 ? h('p', { class: 'lead' }, `You are: ${mine.join('; ')}`) : null,
    ),
    h('div', { class: 'tiles' }, tiles),
  );
}
```

- [ ] **Step 4: Implement teams and people**

`src/ui/teams.ts`:

```ts
import type { Ctx } from './ctx';
import { errorText, notFound } from './common';
import { h } from './dom';

export async function teamsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const canEdit = roles.some((r) => r.role === 'organiser' || r.role === 'chair');

  const listHolder = h('div');
  const showTeams = async () => {
    const teams = (await ctx.api.listTeams(eventId)).sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    listHolder.replaceChildren(
      teams.length === 0
        ? h('p', { class: 'muted' }, 'No teams yet.')
        : h('ul', { class: 'list' }, teams.map((t) => h('li', null, h('strong', null, `Team ${t.number} · ${t.name}`), t.school ? h('span', { class: 'muted small' }, t.school) : null))),
    );
  };
  await showTeams();

  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  let form: HTMLFormElement | null = null;
  if (canEdit) {
    form = h('form', { class: 'form', novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team number'), h('input', { name: 'number', required: true, maxlength: 12, autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team name'), h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'School or club (optional)'), h('input', { name: 'school', maxlength: 120, autocomplete: 'off' })),
      h('button', { class: 'btn btn--primary', type: 'submit' }, 'Add team'),
    );
    const f = form;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const data = new FormData(f);
      try {
        await ctx.api.createTeam(eventId, { number: String(data.get('number')), name: String(data.get('name')), school: String(data.get('school')) });
        f.reset();
        await showTeams();
      } catch (err) {
        error.textContent = errorText(err);
        error.hidden = false;
      }
    });
  }

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: `#/event/${encodeURIComponent(eventId)}` }, event.name), h('h1', null, 'Teams')),
    h('section', { class: 'section' }, listHolder),
    form ? h('section', { class: 'section' }, h('h2', null, 'Add a team'), error, form) : null,
  );
}
```

`src/ui/people.ts`:

```ts
import type { Panel, Role } from '../api';
import type { Ctx } from './ctx';
import { errorText, notFound } from './common';
import { h } from './dom';
import { INVITABLE, PANEL_LABEL, ROLE_LABEL } from './labels';

const PANELS = Object.keys(PANEL_LABEL) as Panel[];

export async function peopleScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  if (!roles.some((r) => r.role === 'organiser' || r.role === 'chair')) {
    return notFound('Only the organiser or chair can manage people.', `#/event/${encodeURIComponent(eventId)}`, event.name);
  }
  const teams = await ctx.api.listTeams(eventId);
  const teamLabel = (id: string | null) => {
    const t = teams.find((x) => x.id === id);
    return t ? `Team ${t.number} · ${t.name}` : '';
  };

  const peopleHolder = h('div', { 'data-section': 'people' });
  const inviteHolder = h('div', { 'data-section': 'invitations' });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const fail = (e: unknown) => { error.textContent = errorText(e); error.hidden = false; };

  const describe = (x: { role: Role; panel: Panel | null; teamId: string | null }) =>
    [ROLE_LABEL[x.role], x.panel ? PANEL_LABEL[x.panel] : '', teamLabel(x.teamId)].filter(Boolean).join(' · ');

  const refresh = async () => {
    const [allRoles, invites] = await Promise.all([ctx.api.listRoles(eventId), ctx.api.listInvitations(eventId)]);
    peopleHolder.replaceChildren(
      h('h2', null, 'People'),
      h('ul', { class: 'list' }, allRoles.map((r) => h('li', null,
        h('strong', null, r.email ?? r.userId), h('span', { class: 'muted small' }, describe(r)),
        r.role === 'organiser' ? null : h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: async () => { try { await ctx.api.removeRole(r.id); await refresh(); } catch (e) { fail(e); } } }, 'Remove')))),
    );
    inviteHolder.replaceChildren(
      h('h2', null, 'Invitations waiting'),
      invites.length === 0 ? h('p', { class: 'muted' }, 'No pending invitations.')
        : h('ul', { class: 'list' }, invites.map((i) => h('li', null,
            h('strong', null, i.email), h('span', { class: 'muted small' }, describe(i)),
            h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: async () => { try { await ctx.api.removeInvitation(i.id); await refresh(); } catch (e) { fail(e); } } }, 'Withdraw')))),
    );
  };
  await refresh();

  const roleSelect = h('select', { name: 'role' }, INVITABLE.map((r) => h('option', { value: r }, ROLE_LABEL[r])));
  const panelSelect = h('select', { name: 'panel' }, PANELS.map((p) => h('option', { value: p }, PANEL_LABEL[p])));
  const teamSelect = h('select', { name: 'team' }, teams.map((t) => h('option', { value: t.id }, `Team ${t.number} · ${t.name}`)));
  const panelField = h('label', { class: 'field', 'data-field': 'panel', hidden: true }, h('span', { class: 'field__label' }, 'Panel'), panelSelect);
  const teamField = h('label', { class: 'field', 'data-field': 'team', hidden: true }, h('span', { class: 'field__label' }, 'Team'), teamSelect);
  const sync = () => {
    panelField.hidden = !(roleSelect.value === 'judge' || roleSelect.value === 'lead_judge');
    teamField.hidden = roleSelect.value !== 'team_manager';
  };
  roleSelect.addEventListener('change', sync);
  roleSelect.value = 'chair';
  sync();

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Role'), roleSelect),
    panelField, teamField,
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send invitation'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const role = roleSelect.value as Role;
    try {
      await ctx.api.invite(eventId, {
        email: (form.querySelector('input[name=email]') as HTMLInputElement).value,
        role,
        panel: role === 'judge' || role === 'lead_judge' ? (panelSelect.value as Panel) : undefined,
        teamId: role === 'team_manager' ? teamSelect.value : undefined,
      });
      (form.querySelector('input[name=email]') as HTMLInputElement).value = '';
      await refresh();
    } catch (err) {
      fail(err);
    }
  });

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: `#/event/${encodeURIComponent(eventId)}` }, event.name), h('h1', null, 'People'),
      h('p', { class: 'lead' }, 'Invited people sign in with the email address you enter here and get their role automatically.')),
    error,
    h('section', { class: 'section' }, h('h2', null, 'Invite someone'), form),
    h('section', { class: 'section' }, peopleHolder),
    h('section', { class: 'section' }, inviteHolder),
  );
}
```

- [ ] **Step 5: Wire the routes**

In `src/main.ts` import `eventHomeScreen`, `teamsScreen`, `peopleScreen` and add to `screenFor`:

```ts
    case 'event': return eventHomeScreen(ctx, route.eventId);
    case 'teams': return teamsScreen(ctx, route.eventId);
    case 'people': return peopleScreen(ctx, route.eventId);
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/ui && npx tsc --noEmit`
Expected: PASS. If the event-home tile order test fails, keep the order used in the implementation (Teams, People, My scorecards, Moderation, Rankings, Results) and align the expectations in the test with it: for the chair that order is Teams, People, Moderation, Rankings, Results, as asserted.

- [ ] **Step 7: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): event home, teams and people screens with role-aware tiles" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Judge screens (scorecard worklist and the scorecard form)

**Files:**
- Create: `platform/src/ui/scoring.ts`, `platform/src/ui/scorecard.ts`
- Modify: `platform/src/main.ts` (add `score` and `scorecard` cases)
- Test: `platform/tests/ui/scoring.test.ts`, `platform/tests/ui/scorecard.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `Api`, `ScoreQueue`, `validateScores`, `areaTotal`, `bandIndex`, labels, `tag`, `notFound`, `errorText`.
- Produces (exact):
  - `type ParsedScore = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad'; message: string }`
  - `parseScore(text: string, max: number): ParsedScore`
  - `scoringScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`
  - `scorecardScreen(ctx: Ctx, eventId: string, teamId: string, areaId: string): Promise<HTMLElement>`
  - Accessible names: score inputs `"<criterion name> (0 to <max>)"`, comment boxes `"<criterion name> comment"`, submit button text `Submit scorecard`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/scorecard.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { parseScore, scorecardScreen } from '../../src/ui/scorecard';
import { EMAILS, makeCtx, text, world } from './helpers';

const ENGAGE = 'Engagement & Presentation Dynamics';
const TEAM = 'Team Contribution';
const input = (el: HTMLElement, name: string) => el.querySelector(`input[aria-label="${name} (0 to 20)"]`) as HTMLInputElement;
const type = (i: HTMLInputElement | HTMLTextAreaElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const submitBtn = (el: HTMLElement) => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Submit scorecard') as HTMLButtonElement | undefined;
const open = async () => {
  const { api, ev, t1, t2 } = await world();
  await api.signIn(EMAILS.judge);
  return { api, ev, t1, t2 };
};

describe('parseScore', () => {
  it('accepts whole numbers up to the maximum', () => {
    expect(parseScore('0', 20)).toEqual({ kind: 'ok', value: 0 });
    expect(parseScore(' 20 ', 20)).toEqual({ kind: 'ok', value: 20 });
    expect(parseScore('', 20)).toEqual({ kind: 'empty' });
    expect(parseScore('   ', 20)).toEqual({ kind: 'empty' });
  });
  it('rejects everything else with a readable message', () => {
    for (const bad of ['21', '4.5', '-1', 'abc', '1e1', '7x', '٣', '١٠']) {
      const p = parseScore(bad, 20);
      expect(p.kind, bad).toBe('bad');
    }
    expect(parseScore('21', 20)).toEqual({ kind: 'bad', message: 'Scores go from 0 to 20' });
    expect(parseScore('4.5', 15)).toEqual({ kind: 'bad', message: 'Enter a whole number from 0 to 15' });
  });
});

describe('scorecardScreen', () => {
  it('shows each criterion with its bands and a disabled submit button', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(text(el)).toContain('Verbal Presentation: Technique');
    expect(text(el)).toContain('Team 1 · One');
    expect(input(el, ENGAGE)).not.toBeNull();
    expect(text(el.querySelector('.bands')!)).toContain('0–5');
    expect(text(el.querySelector('.bands')!)).toContain('16–20');
    expect(submitBtn(el)!.disabled).toBe(true);
    expect(text(el)).toContain('0 / 40');
  });

  it('flags scores outside the range or not whole numbers, and never sends them', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    const i = input(el, ENGAGE);
    for (const bad of ['21', '4.5', '-1', 'abc', '1e1']) {
      type(i, bad);
      expect(i.getAttribute('aria-invalid'), bad).toBe('true');
    }
    expect(text(el)).toContain('Enter a whole number from 0 to 20');
    type(i, '21');
    expect(text(el)).toContain('Scores go from 0 to 20');
    await ctx.queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({});
    type(i, '');
    expect(i.getAttribute('aria-invalid')).toBe('false');
  });

  it('saves a valid score, shows the band it falls in, and updates the running total', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await ctx.queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({ 'engagement-presentation-dynamics': 14 });
    expect(text(el.querySelector('.bands [aria-current="true"]')!)).toBe('11–15');
    expect(text(el)).toContain('14 / 40');
    expect(text(el.querySelector('[role=status]')!)).toContain('All changes saved');
  });

  it('keeps the comment with the score', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, TEAM), '12');
    type(el.querySelector(`textarea[aria-label="${TEAM} comment"]`) as HTMLTextAreaElement, 'Clear roles');
    await ctx.queue.flush();
    expect((await api.listCards(ev.id))[0].comments[ 'team-contribution' ]).toBe('Clear roles');
  });

  it('submits once every criterion is scored, then shows a locked card', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    expect(submitBtn(el)!.disabled).toBe(true);
    type(input(el, TEAM), '12');
    await ctx.queue.flush();
    expect(submitBtn(el)!.disabled).toBe(false);
    submitBtn(el)!.click();
    await vi.waitFor(async () => expect((await api.listCards(ev.id))[0].status).toBe('submitted'));
    expect(ctx.rerender).toHaveBeenCalled();

    const locked = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(input(locked, ENGAGE).disabled).toBe(true);
    expect(input(locked, ENGAGE).value).toBe('14');
    expect(submitBtn(locked)).toBeUndefined();
    expect(text(locked)).toContain('Only the Chair can reopen');
  });

  it('keeps unsaved scores visible and blocks submit while offline', async () => {
    const { api, ev, t1 } = await open();
    const offline = { saveScore: async () => { throw new ApiError('network', 'No connection to the server'); } };
    const { ctx } = makeCtx(api, offline);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    type(input(el, TEAM), '12');
    await ctx.queue.flush();
    expect(text(el.querySelector('[role=status]')!)).toMatch(/Offline: 2 changes will save/);
    expect(submitBtn(el)!.disabled).toBe(true);
    expect((await api.listCards(ev.id))[0].scores).toEqual({});
  });

  it('restores queued scores after a reload', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    ctx.queue.enqueue({ cardId: card.id, criterionId: 'team-contribution', score: 9, comment: 'queued' });
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(input(el, TEAM).value).toBe('9');
    expect((el.querySelector(`textarea[aria-label="${TEAM} comment"]`) as HTMLTextAreaElement).value).toBe('queued');
  });

  it('tells the judge when an edit was refused because the card was submitted elsewhere', async () => {
    const { api, ev, t1 } = await open();
    const locked = { saveScore: async () => { throw new ApiError('locked', 'This scorecard has been submitted'); } };
    const { ctx } = makeCtx(api, locked);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await ctx.queue.flush();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('submitted or reopened elsewhere');
  });

  it('refuses a conflicted team, another panel and an unknown area with a clear message', async () => {
    const { api, ev, t1, t2 } = await open();
    const { ctx } = makeCtx(api);
    await api.declareConflict(ev.id, t2.id);
    expect(text(await scorecardScreen(ctx, ev.id, t2.id, 'verbal-technique'))).toContain('conflict of interest');
    expect(text(await scorecardScreen(ctx, ev.id, t1.id, 'de-portfolio'))).toContain('do not judge this panel');
    expect(text(await scorecardScreen(ctx, ev.id, t1.id, 'knockout'))).toContain('not found');
  });
});
```

`tests/ui/scoring.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scoringScreen } from '../../src/ui/scoring';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));

describe('scoringScreen', () => {
  it('lists every team with the areas of the judge panel, linking to each scorecard', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).toContain('Verbal Presentation');
    const links = [...el.querySelectorAll('a.btn')].map((a) => a.getAttribute('href'));
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-technique`);
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-composition`);
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-subject`);
    expect(links).toHaveLength(6);
    expect(text(el)).not.toContain('Design & Engineering');
  });

  it('shows the state of each card in words', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 12);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).toContain('Draft');
    expect(text(el)).toContain('Not started');
  });

  it('lets a judge declare a conflict in two steps and then hides that team', async () => {
    const { api, ev, t2 } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    const btn = () => [...el.querySelectorAll('button')].filter((b) => /conflict|Confirm/.test(b.textContent ?? ''));
    expect(btn()).toHaveLength(2);
    btn()[1].click();
    expect(text(btn()[1])).toContain('Confirm');
    expect(await api.myConflicts(ev.id)).toEqual([]);
    btn()[1].click();
    await wait();
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
    expect(text(el)).toContain('You declared a conflict');
    expect([...el.querySelectorAll('a.btn')]).toHaveLength(3);
  });

  it('says so when the person does not score any panel', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.lead);
    const { ctx } = makeCtx(api);
    expect(text(await scoringScreen(ctx, ev.id))).toContain('not a judge on any panel');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/scoring.test.ts tests/ui/scorecard.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the scorecard form**

`src/ui/scorecard.ts`:

```ts
import type { CardRow } from '../api';
import { areaTotal, bandIndex, validateScores, type Criterion } from '../engine';
import type { Ctx } from './ctx';
import { errorText, notFound } from './common';
import { h } from './dom';
import { routeHref } from './router';

export type ParsedScore = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad'; message: string };

export function parseScore(input: string, max: number): ParsedScore {
  const t = input.trim();
  if (t === '') return { kind: 'empty' };
  if (!/^[0-9]+$/.test(t)) return { kind: 'bad', message: `Enter a whole number from 0 to ${max}` };
  const n = Number(t);
  if (n > max) return { kind: 'bad', message: `Scores go from 0 to ${max}` };
  return { kind: 'ok', value: n };
}

export async function scorecardScreen(ctx: Ctx, eventId: string, teamId: string, areaId: string): Promise<HTMLElement> {
  const [event, teams] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.listTeams(eventId)]);
  const area = event?.ruleset.areas.find((a) => a.id === areaId && a.kind === 'scorecard');
  const team = teams.find((t) => t.id === teamId);
  const back = routeHref({ name: 'score', eventId });
  if (!event || !area || !team) return notFound('That scorecard was not found.', back, 'Back to my scorecards');

  let card: CardRow;
  try {
    card = await ctx.api.openCard(eventId, teamId, areaId);
  } catch (e) {
    return notFound(errorText(e), back, 'Back to my scorecards');
  }

  const locked = card.status === 'submitted';
  const values: Record<string, number> = { ...card.scores };
  const comments: Record<string, string> = { ...card.comments };
  for (const q of ctx.queue.pendingFor(card.id)) {
    values[q.criterionId] = q.score;
    comments[q.criterionId] = q.comment;
  }

  const status = h('p', { class: 'small', role: 'status' });
  const alertBox = h('p', { class: 'alert', role: 'alert', hidden: true });
  const total = h('strong', null);
  const submit = h('button', { class: 'btn btn--primary', type: 'button' }, 'Submit scorecard');
  const blocks: { c: Criterion; bands: HTMLElement }[] = [];
  let statusNote = '';

  const refresh = () => {
    total.textContent = `${areaTotal(area, values)} / ${area.max}`;
    for (const b of blocks) {
      const v = values[b.c.id];
      [...b.bands.children].forEach((span, i) => span.setAttribute('aria-current', String(v !== undefined && bandIndex(b.c, v) === i)));
    }
    const pending = ctx.queue.pendingFor(card.id).length;
    const complete = validateScores(area, values, { complete: true }).length === 0;
    submit.disabled = locked || !complete || pending > 0;
    if (locked) status.textContent = '';
    else if (statusNote) status.textContent = statusNote;
    else status.textContent = pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} waiting to save` : 'All changes saved';
  };

  const queueScore = (c: Criterion) => {
    ctx.queue.enqueue({ cardId: card.id, criterionId: c.id, score: values[c.id], comment: comments[c.id] ?? '' });
    void ctx.queue.flush();
  };

  const criterionBlock = (c: Criterion) => {
    const input = h('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${c.name} (0 to ${c.max})`, 'aria-invalid': 'false',
      disabled: locked, value: values[c.id] === undefined ? '' : String(values[c.id]),
    });
    const err = h('p', { class: 'field__error', role: 'alert', hidden: true });
    const comment = h('textarea', { 'aria-label': `${c.name} comment`, maxlength: 1000, rows: 2, disabled: locked });
    comment.value = comments[c.id] ?? '';
    const bands = h('div', { class: 'bands' }, c.bands.map((b) => h('span', { 'aria-current': 'false' }, `${b.min}–${b.max}`)));
    blocks.push({ c, bands });

    input.addEventListener('input', () => {
      statusNote = '';
      const p = parseScore(input.value, c.max);
      err.hidden = p.kind !== 'bad';
      err.textContent = p.kind === 'bad' ? p.message : '';
      input.setAttribute('aria-invalid', String(p.kind === 'bad'));
      if (p.kind === 'ok') {
        values[c.id] = p.value;
        queueScore(c);
      } else {
        delete values[c.id];
      }
      refresh();
    });
    comment.addEventListener('input', () => {
      comments[c.id] = comment.value;
      if (values[c.id] !== undefined) queueScore(c);
    });

    return h('section', { class: 'row' },
      h('div', { class: 'row__head' }, h('h3', null, c.name), h('span', { class: 'small muted' }, `0 to ${c.max}`)),
      bands,
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Score'), input),
      err,
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Comment (optional)'), comment),
    );
  };

  const unsubscribe = ctx.queue.subscribe((e) => {
    if (e.kind === 'dropped') {
      if (e.item.cardId !== card.id) return;
      alertBox.textContent = e.reason;
      alertBox.hidden = false;
    } else if (e.kind === 'offline') {
      statusNote = `Offline: ${e.pending} change${e.pending === 1 ? '' : 's'} will save when you reconnect`;
    } else {
      statusNote = '';
    }
    refresh();
  });
  ctx.onLeave(unsubscribe);

  submit.addEventListener('click', async () => {
    alertBox.hidden = true;
    submit.disabled = true;
    try {
      await ctx.queue.flush();
      if (ctx.queue.pendingFor(card.id).length > 0) {
        alertBox.textContent = 'Some scores have not reached the server yet. Wait for a connection, then submit.';
        alertBox.hidden = false;
        refresh();
        return;
      }
      await ctx.api.submitCard(card.id);
      ctx.rerender();
    } catch (e) {
      alertBox.textContent = errorText(e);
      alertBox.hidden = false;
      refresh();
    }
  });

  const screen = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: back }, 'My scorecards'),
      h('p', { class: 'eyebrow' }, event.name),
      h('h1', null, area.name),
      h('p', { class: 'lead' }, `Team ${team.number} · ${team.name}`),
      locked ? h('p', { class: 'notice' }, 'Submitted. Only the Chair can reopen this scorecard.') : null,
    ),
    alertBox,
    ...area.criteria.map(criterionBlock),
    h('div', { class: 'stack' }, h('p', null, 'Total: ', total), status, locked ? null : submit),
  );
  refresh();
  return screen;
}
```

- [ ] **Step 4: Implement the worklist**

`src/ui/scoring.ts`:

```ts
import type { CardRow, Panel } from '../api';
import type { Ctx } from './ctx';
import { errorText, notFound, tag } from './common';
import { h } from './dom';
import { PANEL_LABEL } from './labels';
import { routeHref } from './router';

export async function scoringScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, teams, cards, conflictList] = await Promise.all([
    ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.myConflicts(eventId),
  ]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const panels = [...new Set(roles.filter((r) => r.role === 'judge' && r.panel).map((r) => r.panel as Panel))];
  if (panels.length === 0) return notFound('You are not a judge on any panel for this event.', eventHref, event.name);

  const conflicts = new Set(conflictList);
  const myCards: CardRow[] = cards;
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const body = h('div', { class: 'stack stack--lg' });

  const stateTag = (teamId: string, areaId: string) => {
    const c = myCards.find((x) => x.teamId === teamId && x.areaId === areaId);
    if (!c) return tag('Not started', 'todo');
    return c.status === 'submitted' ? tag('Submitted', 'pass') : tag('Draft', 'risk');
  };

  const render = () => {
    body.replaceChildren(
      ...panels.map((panel) => {
        const areas = event.ruleset.areas.filter((a) => a.kind === 'scorecard' && a.panel === panel);
        return h('section', { class: 'section' },
          h('h2', null, PANEL_LABEL[panel]),
          h('div', { class: 'grid' }, teams.map((t) => {
            const conflicted = conflicts.has(t.id);
            let armed = false;
            const declare = h('button', { class: 'linkish', type: 'button' }, 'I have a conflict with this team');
            declare.addEventListener('click', async () => {
              if (!armed) {
                armed = true;
                declare.textContent = 'Confirm: I cannot judge this team';
                return;
              }
              try {
                await ctx.api.declareConflict(eventId, t.id);
                conflicts.add(t.id);
                render();
              } catch (e) {
                error.textContent = errorText(e);
                error.hidden = false;
              }
            });
            return h('article', { class: 'card' },
              h('h3', null, `Team ${t.number} · ${t.name}`),
              conflicted
                ? h('p', { class: 'small' }, 'You declared a conflict of interest with this team. Ask the Chair if this was a mistake.')
                : h('div', { class: 'stack' },
                    ...areas.map((a) => h('a', { class: 'btn btn--ghost btn--small', href: routeHref({ name: 'scorecard', eventId, teamId: t.id, areaId: a.id }) }, a.name, ' ', stateTag(t.id, a.id))),
                    declare),
            );
          })),
        );
      }),
    );
  };
  render();

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, event.name), h('h1', null, 'My scorecards'),
      h('p', { class: 'lead' }, 'Choose a team and an area. Scores save as you type and can be edited until you submit.')),
    error, body,
  );
}
```

- [ ] **Step 5: Wire the routes**

In `src/main.ts` import both screens and add to `screenFor`:

```ts
    case 'score': return scoringScreen(ctx, route.eventId);
    case 'scorecard': return scorecardScreen(ctx, route.eventId, route.teamId, route.areaId);
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/ui && npx tsc --noEmit`
Expected: PASS. Checks on likely snags: (a) the worklist expects 6 `a.btn` links for 2 teams × 3 verbal areas and, after one conflict, 3; (b) `parseScore('٣', 20)` and `'١٠'` (Arabic-Indic digits) must be `bad`, which holds because the pattern is `[0-9]`, not `\d`; (c) in the "dropped" test the visible alert is the first `[role=alert]:not([hidden])`; the per-criterion error paragraphs are hidden while empty.

- [ ] **Step 7: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): judge worklist and scorecard form with inline validation, offline status and locking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Chair screens (moderation and rankings)

**Files:**
- Create: `platform/src/ui/moderation.ts`, `platform/src/ui/rankings.ts`
- Modify: `platform/src/main.ts` (add `moderate` and `rankings` cases)
- Test: `platform/tests/ui/moderation.test.ts`, `platform/tests/ui/rankings.test.ts`

**Interfaces:**
- Consumes: `rank`, `canonicalJson`, `sha256Hex`, `Ranking`, `areaTotal`, `validateScores`, `round1` (engine); `Api`; `Ctx`.
- Produces (exact):
  - `interface ModerationRow { teamId: string; teamLabel: string; areaId: string; judges: { cardId: string; judgeId: string; status: 'draft' | 'submitted'; total: number | null }[]; mean: number | null; override: OverrideRow | null }`
  - `buildModeration(area: Area, teams: TeamRow[], cards: CardRow[], overrides: OverrideRow[]): ModerationRow[]`
  - `moderationScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`
  - `rankingsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`

- [ ] **Step 1: Write the failing tests**

`tests/ui/moderation.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CardRow, OverrideRow, TeamRow } from '../../src/api';
import { INDIA_2026 } from '../../src/rulesets';
import { buildModeration, moderationScreen } from '../../src/ui/moderation';
import { EMAILS, makeCtx, text, world } from './helpers';

const area = INDIA_2026.areas.find((a) => a.id === 'verbal-technique')!;
const team = (id: string, number: string): TeamRow => ({ id, eventId: 'e', number, name: `T${number}`, school: '' });
const card = (id: string, teamId: string, judgeId: string, status: 'draft' | 'submitted', scores: Record<string, number>): CardRow => ({
  id, eventId: 'e', teamId, areaId: 'verbal-technique', panel: 'verbal', judgeId, status, reopenedCount: 0, scores, comments: {},
});
const full = (a: number, b: number) => ({ 'engagement-presentation-dynamics': a, 'team-contribution': b });
const wait = () => new Promise((r) => setTimeout(r, 0));

describe('buildModeration', () => {
  it('averages only submitted, complete cards and reports unfinished ones as incomplete', () => {
    const rows = buildModeration(area, [team('t1', '1'), team('t2', '2')], [
      card('c1', 't1', 'jA', 'submitted', full(14, 12)),
      card('c2', 't1', 'jB', 'submitted', full(15, 15)),
      card('c3', 't1', 'jC', 'draft', { 'team-contribution': 5 }),
    ], []);
    expect(rows[0].mean).toBe(28);
    expect(rows[0].judges.map((j) => j.total)).toEqual([26, 30, null]);
    expect(rows[1]).toMatchObject({ mean: null, judges: [], override: null });
    expect(rows[0].teamLabel).toBe('Team 1 · T1');
  });

  it('attaches the override for the team and area only', () => {
    const o: OverrideRow[] = [
      { eventId: 'e', teamId: 't1', areaId: 'verbal-technique', value: 31, reason: 'Moderated' },
      { eventId: 'e', teamId: 't1', areaId: 'de-portfolio', value: 100, reason: 'Other area' },
    ];
    expect(buildModeration(area, [team('t1', '1')], [], o)[0].override?.value).toBe(31);
  });

  it('rounds a repeating mean to one decimal', () => {
    const rows = buildModeration(area, [team('t1', '1')], [
      card('a', 't1', 'j1', 'submitted', full(1, 0)), card('b', 't1', 'j2', 'submitted', full(1, 0)), card('c', 't1', 'j3', 'submitted', full(2, 0)),
    ], []);
    expect(rows[0].mean).toBe(1.3);
  });
});

describe('moderationScreen', () => {
  const submitOne = async (api: Awaited<ReturnType<typeof world>>['api'], evId: string, teamId: string) => {
    await api.signIn(EMAILS.judge);
    const c = await api.openCard(evId, teamId, 'verbal-technique');
    await api.saveScore(c.id, 'engagement-presentation-dynamics', 14);
    await api.saveScore(c.id, 'team-contribution', 12);
    await api.submitCard(c.id);
    return c.id;
  };

  it('shows the judges totals by email, the mean and status', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('judge@x.test');
    expect(t).toContain('26');
    expect(t).toContain('submitted');
    expect(t).toContain('Team 1 · One');
  });

  it('lets the Chair reopen a submitted card with a reason, and explains a missing reason', async () => {
    const { api, ev, t1 } = await world();
    const cardId = await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const form = el.querySelector('form[data-reopen]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('reason');
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'Judge asked to fix a typo';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    await api.signIn(EMAILS.judge);
    expect((await api.listCards(ev.id)).find((c) => c.id === cardId)?.status).toBe('draft');
  });

  it('lets the Chair override an area score within its maximum', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const form = el.querySelector('form[data-override]') as HTMLFormElement;
    const set = (v: string, r: string) => {
      (form.querySelector('input[name=value]') as HTMLInputElement).value = v;
      (form.querySelector('input[name=reason]') as HTMLInputElement).value = r;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    set('41', 'Too high');
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('between 0 and 40');
    set('abc', 'Not a number');
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('number');
    set('31', 'Cross-moderated with the panel');
    await wait();
    expect((await api.listOverrides(ev.id))[0]).toMatchObject({ areaId: 'verbal-technique', value: 31 });
    expect(text(el)).toContain('Override: 31');
  });

  it('is read-only for a lead judge and closed to everyone else', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.lead);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    expect(text(el)).toContain('26');
    expect(el.querySelector('form')).toBeNull();
    await api.signIn(EMAILS.judge);
    expect(text(await moderationScreen(ctx, ev.id))).toContain('Only the Chair and lead judges');
  });
});
```

`tests/ui/rankings.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { rankingsScreen } from '../../src/ui/rankings';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));
const scoreTeam = async (api: Awaited<ReturnType<typeof world>>['api'], evId: string, teamId: string, a: number, b: number) => {
  await api.signIn(EMAILS.judge);
  const c = await api.openCard(evId, teamId, 'verbal-technique');
  await api.saveScore(c.id, 'engagement-presentation-dynamics', a);
  await api.saveScore(c.id, 'team-contribution', b);
  await api.submitCard(c.id);
};
const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

describe('rankingsScreen', () => {
  it('ranks teams by total and says the ranking is provisional until every area is judged', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await scoreTeam(api, ev.id, t2.id, 5, 5);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    expect(rows[0][0]).toBe('1');
    expect(rows[0][1]).toContain('Team 1 · One');
    expect(rows[0].at(-1)).toBe('26');
    expect(rows[1][0]).toBe('2');
    expect(rows[1][1]).toContain('Team 2 · Two');
    expect(text(el)).toContain('Provisional');
    expect(text(el)).toContain('of 650');
  });

  it('flags teams on equal points as a tie for the Chair to decide', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Tie');
    expect(text(el)).toContain('Chair to decide');
  });

  it('adds a protest penalty with a reason and re-ranks', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const form = el.querySelector('form[data-penalty]') as HTMLFormElement;
    expect((form.querySelector('input[name=points]') as HTMLInputElement).value).toBe('15');
    (form.querySelector('select[name=team]') as HTMLSelectElement).value = t1.id;
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'Unsuccessful appeal';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect([...el.querySelectorAll('tbody tr')][0].lastElementChild!.textContent).toBe('11');
    expect(text(el)).toContain('Unsuccessful appeal');
  });

  it('publishes an immutable snapshot with a hash, and releases and withdraws results', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const snap = await api.latestSnapshot(ev.id);
    expect(snap?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap?.rows[0]).toMatchObject({ teamId: t1.id, total: 26, rank: 1 });
    await vi.waitFor(() => expect(text(el)).toContain('Published'));

    button(el, 'Release results to teams and the public').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(true));
    await vi.waitFor(() => expect(button(el, 'Withdraw released results')).toBeDefined());
    button(el, 'Withdraw released results').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(false));
  });

  it('produces the same hash for the same inputs', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const first = (await api.latestSnapshot(ev.id))!;
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect((await api.latestSnapshot(ev.id))!.id).not.toBe(first.id));
    expect((await api.latestSnapshot(ev.id))!.inputHash).toBe(first.inputHash);
  });

  it('lets the organiser read the ranking but not publish, and refuses everyone else', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(button(el, 'Publish ranking')).toBeUndefined();
    await api.signIn(EMAILS.judge);
    expect(text(await rankingsScreen(ctx, ev.id))).toContain('Only the organiser or chair');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/moderation.test.ts tests/ui/rankings.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement moderation**

`src/ui/moderation.ts`:

```ts
import type { CardRow, OverrideRow, Panel, TeamRow } from '../api';
import { areaTotal, round1, validateScores, type Area } from '../engine';
import type { Ctx } from './ctx';
import { errorText, notFound, tag } from './common';
import { h } from './dom';
import { routeHref } from './router';

export interface ModerationRow {
  teamId: string;
  teamLabel: string;
  areaId: string;
  judges: { cardId: string; judgeId: string; status: 'draft' | 'submitted'; total: number | null }[];
  mean: number | null;
  override: OverrideRow | null;
}

export function buildModeration(area: Area, teams: TeamRow[], cards: CardRow[], overrides: OverrideRow[]): ModerationRow[] {
  return teams.map((t) => {
    const judges = cards.filter((c) => c.teamId === t.id && c.areaId === area.id).map((c) => ({
      cardId: c.id, judgeId: c.judgeId, status: c.status,
      total: validateScores(area, c.scores, { complete: true }).length === 0 ? areaTotal(area, c.scores) : null,
    }));
    const done = judges.filter((j) => j.status === 'submitted' && j.total !== null).map((j) => j.total as number);
    return {
      teamId: t.id, teamLabel: `Team ${t.number} · ${t.name}`, areaId: area.id, judges,
      mean: done.length > 0 ? round1(done.reduce((a, b) => a + b, 0) / done.length) : null,
      override: overrides.find((o) => o.teamId === t.id && o.areaId === area.id) ?? null,
    };
  });
}

export async function moderationScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const isChair = roles.some((r) => r.role === 'chair');
  const leadPanels = roles.filter((r) => r.role === 'lead_judge').map((r) => r.panel as Panel);
  if (!isChair && leadPanels.length === 0) return notFound('Only the Chair and lead judges can moderate.', eventHref, event.name);

  const areas = event.ruleset.areas.filter((a) => a.kind === 'scorecard' && (isChair || leadPanels.includes(a.panel as Panel)));
  const select = h('select', { name: 'area', 'aria-label': 'Area' }, areas.map((a) => h('option', { value: a.id }, a.name)));
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const fail = (e: unknown) => { error.textContent = errorText(e); error.hidden = false; };
  const table = h('div', { class: 'table-wrap' });

  const refresh = async () => {
    const area = areas.find((a) => a.id === select.value) ?? areas[0];
    const [teams, cards, overrides, allRoles] = await Promise.all([
      ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.listOverrides(eventId), ctx.api.listRoles(eventId),
    ]);
    const who = (judgeId: string, i: number) => allRoles.find((r) => r.userId === judgeId)?.email ?? `Judge ${i + 1}`;
    const rows = buildModeration(area, teams, cards, overrides);
    table.replaceChildren(
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Team', 'Judges', 'Mean', 'Chair override'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('th', { scope: 'row' }, r.teamLabel),
          h('td', null, r.judges.length === 0 ? h('span', { class: 'muted' }, 'No cards yet') : h('ul', { class: 'list' }, r.judges.map((j, i) => h('li', null,
            `${who(j.judgeId, i)}: ${j.total ?? 'incomplete'} `, tag(j.status, j.status === 'submitted' ? 'pass' : 'risk'),
            isChair && j.status === 'submitted' ? reopenForm(j.cardId) : null)))),
          h('td', { class: 'num' }, r.mean === null ? '—' : String(r.mean)),
          h('td', null,
            r.override ? h('p', { class: 'small' }, `Override: ${r.override.value} (${r.override.reason})`) : null,
            isChair ? overrideForm(r.teamId, area) : null)))),
      ),
    );
  };

  const reopenForm = (cardId: string) => {
    const form = h('form', { class: 'inline-form', 'data-reopen': cardId, novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason to reopen'), h('input', { name: 'reason', autocomplete: 'off' })),
      h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, 'Reopen'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      try {
        await ctx.api.reopenCard(cardId, (form.querySelector('input[name=reason]') as HTMLInputElement).value);
        await refresh();
      } catch (err) { fail(err); }
    });
    return form;
  };

  const overrideForm = (teamId: string, area: Area) => {
    const form = h('form', { class: 'inline-form', 'data-override': teamId, novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, `Score (0 to ${area.max})`), h('input', { name: 'value', inputmode: 'decimal', autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason'), h('input', { name: 'reason', autocomplete: 'off' })),
      h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, 'Set override'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const raw = (form.querySelector('input[name=value]') as HTMLInputElement).value.trim().replace(',', '.');
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value)) { error.textContent = 'Enter the override as a number'; error.hidden = false; return; }
      try {
        await ctx.api.setOverride(eventId, teamId, area.id, value, (form.querySelector('input[name=reason]') as HTMLInputElement).value);
        await refresh();
      } catch (err) { fail(err); }
    });
    return form;
  };

  select.addEventListener('change', () => void refresh());
  // Open on the first area that already has scorecards, so the Chair lands on something to review.
  const existing = await ctx.api.listCards(eventId);
  const busy = areas.find((a) => existing.some((c) => c.areaId === a.id));
  if (busy) select.value = busy.id;
  await refresh();

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, event.name), h('h1', null, 'Moderation'),
      h('p', { class: 'lead' }, isChair ? 'Review each judge\'s total, reopen a card with a reason, or override an area score.' : 'Review your panel\'s scores. Only the Chair can change them.')),
    error,
    h('label', { class: 'field', style: 'max-width: 420px' }, h('span', { class: 'field__label' }, 'Area'), select),
    table,
  );
}
```

- [ ] **Step 4: Implement rankings**

`src/ui/rankings.ts`:

```ts
import { canonicalJson, rank, sha256Hex, type Ranking } from '../engine';
import type { Ctx } from './ctx';
import { errorText, notFound, tag } from './common';
import { h } from './dom';
import { routeHref } from './router';

export async function rankingsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [first, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!first) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const isChair = roles.some((r) => r.role === 'chair');
  if (!isChair && !roles.some((r) => r.role === 'organiser')) return notFound('Only the organiser or chair can see the ranking.', eventHref, first.name);

  const holder = h('div', { class: 'stack stack--lg' });
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const fail = (e: unknown) => { error.textContent = errorText(e); error.hidden = false; };

  const refresh = async () => {
    const [event, teams, cards, overrides, penalties] = await Promise.all([
      ctx.api.getEvent(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.listOverrides(eventId), ctx.api.listPenalties(eventId),
    ]);
    if (!event) return;
    const inputs = {
      teams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
      cards: cards.filter((c) => c.status === 'submitted').map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: c.scores })),
      overrides: overrides.map((o) => ({ teamId: o.teamId, areaId: o.areaId, value: o.value })),
      penalties: penalties.map((p) => ({ teamId: p.teamId, points: p.points })),
    };
    let ranking: Ranking;
    try {
      ranking = rank({ ruleset: event.ruleset, ...inputs });
    } catch (e) {
      holder.replaceChildren(h('p', { class: 'alert', role: 'alert' }, `The ranking cannot be calculated: ${e instanceof Error ? e.message : 'unknown problem'}`));
      return;
    }

    const categories = event.ruleset.categories.filter((c) => ranking.rows.some((r) => r.categories[c.id] !== undefined));
    const earned = ranking.rows.reduce((s, r) => s + r.subtotal, 0);
    const teamName = (id: string) => teams.find((t) => t.id === id);

    const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, [
        h('th', { scope: 'col' }, 'Rank'), h('th', { scope: 'col' }, 'Team'),
        ...categories.map((c) => h('th', { scope: 'col', class: 'num' }, c.name)),
        h('th', { scope: 'col', class: 'num' }, 'Penalties'), h('th', { scope: 'col', class: 'num' }, 'Total'),
      ])),
      h('tbody', null, ranking.rows.map((r) => h('tr', null,
        h('td', null, String(r.rank)),
        h('th', { scope: 'row' }, `Team ${r.number} · ${r.name}`, r.tied ? h('span', null, ' ', tag('Tie', 'risk')) : null, r.judgedComplete ? null : h('span', { class: 'small muted' }, ' (not fully judged)')),
        ...categories.map((c) => h('td', { class: 'num' }, r.categories[c.id] === undefined ? '—' : String(r.categories[c.id]))),
        h('td', { class: 'num' }, r.penalties === 0 ? '—' : `−${r.penalties}`),
        h('td', { class: 'num' }, String(r.total)))))));

    const penaltyForm = h('form', { class: 'inline-form', 'data-penalty': '', novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), h('select', { name: 'team' }, teams.map((t) => h('option', { value: t.id }, `Team ${t.number} · ${t.name}`)))),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Points'), h('input', { name: 'points', inputmode: 'decimal', value: String(event.ruleset.protestPenalty) })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason'), h('input', { name: 'reason', autocomplete: 'off' })),
      h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, 'Add penalty'));
    penaltyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const points = Number((penaltyForm.querySelector('input[name=points]') as HTMLInputElement).value.replace(',', '.'));
      try {
        await ctx.api.addPenalty(eventId, (penaltyForm.querySelector('select[name=team]') as HTMLSelectElement).value, points, (penaltyForm.querySelector('input[name=reason]') as HTMLInputElement).value);
        await refresh();
      } catch (err) { fail(err); }
    });

    const publish = h('button', { class: 'btn btn--primary', type: 'button' }, 'Publish ranking');
    publish.addEventListener('click', async () => {
      error.hidden = true;
      publish.disabled = true;
      try {
        const hash = await sha256Hex(canonicalJson({ rulesetId: event.ruleset.id, inputs, rows: ranking.rows }));
        const snap = await ctx.api.publishSnapshot(eventId, { rulesetId: event.ruleset.id, inputHash: hash, inputs, rows: ranking.rows });
        notice.textContent = `Published at ${snap.createdAt}. Fingerprint ${hash.slice(0, 12)}. Publishing again after changes creates a new snapshot; old ones are kept.`;
        notice.hidden = false;
      } catch (err) { fail(err); } finally { publish.disabled = false; }
    });
    const releaseBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, event.resultsReleased ? 'Withdraw released results' : 'Release results to teams and the public');
    releaseBtn.addEventListener('click', async () => {
      error.hidden = true;
      try { await ctx.api.setReleased(eventId, !event.resultsReleased); await refresh(); } catch (err) { fail(err); }
    });

    holder.replaceChildren(
      ranking.provisional ? h('p', { class: 'notice' }, 'Provisional: some teams have areas that are not judged yet. Rankings change as scores arrive.') : null,
      ranking.ties.length > 0 ? h('p', { class: 'notice' }, `Tie: ${ranking.ties.map((g) => g.map((id) => `Team ${teamName(id)?.number ?? '?'}`).join(' and ')).join('; ')}. Equal points and knock-out score, so the Chair to decide.`) : null,
      h('p', { class: 'muted' }, `Judged points so far: ${Math.round(earned * 10) / 10} of ${ranking.maxAvailable} available per team.`),
      table,
      penalties.length > 0 ? h('section', { class: 'section' }, h('h2', null, 'Penalties'), h('ul', { class: 'list' }, penalties.map((p) => h('li', null, h('strong', null, `Team ${teamName(p.teamId)?.number ?? '?'}: −${p.points}`), h('span', { class: 'small' }, p.reason))))) : null,
      isChair ? h('section', { class: 'section' }, h('h2', null, 'Protest penalty'), penaltyForm) : null,
      isChair ? h('section', { class: 'section' }, h('h2', null, 'Publish and release'),
        h('p', null, event.resultsReleased ? 'Results are visible to teams and the public.' : 'Results are hidden from teams and the public until you release them.'),
        h('div', { class: 'actions' }, publish, releaseBtn)) : null,
    );
  };

  await refresh();
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, first.name), h('h1', null, 'Rankings'),
      h('p', { class: 'lead' }, 'Totals from submitted scorecards, Chair overrides and protest penalties. Specification and racing points join in later phases.')),
    error, notice, holder,
  );
}
```

- [ ] **Step 5: Wire the routes**

In `src/main.ts` import both and add to `screenFor`:

```ts
    case 'moderate': return moderationScreen(ctx, route.eventId);
    case 'rankings': return rankingsScreen(ctx, route.eventId);
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/ui && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): Chair moderation, overrides, reopen, rankings, penalties, publish and release" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Results views for teams and the public

**Files:**
- Create: `platform/src/ui/results.ts`
- Modify: `platform/src/main.ts` (add the `results` case)
- Test: `platform/tests/ui/results.test.ts`

**Interfaces:**
- Consumes: `Api.getEvent`, `latestSnapshot`, `myRoles`, `listCards`, `listPenalties`; `Ctx`; `RankRow`.
- Produces (exact): `resultsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement>`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/results.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RankRow } from '../../src/engine';
import { resultsScreen } from '../../src/ui/results';
import { EMAILS, makeCtx, text, world } from './helpers';

const HASH = 'c'.repeat(64);
const row = (over: Partial<RankRow>): RankRow => ({
  rank: 1, teamId: 't', number: '1', name: 'One', areas: {}, categories: { verbal: 26 }, subtotal: 26, penalties: 0, total: 26, judgedComplete: true, tied: false, ...over,
});

describe('resultsScreen', () => {
  it('shows an unreleased event to nobody outside the event', async () => {
    const { api, ev } = await world();
    await api.signOut();
    const { ctx } = makeCtx(api);
    expect(text(await resultsScreen(ctx, ev.id))).toContain('not been released');
  });

  it('says results are not published yet when released without a snapshot', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    await api.setReleased(ev.id, true);
    await api.signOut();
    const { ctx } = makeCtx(api);
    expect(text(await resultsScreen(ctx, ev.id))).toContain('not been published');
  });

  it('shows the public the released ranking, with hostile names as plain text and a provisional note', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, {
      rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {},
      rows: [row({ teamId: t1.id, name: '<img src=x onerror=alert(1)> 🚗', judgedComplete: false }), row({ rank: 2, teamId: 'x', number: '2', name: 'Two', total: 20, categories: { verbal: 20 } })],
    });
    await api.setReleased(ev.id, true);
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(el.querySelector('img')).toBeNull();
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    expect(rows[0][1]).toContain('<img src=x onerror=alert(1)> 🚗');
    expect(rows[0].at(-1)).toBe('26');
    expect(text(el)).toContain('Provisional');
    expect(text(el)).not.toContain('Your scorecards');
  });

  it('shows a team manager their own scorecards with comments, after release only', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(EMAILS.judge);
    for (const [team, c] of [[t1, 'Clear roles'], [t2, 'Other team comment']] as const) {
      const card = await api.openCard(ev.id, team.id, 'verbal-technique');
      await api.saveScore(card.id, 'engagement-presentation-dynamics', 14, 'Engaging');
      await api.saveScore(card.id, 'team-contribution', 12, c);
      await api.submitCard(card.id);
    }
    await api.signIn(EMAILS.mgr);
    const { ctx } = makeCtx(api);
    expect(text(await resultsScreen(ctx, ev.id))).toContain('not been released');
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    await api.setReleased(ev.id, true);
    await api.signIn(EMAILS.mgr);
    const el = await resultsScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('Your scorecards');
    expect(t).toContain('Verbal Presentation: Technique');
    expect(t).toContain('Clear roles');
    expect(t).toContain('14');
    expect(t).not.toContain('Other team comment');
  });

  it('shows staff the latest snapshot before release, marked as not released', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    const { ctx } = makeCtx(api);
    const t = text(await resultsScreen(ctx, ev.id));
    expect(t).toContain('Not released');
    expect(t).toContain('Team 1');
  });

  it('shows tied teams with a shared rank', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'r', inputHash: HASH, inputs: {}, rows: [row({ tied: true }), row({ number: '2', name: 'Two', teamId: 'x', tied: true })] });
    await api.setReleased(ev.id, true);
    const { ctx } = makeCtx(api);
    const rows = [...(await resultsScreen(ctx, ev.id)).querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    expect(rows.map((r) => r[0])).toEqual(['1', '1']);
    expect(text((await resultsScreen(ctx, ev.id)))).toContain('Tie');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/results.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/ui/results.ts`:

```ts
import type { CardRow } from '../api';
import type { Ctx } from './ctx';
import { notFound, tag } from './common';
import { h } from './dom';
import { routeHref } from './router';

export async function resultsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, snapshot, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.latestSnapshot(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('These results have not been released.', '#/', 'All events');
  const isStaff = roles.some((r) => r.role === 'organiser' || r.role === 'chair');
  const isManager = roles.some((r) => r.role === 'team_manager');
  const signedIn = (await ctx.api.getSession()) !== null;
  const eventHref = signedIn ? routeHref({ name: 'event', eventId }) : '#/';

  const head = h('div', { class: 'stack' },
    h('a', { class: 'back', href: eventHref }, signedIn ? event.name : 'Sign in'),
    h('p', { class: 'eyebrow' }, event.startsOn ?? ''),
    h('h1', null, `${event.name}: results`),
    isStaff && !event.resultsReleased ? h('p', { class: 'notice' }, 'Not released. Only you can see this ranking.') : null,
  );

  if (!snapshot) {
    return h('div', { class: 'stack stack--lg' }, head,
      h('p', { class: 'lead' }, event.resultsReleased ? 'The final ranking has not been published yet. Check back soon.' : 'Results have not been released.'));
  }

  const categories = event.ruleset.categories.filter((c) => snapshot.rows.some((r) => r.categories[c.id] !== undefined));
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, [
      h('th', { scope: 'col' }, 'Rank'), h('th', { scope: 'col' }, 'Team'),
      ...categories.map((c) => h('th', { scope: 'col', class: 'num' }, c.name)),
      h('th', { scope: 'col', class: 'num' }, 'Penalties'), h('th', { scope: 'col', class: 'num' }, 'Total'),
    ])),
    h('tbody', null, snapshot.rows.map((r) => h('tr', null,
      h('td', null, String(r.rank)),
      h('th', { scope: 'row' }, `Team ${r.number} · ${r.name}`, r.tied ? h('span', null, ' ', tag('Tie', 'risk')) : null),
      ...categories.map((c) => h('td', { class: 'num' }, r.categories[c.id] === undefined ? '—' : String(r.categories[c.id]))),
      h('td', { class: 'num' }, r.penalties === 0 ? '—' : `−${r.penalties}`),
      h('td', { class: 'num' }, String(r.total)))))));

  let mine: HTMLElement | null = null;
  if (isManager && event.resultsReleased) {
    const cards: CardRow[] = (await ctx.api.listCards(eventId)).filter((c) => c.status === 'submitted');
    const teams = await ctx.api.listTeams(eventId);
    mine = h('section', { class: 'section' }, h('h2', null, 'Your scorecards'),
      cards.length === 0 ? h('p', { class: 'muted' }, 'No scorecards have been submitted for your team yet.') : null,
      ...event.ruleset.areas.filter((a) => cards.some((c) => c.areaId === a.id)).map((a) => {
        const list = cards.filter((c) => c.areaId === a.id);
        return h('article', { class: 'card' }, h('h3', null, a.name),
          h('p', { class: 'small' }, teams.length === 1 ? `Team ${teams[0].number} · ${teams[0].name}` : ''),
          ...list.map((c, i) => h('div', { class: 'stack' },
            h('p', { class: 'small muted' }, `Judge ${i + 1}`),
            h('ul', { class: 'list' }, a.criteria.map((cr) => h('li', null, h('strong', null, `${cr.name}: ${c.scores[cr.id] ?? '—'} / ${cr.max}`), c.comments[cr.id] ? h('span', { class: 'small' }, c.comments[cr.id]) : null))))));
      }));
  }

  return h('div', { class: 'stack stack--lg' }, head,
    snapshot.rows.some((r) => !r.judgedComplete) ? h('p', { class: 'notice' }, 'Provisional: some teams have areas that are not judged yet.') : null,
    h('p', { class: 'muted small' }, `Ruleset: ${event.ruleset.name}. Published ${snapshot.createdAt}.`),
    table, mine);
}
```

- [ ] **Step 4: Wire the route and run**

In `src/main.ts` import `resultsScreen` and add `case 'results': return resultsScreen(ctx, route.eventId);` to `screenFor`.

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS. Debug note: the test "shows a team manager their own scorecards" expects the text `14` and `Clear roles`; `MemoryApi.listCards` returns only that manager's team cards after release, which is why `Other team comment` is absent.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rg/STEM Racing India " && git add platform && git commit -m "feat(platform): released results for the public and team scorecards for team managers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: README, local Supabase smoke test, and end-to-end verification

**Files:**
- Create: `platform/README.md`, `platform/tests/smoke/local.test.ts`
- Modify: `platform/src/api/supabase.ts` (optional injected client), `/Users/rg/STEM Racing India /.claude/launch.json` (preview entry)

**Interfaces:**
- Consumes: everything above.
- Produces: `createSupabaseApi(url: string, anonKey: string, client?: SupabaseClient): Api` (the third parameter lets tests pass an already signed-in client).

- [ ] **Step 1: Let tests inject a signed-in client**

In `src/api/supabase.ts` change the signature and first lines to:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// ...
export function createSupabaseApi(url: string, anonKey: string, client?: SupabaseClient): Api {
  const sb = client ?? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
```

Run `npx tsc --noEmit && npx vitest run`. Expected: still green.

- [ ] **Step 2: Write the gated smoke test**

`tests/smoke/local.test.ts` runs only when `SMOKE_SUPABASE_URL`, `SMOKE_ANON_KEY` and `SMOKE_SERVICE_ROLE_KEY` are set (a **local** Supabase started with the CLI; the service role key is read from `supabase status`, never committed, and must never be a hosted project's key).

```ts
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ApiError, createSupabaseApi, type Api } from '../../src/api';
import { canonicalJson, rank, sha256Hex } from '../../src/engine';

const URL_ = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_ANON_KEY;
const SERVICE = process.env.SMOKE_SERVICE_ROLE_KEY;
const run = !!(URL_ && ANON && SERVICE) && /localhost|127\.0\.0\.1/.test(URL_ ?? '');

const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { if (e instanceof ApiError) return e.code; throw e; }
  return 'ok';
};

describe.skipIf(!run)('local Supabase smoke test', () => {
  it('runs the whole judging flow against real Postgres, Auth and row-level security', async () => {
    const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    const stamp = Date.now();
    const emails = { org: `org${stamp}@smoke.test`, chair: `chair${stamp}@smoke.test`, judge: `judge${stamp}@smoke.test`, mgr: `mgr${stamp}@smoke.test` };
    const asUser = async (email: string): Promise<Api> => {
      const c = createClient(URL_!, ANON!, { auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email, password: 'smoke-test-password' });
      if (error) throw error;
      return createSupabaseApi(URL_!, ANON!, c);
    };
    for (const e of Object.values(emails)) {
      const { error } = await admin.auth.admin.createUser({ email: e, password: 'smoke-test-password', email_confirm: true });
      if (error) throw error;
    }

    const org = await asUser(emails.org);
    const ev = await org.createEvent({ name: `Smoke ${stamp}`, startsOn: '2026-11-01' });
    const t1 = await org.createTeam(ev.id, { number: '1', name: 'One' });
    const t2 = await org.createTeam(ev.id, { number: '2', name: 'Two' });
    expect(await code(org.createTeam(ev.id, { number: ' 1 ', name: 'Dup' }))).toBe('duplicate');
    await org.invite(ev.id, { email: emails.chair, role: 'chair' });
    await org.invite(ev.id, { email: emails.judge, role: 'judge', panel: 'verbal' });
    await org.invite(ev.id, { email: emails.mgr, role: 'team_manager', teamId: t1.id });

    const chair = await asUser(emails.chair);
    const judge = await asUser(emails.judge);
    const mgr = await asUser(emails.mgr);
    for (const a of [chair, judge, mgr]) expect(await a.claimInvitations()).toBe(1);

    expect(await code(judge.openCard(ev.id, t1.id, 'de-portfolio'))).toBe('forbidden');
    const card = await judge.openCard(ev.id, t1.id, 'verbal-technique');
    expect(await code(judge.saveScore(card.id, 'team-contribution', 21))).toBe('invalid');
    await judge.saveScore(card.id, 'team-contribution', 12, 'Clear roles');
    expect(await code(judge.submitCard(card.id))).toBe('invalid');
    await judge.saveScore(card.id, 'engagement-presentation-dynamics', 14);
    await judge.submitCard(card.id);
    expect(await code(judge.saveScore(card.id, 'team-contribution', 3))).toBe('locked');
    expect(await code(judge.reopenCard(card.id, 'please'))).toBe('forbidden');

    await chair.reopenCard(card.id, 'Judge asked to fix a typo');
    await judge.saveScore(card.id, 'team-contribution', 13);
    await judge.submitCard(card.id);

    expect(await mgr.listCards(ev.id)).toEqual([]);
    await chair.setOverride(ev.id, t2.id, 'pit-display', 40, 'Cross-moderated by the Chair');
    await chair.addPenalty(ev.id, t1.id, 15, 'Unsuccessful appeal');

    const [teams, cards, overrides, penalties] = await Promise.all([chair.listTeams(ev.id), chair.listCards(ev.id), chair.listOverrides(ev.id), chair.listPenalties(ev.id)]);
    const inputs = {
      teams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
      cards: cards.filter((c) => c.status === 'submitted').map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: c.scores })),
      overrides: overrides.map((o) => ({ teamId: o.teamId, areaId: o.areaId, value: o.value })),
      penalties: penalties.map((p) => ({ teamId: p.teamId, points: p.points })),
    };
    const ranking = rank({ ruleset: ev.ruleset, ...inputs });
    expect(ranking.rows.find((r) => r.teamId === t1.id)!.total).toBe(25 - 15);
    const hash = await sha256Hex(canonicalJson({ rulesetId: ev.ruleset.id, inputs, rows: ranking.rows }));
    const snap = await chair.publishSnapshot(ev.id, { rulesetId: ev.ruleset.id, inputHash: hash, inputs, rows: ranking.rows });

    const anon = createSupabaseApi(URL_!, ANON!, createClient(URL_!, ANON!, { auth: { persistSession: false } }));
    expect(await anon.latestSnapshot(ev.id)).toBeNull();
    expect(await anon.getEvent(ev.id)).toBeNull();
    expect(await code(anon.listCards(ev.id))).toBe('forbidden');
    await chair.setReleased(ev.id, true);
    expect((await anon.latestSnapshot(ev.id))?.id).toBe(snap.id);
    expect((await mgr.listCards(ev.id)).map((c) => c.teamId)).toEqual([t1.id]);
    expect(await code(judge.setReleased(ev.id, false))).toBe('forbidden');
  });
});
```

- [ ] **Step 3: Run it (skipped by default), then against a local Supabase if Docker is available**

Run: `npx vitest run tests/smoke`
Expected: 1 skipped (no environment variables).

Check Docker: `docker info > /dev/null 2>&1 && echo up || echo down`. If it prints `up`:

```bash
cd "/Users/rg/STEM Racing India /platform"
supabase init --force   # creates supabase/config.toml next to the migrations; keep the existing migrations
supabase start          # downloads images the first time; local only
supabase db reset       # applies supabase/migrations/*.sql
supabase status         # prints API URL, anon key, service_role key
SMOKE_SUPABASE_URL=http://127.0.0.1:54321 SMOKE_ANON_KEY=<anon key> SMOKE_SERVICE_ROLE_KEY=<service_role key> npx vitest run tests/smoke
supabase stop
```

Expected: the smoke test PASSES. This is the first time the migrations and `SupabaseApi` meet real Postgres, PostgREST and Auth, so fix what it shows: a typical finding is a column privilege or policy that PGlite did not model (for example `anon` needing `execute` on a function, or supabase-js returning an array where the adapter expects an object). Fix the adapter or migration, add a unit or SQL test that pins the bug, and re-run. If Docker is **down**, say so in the final report: the migrations are proven only against PGlite and the adapter only by types and mapper tests, and this step stays open.

- [ ] **Step 4: Write the README**

`platform/README.md`:

```markdown
# STEM Racing India event platform

Online judging, scorecards, moderation, penalties and rankings for a STEM Racing India National Finals event
(Phase 1a). Rules come from the India National Finals 2026 Competition Regulations and are plain data in
`src/rulesets/india-2026.ts`.

## Run

    npm install
    npm run dev        # demo mode: sample data in memory, switch persona in the bar at the top
    npm test           # engine, database rules (PGlite), API, queue and UI tests
    npm run build

Demo mode is used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not set. Nothing is saved in demo mode.

## Database

`supabase/migrations/*.sql` define the schema and every access rule (row-level security). They are tested in Node
with PGlite (`tests/sql`), and end to end against a local Supabase with the gated smoke test:

    supabase start && supabase db reset
    SMOKE_SUPABASE_URL=... SMOKE_ANON_KEY=... SMOKE_SERVICE_ROLE_KEY=... npx vitest run tests/smoke

## Going online (needs the owner's decision)

1. Create a Supabase project, run the migrations (`supabase db push`), and enable email sign-in with a redirect URL
   for the deployed site.
2. Put the project URL and **anon** key in `.env` (copy `.env.example`). Never put the service role key in the app.
3. Deploy the built `dist/` (for example on Vercel). Hash-based routing means no rewrite rules are needed.

## What is not here yet

Judging schedule generator, protest and appeal lodging, judge-to-team assignment, server-side snapshot verification,
specification scores from scrutineering, racing and knock-out (later phases). See the design spec in
`docs/superpowers/specs/2026-10-10-event-platform-design.md`.
```

- [ ] **Step 5: Add a preview entry and verify the whole flow in the browser**

Add to `/Users/rg/STEM Racing India /.claude/launch.json` (keep the existing entry) a second configuration:

```json
{ "name": "platform", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "platform", "run", "dev", "--", "--port", "5174", "--strictPort"], "port": 5174 }
```

Start it and walk the demo as each persona (use the persona switcher), checking each point and fixing anything that is off:
1. **Organiser:** Teams lists the three sample teams; adding a team with a `<b>` in its name shows it as text; People invites an email with the Judge role and a panel; the pending invitation shows.
2. **Judge: Verbal Presentation:** My scorecards shows 3 teams × 3 areas; opening Verbal Presentation: Technique, typing `21` shows the red-bordered field and "Scores go from 0 to 20"; typing `14` and `12` enables Submit; submitting shows the locked card.
3. **Chair:** Moderation shows the judge's total and a Reopen control; Rankings shows Sample team 1 first, a "Provisional" note and a tie note for the other teams; adding the 15-point penalty lowers the total; Publish shows the fingerprint; Release flips the button.
4. **Team manager (Sample team 1):** Results shows the released ranking and "Your scorecards" with the score and comment.
5. Sign out in the header and open the results link without signing in: the released ranking is visible and no other screen is.
6. Brand: headings are italic, section titles use the gradient, buttons are at least 44px high, focus rings are gold, no status relies on colour alone, no horizontal scroll at 768px width.

- [ ] **Step 6: Full verification and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green; `tests/smoke` skipped unless the local variables are set.

```bash
cd "/Users/rg/STEM Racing India " && git add platform .claude && git commit -m "docs(platform): README, gated local Supabase smoke test and demo walkthrough" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hosted setup (STOP and ask)**

Creating a hosted Supabase project, setting its auth redirect URLs, pushing migrations to it, and deploying to Vercel are actions outside this repository. **Stop and ask the user before doing any of them.** When they say go: use the Supabase connector (`create_project`, `apply_migration` for each file in order), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel project environment variables (public values only), deploy, then sign in as the owner and repeat the Step 5 walkthrough on the live URL.
