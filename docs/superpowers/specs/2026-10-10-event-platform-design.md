# STEM Racing India Event Platform: Design

Date: 2026-10-10 · Status: draft for review · Supersedes the scope of `2026-10-08-scrutineering-platform-design.md` (that app becomes one module, see section 8)

## 1. Purpose and scope

An online platform that runs one STEM Racing India National Finals event end to end: registration of teams, judging by six panels, scrutineering, racing (reaction races and knockout), protests, awards, and the final rankings, calculated automatically from the event's ruleset.

**Rules source:** *STEM Racing India National Finals 2026 Competition Regulations* (46 pp.) and *Technical Regulations* (61 pp.), by STEM Racing at The British School, New Delhi. Both PDFs are in `~/Downloads` and are the source of truth. The Aramco World Finals 2026 documents are not used for India.

**Users:** Organiser and Chair of Judges, Lead Judges and Judges (six panels), Scrutineers, Race officials, Teams, and the public.

**Success criteria**
- The final 1000-point table is produced from entered scores with no manual arithmetic, and a second run on the same data gives identical output.
- A judge can score a team on a tablet, with a flaky connection, without losing work.
- Every number on a published ranking can be traced to the scorecards, race results and penalties that produced it.
- A different event format (another year, World Finals) is a new ruleset file, not a code change.

**Out of scope for now:** hardware timing-gate integration (race times are typed in), Development and Cadet classes (the India document defines one class), judge-room video conferencing, payment and registration fees, native mobile apps.

## 2. Phases

Each phase gets its own plan and produces working software.
1. **Core and judging:** events, teams, roles, ruleset engine, scorecards for five judged categories, judging schedule, protests, rankings without racing.
2. **Racing:** race entry, reaction scoring, knockout bracket, Fastest Car bonus, full 1000-point rankings, awards.
3. **Scrutineering and public views:** the scrutineering module moved onto the shared database with the India technical ruleset, live public leaderboard, printable scorecards and result packs.

## 3. Architecture

- **Supabase** (Postgres, Auth, Realtime, Edge Functions, Row-Level Security) for data, logins and live updates. **Vercel** serves the TypeScript web app (Vite, framework-free DOM as in the current code, brand system from section 12).
- **One pure TypeScript engine** (`packages/engine`, no I/O) calculates scorecard totals, race points, knockout progression, penalties, rankings and award eligibility. The browser uses it for live previews; an Edge Function runs the same code to produce the official ranking snapshot. They cannot disagree.
- **Rulesets are versioned data** (JSON, validated by a schema): categories, scored areas and maxima, scorecard criteria with four bands and descriptors, race formulas, knockout point table, tie-break order, award matrix, technical-rule table. An event pins one ruleset version.
- **Offline tolerance:** a judge's device stores unsaved scorecard edits locally and syncs when the connection returns. A scorecard that has not reached the server is shown as "not saved" in the UI.
- **Outside actions:** creating the Supabase project and deploying to Vercel are external side effects. The user is asked before either.

## 4. Roles and permissions

Invitation by email link. Permissions are enforced by Row-Level Security, not only in the UI.

| Role | Can |
|---|---|
| Organiser | Create event, load ruleset, add teams and users, build the schedule, release results |
| Chair of Judges | Everything Organiser can on judging, plus moderate scores, reopen submitted cards, decide protests, ratify rankings |
| Lead Judge | Read their panel's cards, review and cross-moderate their panel |
| Judge | Create and submit scorecards for assigned teams in their panel only |
| Scrutineer | Enter scrutineering results and rectification outcomes |
| Race official | Enter race results, DNS, DNF, false starts, launch order |
| Team manager | Read own team's released scorecards; lodge protests and appeals |
| Public | Read released leaderboard and awards |

Judges sign the conflict-of-interest declaration (C12.1) in the app. A judge cannot be assigned to, or open, a team they declared a conflict with.

## 5. Judging (Competition Regulations C3 to C8, C12)

**Points (C3.5), total 1000**

| Category | Scored area | Max |
|---|---|---|
| Specification & Scrutineering | Specifications | 100 |
| | Engineering Drawings | 20 |
| | 3D Renders | 20 |
| | Quality of Finish and Assembly | 20 |
| Design & Engineering | Portfolio | 180 |
| Project Management | Initiating 35, Planning 25, Executing 20, Monitoring & Controlling 10 | 90 |
| Enterprise | Portfolio only 100, Team Identity 20, Pit Display 60 | 180 |
| Verbal Presentation | Technique 60, Composition 40, Subject Matter 40 | 140 |
| Racing | Reaction 105, Knock-out 135, Fastest Car bonus 10 | 250 |

**Scorecards** come from the appendix scorecards: each criterion has four bands with point ranges and descriptors (for example Verbal Technique: 0-5, 6-10, 11-15, 16-20), and each section has a subtotal. A judge enters an integer within the criterion's maximum, with a band hint, and an optional comment. Submitted cards are locked; only the Chair can reopen one, and the reopening is logged with a reason.

**Combining judges:** when more than one judge scores a team in a category, the team's category score is the mean of submitted cards, rounded to one decimal, with Lead Judge cross-moderation and Chair override recorded as separate audited adjustments. *(Open question 7.)*

**Schedule (C3.1):** the Organiser builds a program of judging streams A to D with 20-minute rotations. The generator places each team in each category once, avoids clashes with race slots, and avoids judge-team conflicts. The result is editable and published to teams.

## 6. Scrutineering and specification (C4, Technical Regulations)

- **Specifications score** starts at 100 per team and loses the penalty points for every infringement on either car (once per infringement per car, T2.5.1). The score never goes below 0. *(Open question 4.)*
- **Technical rule table** is built from the India Technical Regulations, article by article (classes General/Safety/Performance, limits, proportional penalties, measurement conditions). It replaces the World Finals values used by the first scrutineering build; known difference: T4.4.5 halo test is 1 kg with no second test. A rule-by-rule comparison with the World Finals digest is produced during the Phase 3 plan.
- **Rectification (C4.5):** for T3.2, T4.4.4, T4.4.5, T5.1, T5.3, T5.4, T5.5, T5.6, T6.1, T6.2, T6.3 and T7.13, a team gets one 10-minute rectification. If the car then complies, the team pays half the penalty for that infringement and it is not classed as a Safety infringement.
- **Performance failures (C3.6.2):** a car with any Performance failure makes the team ineligible for Fastest Car and Best Engineered Car, shows an "under investigation" mark next to their race times, and if both cars fail and the team is seeded in the top 16 for the knockout, they race only round 1 and are knocked out regardless of the result.
- **Appeals (C11.1):** a team can appeal a specification result within two hours of finishing. An unsuccessful protest or appeal costs 15 points off the total.
- Drawings, renders and finish/assembly are scored by judges on scorecards.

## 7. Racing (C9)

Race times are entered by a Race official to 1/1000 s, as total race time and reaction time.

**Reaction racing (105 points).** 4 races per team over 2 sessions, with each car racing in each lane's rotation as scheduled. *(Open question 1.)* The team's best total race time is used.
- Fastest = 105, 2nd = 100, 3rd = 95, slowest = 5.
- Base Time = 120% of the 3rd fastest time. For 4th and below: `5 + (90 / (Base − F)) × (Base − t)` where F is the fastest team time and t is the team's best time. A team slower than Base scores 5. Among teams on 5, 1 point is deducted per DNF reaction race.
- A reaction false start costs 2.5 points and forfeits that race. DNF: damage or part separation before the finish, or not crossing the line.

**Knockout (135 points).** Seeded by best reaction-race time (open question 2). Single elimination; each team nominates car A or B per round; fastest total race time wins; a tie triggers a sudden-death race; a false start forfeits that race (the other team's time stands; both false start: re-run per C9.9). A DNF costs 2.5 points. Points by stage of elimination come from a stage table in the ruleset: Round 1 (Round of 16) 26, Round 2 (Round of 8) 52, Quarter Final 85, Semi Final 106, Winner 135, others 10. **The document has no runner-up value and lists Round of 8 and Quarter Final separately, so the platform will not generate a bracket until the Chair confirms a points value for every stage the bracket produces.** *(Open question 3.)*

**Fastest Car bonus (10).** The team with the single fastest car race time across all time-trial races.

**Other:** DNS for cars ruled unsafe or ineligible (C9 and the repair rules); weight checks at the track (C9.13); car repair and servicing sessions are logged with the officials' ruling.

## 8. Rankings and awards

**Rankings.** Total = sum of all scored areas, minus protest penalties. Ordered by total; ties are broken by the highest Knock-out score (C3.4); a remaining tie is flagged to the Chair, who decides (decision final). The Chair ratifies results (C12.2) before release.

**Snapshots.** Official rankings are produced by the Edge Function, stored as an immutable snapshot with the ruleset version, input hash, timestamp and ratifying user. Re-publishing creates a new snapshot; the old one stays.

**Awards (C13).** 20 awards. Those derived from scorecard areas via the Awards Matrix are computed (for example Fastest Car, Best Engineered Car, Scrutineering, Pit Display, Verbal Presentation, Project Management, Knockout Champions) subject to eligibility rules. Starred awards (Best Collaboration, Sponsorship & Marketing, Innovative Thinking, Chair of Judges, Research and Development, Team Identity, Digital Media, Women in Motorsport, Sustainability) are nominated by judges and decided by the Chair. Participation certificates for all students.

## 9. Data model (Postgres)

`events`, `ruleset_versions`, `teams`, `team_members`, `users` and `event_roles`, `judge_declarations`, `judging_slots`, `scorecards`, `scorecard_scores`, `scorecard_adjustments`, `inspections` and `inspection_items`, `rectifications`, `races`, `race_runs`, `knockout_rounds`, `knockout_matches`, `protests`, `award_nominations`, `ranking_snapshots`, `audit_log`.

Derived values (totals, ranks) are not stored except in snapshots. Every write by a judge, official or chair is audit-logged with user, time and before/after.

## 10. Testing

- Engine unit tests with worked examples taken from the regulations (reaction points at the named positions and just inside and outside Base Time, knockout stage scoring, specification score with half penalties, tie-break, award eligibility, protest penalty).
- Ruleset schema tests: totals equal 1000; every scorecard subtotal equals its stated maximum.
- RLS tests: a judge cannot read another panel's cards or a conflicted team; a team cannot read before release; the public cannot read unreleased data.
- Offline queue tests (edits survive reload, merge on reconnect, no overwrites of newer server data).
- Playwright flow per phase.

## 11. Carried over from the scrutineering review

The first build's final review found issues that become requirements here: a partly measured per-wheel row must not look finished or reclassify early; result sheets must print measured values, limits and breach detail; importing or syncing must merge per article, not overwrite a whole car; a row note field must exist; the A-vs-B screen must show geometry differences (T3.1.4).

## 12. Brand

The STEM Racing design system (Secondary division theme, Brand Identity Guidelines v1.3) governs the UI as in the first build: dark ground, Magistral Bold Italic headings, MachoModular body, named tokens only, status shown in words not colour alone. The India location logo replaces the primary logo when a PNG is supplied.

## 13. Open rule questions

Each has a default so work can proceed; the Chair or rules owner should confirm.
1. **Reaction race count and launch mode.** C9.1 says automatic launch and 4 races; C9.4 describes driver launch and recorded reaction times; C9.5 scores "all two" times. Default: 4 races per team, best total race time scores.
2. **Knockout seeding source.** C9.7.1 says seed by the "knock-out racing event" (circular). Default: best reaction-race time.
3. **Knockout stage points.** No runner-up value; "Round of 8" and "Quarter Final" both listed. Default: block bracket creation until the Chair confirms a value per stage.
4. **Specification floor.** Default: never below 0.
5. **Tie-break.** Highest Knock-out score (C3.4); then Chair.
6. **C4.6 appeals text** is missing from the India PDF body (the document says so); the World Finals wording (two hours) is used until STEM Racing India confirms.
7. **Combining several judges per category.** Default: mean of submitted cards, rounded to one decimal, with audited moderation.
8. **Number of judges per panel and teams per event** is not stated; the platform does not assume a maximum.

## 14. Risks

- Rules documents are contradictory in places; mitigated by explicit open questions and a ruleset that is data with versioning.
- Hosting and accounts are external dependencies; mitigated by asking before creating them and keeping the engine independent of Supabase.
- Judge connectivity at venue; mitigated by the offline queue and a "not saved" indicator.
- Disputes over results; mitigated by snapshots, audit log and the Chair's ratification step.
