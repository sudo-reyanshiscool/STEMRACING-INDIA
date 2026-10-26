# Submission integrity audit — 26 October 2026

The portfolio and new compulsory-media paths were inspected separately. The new media implementation had substantive production defects; successful local demo tests did not establish shared-server persistence.

## Findings and repairs

1. **Browser-only submissions.** Car renders, models, materials, colours and member portraits were stored in localStorage (with a silently swallowed storage failure). They were not visible to organisers on another device. Replaced this with private database tables and server-authorised RPCs. The browser displays confirmed server state, surfaces save/load failures, provides file downloads, and can recover valid earlier local drafts without deleting the local copy.
2. **Missing production schema.** Production had migrations 0042/0043 but lacked 0041 and its photo tables. Installed the missing migration, followed by 0044 integrity rules. Existing team and judging records are preserved.
3. **Permissions and guide bypass.** New media methods lacked team ownership enforcement; the guide trigger covered portfolios but not photo uploads. Reads/writes now enforce active-event membership, own-team or staff scope, spectator read-only access, release locks, and server-side guide completion for every submission path. Approved-broadcast access for race officials is a separate prepared adjustment pending explicit authorisation.
4. **False processing success.** The processor substituted a tiny placeholder PNG when unavailable. Callers also passed team IDs to an RPC expecting job IDs and did not check its false result. Removed the fabricated fallback; processing now queues an actual job, records completion/failure using its ID, and refuses stale results after photo replacement. Team upload records the original and queues it for organiser processing; it does not claim a cutout exists prematurely.
5. **Unauthorised processing and incorrect dimensions.** Photo completion previously lacked caller/event scope checks. New server checks restrict completion to event staff, bound payload sizes, validate images, derive dimensions from the bytes, reject superseded jobs, and protect released events. Corrected-photo uploads are bounded and validated too.
6. **False checklist readiness and member-role bug.** A name without a portrait counted as complete; blank colours silently became defaults; the role field used the DOM role property. Member name, actual role and image are now required, colour values are explicit, and the checklist describes submitted media categories rather than claiming full registration approval. There is no separate registered-member roster in the data model, so organisers must confirm roster completeness.
7. **Replacement and UI handling.** File/detail revisions detect stale edits. Logo uploads and removal use the canonical team-file record. Team switching cannot retarget an in-flight media edit. Released submissions show read-only controls. Load/save errors remain visible rather than masquerading as success.

## Validation

- Real PostgreSQL-compatible migration tests exercise private storage, independent role read-back, actual downloadable bytes, invalid files, ownership/cross-event restrictions, spectators, guide enforcement, release locks, revisions, canonical logos, stale processing, dimensions.
- Adapter and UI tests cover server failures, member roles, real job IDs, processor failures, old local drafts and read-only controls.
- Existing portfolio deadline, first-receipt, automatic penalty, canonical ranking/release and confirmation-email tests are included in the full regression run.
- The interface was visually inspected using disposable MemoryApi sample data. Synthetic colour changes were used to verify the confirmed checklist update. No real portfolios, photographs, invitations or email receipts were created during verification.
- Live checks confirm 51 teams and 721 scorecards remain present, the hidden organiser remains hidden, and unauthorised media reads are denied.

## Practical limits

- File checks establish supported bounded formats, image headers/dimensions/alpha channel, OBJ vertices/faces and ZIP structure. Organisers still review the actual design, transparent background appearance, materials/texture contents and full team roster.
- Background removal requires the configured processing worker. If it is unavailable, the original remains saved and processing reports failure; there is no pretend successful cutout.
- Files currently consume private database storage, matching existing portfolio/photo architecture. This audit does not upgrade the Supabase plan or migrate files to object storage. Capacity for the planned regional/national uploads still needs to match the chosen plan.
- Confirmation-email code and permissions were tested without sending real email. Inbox/spam delivery is not established by those tests.
