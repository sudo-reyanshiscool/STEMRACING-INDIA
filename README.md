# STEM Racing India digital scrutineering

Offline-first checklist for scrutineers at STEM Racing events. Enter measurements for each car, see penalties
from the Aramco STEM Racing World Finals 2026 Technical Regulations (Professional class) computed live, and print a
result sheet. Records stay on the device; export a JSON backup to copy or merge them.

## Run

    npm install
    npm run dev                        # develop at http://localhost:5173
    npm run build && npm run preview   # production build at http://localhost:4173

## Test

    npm test           # engine, rules, store, UI and PDF unit tests
    npm run e2e        # offline end-to-end test (needs: npx playwright install chromium)

## Using it at an event

- Host the built `dist/` over **https** (for example Vercel), or serve it from `localhost`. Service workers and
  offline mode do not work on plain `http://` LAN addresses or `file://`.
- Open the app once with internet so it can cache itself. After that it works with no connection.
- Each device keeps its own records. Use **Export backup** on one device and **Import backup** on another to merge.

## Rules

The WF26 rules live in `src/rules/wf26.ts`, copied from the regulation digest (issued 10 February 2026). To add
another class or season, add a new ruleset file with the same shape. Amendments are published on stemracing.com;
check the clarifications page before an event. The Competition Regulations (C-prefix) are out of scope, including
the half-points rule for Safety items fixed in the service session.

## Brand

Colours, type, components and logo rules follow the STEM Racing design system
(https://claude.ai/artifact/KutpCGGzkX3doLkwNpHZCQ), the Secondary division theme of the Brand Identity Guidelines v1.3.
Replace `public/brand/logo-full-colour-white.png` with the India location lockup when a PNG is available.
The PDF uses Helvetica because jsPDF cannot embed the web fonts.
