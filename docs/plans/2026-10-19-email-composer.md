# Email Composer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a branded in-app Email Composer for the Organiser and Chair of Judges to compose and broadcast announcements to all judges, specific panels, specific judges, or arbitrary email addresses through Supabase SMTP.

**Architecture:** A new `/event/:id/communications` route in the event platform provides audience selection, subject/category/body markdown editing, and real-time live preview inside the official STEM Racing India responsive email layout. A new `0013_communications.sql` migration stores broadcast audit records and access control. A Supabase Edge Function (`send-broadcast`) validates caller permissions, renders the branded HTML email, and dispatches to recipients using SMTP. MemoryApi and demo mode support in-memory broadcast simulation.

**Tech Stack:** TypeScript, Vanilla DOM (`h`), Supabase Postgres with RLS, PGlite for SQL tests, Vitest, Deno/Supabase Edge Functions.

---

### Task 1: Branded Email HTML Generator & Unit Tests

**Files:**
- Create: `platform/src/engine/broadcast-template.ts`
- Test: `platform/tests/engine/broadcast-template.test.ts`

**Step 1: Write the failing test**
Create `platform/tests/engine/broadcast-template.test.ts` asserting:
- Given subject, category, body markdown, optional button text and URL, it produces valid responsive HTML containing:
  - Header with `#05000b` background and India logo lockup (`https://stemracingindia-events.vercel.app/brand/logo-india-colour-white.png`).
  - 75% pink (`#e6007e`) and 25% orange (`#ed6d05`) accent bar.
  - Category tag in `#961b81` uppercase.
  - Title and converted paragraphs/lists with proper email-safe styles.
  - Optional CTA button linking to the given URL with `#e6007e` background.
  - Footer with `STEM RACING INDIA / EVENTS PLATFORM`.
  - Escaped HTML in raw user text to prevent XSS.

**Step 2: Run test to make sure it fails**
Run `npx vitest run tests/engine/broadcast-template.test.ts` and verify it fails due to missing module.

**Step 3: Implement minimal code**
Implement `platform/src/engine/broadcast-template.ts`:
- Helper `renderBroadcastHtml(options: { subject: string; category?: string; body: string; buttonText?: string; buttonUrl?: string }): string`.
- Converts basic markdown (paragraphs, line breaks, bold, italics, bullet points, links) safely into inline-styled email HTML tables.

**Step 4: Run test to make sure it passes**
Run `npx vitest run tests/engine/broadcast-template.test.ts` and verify it passes.

---

### Task 2: Database Schema & Migration for Broadcasts

**Files:**
- Create: `platform/supabase/migrations/0013_communications.sql`
- Test: `platform/tests/sql/communications.test.ts`

**Step 1: Write the failing SQL test**
Create `platform/tests/sql/communications.test.ts` using PGlite and the existing migration test harness:
- Test table `broadcast_emails`:
  - Organisers and Chairs can select broadcasts for their active event.
  - Judges and Team Managers cannot read or insert broadcasts (`permission denied`).
  - RPC function `record_broadcast_email` or insert RLS enforces event active and organiser/chair check.

**Step 2: Run test to make sure it fails**
Run `npx vitest run tests/sql/communications.test.ts` and verify it fails.

**Step 3: Implement migration**
Implement `platform/supabase/migrations/0013_communications.sql`:
- Create table `broadcast_emails` (id, event_id, sender_id, sender_email, audience_type, panel, recipient_count, subject, category, body, button_text, button_url, created_at).
- Enable RLS: `select` and `insert` policies checking `is_chair_or_organiser(event_id)`.
- Grants to `authenticated`.

**Step 4: Run test to make sure it passes**
Run `npx vitest run tests/sql/communications.test.ts` and verify it passes.

---

### Task 3: API Types, MemoryApi & SupabaseApi Support

**Files:**
- Modify: `platform/src/api/types.ts`
- Modify: `platform/src/api/memory.ts`
- Modify: `platform/src/api/supabase.ts`
- Test: `platform/tests/api/communications-api.test.ts`

**Step 1: Write failing test**
Create `platform/tests/api/communications-api.test.ts`:
- Test `listBroadcasts(eventId)` and `sendBroadcast(eventId, input)` on `MemoryApi`.
- Verify input validation (non-empty subject, body, valid audience).
- Verify audience resolution (resolves judges assigned to event or specific panel, extracts emails).
- Verify in-memory storage of sent broadcasts.

**Step 2: Run test to make sure it fails**
Run `npx vitest run tests/api/communications-api.test.ts` and verify failure.

**Step 3: Implement API methods and types**
- In `types.ts`, define `BroadcastEmail`, `BroadcastAudience`, `NewBroadcastInput`.
- Extend `Api` interface with `listBroadcasts(eventId: string)` and `sendBroadcast(eventId: string, input: NewBroadcastInput)`.
- In `memory.ts`, implement in-memory tracking of broadcasts, resolving emails based on assigned judges and roles.
- In `supabase.ts`, implement Supabase client calls to `broadcast_emails` table and invoking `send-broadcast` edge function.

**Step 4: Run test to make sure it passes**
Run `npx vitest run tests/api/communications-api.test.ts` and verify it passes.

---

### Task 4: Edge Function Handler for Sending Broadcasts

**Files:**
- Create: `platform/supabase/functions/_shared/broadcast-handler.ts`
- Create: `platform/supabase/functions/send-broadcast/index.ts`
- Test: `platform/tests/api/broadcast-handler.test.ts`

**Step 1: Write failing test**
Create `platform/tests/api/broadcast-handler.test.ts`:
- Mock authentication and delivery dependencies.
- Verify 401 when unauthenticated.
- Verify 403 when not an organiser or chair of the event.
- Verify recipient resolution (deduplicates emails, validates format).
- Verify sending email batches through SMTP provider.

**Step 2: Run test to make sure it fails**
Run `npx vitest run tests/api/broadcast-handler.test.ts` and verify it fails.

**Step 3: Implement broadcast handler and edge function**
- Implement `platform/supabase/functions/_shared/broadcast-handler.ts`.
- Implement `platform/supabase/functions/send-broadcast/index.ts`.

**Step 4: Run test to make sure it passes**
Run `npx vitest run tests/api/broadcast-handler.test.ts` and verify it passes.

---

### Task 5: Communications UI (Composer Screen, Audience Selector, Live Preview, and Sent History)

**Files:**
- Create: `platform/src/ui/communications.ts`
- Modify: `platform/src/ui/router.ts`
- Modify: `platform/src/ui/event-nav.ts`
- Modify: `platform/src/main.ts`
- Test: `platform/tests/ui/communications.test.ts`

**Step 1: Write failing UI test**
Create `platform/tests/ui/communications.test.ts`:
- Renders composer with audience selection (All Judges, Panels, Specific Judges, Custom Emails).
- Selecting audience updates computed recipient count dynamically.
- Typing subject, category, body updates the live preview card in real time.
- Clicking "Send announcement" shows confirmation modal with recipient count and triggers `sendBroadcast`.
- Displays sent broadcast history table.
- Accessible error handling for empty fields.

**Step 2: Run test to make sure it fails**
Run `npx vitest run tests/ui/communications.test.ts` and verify failure.

**Step 3: Implement UI and wiring**
- Update `event-nav.ts` to add `['Communications', { name: 'communications', eventId: event.id }]` for `has('organiser', 'chair')`.
- Update `router.ts` with `communications` route.
- Implement `platform/src/ui/communications.ts`.
- Wire `communications` case in `main.ts`.

**Step 4: Run test to make sure it passes**
Run `npx vitest run tests/ui/communications.test.ts` and verify it passes.

---

### Task 6: Full Verification and Demo Mode Testing

**Files:**
- Run full test suite: `npm test`
- Typecheck: `npm run typecheck`
- Verify demo mode personas: Organiser and Chair see Communications tab; Judges and Managers do not.
