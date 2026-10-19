# STEM Racing India event platform

Online judging, scorecards, moderation, penalties and rankings for a STEM Racing India National Finals event
(Phase 1a). Rules come from the India National Finals 2026 Competition Regulations and are plain data in
`src/rulesets/india-2026.ts`.

## Digital scorecards

Each criterion shows the four rubric bands and a button for every permitted score, with a numeric entry alternative.
The full band descriptions come from the supplied Competition Regulations, pages 32–37, and live in
`src/rulesets/rubrics.ts`. New events pin these descriptions alongside their scoring rules; existing events keep
their pinned rulesets. Scores and category maxima have not changed. Section links switch between a panel's cards.

Judges can write private notes for each criterion before entering a score, plus an overall private note. The judge,
their panel lead and the Chair can read these notes; organisers and team managers cannot. Existing criterion comments
remain explicitly team-facing and are available under “Criterion feedback for the team”. Team feedback has Overall
Comment (required when checking a card), Key Strengths and Areas for Improvement. Managers see only their own team's
submitted feedback after results are released.

Use **Check card**, review the scores and feedback, then **Submit scorecard**. Editing afterwards requires another
check. Notes, feedback and nominations save together, with per-user browser drafts while offline. Reopening the card
restores pending drafts; an open card retries on reconnect and every 15 seconds. Demo drafts remain in memory.
Submitted and released cards are read-only. Apply migration `0005_scorecard_reviews.sql` before using this UI with a
Supabase backend. The existing submission API remains compatible with older clients and cards without feedback;
the new required-comment and check step is enforced by this UI.

Star Quality nominations appear in Moderation for the Chair and panel leads, counting submitted cards only.
Repeated nominations in several sections count once per judge, team, award and panel. The tally informs the short
list; it does not choose award winners or change points.

## Run

    npm install
    npm run dev          # demo mode: sample data in memory, switch persona in the bar at the top
    npm test             # engine, database rules (PGlite), API, queue and UI tests
    npm run typecheck
    npm run build

Demo mode is used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not set. Nothing is saved in demo mode:
reloading the page restores the sample data.

Demo mode opens with two events:

- **Sample event (demo data)**: three teams, nothing scored yet. Use it to try the judge screens as
  *Judge: Verbal Presentation* or *Judge: Design & Engineering*.
- **National Finals rehearsal (demo data)**: twelve teams and two judges on every panel, every scorecard already
  submitted with fixed (seeded) scores, so *Chair of Judges* sees a realistic ranking to moderate, penalise,
  publish and release. The *Team manager* persona manages Kolkata Comets in this event.

## Database

`supabase/migrations/*.sql` define the schema and every access rule (row-level security). They are tested in Node
with PGlite (`tests/sql`), and end to end against a local Supabase with the gated smoke test
(`tests/smoke/local.test.ts`). The smoke test signs in as an organiser, a Chair, a judge, a team manager and an
anonymous visitor against real Postgres, PostgREST and Auth, and checks the access rules a browser would meet:
claiming invitations, scoring and submitting, Chair reopen and overrides, penalties, publishing, the release freeze,
snapshot `inputs` being unreadable except through `snapshot_inputs` for the Chair and Organiser, and a signed-out
write being reported as `unauthenticated`.

It only runs when all three variables are set and the URL is on localhost. It needs Docker.

    supabase start        # first run downloads the images; everything stays on this machine
    supabase db reset     # applies supabase/migrations/*.sql
    eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
    SMOKE_SUPABASE_URL="$API_URL" SMOKE_ANON_KEY="$ANON_KEY" SMOKE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
      npx vitest run tests/smoke
    supabase stop

The service role key is read from `supabase status` for that one command. Never commit it, never use a hosted
project's key, and never put it in the app. If another local Supabase project already uses the default ports, change the
`[api]`, `[db]`, `[studio]` and `[inbucket]` ports in `supabase/config.toml` (this repository uses 55321 and up for
that reason).

## Going online (needs the owner's decision)

1. Create a Supabase project, run the migrations (`supabase db push`), and enable email sign-in with a redirect URL
   for the deployed site. Invitations only attach to an account whose email address is confirmed.
2. Put the project URL and **anon** key in `.env` (copy `.env.example`). Never put the service role key in the app.
3. Deploy the built `dist/` (for example on Vercel). Hash-based routing means no rewrite rules are needed.

### Hosted launch checklist

Before the first real event on a hosted project:

- **Sign-ups and event creation are open.** Anyone with the anon key can create an account and call `create_event`
  (becoming Organiser of their own event, which they alone can see). Before launch, disable automatic sign-up
  (Authentication, Providers, Email: turn off "Allow new users to sign up") and create the organisers' accounts, or
  restrict `create_event` to an allow-list.
- **`max_rows`.** The adapter reads every list in pages of 1000. The hosted project's API setting `max_rows` must be
  1000 or more (the default), otherwise a short page would be mistaken for the last one. `supabase/config.toml` keeps
  the local value at 1000 and a test pins it.
- **Redirect URLs.** Authentication, URL Configuration: set the Site URL to the deployed address and add that address
  (with and without the trailing slash) to the redirect allow-list. Locally, `supabase/config.toml` already allows
  `http://localhost` and `http://127.0.0.1` on ports 5173 and 5174.
- **Confirmed email.** Keep email confirmation on: invitations are only claimed by an account whose address is confirmed.

### Things to know

- **The Chair alone releases results.** Releasing and withdrawing go through `release_results()` and
  `withdraw_results()`; nobody can set `results_released` with a direct update. A release is refused unless the latest
  published ranking matches everything that is counted now.
- **No rule stops removing the last Organiser** of an event (or the last Chair). Do not remove the people running the
  event; add a replacement first.
- **Penalty points are public by design.** After release the public ranking shows each team's penalties column, and
  the team manager sees their own penalty reasons.
- **Phase 1a counts every submitted card of a judge who later loses their role.** Removing a judge does not remove
  their submitted scorecards from the ranking; reopen them in Moderation if they should not count.
- **Teams stay editable after release.** The freeze covers scorecards, scores, overrides and penalties; a Chair or
  Organiser can still add or rename teams, which changes the public team list (the published snapshot is unaffected).
- **Global default privileges.** `0001_core.sql` revokes execute on new functions from `public`, `anon` and
  `authenticated` for the role that runs the migrations, and `0003_results.sql` revokes default table and sequence
  privileges from the API roles. Every function a later migration adds is therefore callable by nobody until it is
  granted explicitly: always write the `grant execute` (and a test) with the function.
- **Conflicts of interest** must be declared before judging: once a judge has submitted a card for a team, or results
  are released, the declaration is refused. The Chair sees declared conflicts in Moderation and on Rankings.

## What is not here yet

Judging schedule generator, protest and appeal lodging, judge-to-team assignment, server-side snapshot verification,
specification scores from scrutineering, racing and knock-out (later phases). See the design spec in
`docs/superpowers/specs/2026-10-10-event-platform-design.md`.
