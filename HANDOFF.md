## Latest data update — 20 October 2026: simulations loaded and drafts finalised

User explicitly requested: “put the simulated tests into the scorecards, finalise the drafts”. Data-only update to the seeded Test Event, not a new deployment.

- Submitted all 26 drafts, including the three Athena originals previously preserved. Original marks, criterion comments and judge identities verified unchanged. 717/717 scorecards submitted; no drafts.
- Completed six practice inspections; created Athena Car A/B synthetic checks; reopened and revised the two synthetic SUPERCHARGED inspections to preserve the requested championship scenario, retaining old readings in inspection history. 102/102 inspections submitted and evaluator-complete.
- Preserved every previously recorded race lane. Completed five pending practice heats; added 104 reaction completion/tiebreak heats and 46 bracket heats. Total 225 heats, none pending. Shared seeded knockout setup saved, full bracket finished; four PERF/SAF teams automatically disqualified in round one.
- Practice stage table: [10,26,52,85,106,120,135,10], expressly logged as synthetic rather than an official ruling. One 0.1-point practice moderation adjustment maintains distinct totals.
- Rebuilt immutable snapshot with the real ranking engine and racing fingerprint. SUPERCHARGED 001 first at 987.5/1000; Athena last (51st) at 266.7. All 51 totals distinct and all derived/scorecard areas complete.
- Event was already released when the request arrived. Temporarily withdrew while writing, then restored release with the fresh validated snapshot. Verified public standings, current fingerprint, zero racing issues and 11 unrelated public tables unchanged. No emails sent.
- Audits: `admin_finalise_draft` (26 entries), `practice_racing_finalised`, `practice_final_snapshot`; actual actor is permanent admin, original authors retained.
- /tmp/stem-finalise-* contains source, prepared payload, rollback/commit SQL, final snapshot and verification. Do not rerun blindly; optimistic source fingerprints correctly reject reapplication.

## Latest update — 20 October 2026: racing implemented and live

- Commit `19f61f4` pushed to main. Production READY: `stemracingindia-events-q3tjhb7gv-sudo-reyanshiscools-projects.vercel.app`, with the normal production alias.
- Migration 0022 installed in isolated `stem_racing`; next migration must be 0023. Live counts preserved: 1 event, 51 teams, 717 cards, 100 inspections, 75 existing races; 11 unrelated public tables unchanged. No live racing setup/seeds/test timings created.
- Racing → Competition racing: four-run reaction scheduling; explicit completion; top-64 seed preview/approval; tied seed order confirmation/reordering; six-round bracket, byes, reruns, automatic advancement; stage points editable by organiser/Chair; shared versioned setup and audited race writes.
- User overrides: KO-only +200ms per failed PERF article/+300ms per SAF article on nominated car; a PERF/SAF breach on either car eliminates the team in round one (even with bye); existing point deductions retained. Missing/reopened inspections block progression.
- Derived reaction/knockout/fastest-car points and separate automatic race deductions now feed overall rankings. Missing stage values remain pending; no runner-up/top-64 values invented. Race/setup/inspection fingerprint prevents stale release. Existing unlinked KO heats stay historical, not guessed into the bracket.
- 795 tests passed, 2 skipped, build passed. Synthetic 64-team/63-heat tournament and real browser save verified, including SAF DQ, desktop/mobile layout and no overflow/page errors. Physical Denford track remains untested.
- Full details in `platform/docs/racing.md`. No results released or emails sent by this update. Prior unrelated files preserved.

# STEM Racing India — handoff

Updated 20 October 2026 (Asia/Kolkata). The user is stopping because of usage limits and intends to return in a couple of hours. No reminder or automation was requested.

## Resume here

The latest request is complete: Athena in Test Event now has low practice scores and detailed written feedback. No deployment or database operation remains pending. Wait for the next request rather than repeating the update.

Earlier unresolved request: “faff-ability”. Asked whether this meant customising PDF text/layout/branding, editing scores/feedback before sending, or both; user said they would explain later. Nothing has been implemented for that phrase.

## Workspace and production

- Workspace: `/Users/rg/STEM Racing India ` (trailing space).
- Main app: `platform/` — Vite, TypeScript, Supabase.
- Branch: `codex/scorecard-demo`.
- Remote: `https://github.com/sudo-reyanshiscool/STEMRACING-INDIA.git`.
- Publish: `git push origin HEAD:main`; Git integration deploys automatically.
- Production: `https://stemracingindia-events.vercel.app/`.
- Vercel project `stemracingindia-events`, scope `sudo-reyanshiscools-projects`.
- Latest commit **`25a8c59`**, `feat(events): add reviewable number and judge lot draws`.
- Latest verified READY production deployment: `stemracingindia-events-dwolyuz9t-sudo-reyanshiscools-projects.vercel.app`.
- Supabase project **`qauinbzudjordjsjrgcm`**, isolated schema **`stem_racing`**.
- **Preserve the 11 unrelated public tables. No reset is authorised:** the user cancelled the earlier reset.
- Permanent owner: `reyanshg11111@gmail.com`, UID `16c108c3-3c5d-44ac-8acc-79975f11ebae`.
- No AGENTS.md was found.

Unrelated local work must remain untouched:

```text
 M .claude/launch.json
?? HANDOFF.md
?? ceremony/
?? output/
?? team-intro/
```

HANDOFF.md is intentionally local/untracked. Other listed changes predate this work. No application source changes remain uncommitted.

## Latest live data change: Athena

- **Test Event** ID: `35af7519-5aa5-43f3-a89a-0f7efe01a57e`; has synthetic seed provenance (`demo_seed` audit action).
- **Athena**, team **051**, ID `32bf7958-bc17-44fb-9987-a29a4676a4a1`.
- Event now has **51 teams**: original 50-team sample batch plus Athena.
- Athena originally had three draft scrutineering cards owned by `6d7d85be-2d7b-420f-a452-1dc4fd383bc0`: Engineering Drawings 9/20, Renders 6/20, Finish/Assembly 9/20 (the latter said “Not Good enough”).
- **All three original drafts were preserved. Do not impersonate their author or overwrite them.**
- Added **14 submitted scorecards**, one for every scorecard area, under the permanent owner's own account using the new staff-judging permission.
- Added **35 public criterion comments**, plus detailed overall feedback, strengths and improvement steps for every area: approximately **3,293 words** total.
- Athena has **103/650 across judged scorecards**, ranking **51st of 51**. The 650 denominator covers scorecard maxima, not specification/racing and the full event maximum.
- Other teams' calculated totals were explicitly checked unchanged. SUPERCHARGED remains team 001 and first. That ranking has distinct totals/no ties.
- Published a new immutable ranking snapshot using the actual ranking engine and canonical input hash.
- **Results remain unreleased. No email was sent.** No specification measurements, races or penalties were invented for Athena.
- Shared feedback contains no “demo” filler. Private notes and an explicit `practice_feedback` audit record identify this as an organiser-requested weak-submission scenario, not a judgment based on inspected real materials.
- Verified the live result packet: 14 submitted cards, total 103/rank 51, complete feedback, no filler/private-note leakage; verified 35 substantive criterion comments and 3 preserved drafts.

Temporary files for reference; **do not rerun blindly**:

```text
/tmp/stem-athena-feedback.json          # All authored marks/comments/feedback
/tmp/stem-athena-source-query.sql       # Scoped read-only baseline query
/tmp/stem-athena-source.json            # Baseline before adding cards
/tmp/stem-prepare-athena.ts             # Uses real ranking/technical/review validators
/tmp/stem-prepare-athena.mjs            # Bundled generator
/tmp/stem-athena-prepared.json          # Applied cards/snapshot payload
/tmp/stem-athena-rollback.sql           # Successful dry run, rolled back
/tmp/stem-athena-commit.sql             # Successfully applied
/tmp/stem-verify-athena.sql             # Successful live verification
```

Updater requires the exact unreleased, seeded Test Event/Athena identity, unchanged source hash and no existing owner cards. Reapplying correctly refuses now. This was data-only; no source push was needed.

## Recent completed features

### All-PDF ZIP download — commit 33e7a44

- Results → Results PDFs and manager emails → **Download all PDFs (ZIP)**.
- Common standings/awards once, plus each team's results and feedback PDFs in unique team folders.
- Progress/cancellation, snapshot/award-change checks, no partial archive on failure; protected staff-only packet API.
- Explicit `fflate` dependency; PDFs are stored without redundant compression.
- Verified 50-team archive: **101 actual PDFs**, about 13.93 MB.
- Files: `src/pdf/resultsArchive.ts`, `ui/result-delivery.ts`, shared `results-pdf.ts` (`teamResultPdfFiles` export avoids regenerating standings per team).

### Preview download recovery — commit 1a2a6e7

- Reproduced an old open page requesting a removed PDF chunk after deployment: old `resultReports-CbV_lOGr.js` returned 404 on the new production origin.
- Current live data and PDF generation worked for all 50 teams; a browser downloaded all 3 selected-team reports.
- `ui/pdf-tools.ts` wraps lazy loads in `PdfToolsLoadError`. A specific explanation and **Reload website** button replace the generic failure; queued scores flush before reload.
- Preview team selection survives redraws; removed unused separate logo-module import.
- Successful downloads and intercepted-404 recovery both browser-tested.
- Old open pages need one refresh to receive the fix.

### Staff Judge tab — commit d75803c, migration 0020

- Organisers/Chairs see **Judge** in event navigation/home. Ordinary judges retain **My scorecards**.
- Reuses `/score`; staff select a team and any scorecard panel, without another judge invitation.
- Team/panel selections persist in session storage.
- Staff create **their own** cards; submissions count normally and do not edit other judges' cards.
- Conflicts, exemptions, submission/release locks remain enforced.
- SQL `judge_can_score` recognises staff; staff can declare their own conflicts.
- Dimensions/technical inspections remain reachable under Specification & Scrutineering.
- Files: `ui/scoring.ts`, `scorecard.ts`, `event-nav.ts`, `event-home.ts`, `api/memory.ts`, migration 0020.

### Random draws — commit 25a8c59, migration 0021

- User clarified **both** random judge/team allocations and random team numbers.
- Staff **Draw lots** tab, route `#/event/<eventId>/draw`.
- Unique contiguous numbers from 001, with **SUPERCHARGED pinned to 001**, enforced client/server.
- Balanced teams between selected, accepted judges on a chosen panel; group sizes differ by at most one.
- Conflicts/exemptions excluded. Uses cryptographic random indices and matching/rebalancing paths; reports impossible draws.
- Preview → optional redraw → explicit Apply. Preview never writes.
- Server applies one audited transaction and rejects stale source-state versions.
- Number permutations use an unused temporary namespace to avoid unique-index collisions.
- Only selected judges' scopes on the chosen panel change; other judges, panels and roles remain.
- At least one judge, no more judges than teams; participants must already have accepted that panel's judge role.
- **Setup restrictions:** number draws lock after any cards, inspections, races, snapshots or released results; judge draws lock once that panel has cards/inspections or results are released.
- The populated Test Event is protected. **No live draws have been applied.**
- This allocates teams to judges; **no dated time-slot/timetable scheduler was implemented**.
- Files: `ui/draw-lots.ts`, `draws/random.ts`, `api/draw-lots.ts`, API implementations, migration 0021.
- SQL API: `draw_lots_state`, `apply_team_number_draw`, `apply_judge_draw`; authenticated execution with internal staff checks. State is private staff data.
- Latest full suite: **780 passed, 2 skipped** across 80 files; production build passed; browser preview/apply passed on disposable MemoryApi data.
- Logs/checks: `/tmp/stem-draw-lots-tests-final.log`, `/tmp/stem-browser-draws-check.mjs`, `/tmp/stem-draw-lots-browser.png`.

## Manager emails and delivery requirements

- User first requested `reyanshguptaofficial11111@gmail.com`, then corrected it to **`inbound.stemracingindiaevents@gmail.com`**.
- All **50 teams existing at that time** were updated via `set_team_contact`, with no emails sent. Athena was added later; do not assume its contact or hardcode that address for future imports.
- CSV optional `manager_email`; contacts are private.
- Separate **Email results to managers** button, never automatic on release.
- Managers receive shared final standings/confirmed awards and **only their own teams' detailed results/feedback PDFs**.
- Organiser/Chair selects and confirms award winners.
- Final standings are public to anyone and show total points only. Detailed results are own-team-manager access; judges see own cards, with Specification shared to judges/event staff.
- Server-selected recipients, reviewed snapshot/award/email versions, sent/busy deduplication and explicit inbox-check acknowledgement for uncertain retries.
- Agent sent no actual results emails. An earlier read showed **3 delivery records from user activity**; do not assume the delivery table is empty.
- Edge function `send-results` has existing SMTP secrets; never print/retrieve secrets unnecessarily.
- Sign-in/invitations use Supabase Auth OTP with Gmail SMTP; results emails use Nodemailer/Gmail directly.
- Gmail published limit roughly **500 emails/day**, subject to throttling; custom-SMTP Supabase Auth defaults to **30/hour**, configurable. Current configured Auth cap was not separately retrieved.
- Sources: `https://support.google.com/mail/answer/22839`, `https://supabase.com/docs/guides/auth/auth-smtp`.

## PDFs and reference matching

User supplied and asked for close reproduction, especially scorecards:

```text
/Users/rg/Downloads/T62 - SUPERCHARGED - India - Results.pdf
/Users/rg/Downloads/62 - SUPERCHARGED - India - Feedback_5294.pdf
/Users/rg/Downloads/stem-racing-world-finals-2026-final-points-and-award-winnerspdf.pdf
/Users/rg/Downloads/STEM Racing World Finals 2026 Lockup Non Designation_RGB_Mono_Black_Mono_White.svg
```

Despite its filename, supplied SVG artwork reads **Regional Finals · INDIA**. This was disclosed; lettering retained. Native PDF vector outlines, white on dark headers/black on white pages.

Shared implementation under `platform/supabase/functions/_shared/`:
`results-pdf.ts`, `scorecard-layout.ts`, `results-packet.ts`, `event-lockup.ts`, `scorecard-assets.ts`, `results-fonts.ts`, `results-banner.ts`, `FONT-LICENSES.txt`.
Client re-exports from `src/pdf/resultReports.ts`; source logo `public/brand/event-lockup.svg`; generator `scripts/prepare-report-lockup.py`.

- Exports standings/awards, team results and team feedback builders/file helpers, shared by client and Edge.
- Boxed metadata, full rubric bands/numeric choices, green means, cyan section bars, red totals, matched fonts/reference-like layout.
- Feedback has vertical rating strips and shared-feedback Notes boxes with continuation pages.
- **Privacy:** `criterionNotes` and `internalNotes` are private and absent from report packets.
- **Current criterion text in feedback PDFs is rubric guidance for the mean mark**, clearly explained. Actual shared overall/strengths/improvements appear in Notes. Legacy public criterion comments appear on website scorecards but are not currently in `ResultsPacket` or the PDF criterion column.
- If asked to put authored criterion comments in that PDF column, add an explicit public comments field and tests; never substitute private notes.
- Totals use immutable ranking snapshots; criterion means can differ from authorised overrides, with explanation.
- Race details are own lanes only; no opponent/private-note leakage.
- Shared technical evaluator under `_shared/technical/` is re-exported by `src/technical/` and used by app/reports.

Latest delivered static previews, rendered and inspected (13 and 6 pages):

```text
/Users/rg/STEM Racing India /output/pdf/SUPERCHARGED-results-preview.pdf
/Users/rg/STEM Racing India /output/pdf/SUPERCHARGED-feedback-preview.pdf
```

Older `Final-standings-and-awards-preview.pdf` still has the prior logo; regenerate before presenting again. Runtime builders use the supplied logo.

For PDF authoring, read `/Users/rg/.codex/plugins/cache/openai-primary-runtime/pdf/26.1015.12040/skills/pdf/SKILL.md`; follow its operation marker, render/inspect and file-citation instructions. No PDF artifact was authored for the Athena data update.

## Database, deployment and tools

- **Migrations 0001–0021 are installed and immutable. Append 0022 for the next schema change.**
- Render: `node platform/scripts/render-migrations.mjs`.
- Apply isolated schema SQL with absolute path:

```sh
/opt/homebrew/bin/supabase db query --linked --workdir platform \
  --file '/Users/rg/STEM Racing India /platform/supabase/.temp/live-migrations.sql'
```

- `db query` takes SQL positionally, **not `--sql`**. Run linked DB commands **serially** because temporary login-role rotation can conflict.
- Supabase CLI `/opt/homebrew/bin/supabase`; Vercel `/Users/rg/.npm-global/bin/vercel`.
- Use sandbox escalation for network/deployment/git writes; prior authorised operations were approved. Avoid reconfirming routine already-authorised work.
- Check deployment READY **and the production alias** after pushing.
- For protected Vercel curl, pass the full deployment URL (not `/` with `--deployment`).
- If Edge code changes:

```sh
/opt/homebrew/bin/supabase functions deploy send-results \
  --project-ref qauinbzudjordjsjrgcm --workdir platform --use-api
```

- `.env.local` exists; don't print credentials. No Docker cleanup or unrelated schema changes needed.
- Earlier service-role permission was limited to temporary synthetic test-account checks; do not retrieve that key for routine work.
- Bundled Python: `/Users/rg/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3` (PIL/pdfplumber/pypdf).
- Poppler tools under `/opt/homebrew/bin/`; fonttools/uharfbuzz extras at `/tmp/stem-pdf-font-tools`.
- Playwright installed in root `node_modules`; managed Chromium cached.
- Rolldown: `platform/node_modules/rolldown/dist/index.mjs` for temporary TS checks.
- Local Vite port 5174 may already be occupied; check before starting another server. Sandbox curl may fail while an escalated browser can reach it.
- Browser checks use disposable MemoryApi data; no real invitations/emails or live record changes.

## Email incident — 23 October 2026

- User reported all email sends failing. Read live dashboard logs via Safari's existing session: latest `send-invitation` returned 503 at 20:47:21 IST. Auth OTP request returned 200, then `complete_invitation_email` returned 403 with `only organisers can invite organisers`.
- Root cause: `protect_invitation_role` applied human organiser checks to server-only delivery metadata updates. Service role has no human auth.uid(), so organiser invitations stayed `sending` after accepted OTP requests.
- Added and installed immutable migration `0023_invitation_delivery_guard.sql` through isolated renderer. Guard now allows only delivery-metadata-only updates without role check; all invitation content/access changes retain existing checks, column grants and RLS.
- Added regression test for organiser delivery without human JWT plus Chair restrictions. 23 tests passed across invitation-email, organisers-creators, platform-organisers and isolated-schema suites.
- Live service-role completion tested successfully with the affected reservation inside ROLLBACK. No emails sent; invitation status deliberately unchanged because inbox receipt is unverified. Existing pending invitation can be retried by user.
- Live summary: nine earlier results deliveries `sent`, most recent 20 October; no broadcast history; one invitation `sending` from 23 October 15:17:16 UTC. Latest hour logs showed only this invitation attempt, no result/broadcast attempts.
- SMTP secret names are present; no secret values retrieved. Automatic approval rejected a custom keychain-credential/log API request. Did not execute or bypass it; used existing dashboard UI instead.
- Production ledger confirms 0023 installed. Next migration must be 0024.

## Interactive Test Event showcase — 24 October 2026 (awaiting production approval)

- User requested a special Test Event to demonstrate every tab, with temporary interactive changes that reset on reload.
- Implemented and committed as `d9e92a8` on `codex/test-event-showcase`, based on remote main `04c3441`. No production push occurred.
- Automatic approval review REJECTED `git push origin HEAD:main`: production destination requires explicit user authorisation. Ask the user to approve publishing to `stemracingindia-events.vercel.app` via shared main. Do not bypass this rejection with another deployment method.
- Feature: Open showcase entry on Test Event/Event list for Chair or organiser. `?showcase=35af7519-5aa5-43f3-a89a-0f7efe01a57e` loads existing authorised data into independent MemoryApi. No shared API references remain in its business actions. Every event tab shown, standings/PDFs retained, email actions simulated, scorecards prefilled into separate presenter drafts. Draw setup locks relaxed within this memory copy only. Source results stay withdrawn.
- Auth and MFA checked before loading. Unknown events, missing roles/MFA, loading errors fail closed. Source auth change exits the mode. Queue storage uses memoryKV, feedback ReviewDraft uses demo flag, unique presenter ID each reload. No shared permission changes or migrations required.
- Full suite: 829 passed, 2 skipped; build passed. Later draw/showcase targeted checks: 20 passed; final build passed. Browser edited 20 to 12 then reset to original 20. UI smoke tests render all 11 tabs.
- Screenshot: `output/test-event-showcase-preview.png`. Local sample-data harness at untracked `platform/.showcase-preview.html`; Vite running on 127.0.0.1:5188 in exec session 5647. IAB preview marked for follow-up. This is synthetic fixture data, not actual live event data. Remove harness and stop preview after review/publishing.
- No real emails sent or live event data changed by this task. Real production browser verification remains after user approves publishing.

## Example team manager contacts — 24 October 2026

- User requested all example teams use `shubham@stempify.com`.
- Updated all 51 saved Test Event manager contacts through `set_team_contact`, as the permanent admin, in one guarded transaction. Verified 51 matching contacts. This also stores the normal pending team-manager invitations for that address; no email was sent and existing verified roles were not removed.
- Results remain withdrawn; no scorecards, rankings or race data changed. Result delivery record count verified unchanged.
- Updated the local synthetic showcase fixture contact to the same address so the review preview matches.
- This request did not approve the earlier blocked production code push; showcase publishing remains awaiting explicit approval.

## Simulation number-draw change — 24 October 2026

- User requested removal of “SUPERCHARGED stays 001” and the reservation rule in the simulation.
- Simulation UI now says every team participates; preview generator shuffles all teams, including SUPERCHARGED. MemoryApi showcase apply validation accepts a different SUPERCHARGED number. Shared/ordinary event generator and SQL reservation stay intact.
- New tests prove a non-001 assignment both previews and applies locally while source stays unchanged. 21 relevant tests and production build passed. Browser Draw lots screen verified neutral wording.
- Committed locally on codex/test-event-showcase; no push (production approval still pending). Commit also includes prior requested showcase fixture manager email shubham@stempify.com.
- Latest preview image output/showcase-random-draw.png; IAB now on Draw lots, still using one synthetic fixture team. The real Test Event has 51 teams with manager contacts already updated live, no emails sent.

## Completed six-team simulation — 24 October 2026

- User requested 5/6 example teams with finalised scores across all panels and racing. Expanded the local review preview to six fictional teams (Apex Racing, SUPERCHARGED, Velocity Works, Aurora Motorsport, Quantum Racing, Falcon Dynamics).
- Added reusable browser-safe builder `src/api/showcase-examples.ts`: 84 submitted scorecards (all 14 areas, five panels), 12 fully passing submitted inspections, 12 finished reaction heats (four runs/team) and five finished KO heats. Engine resolves full bracket and all specification/reaction/knockout/fastest-car points with zero racing issues.
- Engine-generated final ranking has six distinct complete totals: 934, 871, 812, 740.2, 673.3, 625.4. Baseline fingerprint confirmed to match the Rankings UI; snapshot and sample awards ready. Source/live results remain withdrawn, and memory example starts unreleased so editing/draws stay possible.
- Every example manager contact is shubham@stempify.com. SUPERCHARGED starts at 002 in this sample and no reservation applies to simulation draws.
- Production feature entry (not yet published): Test Event → Six-team example, same staff/MFA gate, query `?showcase=35af7519-5aa5-43f3-a89a-0f7efe01a57e&examples=6`. Original Open showcase still loads the authorised copy of saved Test Event data. Both modes are isolated MemoryApi; reload regenerates example state.
- Local untracked `.showcase-preview.html` now imports the same production example builder, so it shows all six teams/84 cards/17 heats. It remains at localhost:5188; do not commit the harness.
- Full suite 836 passed, 2 skipped; production build passed. Browser results table and ranking totals verified, including matching published fingerprint and release readiness. No live data writes or email sends for this task.
- Code saved on codex/test-event-showcase. Earlier production push rejection still applies; no explicit publish approval received and no push attempted.

## Optional simulation override reasons — 24 October 2026

- User requested optional override reasons in the ongoing simulation work.
- Showcase moderation labels the field “Reason (optional)” and accepts an empty reason. MemoryApi permits it only for its showcase mode. Blank reasons display without empty parentheses. Ordinary shared events retain their existing reason requirement; no SQL changes or deployment attempted.
- Regression test saves a blank-reason override through the actual moderation form. 68 relevant tests passed; build passed. Saved locally on codex/test-event-showcase.

## 2027 minutes implementation — 25 October 2026

- User asked to build all remaining platform work from the 24 October minutes and clarified that the lack of a visible score-override audit trail is intentional. Override behaviour is unchanged.
- Implemented team-reported concerns, private PNG/SVG logos and PDF portfolios, authorised file retrieval, numbered logo ZIP export, same-team A/B reaction heats, linked lane swaps/reruns, pinned selected inspection scope across scoring/PDF/racing, and configurable reaction/Fastest Car scoring.
- Existing tracked migration 0024_reaction_pairings is preserved. New uninstalled migrations are 0025_team_concerns, 0026_race_followups, 0027_inspection_scope, 0028_team_files and 0029_reaction_scoring. Renderer output refreshed under supabase/.temp. No shared database updates were made.
- Full platform suite: 864 passed, 2 skipped. Bridge: 7 Python tests passed. Final production build and diff whitespace checks passed. Browser checked synthetic manager/organiser concern resolution, judge portfolio access, lane-followup preservation and form styling. Real gate not connected.
- Local preview: Vite on 127.0.0.1:5191 (session 21081), path /.2027-preview.html. Synthetic MemoryApi with organiser/manager/judge switches; every role screen uses disposable data. Reload resets it. IAB marked deliverable. Preview file is untracked and should not be committed as an application entry.
- Screenshot: output/2027-platform-preview.png; detailed status and rollout order: docs/2027-platform-work.md.
- Remaining external work: physical start-gate bench test, Shubham’s final 2027 scoring and exceptional adjudication decisions, and real organiser invitation scope/authorisation. Do not call local verification physical timing approval. Equal-raw-time reruns supported; ties after differing inspection time adjustments require official review.
- Production publishing still requires explicit approval under the prior rejected push recorded above; no new push/deploy was attempted. Rollout needs isolated migrations BEFORE client, and redeployment of send-results for updated inspection-scope reports. No emails sent, no original Test Event data changed.

## Production rollout and Nelson access — 25 October 2026

- User explicitly authorised “deploy everything”, then requested Nelson become a Platform Organiser and his email be hidden.
- Identified Nelson Vale through his existing named event invitation, then matched its email to a single confirmed Auth account: c153b6f9-2e5e-4d58-8f85-ab9108331f84. Granted scope=platform with display_name=Nelson Vale and hide_email=true. No invitation email sent.
- Automatic review rejected an additional claim_event_invitations step because accepting the separate event invitation was not specifically approved. Removed that step and applied ONLY the authorised global grant and email privacy. Pending event invitation remains unchanged.
- New immutable migrations 0030_organiser_display and 0031_private_people_listing redact hidden organiser addresses server-side in platform and event People/invitation lists. Direct browser reads of the corresponding email columns are revoked. The database retains addresses privately for sign-in/server delivery. Keep using list_event_people/list_event_invitations RPCs in clients.
- Installed isolated migrations through 0031. Verified competition counts remain 51 teams, 721 cards, 225 races. Live assertions verified platform_manager() for Nelson, masked platform listing, masked pending invitation and preserved invitation.
- send-results deployed ACTIVE v6 at 2026-10-25 05:59:40 UTC. Production commit 5674d7c pushed to origin/main, including the earlier showcase commits. Vercel deployment dpl_5U51Zhdw3NAgG44Rp7d2NNnzSpxf READY; production alias confirmed https://stemracingindia-events.vercel.app. Deployment URL: https://stemracingindia-events-hd09l9ywj-sudo-reyanshiscools-projects.vercel.app.
- Verification: prior full suite 866 tests with two contact-read tests needing updates for intentionally revoked email-column access; corrected tests passed (28 tests in core/organisers-creators); privacy/isolated-schema regression passed, build passed. Seven Python bridge tests passed earlier. No live timing hardware used.
- Browser: signed-in Platform Admin opened the production site, verified Nelson’s name/Platform Organiser/Email hidden, People’s masked Nelson invitation, event home and Team files. No browser errors observed. Live tab marked deliverable. Screenshot output/nelson-platform-organiser-live.png.
- No production work remains pending from these requests. Physical gate and final 2027 rules verification remain operational prerequisites documented separately. Local synthetic preview files remain untracked, alongside unrelated user artifacts.

## Admin-only Nelson contact visibility — 25 October 2026

- User refined the requirement: other Platform Organisers, especially Shubham, must not see Nelson’s email; the permanent Platform Admin may see it.
- Added immutable migration 0032_admin_contact_visibility.sql, installed live and committed as 3344f52. platform_access and event People/invitation RPCs now expose hidden contacts only to platform_owner.user_id. Restrictive audit/broadcast history policies prevent non-admin retrieval of addresses from past records. Private sign-in/delivery data is unchanged.
- Live assertions passed for admin visibility, non-admin Platform Organiser concealment and Shubham’s current view. Shubham has a pending platform invitation and an unconfirmed Auth account; no invitation was accepted and no access was changed. General non-admin platform scope is tested with a separate synthetic organiser.
- Full suite: 866 passed, 2 skipped. Build passed. Production backend rule is live; source pushed to main. No contact address was printed in verification results, no emails sent.

## Home-page contact visibility report — 25 October 2026

- User reported that reyansh.gupta@british-school.org could see Nelson's email on the home page. Live inspection confirms this is a non-owner Platform Organiser (6d7d85be-2d7b-420f-a452-1dc4fd383bc0). Its live platform_access response was already masked under migration 0032; the visible leak was not independently reproduced. Do not claim a confirmed root cause.
- Added defence against stale/cross-account display: migration 0033 adds viewerId, ownerId and a persistent contactRestricted flag. Supabase adapter rejects responses across session changes. Events passes the current viewer to organiserControls; restricted emails require matching administrator/viewer/response identities. Account changes immediately clear outgoing DOM; read-only organiser rows refresh on focus/reconnection/interval without resetting the invitation form.
- Tests include a stale response containing an actual restricted address, a non-admin current viewer receiving an admin response, and legitimate admin visibility. Full suite 868 passed, 2 skipped; build passed. Migration 0033 installed live, source committed/pushed as f0845e0. Vercel deployment stemracingindia-events-5seu65cd4-sudo-reyanshiscools-projects.vercel.app READY.
- Live response under the exact reported school-account ID verifies viewer matches, notAdministrator=true, Nelson addressAbsent=true, emailHidden=true, contactRestricted=true. No account permissions or invitation state were changed.

## Nelson identity hidden entirely — 25 October 2026

- User clarified the intended rule: nobody except reyanshg11111@gmail.com should see Nelson at all, rather than only concealing his email.
- Added migration 0034_private_organiser_identity with a protected hide_identity flag and enabled it only for Nelson's verified ID c153b6f9-2e5e-4d58-8f85-ab9108331f84. Non-owner platform/People/invitation responses omit the entire row. Direct directory SELECT policies hide corresponding event roles/invitations; audit/broadcast readers cannot recover his identity. Home UI independently omits private identities if the current viewer isn't the verified owner, including stale admin responses.
- Nelson retains Platform Organiser access. No invitation accepted, no account permissions revoked and no emails sent.
- Full suite 870 passed, 2 skipped; build passed. Live assertions checked every current non-owner Platform Organiser plus Shubham's pending account and confirmed absence from organiser/People/invitation directories, owner visibility, and Nelson's active platform_manager access.
- Migration installed, source commit 1bd4d49 pushed to main. Production deployment stemracingindia-events-fzxpp0g15-sudo-reyanshiscools-projects.vercel.app READY. Local preview is still synthetic and should not be used to assess live permissions.

## Three-section judge workspace — 25 October 2026

- User supplied a screenshot showing Event, My scorecards, Scores and requested that this be all judges can see. User explicitly answered that Lead Judges should keep Moderation.
- Judge-only accounts now have exactly those three event tabs, only scorecard/scores home tiles, and route guards blocking other event pages before those screens load. Scorecard/inspection detail routes remain part of My scorecards.
- Accounts with only Judge/Lead Judge roles share this workspace; Lead Judges get Moderation as the fourth tab. A lead without individual Judge assignments gets a clear My scorecards empty state linking to Moderation, without gaining write rights to scorecards. Separately assigned organiser, Chair and operational roles keep their legitimate workspaces. This is an interface restriction; existing data/API permissions are unchanged.
- Added shared ui/judge-access policy and regression tests covering exact navigation, released events, direct routes, role combinations, lead moderation and empty state.
- Full suite 875 passed, 2 skipped; build passed. Commits 75dfca4 and f9b4066 pushed to origin/main. No database updates or account changes for this request.

## Results added to judge workspace — 25 October 2026

- User then requested Results as well. Standard judge tabs are now Event, My scorecards, Scores, Results; Lead Judges add Moderation before Results.
- Shared route policy permits Results and event home includes the Results tile. Existing resultsScreen uses publicStandings for judges/leads and keeps unreleased snapshots private; no permission or database changes.
- 21 relevant navigation/home/results tests passed; build passed. Source commit 800a8d3 pushed to main for production deployment.

## 25 October: hidden account management and Platform Spectators
- Commit 3125348 pushed to main; migrations 0035/0036 installed live (36 total).
- Owner-only hidden invitations and existing account visibility controls in Events → Organiser access. Only permanent owner may assign/manage spectators or hidden accounts.
- Spectators read organiser data including unreleased scores/races; synthetic UI role strips older event roles and backend write triggers enforce read-only even through SECURITY DEFINER RPCs. Hidden identities remain owner-only, pending invitations included.
- Full suite 882 passed, 2 skipped; build passed. Latest identity-helper adjustment retested via 8 SQL/isolated tests.
- Live verified Nelson hide_identity=true, 51 teams and 721 scorecards preserved. No real invitations or grants created.
- Vercel deployment stemracingindia-events-399xk092g-sudo-reyanshiscools-projects.vercel.app.

## 25 October: Submissions page
- Commit 0670c5e pushed to main. Migration 0037 installed live (37 total), 51 teams/721 scorecards preserved, no live files/deadline settings yet.
- New event Submissions route for organisers, Chair, team managers and read-only Platform Spectators. Judge navigation remains unchanged.
- Three portfolio categories with PDFs through existing private file APIs. Server first-submission timestamp persists across replacements; existing file timestamps backfilled (live had none).
- Per-portfolio IST deadline and configurable hourly rate default 5. Each started hour late; missing files accrue until first submission, no cap. No live deadlines auto-configured.
- Dynamic automatic penalty rows union with manual penalties through list_event_penalties; consumed by rankings/results packets. Cannot be manually removed. Canonical validations reject stale/missing penalty inputs at publish/release. Missing-file accrual freezes at released snapshot timestamp.
- Full regression: 888 passed, 2 skipped. Added final actual publish/release test, 7 focused tests pass; build/typecheck pass. Visually checked synthetic organiser and manager page. Local Vite preview at 5192 session 80489.

## 25 October: portfolio confirmation emails
- Commit 3441617 pushed to main; migration 0038 installed live; send-submission Edge Function ACTIVE v1. Existing SMTP secret names verified configured (no values read).
- Successful portfolio upload calls send-submission; logos excluded. Immutable per-file/revision receipt queued by DB trigger; email includes event/team, filename/version, upload/first-submission times, deadline and current late penalty.
- Recipient chosen in DB: team_contacts.manager_email, otherwise verified uploader. Recipient/receipt payload readable only by service_role, never exposed via browser reservation RPC (protects hidden identities).
- Duplicate/concurrent sends blocked; uncertain sends never blindly retried. Failed/pending mail can be retried from Submissions; status survives reload. Upload remains saved if email fails. Spectators cannot send.
- Full regression 897 passed, 2 skipped; build/typecheck passed. No sample email or real upload created.

## 25 October: team manager visual redesign
- Commit 4479ba4 pushed to main, frontend-only; no new migrations.
- Applied frontend-design skill: racing Team Garage direction using existing Magistral/MachoModular fonts, carbon/pink brand colours, numbered race-entry hero, native portfolio progress, deadline/penalty/status cards and numbered toolkit links. Scoped to pure team_manager event roles; mixed operational roles retain their workspaces.
- Styled manager event calendar, submissions/portfolio uploads, files, feedback, results waiting state and released score summaries/meters. All data from existing protected APIs; no permission changes.
- Full suite 900 passed, 2 skipped; build passed. Browser checked 1280px desktop and 390px iframe phone viewport, light/dark themes. Synthetic screenshot /tmp/team-garage-preview.png.
- Local untracked .garage-mobile.html and edits to .2027-preview.html are QA-only and not deployed.

## 25 October: Scheduling & Streams + judge permissions
- Commit 24b9236 pushed to main; migrations 0039/0040 installed (40 total). Live verified 51 teams, 721 scorecards, Nelson hidden, no official schedules published/created by deployment.
- Scheduling & Streams in organiser/Chair event navigation; Spectators have read-only access. Team Garage gains My Schedule, published stream and upcoming appointment summary.
- Cryptographic Fisher–Yates preview allocation, ceil(n/10) balanced alphabetic streams through AA etc, max10, persisted only on Save draft. Explicit regeneration confirmation, stable stream IDs, manual transfers/capacity checks, new-team awaiting allocation and withdrawn-team draft cleanup.
- Event-owned JSON schedule documents with validated team/resource/stream relationships; event_schedules draft and immutable published snapshot, private schedule_history saves/publishes actor+timestamp+document, audit trail. Atomic revision checks/event lock. All Streams is a shared activity scope, no allocation stream or per-team record duplication.
- Multi-day timezone/operating hours, reusable tracks/rooms/panels; timeline filters by day/stream/team/type; manual activity editor and generated sequential slot preview with duration/gap/round count/order, category/all judging exemptions. Existing judge-team exclusions shown separately; no inference that these exempt a team from judging.
- SQL validates allocations, team overlaps, exemptions, stale team-stream associations, operating hours and durations; shared resource/location overlaps are warnings. Block publication on errors. Published versions stay unchanged while drafts edited. Teams receive own filtered published activities only (other team IDs removed); names for resource IDs included. Stream judging blocks explicitly informational, not simultaneous required team appointments.
- Ordinary judge roles now require explicit team_id to score; null means unassigned. All current teams materialises current registration IDs, excludes future registrations. Staff judging rights retained. Both scorecards and technical inspections enforce assignment server-side; inspection edits/submit after reassignment blocked. Existing live null scopes remain unassigned, organisers must assign via People → Judge assignments.
- Lead Judges reopen submitted scorecards only in their panel, with reason + audit, preserving release locks and Chair-only overrides. Reopen locks card row to serialize concurrent requests.
- Full regression: 925 passed, 2 skipped, build passed; final SQL/isolated tests 7 passed after reopen locking cleanup. SQL tests cover100teams, capacity, privacy, multi-race, exemptions, conflicts, publication, cross-event denial, spectators and history. Engine covers 0/4/10/25/53/100/120, labelsAA, timezone conversion and repeated slot generation. UI tests preview/save, regeneration confirmation and team-only published views.
- Browser checked organiser timeline and manager schedule, desktop and390px mobile. Sample screenshot /tmp/team-schedule-preview.png. Synthetic preview additions remain untracked (not production data).
