# STEM Racing India platform guides

Three captioned walkthroughs built from real platform screens populated with synthetic event data. The guides have no narration or soundtrack.

## Edit

`src/content.json` is the authoritative script and scene timing. Each scene has a title, instructional lines, optional screenshot crop, and optional highlight rectangle. Screens are saved in `public/screens`; selected crops are generated under `public/crops`.

`src/Root.tsx` contains the 1080p Remotion compositions and frame-driven transitions.

## Build

```sh
npm install
python3 scripts/prepare.py
node scripts/render.mjs --stills
node scripts/render.mjs --storyboard
python3 scripts/encode.py
python3 scripts/delivery.py
```

The renderer uses the installed Google Chrome application on macOS. Change `browserExecutable` in `scripts/render.mjs` for another environment. Results go to `../output/walkthroughs/`.

For direct frame-by-frame animation rendering, use `node scripts/render.mjs`. The delivered captioned editions hold each checked instruction scene for reading, with short fades and embedded chapters.

Render one guide by adding `Teams`, `Judges`, or `Organisers` to the render command. The source and screenshots reflect the platform as inspected on 26 October 2026. New platform changes may require new captures and script updates.

All accounts use `preview.invalid`; all teams, schedules, files and judging data are synthetic. The screenshot harness uses MemoryApi and cannot mutate production. No hidden real account is included. The organiser example has both Organiser and Chair access, and the guide labels Chair-only actions explicitly.
