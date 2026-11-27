# Paddock Pass: digital ID cards for regional events

Status: draft for approval · 28 November 2026

## Why

Regional events print a physical ID card for every student and team manager. Dropping the print run saves money.
The replacement has to do the two jobs the printed card did, and it should look spectacular while doing them:

1. **Entry.** Staff at the entrance confirm the person belongs at the event.
2. **Glance checks inside.** Staff at a judging-stream door, the track or the pits see at a glance that the person is
   an accredited member of a particular team and stream.

"Paddock Pass" is the working name for the feature.

## What the platform already holds

- **Students.** Each team's media submission (`team_media_details.members`) holds up to 12 members with an id, name,
  role and portrait. Students have no accounts.
- **Team managers.** One or more `event_roles` rows with role `team_manager` per team. They sign in. No name or
  photo is stored for them (`display_name` is empty for managers today).
- **Team and event.** Team number, name and school; the published schedule gives each team its stream and its
  activities with times and rooms.
- **A no-login precedent.** The remote big screen reads through key-checked `security definer` functions without a
  session. The pass page follows the same pattern.
- **No offline support.** The earlier offline worker at `/sw.js` was deliberately retired and unregisters itself.

## Goals

- Every student and team manager at a regional carries a pass on a phone.
- A pass can be confirmed as genuine by a scan, checked on the server, and a screenshot of it stops working quickly.
- A pass is visibly live at a glance, with no scanner, and shows team and stream prominently.
- A pass opened once keeps working with no signal. Scanning also works with no signal and syncs later.
- The card looks like a premium holographic credential and stays readable. It runs smoothly on a mid-range Android
  phone, falls back cleanly without WebGL, and respects reduced motion.
- It works in the new and classic looks and in light and dark themes.

## Non-goals

- Passes for judges, officials and organisers. Not asked for in this round.
- Student accounts, or any collection of student email addresses or phone numbers.
- Native wallet passes (Apple Wallet, Google Wallet).
- Access zones or per-door permissions. A pass says who someone is, not where they may go.
- Replacing how portraits are submitted. The pass reuses the portraits teams already submit.

## Anti-goals

- A pass that a screenshot or a forwarded link can copy without anyone noticing.
- Effects that make the name, team or stream hard to read, or that stutter on an ordinary phone.
- Any screen that shows the hidden owner or hidden administrator. Passes exist only for students and team managers,
  and no pass screen shows who issued, reset or scanned a pass.
- A pass page that needs signal at the door.

## Decisions made with the user

| Question | Decision |
| --- | --- |
| Who gets a pass | Students and team managers |
| How it is checked | Scan at the entrance; glance checks elsewhere, still holographic |
| Connectivity | Assume patchy. Passes and scanning must work offline |
| How students get a pass | A personal link from the team manager, plus the manager can show any of the team's passes |
| Look | The prototype's direction, toned down: keep the foil and hologram, calm the line work and motion |

## Approaches considered

**How a student gets a pass**

- **A. Personal link, locked to one phone (chosen).** The manager sends each student a link or shows a QR. The first
  phone to open it holds the pass. No accounts, and each student can move around alone.
- **B. Manager's phone only.** Simplest, but students must stay with the manager to be checked. Kept as the
  fallback inside A: the manager's page can present any team member's pass.
- **C. Student accounts.** Ruled out. It means collecting minors' email addresses and a sign-up for every student.

**How a pass proves it is genuine**

- **A. Rotating code from a secret held on the phone (chosen).** The phone holds a secret key it cannot export. The QR
  is a short message authenticated with that key and the current 30-second window. The server holds the same secret
  and checks it. Works with the database alone and verifies offline from a downloaded door list.
- **B. Server-signed pass plus a device signature.** Stronger separation, since scanners would need no secrets, but
  Postgres has no built-in signing, so it needs an edge function for every issue, and the QR is three times larger.
- **C. A static QR looked up on the server.** A screenshot is as good as the pass. Ruled out.

**Where the student's pass lives**

- **A. A small standalone page at `/pass/` with its own offline worker (chosen).** Light, loads fast on a phone, and
  the worker is scoped to `/pass/` so the main app stays exactly as it is, with no worker.
- **B. A route in the main app.** Pulls the whole app bundle and the sign-in flow onto a student's phone, and
  offline support would mean bringing back the app-wide worker that was retired.

## Design

### The pass

One row per person per team in a new `passes` table.

- A **student pass** points at a member id inside `team_media_details.members`. Name, role and whether the member
  still exists are always read live from there. Removing a member from the submission kills the pass.
- The submission page corrects a member by removing and re-adding them, which gives the member a new id. So that a
  typo fix or a new portrait does not strand a student, a pass whose member has gone is re-linked to a new member of
  the same team with the same name (ignoring case and spacing) or the same portrait. If both changed, it is a new
  person and needs a new link.
- A **manager pass** points at the manager's user id and team. The manager types their own name once. They may add
  a portrait from their camera. A manager pass without a portrait shows the team logo in the photo frame.
- Each pass stores a small portrait (JPEG, about 320 px wide, at most 64 KB) made on the manager's device from the
  submitted portrait. The door list for a whole event then stays a few megabytes. The pass records a hash of the
  source portrait, worked out by the database, so a changed portrait is noticed and the small copy is remade the
  next time the team's passes are opened.
- Each pass has a **device secret** (32 random bytes). It is created when a phone claims the pass and replaced
  whenever the pass is reset.

### Issuing: the "Paddock Passes" page

A new page in the event menu, under Teams, for team managers, organisers and the Chair.

- A manager sees their own team. Staff pick a team, which also serves as a help desk on the day.
- Opening the page creates any missing pass rows for the team's current members and for the manager.
- Each person appears as a live card in a swipeable row. The centred card runs the shader; the others are still.
- Under each student card: **Send to phone**. It shows a QR and a link to copy or share. Each press makes a fresh
  single-use link and cancels the previous one. Status reads Not sent, Link sent, or On a phone since a given time.
  If the pass is already on a phone, the button asks for confirmation first, because the new link replaces it.
- **Reset** (with a confirmation) cancels the pass on its current phone, for a lost or changed phone.
- **Show this pass** opens any team member's card full screen on the manager's phone, including the scan side, for
  students without a phone. The manager's phone holds its own presenter secret for each pass it shows this way.
- The manager's own pass is the first card. The manager's phone gets its secret through the signed-in session.

### Claiming: the student's phone

The link is `https://<host>/pass/#<pass id>.<claim token>`. The token sits after the `#`, so it is never sent to the
web host or written to a log.

1. The pass page reads the fragment and calls `claim_pass`. The server compares the token's hash, checks the pass is
   unclaimed and the event is active, creates the device secret and returns it once with the card's data.
2. The page stores the secret as a non-exportable signing key in IndexedDB, stores the card data beside it, and
   removes the fragment from the address bar.
3. From then on `/pass/` opens the stored pass with no network at all. One phone can hold several passes (siblings).
4. When online, the page refreshes the card data (schedule changes, a reset) by proving it holds the secret.

A link that has been claimed, replaced or reset shows "This link has already been used. Ask your team manager for a
new one."

### The card

One shared card module draws both the student's page and the manager's cards.

**Front, for a glance**

- Event lockup, portrait in a leaning frame, name, role, team number, team name, school.
- A full-width band in the team's **stream colour** with the stream name, and a clock ticking in seconds. Colours
  come from a fixed palette in stream order (A, B, C and so on), chosen to be told apart at a distance and by
  colour-blind staff, with the stream name always written on the band. Before a schedule is published the band is
  neutral grey and reads "Stream to be announced".
- The **sync pulse**: a shape and colour that every valid pass at the event shows at the same moment, changing
  every 8 seconds. It is derived from the time and a per-event key that only passes and event staff hold. A
  screenshot or recording is out of step.
- **The reference.** Everyone with a staff role at the event (organisers, Chair, judges, scrutineers, race
  officials) sees the current pulse on the event's home page under "Pass check", and organisers also see it large on
  Door check. The key is kept on the device once fetched, so the reference keeps running without signal for as long
  as the page stays open.
- Valid dates, from the published schedule's days, or the event's start date when no schedule is published.

**Back, for the scan**

- A large QR on a white tile, a bar showing the time left before it changes, and the holder's name and team.
- The team's next activities from the published schedule, worked out on the phone so it is right offline.
- The screen is kept awake while this side is showing, where the browser allows it.

**The look (the prototype's calmer cut)**

The approved reference is the second version of the throwaway prototype (a private page, not in this repository).
Its shader and layout are the starting point: the build ports them into the card module and trims further where
needed for speed. The prototype's fake data, controls and fixed sizes are not carried over.

- Kept: carbon weave that shifts with tilt, the prismatic foil team number with glitter facets, the two-image
  hologram patch (chequered flag one way, the holder's ghost portrait the other), the stream band, the clock.
- Calmed: the banknote line work drops to a faint band behind the hologram patch and stays clear of all text. The
  chevron sweep across the whole card goes; the pulse is the glyph plus a thin line along the stream band. The
  moving edge light becomes a steady thin iridescent border that only shifts with tilt. The track watermark is
  fainter. Idle motion is slower and smaller.
- The card is always carbon, like the platform's frame, in both themes and both looks. The page around it follows
  the theme and look.

**Motion and tilt**

- On a phone the card follows the phone's tilt (device orientation). iOS asks permission, so the first tap on the
  card requests it. Without it, dragging a finger or moving the pointer tilts the card.
- With reduced motion set, there is no idle movement and no animated transitions. The clock and pulse still change,
  because they carry information. Tilt by touch still works.

**Performance and fallback**

- One WebGL canvas per visible card, one full-screen fragment shader, WebGL 1 for reach. Pixel ratio is capped at 2,
  and at 1.5 on devices reporting 4 GB of memory or less. The loop drops to 30 frames a second when the tilt is
  steady and stops when the page is hidden.
- If WebGL is missing, fails to compile, or the context is lost, the card switches to a CSS-only version with the
  same layout: gradients for the carbon, a conic-gradient foil number that follows the tilt.
- Text is real DOM text over the canvas, so it stays sharp, selectable by screen readers and readable in the
  fallback.

### The rotating code

- Format: `SRI1.<pass id>.<window>.<mac>`. The window is the Unix time divided by 30 seconds. The mac is the first 8
  bytes of HMAC-SHA256 over `SRI1|<pass id>|<window>` with the device secret.
- A check accepts the current window and one either side, so a code is good for 30 to 90 seconds.
- When online, the pass page keeps its clock in step with the server using the time returned by each refresh.
- HMAC is written in SQL on top of Postgres's built-in `sha256`, and tested against the RFC 4231 vectors, so the
  live database and the test database behave identically without an extension.

### Door check: the scanner

A new "Door check" page in the event menu for organisers and the Chair.

- It opens the camera and reads QR codes with the browser's built-in detector where there is one, and a bundled
  decoder (loaded only on this page) where there is not.
- **Online**, each scan calls `check_pass`. The answer is one of: Genuine (with portrait, name, role, team and
  stream), Code just scanned (see below), Expired code (ask them to show the live pass), Reset or removed, Not a pass
  for this event. Each has a distinct colour and icon, and the phone
  vibrates where supported.
- **Offline**, the page uses a door list downloaded in advance: every pass's details, portrait and secret, held in
  IndexedDB. It verifies the code on the phone, shows the same results, and queues the check. Queued checks upload
  when signal returns. The page shows how old the door list is and how many checks are waiting.
- The page shows the current sync pulse, large, as the reference for glance checks.
- **Arrivals**: a count and a per-team list of who has checked in, built from the recorded checks.
- Every scan of a genuine pass is recorded and reads Genuine. If the person was already scanned that day, the result
  adds "First seen today at 08:52". Days follow the event's timezone, and Arrivals is per day.
- A replay is narrower: the very same code scanned again from a different scanner, or more than five seconds after
  the first scan. That reads "This code was just scanned" in amber, because it is how a passed-back screenshot looks.
  The same scanner reading the same code twice within five seconds is treated as one scan.
- The door list is deleted from the phone on sign-out, by a "Remove from this phone" button, and automatically
  three days after it was downloaded.

### Offline

- `/pass/` is a second entry in the Vite build, with no dependency on the main app or on supabase-js. It calls the
  database functions with plain `fetch`.
- A worker at `/pass/sw.js`, scoped to `/pass/`, caches the page, its scripts and styles, the fonts and the event
  logo. After the first visit the page loads with no network. The main app is untouched and still has no worker.
- The page asks the browser to keep its storage (`navigator.storage.persist`).
- Known limit: iOS can clear a site's storage after seven days without a visit. A student who claims early and
  never opens the pass again may need a new link. The manager can send one in seconds, and the page says so.
- No "add to home screen" prompt in this version. On iOS an installed web app has separate storage from Safari, so
  a pass claimed in Safari would be missing from the installed copy.

### Privacy and security

- The three new tables (`passes`, `pass_checks`, `event_pass_keys`) have row-level security on and no grants. All
  access is through `security definer` functions that check the caller.
- A team manager can list, send, reset and present passes only for a team they manage. Organisers and the Chair can
  for any team in their event. Nobody else can. Platform spectators cannot see or issue passes.
- Without a session, a caller can only claim a pass with a valid single-use token, or refresh a pass by proving it
  holds the device secret. Pass ids are random UUIDs.
- Claim tokens and the page fragment never reach the web host. Tokens are stored only as hashes.
- Door staff see a student's name, role, team and portrait. That is what the printed card showed.
- Checks record which account scanned, for audit only. No screen displays it, which also keeps the hidden accounts
  out of view.
- The door list puts pass secrets and portraits on an organiser's phone. Organisers can already issue any pass, so
  this grants nothing new, and the list is wiped as described above.
- Everything is removed with the event or team (`on delete cascade`).

What a determined cheat can still do: hand their unlocked phone to someone else. The portrait on the scanner is the
defence, as it was with a printed card.

### Data and functions

Migration `0059_paddock_passes.sql`.

Tables

- `passes`: id, event, team, kind (`student` or `manager`), member id or user id, holder name (managers), the
  member's name key for re-linking, portrait and its source hash, claim-token hash, holder secret, presenter secret, claimed-at, reset count.
- `pass_checks`: id (made on the scanning device, so a retried upload is harmless), pass, event, window, result,
  gate label, scanned-at, scanned-by, recorded-at.
- `event_pass_keys`: event, pulse key.

Functions

| Function | Caller | Does |
| --- | --- | --- |
| `team_passes(event, team)` | manager of the team, staff | Creates missing rows, returns the team's passes and card data |
| `set_pass_portrait(pass, jpeg, source hash)` | same | Stores the small portrait |
| `set_manager_pass_name(pass, name)` | the manager, staff | Sets the name on a manager pass |
| `pass_link(pass)` | same | Makes a new single-use token, cancels the old one and any claimed phone |
| `reset_pass(pass)` | same | Cancels the token and the phone without making a new link |
| `present_pass(pass)` | same | Returns a secret so the caller's phone can present this pass |
| `claim_pass(pass, token)` | anyone with the link | Checks the token, returns the secret once and the card data |
| `pass_card(pass, window, mac)` | the phone holding the pass | Returns fresh card data and the server time |
| `check_pass(event, code, gate, check id)` | organisers, Chair | Verifies, records the check, returns the result |
| `door_list(event)` | organisers, Chair | Everything the scanner needs offline |
| `record_pass_checks(event, checks)` | organisers, Chair | Uploads checks made offline |
| `pass_arrivals(event)` | organisers, Chair | Who has checked in, per day |
| `pass_pulse_key(event)` | any staff role at the event | The key behind the sync pulse reference |

A pass holds two secrets: the holder's (set by `claim_pass`) and the presenter's (set by `present_pass`). A code made
with either is accepted, so a manager showing a student's pass does not take it off the student's phone. The scanner
says "Shown by the team manager" when the presenter's secret was used. Each secret lives on one phone at a time:
claiming or presenting again replaces it.

### App structure

- `src/pass/`: the standalone page's entry, storage, code generation and the fetch client.
- `src/pass/card/`: the shared card (DOM, shader, CSS fallback, tilt), used by the standalone page and the main app.
- `src/api/`: pass methods added to the interface in `types.ts` and to the Supabase and in-memory implementations.
- `src/ui/passes.ts` and `src/ui/door.ts`: the two new pages, with routes `passes` and `door`, in both event menus.
- Styles for the two pages in the new and classic stylesheets. The card's own stylesheet is shared and theme-free.
- New dependencies: `qrcode-generator` (drawing QR codes) and `jsqr` (reading them where the browser cannot).

### Testing

- **SQL (pglite):** HMAC against RFC 4231; who may list, send, reset and present passes; claiming once, with a wrong
  token, after a reset, on a deleted event; codes in the current, neighbouring and stale windows; replay; a removed
  member; the door list and checks restricted to staff; signed-out and ordinary signed-in callers cannot read the
  tables; no function output contains the scanner's identity.
- **Unit:** the TypeScript code generator agrees with the SQL verifier on fixed inputs; pulse derivation; parsing
  bad codes; the offline queue and its retry.
- **UI (jsdom):** the Paddock Passes page for a manager and for staff; the card without WebGL; reduced motion;
  each Door check result; both looks.
- **By hand on the Test Event:** claim a pass on a real phone, scan it from another, switch the network off and
  repeat, reset it and confirm the old phone is refused.

### Rollout

1. Build on `feature/paddock-pass`. Run the suite.
2. Install migration `0059` on the live database before any app code is pushed.
3. Demonstrate on the Test Event with team 001.
4. Ask before merging to `main`, since that deploys production.

## Calls made by the builder, open to correction

- The feature is called Paddock Pass.
- Only organisers and the Chair can scan. Race officials and scrutineers could be added later.
- Every staff role at the event sees the sync pulse reference; team managers and spectators do not.
- Stream colours are automatic, not chosen by organisers.
- A corrected member keeps their pass when the name or the portrait is unchanged.
- The pages appear for every event, not only regionals, so the Test Event can be used to try them.
- "The event is active" means the event has not been deleted, as elsewhere in the platform.
- A manager types their own name and may add their own portrait. Nothing verifies either beyond the manager's
  sign-in.
- A code lasts 30 seconds and is accepted for one window either side.
- The sync pulse changes every 8 seconds.
- A pass lives on one student phone at a time, plus the team manager's phone when the manager presents it.
- No home-screen install in this version.
- The card is always carbon, in every theme and look.
