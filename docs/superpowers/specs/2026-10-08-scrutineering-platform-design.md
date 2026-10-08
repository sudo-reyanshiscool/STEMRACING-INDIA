# STEM Racing India Digital Scrutineering Platform: Design

Date: 2026-10-08 · Status: draft for review

## 1. Purpose and scope

An offline-first web app (PWA) that event scrutineers use at the inspection bench to record
measurements for each STEM Racing car, check them against the Aramco STEM Racing World Finals 2026
(WF26) Professional Technical Regulations, and get automatic penalty totals and a printable result sheet.

**Primary user:** event scrutineers (officials), on a tablet or laptop, often with no reliable wifi.

**In v1**
- Bench checklist with automatic pass/fail and penalty calculation.
- Team and car registry (each team has two race cars, A and B).
- PDF result sheet per car.

**Out of v1 (YAGNI):** multi-scrutineer live sync, logins, re-inspection / service-session log,
leaderboards, Development/Entry classes, India-specific rule variants, Competition Regulations
(C-prefix) logic such as half-points for Safety items fixed in the 20-minute service session.

**Success criteria**
- A scrutineer can inspect one car end to end, offline, in bench order, and see a correct penalty total.
- Penalty maths matches the worked examples in the regulation digest exactly.
- Adding another class or season means adding a rules file, not changing engine code.

## 2. Architecture

Static PWA, no backend: TypeScript + Vite, service worker for offline use, IndexedDB for storage.
Deployable to any static host or runnable from local files.

Units (each testable on its own):
- `rules/` : typed WF26 rule data (one record per article).
- `engine/` : pure functions `evaluate(rule, measurement) -> Result`, and `summarise(results) -> CarSummary`. No UI or storage imports.
- `store/` : IndexedDB access (events, teams, cars, inspections) and JSON export/import.
- `ui/` : screens (team list, checklist, car summary, A-vs-B compare).
- `pdf/` : client-side PDF generation from a `CarSummary`.

## 3. Rules engine

Each rule record: `{ article, name, class: GEN|SAF|PERF, kind, limits, penalty, notes }`.

Check kinds:
- **range**: min and/or max, flat or proportional (PP+). Covers T3.4-T3.7, T5.2, T5.6, T7.2-T7.5, T7.11, T8.6.x, T9.5.x.
- **pass/fail**: gauge, tool or visual checks (e.g. T4.4.1, T7.10, T9.7), flat penalty.
- **per-wheel / per-axle**: T7.4-T7.8, T7.13 multiply by the number of wheels/axles failing.
- **tiered**: T7.9.1-T7.9.4, each zone with its own penalty.
- **composite**: span rules (T8.6.1, T9.5.1) take the shortest of leading edge, trailing edge, top and bottom measurements.

Behaviour:
- Limits are absolute (47.9 g fails a 48.0 g minimum, T2.7.1). Entered values include paint/decals (T2.7.2).
- PP+ (T2.5.2): breach rounded UP to the next whole unit (1.0 mm or 1.0 g), times the per-unit rate.
- Penalties apply once per infringement per car; A and B are assessed separately (T2.5.1).
- T7.4 / T7.5: if only one wheel on an axle is out of limit, points stand but the infringement is reclassified General.
- T3.6: when weight is under the minimum, the sheet notes that officials add underside ballast at 0.2 g per 0.1 g under.
- Any PERF failure sets `ineligible: [Fastest Car, Best Engineered Car]` (T2.4.2).
- SAF failures are listed as requiring fix in the single 20-minute service session; no half-points logic in v1.
- Margin warning when a value is within 0.5 mm / 0.5 g of a limit.
- Cartridge-in conditions (T3.5, T3.7, T5.2, T5.4, T7.6, T7.11) are shown on the row as a reminder; static stance (resting on all four wheels unaided) is a checklist item.

Source of truth: `wf26-technical-digest.md` and the official PDF. Regulation text governs; the known typos
listed in the digest (T8.5.x vs T8.6.x in appendices, T7.12.1 cross-reference) are resolved to the corrected numbers.

## 4. Data model (IndexedDB)

- `Event { id, name, date, venue, rulesetId }`
- `Team { id, eventId, number, name, school }`
- `Car { id, teamId, label: 'A'|'B' }`
- `Inspection { id, carId, scrutineer, startedAt, updatedAt, measurements: { [articleKey]: value|bool|number[] }, notes: { [article]: string } }`

Results (pass/fail, penalties, totals, warnings) are derived by the engine on read and never stored,
so a rules fix recomputes everything. JSON export/import allows backup and manual merging between devices.

## 5. Screens (tablet-first, large touch targets)

1. **Event / team list**: search; per-car status badge (not started, in progress, clean, penalties).
2. **Bench checklist**: sections in bench order: registration, scales and gauges, chamber and cartridge,
   tether guides, wheels, nose and front wing, rear wing, halo/helmet/ballast, drawings pack. Each row shows
   article, limit and class; numeric or pass/fail input; live penalty; sticky running total.
3. **Car summary**: per-car and A+B pair totals; PERF failures listed separately with the award-ineligibility
   banner; SAF failures flagged for service; at-risk margins; drawings-pack gaps (5 pts each).
4. **A vs B compare**: highlights shared faults (cost doubles, T2.5.1) and A/B geometry differences (T3.1.4).

## 6. PDF result sheet

Generated client-side (works offline). Contents: event, team, car, scrutineer, date; table of every article checked
(value, limit, pass/fail, class, penalty); totals; PERF/SAF sections; award-ineligibility note; at-risk margins;
signature line.

## 7. Testing

- Engine unit tests using the digest worked examples as fixtures:
  - rear wing span 47.2 vs 50.0 (T9.5.1) -> 6 pts per car
  - weight 46.5 vs 48.0 g (T3.6) -> 20 pts per car
  - wheelbase 141.3 vs 140.0 (T7.3) -> 10 pts per car
  - front wheel obstruction 22.4 vs 20.0 (T7.11) -> 30 pts per car
  - both rear wheels at 13.8 vs 15.0 contact width (T7.4.2) -> 10 pts per car; one wheel -> same points, General class
- Rule-data tests: every PP+ article listed in T2.5.2 is present and marked proportional.
- One Playwright flow: create event and team, inspect a car offline, confirm totals, export PDF.

## 8. Risks and open points

- Official PDF is authoritative; rule data entry errors are the main risk, mitigated by the tests above and
  a rules-data review against the PDF before release.
- Amendments are published on stemracing.com; the rules file carries a version and issue date shown in the UI and on the PDF.
- Safety half-points handling depends on the Competition Regulations (not bundled); deferred.
