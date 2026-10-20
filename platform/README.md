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
their panel lead, the Chair and authorised organisers can read these notes; team managers cannot. Existing criterion comments
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

## Connected role interfaces

All role interfaces use the same event and team ids. The event navigation links Judges to **My scorecards** and
**Scores**, Organisers to **Teams**, **People**, **Scores** and **Rankings**, and the Chair to **Moderation** as well.
**Scores** shows saved drafts, submitted totals, criterion breakdowns and team feedback, with team/panel filters. It
refreshes every 10 seconds while visible and when focus or connectivity returns, retaining filters and expanded rows.
Only submitted cards count in Rankings; an organiser can inspect drafts without editing another judge's work.
Private notes remain restricted to the author, panel lead and Chair. Managers can read only their own team's
submitted cards and feedback after release. Database row-level security enforces these rules on every device.

### Assignments, exemptions and score visibility

Under **People → Judge assignments**, choose an existing event member, a panel, and either **All teams** or
**Selected teams**. Save each panel separately; one judge can have several panels and several selected teams.
All teams includes teams added later. Specific team assignments with a declared conflict are refused.
The People list shows each assignment and lets staff remove it individually. Entering an existing member’s email
in the invitation form and selecting a new Judge panel adds the assignment immediately without another email.
Repeating an existing panel leaves its team scope intact. My scorecards checks for assignment changes every 10
seconds, on focus, and with Refresh assignments. The separate Scrutineer role is inspection staff access;
Specification scorecards require Judge → Specification & Scrutineering. Judges with several panels see a panel
selector above the team list in My scorecards. Each panel opens its own assigned teams, and the selected panel
is remembered for that judge and event in the current browser session.

Under **People → Judge exemptions**, the Chair or Organiser can exempt someone from a team across every panel.
Exemptions override assignments, including All teams, without removing them. Remove an exemption to restore access.
If that judge has already submitted a scorecard for the team, the Chair must reopen it before adding an exemption.
Submitted evidence is never silently removed from rankings by reassigning or exempting a judge.

Ordinary judges see only their own scorecards. Submitted **Specification Judging** cards are also visible to all
judges and event staff; other judges’ Specification drafts stay private. Panel leads retain moderation access to
the panels they lead; the Chair and Organiser retain event oversight. Private notes keep their existing restrictions.
Final standings (rank, team and total points only) are public after release, including to signed-out visitors.
Detailed score breakdowns and feedback are private to signed-in managers for their own teams; judges and staff keep
the judging access described above. Full internal rankings remain available to the Chair and Organiser. Apply migrations `0010_judge_assignments.sql` and `0011_private_team_results.sql` before
deploying these interfaces; use the isolated renderer for an existing shared Supabase project.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_SUPABASE_DB_SCHEMA` to enable the shared
workspace. The public client key belongs in the build; never include a service-role key. Each person signs in with
their own email; the organiser creates an event and invites the Chair and panel judges under People. An event may
assign multiple roles to the same person. Authentication's redirect allow-list must include the deployed address;
Supabase's default email service is limited, so configure a production SMTP provider before inviting event staff.

`?demo=1` opens an isolated, temporary demonstration with all five judging panels available. The banner explicitly
states that demonstration data is not saved or shared. Changing persona keeps the current event, and pending
feedback and scores are flushed under the outgoing judge's session before switching.

### Using an existing Supabase project

Use `scripts/isolated-schema.ts` to render the migrations into the dedicated `stem_racing` schema. The renderer keeps
an idempotent migration ledger and rejects edits to previously installed migrations. It rewrites function search
paths and schema-scoped grants, supplies the explicit core permissions that Supabase normally defaults in public,
and re-applies the declared function allow-list. It leaves existing public tables, functions, privileges and global
default privileges intact. Expose `stem_racing` in the project's Data API settings while retaining its existing
exposed schemas, then set `VITE_SUPABASE_DB_SCHEMA=stem_racing` for this app.

The optional `tests/smoke/shared.test.ts` checks independent Organiser, Chair, Judge, unrelated Judge and Manager
clients against a chosen project. It requires an explicit matching project reference and private temporary credential
file, creates only synthetic accounts, soft-deletes its connectivity event, and removes the synthetic accounts.
It exercises score sharing, note privacy, submitted locks, reopening, publication and release without emailing anyone.

## Run

    npm install
    npm run dev          # demo mode: sample data in memory, switch persona in the bar at the top
    npm test             # engine, database rules (PGlite), API, queue and UI tests
    npm run typecheck
    npm run build

## Upgrading an older cached scrutineering installation

The Events deployment keeps `/sw.js` as a one-time retirement worker for browsers that previously installed the
offline scrutineering app on this origin. It removes only Workbox precache assets, unregisters itself and opens
`/?app=events-v1#/` to avoid an HTTP-cached copy of the old HTML. IndexedDB and localStorage records remain intact;
they are not imported into the Events demo. Keep this worker URL available for returning browsers. The standalone
scrutineering deployment still uses its own offline worker.

## Events and team imports

An **Organiser** can open an event, choose **Delete event** under Manage event and type its exact name to confirm.
Deleted events and all their data disappear from ordinary views, including released results. The organiser can use
**Deleted events** on the Events page to restore them. Deletion retains scorecards, feedback, invitations, published
snapshots and the audit log. Invitations wait until restoration, and event permissions are inactive while deleted.

The Chair and Organiser can use **Teams → Delete team** and confirm with the exact team number. Team deletion
is permanent and removes draft cards, feedback, manager access, invitations, conflicts, overrides and penalties.
Submitted cards block deletion until the Chair reopens them; released results must be withdrawn first. Historical
ranking snapshots and the audit log remain, and a fresh ranking must be published before releasing again. Hosted
backends need migration `0007_team_deletion.sql` before using this control.

The Chair and Organiser can use **Teams → Import teams from CSV**. Download the template, choose a UTF-8 CSV and
review the preview, then confirm the import. Required headings are `number` and `name`; `school` is optional.
`Team Number`, `Team Name`, `School Name` and `School or Club` are also recognised. Extra columns are listed and
ignored. Quoted commas, escaped quotes and line breaks are supported. Numbers remain text, so `001` stays `001`.
Import up to 1000 teams in a file no larger than 1 MB. Any invalid row or duplicate team number blocks the whole batch;
existing teams are never overwritten. The server repeats validation and inserts the batch in one transaction.

Apply `0006_event_management.sql` before using these controls with a Supabase backend. The demo supports the same
controls in memory; reloading resets its sample data, including deleted events.

Demo mode is used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not set, or when `?demo=1` is requested. Nothing is saved in demo mode:
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

- **Event creation requires organiser access.** The permanent Platform Admin and invited Platform or Competition Organisers can create events. A Competition Organiser controls only assigned/created events; a Platform Organiser controls all events. Public sign-up alone grants no event management access.
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
- **Public standings contain totals only.** Everyone can read the rank, team and final total after release.
  Section scores, individual cards, feedback and penalty reasons are returned only for the signed-in manager’s teams.
  Full snapshot JSON stays inaccessible to anonymous visitors; the public endpoint projects only the allowed fields.
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

## Race control and Denford timing

Every event now has a **Race control** screen. Organisers, the Chair and Race
Officials can queue two-team heats, nominate car A/B, record total and reaction
times to milliseconds, and mark DNF, DNS or false starts. Other staff can view
saved runs; team managers can view them after release. Revisions prevent silent
cross-device overwrites, corrections require a reason, and the audit log keeps
both versions. Results release freezes race edits. Recorded races also prevent
permanent deletion of their participating teams.

The read-only Denford bridge uses the existing StartGate v1.9 `times.json`
protocol. Choose Track Wi-Fi or Ethernet in the interface, and use the gate's exact IP
for that connection (Wi-Fi commonly uses `http://10.0.0.1`). No network settings
are changed automatically. Pairing files expire after eight hours and can only
upload staging readings for one event. The official selects a heat, captures the
next race ID, reviews the real measurements and saves the result. Duplicate,
skipped and reset race IDs cannot silently be assigned to another heat. No gate
settings, names or launch controls are changed. Reaction-only mode never supplies
simulated finish times. See `tools/README.md` for setup and the separate internet
connection required while using the track's Wi-Fi.

Timing standings are provisional and separate from the judged ranking snapshot.
Reaction points, Fastest Car award eligibility and automatic knockout brackets
are not yet included: the ruleset's open racing questions remain unresolved.
Physical hardware must be bench-tested; automated protocol fixtures do not prove
track operation.

## What is not here yet

Judging schedule generator, protest and appeal lodging, server-side snapshot verification,
specification scores from scrutineering, automatic race-point calculations and knock-out brackets (later phases). See the design spec in
`docs/superpowers/specs/2026-10-10-event-platform-design.md`.

## Invitation emails

The People screen saves the invitation, then invokes the `send-invitation` Edge
Function. The function verifies the caller and the event's Chair/Organiser role,
looks up the recipient from the pending invitation, and sends a Supabase email
sign-in link through the project's configured SMTP provider. Both new and
existing accounts are supported. The sender's browser session stays signed in.
The recipient's verified email claims their pending roles through the existing
`claim_invitations` flow. Withdrawing the invitation removes that pending access.

Deploy migration `0009_invitation_email.sql` and `supabase functions deploy
send-invitation --project-ref YOUR_PROJECT --use-api` before deploying the client.
For this shared project use the isolated migration installer described above.
The Edge Function uses Supabase's built-in server runtime credentials; no service
key belongs in Vite or Vercel's browser variables. Keep JWT verification enabled.

Add `https://stemracingindia-events.vercel.app/?invite=1` to the redirect allow-list
and publish both auth templates and subjects from `supabase/templates` and
`config.toml`. Requests from other applications keep their generic emails.
The host and the fixed callback are intentionally tied to the production site;
update them together if the domain changes.

Delivery status records SMTP acceptance, not inbox delivery. Failed sends keep
the invitation available for **Resend invitation**, with a 60-second cooldown
per invitation plus Supabase/provider sending limits. Previously created pending
invitations start as **Email not sent**; use Resend to send them. Demo mode
simulates invitations and never sends email.

### Email sign-in and Safari

New STEM Racing emails contain an app-owned confirmation link and an email code.
The link opens a confirmation screen; it does not consume the email token until
the user presses **Confirm and sign in**. The browser then verifies the token
with Supabase and saves its own session, without a redirect carrying bearer
tokens. This avoids consuming links merely by loading a page, including during
mail security scans. Alternatively, enter the email address and the code from
the latest email under **Have a sign-in code?**.

Existing implicit email links remain supported. Expired or used link callbacks
now show a useful message rather than silently showing the ordinary sign-in form.
Email confirmation and all event role permissions remain enforced by Supabase.


### Permanent administrator and organiser scopes

Migration 0015 pins the confirmed Auth account for `reyanshg11111@gmail.com` as the permanent Platform Admin. That account must exist and be confirmed before installation; there is no open first-user bootstrap. Permissions use the stored Auth user ID, not an email supplied by the browser. The owner row cannot be updated, deleted or truncated, and authenticated clients have no direct access to global grant tables.

On **Events → Organiser access**, the Platform Admin or another Platform Organiser can invite a **Platform Organiser** (every event) or a **Competition Organiser** (event creation plus assigned events). Invites use the existing protected SMTP delivery flow and are claimed only by the matching confirmed Auth account. Add Competition Organisers to existing events through **People → Competition Organiser**. Event organisers also receive Chair, moderation, override, ranking publication and release powers within their scope. Judges and team managers retain their existing score visibility limits.

Revoking a global organiser grant stops its global powers immediately. Separate event assignments, including an organiser assignment created when that person created an event, remain; remove those through that event’s People screen if needed. The permanent admin cannot be revoked, demoted or removed by any of these controls. These protections apply to the application/API; a Supabase project owner still controls the database infrastructure.

Apply new migrations through `scripts/render-migrations.mjs` and its isolated SQL output. This preserves the shared project’s unrelated public tables and grants. Migrations 0014 and 0015 must be applied in the same rendered transaction when upgrading from 0013.


### Judge names and Test Event sample data

Judge and Lead Judge invitations require a full name (1–100 characters) as well as the email and panel. The name appears in People, assignment and exemption selectors, Scores and Moderation, and is retained when additional panels/teams are assigned. Existing unnamed invitations remain claimable. Organisers and Chairs can name existing members when adding another panel through People.

`scripts/test-event-data.ts` builds synthetic data for an explicitly identified, empty event named **Test Event**. Its guarded SQL checks the event ID, name, active state and pinned ruleset, refuses released/nonempty events, and inserts all sample records in one transaction. It adds 50 clearly labelled Demo teams, five synthetic judge identities at the reserved `example.invalid` domain, varied cards and feedback, technical measurements, penalties, overrides, race heats and an unreleased ranking preview. It sends no invitations or email, and never enables a public demo-mode switch. Repeating the import is refused rather than overwriting submitted evidence.


The Test Event sample generator reserves team `001` for **SUPERCHARGED**, gives it the highest sample total, and creates distinct totals for every demo team. Any synthetic tie adjustments are recorded as sample moderation overrides. `renderTestEventPreferenceSql` updates only the previously seeded, unreleased Test Event and appends a new immutable snapshot; it reopens/resubmits the affected sample cards through the normal correction flow and refuses unexpected changes to the other sample records.


### Manager emails, result PDFs and award confirmation

Team CSVs accept `manager_email` (also `Team Manager Email`). When that column is present, every row must contain a valid address. Older CSVs without it remain importable; Teams shows missing contacts and lets staff add or change them. Addresses live in the private `team_contacts` table, not public team records. Import prepares an email-verified Team Manager invitation without sending an email at import time. Changing a contact removes an older pending invitation for that primary contact; accepted roles remain manageable through People.

Under **Results → Results PDFs and manager emails**, the Organiser or Chair selects overall award winners and confirms the list. The same controls offer PDF previews and a separate **Email results to managers** button. Sending requires released results, a published ranking containing the team, confirmed awards and its saved manager email. Staff review the recipient list before confirming. The common standings PDF follows the final-points format: a podium summary, highlighted top-three positions, a school/club column, and dedicated confirmed-award pages with repeated branding and page numbers. Every recipient gets three PDFs: the common standings/awards report, their own team's results (summary comparisons, rubric scorecards, specification deductions, race summary and measurement appendix), and separate feedback sheets. The summary uses anonymous low/median/high statistics from the same ranking snapshot. Feedback rating guidance comes from rubric bands; only recorded shared comments are shown as judge feedback. Private judging notes and other teams' detailed scores are excluded.

`send-results` generates attachments on the server and uses the existing SMTP secrets. It accepts reviewed event/team/snapshot/award-version/contact identifiers; the database checks these against current records, selects the real recipient and builds the scoped packet. Neither arbitrary recipients nor uploaded attachments are accepted. Deliveries are idempotent per snapshot, confirmed award version, team and address. Failed sends can be retried; uncertain sends require an explicit recipient-inbox acknowledgement, and successful sends are skipped. Each team sends in a separate request, with progress and a stop-after-current-email control.

Deploy `supabase/functions/send-results` with its `deno.json` import map after applying migration 0017 through the isolated migration renderer. Keep JWT verification enabled. The function uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` already stored as server secrets. No SMTP password or service-role key belongs in the frontend. Tests use local MIME streams and synthetic report data; production verification must not send results until a staff member explicitly confirms the recipient review.
