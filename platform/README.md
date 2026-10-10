# STEM Racing India event platform

Online judging, scorecards, moderation, penalties and rankings for a STEM Racing India National Finals event
(Phase 1a). Rules come from the India National Finals 2026 Competition Regulations and are plain data in
`src/rulesets/india-2026.ts`.

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

## What is not here yet

Judging schedule generator, protest and appeal lodging, judge-to-team assignment, server-side snapshot verification,
specification scores from scrutineering, racing and knock-out (later phases). See the design spec in
`docs/superpowers/specs/2026-10-10-event-platform-design.md`.
