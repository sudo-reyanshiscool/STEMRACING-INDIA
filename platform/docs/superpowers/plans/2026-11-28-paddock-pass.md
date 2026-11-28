# Paddock Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digital ID cards for students and team managers, checked by a rotating QR at the entrance and by eye elsewhere, working offline.

**Architecture:** One migration adds three locked tables and `security definer` functions. A shared card module (DOM text over one WebGL canvas, CSS fallback) is used by a standalone offline page at `/pass/` for students and by two new pages in the main app: Paddock Passes (issuing) and Door check (scanning). Codes are HMAC-SHA256 over the pass id and a 30-second window, verified in SQL online and with WebCrypto offline.

**Tech Stack:** Vite multi-page build, TypeScript, the `h()` DOM helper, WebGL 1, WebCrypto, IndexedDB, Postgres (pglite in tests), vitest. New dependencies: `qrcode-generator`, `jsqr`.

**Spec:** `docs/superpowers/specs/2026-11-28-paddock-pass-design.md`

**As built:** the classic look was removed from `main` while this was being built, so there is one look and the
page styles live in `src/styles/passes.css`. The spec's last section lists the other calls made during the build
(`pass_now`, the tap before claiming, offline wording, typed codes).

## Global Constraints

- Run everything from `platform/`. Migration file: `supabase/migrations/0059_paddock_passes.sql`. Functions use `security definer set search_path = public, pg_temp`, are revoked from `public, anon, authenticated`, then granted with a `grant execute on function … ;` statement (the installer re-applies those).
- Code format: `SRI1.<32 upper hex pass id>.<decimal window>.<16 upper hex mac>`. Window = `floor(unix seconds / 30)`. Mac = first 8 bytes of HMAC-SHA256(secret, `SRI1|<dashed lower uuid>|<window>`). Accepted windows: server window −1, 0, +1.
- Sync pulse: `k = floor(unix ms / 8000)`, digest = HMAC-SHA256(pulse key, `pulse|<k>`), glyph = `digest[0] % 6`, colour = `digest[1] % 6`.
- Portrait copy: JPEG, 320 px wide, at most 65 536 bytes.
- The card is always black carbon (Silver look). No pink, purple or rainbow glow. The track shape appears in the hologram patch and as a large foil outline.
- No screen or function output names who issued, reset or scanned a pass.
- Never commit personal email addresses or secrets; never print `.env.local`.
- UI tests need `// @vitest-environment jsdom` on line 1.

## Review Focus

- A phone whose clock is minutes wrong: the pass page must correct with the server offset, and the door must say "Expired code", not "not genuine".
- A claim link opened twice, or after the manager pressed Send again: a plain "already used" message, and the first phone keeps or loses the pass exactly as the design says.
- WebGL missing or the context lost mid-session: the card stays readable in the CSS version, with no blank canvas.
- A manager removing and re-adding a member to fix a typo: the student's pass keeps working.
- A scanner offline for hours with a stale door list: a pass issued after the download reads "Not on this phone's list. Go online to check", never "fake".

---

### Task 1: Database

**Files:** Create `supabase/migrations/0059_paddock_passes.sql`, `tests/sql/paddock-passes.test.ts`.

**Produces** (SQL, all returning `jsonb` unless noted):
- `hmac_sha256(bytea, bytea) returns bytea` (internal)
- `team_passes(p_event uuid, p_team uuid)` → `{now, team, event, stream, activities, timezone, pulseKey, passes:[{id, kind, memberId, name, role, status:'new'|'sent'|'claimed', claimedAt, linkSentAt, portrait, portraitStale, mine}]}`
- `set_pass_portrait(p_pass uuid, p_jpeg text) returns void`, `set_manager_pass_name(p_pass uuid, p_name text) returns void`
- `pass_link(p_pass uuid) returns text` (64 hex token), `reset_pass(p_pass uuid) returns void`, `present_pass(p_pass uuid) returns text` (64 hex secret)
- `claim_pass(p_pass uuid, p_token text)` → `{secret, card}`; `pass_card(p_pass uuid, p_step bigint, p_mac text)` → card. Both granted to `anon`.
- card = `{passId, kind, name, role, team:{number,name,school}, event:{id,name,startsOn,days}, stream:{name,index}|null, activities:[{title,kind,start,end,location}], timezone, portrait, pulseKey, now}`
- `check_pass(p_event uuid, p_code text, p_gate text, p_check uuid, p_device text)` → `{result:'genuine'|'replay'|'expired'|'invalid'|'wrong_event'|'unknown', holder?, presenter?, firstSeenToday?}`
- `door_list(p_event uuid)`, `door_portraits(p_event uuid, p_after uuid, p_limit int)`, `record_pass_checks(p_event uuid, p_checks jsonb) returns int`, `pass_arrivals(p_event uuid)`, `pass_pulse_key(p_event uuid) returns text`

- [ ] Write `tests/sql/paddock-passes.test.ts` covering: RFC 4231 vectors; manager sees own team only, staff any team, judges/outsiders/anonymous/spectators refused; rows created for members and managers; re-link on same name or same portrait, new pass when both change, removed member's pass deleted; link → claim once, wrong token, second claim, new link cancels the old one and the claimed phone; reset; present keeps the holder secret; `pass_card` with a right and wrong mac; `check_pass` genuine, neighbouring window, stale window = expired, bad mac = invalid, other event = wrong_event, garbage = unknown, replay from another device, same device within 5 s deduplicated, presenter flag, firstSeenToday; `door_list`, `record_pass_checks` (idempotent), `pass_arrivals`, `pass_pulse_key` by role; tables unreadable by `anon` and `authenticated`; no output contains a scanner's id or email; deleted event refuses everything.
- [ ] Run `npx vitest run tests/sql/paddock-passes.test.ts`; expect failures on missing functions.
- [ ] Write the migration.
- [ ] Run it again; expect all passing. Run `npx vitest run tests/sql/isolated-schema.test.ts` too.
- [ ] Commit.

### Task 2: Codes, pulse and the API layer

**Files:** Create `src/pass/code.ts`, `src/api/passes.ts`, `tests/pass/code.test.ts`, `tests/api/passes-memory.test.ts`. Modify `src/api/types.ts`, `src/api/supabase.ts`, `src/api/memory.ts`, `src/api/index.ts`, `src/api/cached.ts`, `package.json`.

**Produces:**
- `code.ts`: `STEP_MS = 30000`, `PULSE_MS = 8000`, `importSecret(hex): Promise<CryptoKey>` (non-extractable), `macFor(key, passId, step): Promise<string>`, `passCode(passId, step, mac): string`, `parsePassCode(text): {passId, step, mac} | null`, `currentStep(nowMs): number`, `pulseAt(key, nowMs): Promise<{k, glyph, colour}>`.
- `passes.ts`: types `PassCardData`, `TeamPass`, `TeamPasses`, `PassCheckResult`, `DoorList`, `DoorEntry`, `QueuedCheck`, `PassArrivals`.
- `Api` gains `teamPasses`, `setPassPortrait`, `setManagerPassName`, `passLink`, `resetPass`, `presentPass`, `checkPass`, `doorList`, `doorPortraits`, `recordPassChecks`, `passArrivals`, `passPulseKey`.

- [ ] Test: `macFor` equals node's `createHmac` for a fixed secret, pass id and step, and equals the fixed vector also asserted in the SQL test; `parsePassCode` rejects wrong prefix, short ids, non-numeric windows, lower-case input is accepted and normalised; `pulseAt` is stable inside a window and matches a hand-computed digest.
- [ ] Test the in-memory API mirrors the SQL rules used by the UI: issue, link, claim, reset, check results.
- [ ] Implement, run, commit.

### Task 3: The card

**Files:** Create `src/pass/card/card.ts`, `shader.ts`, `mask.ts`, `tilt.ts`, `qr.ts`, `card.css`, `streams.ts`, `tests/ui/pass-card.test.ts`.

**Produces:** `createPassCard(data: PassCardData, options: {code?: () => Promise<string | null>; pulseKey?: CryptoKey | null; now?: () => number; shader?: boolean}): PassCard` where `PassCard = {el: HTMLElement; update(data): void; flip(back?: boolean): void; setActive(on: boolean): void; destroy(): void}`; `streamColour(index: number | null): {fill: string; ink: string}`.

- [ ] Test (jsdom, no WebGL): the card renders name, role, team number, team name, school, stream name and valid dates as text; has class `pass-card--basic`; the manager role label has its solid style class; a card with no stream reads "Stream to be announced"; `flip()` exposes the entry side with a QR canvas and next activities; reduced motion adds `pass-card--still`; `destroy()` stops timers.
- [ ] Port the prototype's Silver shader, add the track shape to the hologram patch and enlarge the outline. Implement tilt (device orientation with the iOS permission request on first tap, pointer, idle), context-loss fallback, pixel-ratio cap, 30 fps idle.
- [ ] Run, commit.

### Task 4: The student's page

**Files:** Create `pass/index.html`, `src/pass/main.ts`, `src/pass/store.ts`, `src/pass/client.ts`, `src/pass/page.css`, `public/pass/sw.js`, `tests/ui/pass-page.test.ts`. Modify `vite.config.ts`, `vercel.json`.

**Produces:** `openPassStore(): Promise<PassStore>` with `all()`, `put(record)`, `remove(id)`; `rpc<T>(name, args): Promise<T>` over `fetch`; `startPassPage(root, deps)`.

- [ ] Test with injected store and rpc: a claim fragment calls `claim_pass`, stores the record, clears the fragment and shows the card; a refused claim shows "This link has already been used. Ask your team manager for a new one."; with stored passes and a failing network the card still shows; several stored passes can be switched between; the empty state explains what to do.
- [ ] Implement. The worker caches the page and whatever resource URLs the page posts to it after load, serves cache first for same-origin GETs and falls back to the network.
- [ ] `npm run build`; confirm `dist/pass/index.html` exists. Commit.

### Task 5: Paddock Passes and Door check

**Files:** Create `src/ui/passes.ts`, `src/ui/door.ts`, `src/ui/pass-reference.ts`, `src/pass/portrait.ts`, `src/pass/door-store.ts`, `src/pass/scan.ts`, `src/pass/verify.ts`, `tests/ui/passes.test.ts`, `tests/ui/door.test.ts`, `tests/pass/verify.test.ts`. Modify `src/ui/router.ts`, `src/main.ts`, `src/ui/event-nav.ts`, `src/ui/event-home.ts`, `src/styles/platform.css`, `src/styles/classic/platform.css`.

**Produces:** routes `passes` and `door`; `verifyOffline(list: DoorList, code: string, nowMs: number): Promise<PassCheckResult>`; `makePortrait(base64, mime): Promise<string>`.

- [ ] Tests: a manager sees their team's cards and Send to phone shows a link containing `/pass/#`; staff get a team picker; a claimed pass asks before a new link; a judge gets the not-available screen; each `PassCheckResult` renders its own heading; offline verify returns genuine, expired, invalid and "not on this phone's list"; queued checks upload once when the network returns; nav shows the two pages to the right roles in both looks.
- [ ] Implement, run, commit.

### Task 6: Ship it

- [ ] `npx tsc --noEmit` and `npx vitest run`; re-run any SQL file that fails only under parallel load.
- [ ] `node scripts/render-migrations.mjs`, then install with the Supabase CLI against the linked project.
- [ ] Demonstrate on the Test Event with team 001: issue, claim in a second browser profile, scan the code, reset.
- [ ] Ask the user before merging to `main`.
