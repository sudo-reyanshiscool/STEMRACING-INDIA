# 2027 competition platform work

Implementation based on the 24 October 2026 minutes. Deployment authorised on 25 October 2026. Backend migrations and the results service have been deployed; the website is published through the existing production branch. Existing team, race and scorecard counts were preserved. Existing score override behaviour is unchanged.

## Completed software

| Meeting requirement | Implementation |
| --- | --- |
| Organiser evaluation | Existing organiser scopes and Test Event showcase preserved; no Test Event deletion or real invitations sent. |
| Registration and portfolio submissions | Team creation and CSV import retained. Team managers and event staff can upload/replace team PNG or static SVG logos (2 MB) and PDF portfolios (12 MB each) under Team files. Server validates content and authorisation. |
| Private portfolio access | Managers access their own teams. Organisers and the Chair access event files. Judges access the relevant assigned portfolios; conflicts and exemptions block access. Files have no public download URLs. |
| Branding assets | Organisers download a ZIP of team logos using numbered filenames, with a teams.json index. Colliding normalised numbers retain distinct files. |
| Manual race operation | Existing corrections, officials, revision checks, timing capture and exports preserved. |
| Same-team racing | Reaction heats support Car A against Car B of the same team. A car cannot occupy both lanes. Knockout participants remain distinct teams. |
| Lane swaps | Explicit Queue lane-swapped race action, plus automatic back-to-back swapped reaction pairs. Four runs per team, including odd fields and one-team A/B practice. |
| Reruns | Eligible DNS/false-start or equal raw finish replays create a new linked heat and retain the original. Duplicate follow-ups and stale requests are rejected. DNF is excluded from ordinary reruns; a no-finisher DNF match requires official review. |
| Scoring configuration | Existing knockout stage controls plus configurable reaction podium/minimum points, reference multiplier, deductions and Fastest Car bonus. Server validates settings; scoring and ranking fingerprints use the saved configuration. |
| Selective scrutineering | Organisers select an event-wide checklist before inspections begin. The server pins it to each inspection. All 73 regulations are selectable. Unselected checks do not block completion or generate deductions, racing infringements or PDF penalties. Historical inspections keep their full checklist. |
| Team feedback | Managers report judging concerns before or after results release. Organisers and the Chair respond and resolve them. Team isolation is enforced by database functions. |
| Scorecards and distribution | Existing PDF and manager-delivery workflows retained and covered by the regression suite; technical report packets now carry the pinned inspection selection. No real result emails sent. |
| Timing connection | Existing Ethernet/Wi-Fi bridge retained, with configurable application schema and a read-only --check diagnostic. Protocol, application capture and bridge tests are local/simulated. |

## Rollout order

1. Review the implementation and final competition settings.
2. Render migrations with `node platform/scripts/render-migrations.mjs` and install the resulting isolated-schema transaction. Existing migration 0024 is retained. New migrations are 0025_team_concerns, 0026_race_followups, 0027_inspection_scope, 0028_team_files 0029_reaction_scoring, 0030_organiser_display and 0031_private_people_listing.
3. Publish the updated application after the database update.
4. Redeploy the existing send-results function with its updated report code so shared team PDF packets use the selected scope too.
5. Verify organiser, judge and manager access using synthetic records, then let Shubham test the preserved Test Event.

Files are stored as private binary data in the application database; lists fetch metadata only. Logo ZIP export fetches authorised logos individually. File limits are enforced in both the browser and database.

## External steps that software cannot complete

- Shubham must verify the final 2027 scoring values and any exceptional adjudication rules. Existing values come from the pinned 2026 rules, not an approved 2027 rulebook. Adjusted-time ties with unequal raw times require official review; the automatic tied-finish replay action checks equal raw finish times.
- Bench-test the actual start gate, Ethernet connection and physical sensors. The bridge diagnostic is `python3 denford-bridge.py --config /path/to/denford-connection.json --check`; it reads once and uploads nothing. Then test reviewed timing capture, disconnection/reconnection, race-ID resets/skips, DNS, false starts, DNF and manual corrections with synthetic event records.
- Confirm the intended organiser scope for Shubham and review any real invitation before sending it. Nelson Vale was separately granted Platform Organiser access at the user’s request, with his email hidden in organiser and event People/invitation listings. His pending event invitation was not accepted or changed.
- Production deployment was explicitly authorised on 25 October 2026. It uses the existing production branch and hosting integration.

## Verification

The test suite covers team and panel isolation, conflicts, file validation, replacement revisions, ZIP contents/naming, pinned inspection scope, same-team pairing, lane-swap schedules for one through five teams, preserved rerun sources, DNF restrictions, saved scoring settings and installation into an isolated shared-project schema. Existing judging, ranking, PDFs and result delivery are regression-tested. Browser checks used only disposable synthetic preview data.

Final local results: **864 platform tests passed, 2 skipped; 7 Python timing-bridge tests passed; production build passed.** The preview is available at `http://127.0.0.1:5191/.2027-preview.html` while its local server is running. All preview accounts and records are synthetic and reset on reload.
