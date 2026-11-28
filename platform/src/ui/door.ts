import { ApiError, type PassArrivals, type PassCheckOutcome, type PassCheckResult, type QueuedCheck } from '../api';
import { streamColour } from '../pass/card/streams';
import { openDoorStore, DOOR_LIST_DAYS, type DoorCache, type DoorStore } from '../pass/door-store';
import { cameraFault, startScanner, type Scanner } from '../pass/scan';
import { verifyOffline, type SeenScan } from '../pass/verify';
import { errorText, notFound } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { measureClock, pulseReference } from './pass-reference';
import { routeHref } from './router';
import { spectatorOnly } from './spectator';

export interface DoorDeps {
  /** Where the door list is kept. Null: this browser cannot keep one. */
  store?: DoorStore | null;
  online?: () => boolean;
  confirm?: (question: string) => boolean;
  scanner?: typeof startScanner;
  /** How long to wait for the server before checking from the saved list instead, in milliseconds. */
  patience?: number;
}
type Shown = PassCheckOutcome | 'no-list' | 'fault';
const HEADING: Record<Shown, string> = {
  genuine: 'Genuine pass', replay: 'This code was just scanned', expired: 'Expired code', invalid: 'Reset or removed',
  wrong_event: 'Not a pass for this event', unknown: 'Not a Paddock Pass', unlisted: 'Not on this phone’s list',
  'no-list': 'No signal, and no door list on this phone', fault: 'This pass could not be checked',
};
const MARK: Record<Shown, string> = { genuine: '✓', replay: '↺', expired: '◷', invalid: '✕', wrong_event: '⊘', unknown: '?', unlisted: '≠', 'no-list': '…', fault: '!' };
const ADVICE: Partial<Record<Shown, string>> = {
  replay: 'The same code has been shown before. Ask them to turn the card over again for a new code, and check the face against the portrait.',
  expired: 'This code is too old to be the live pass, which is how a screenshot looks. Ask them to open their live pass and show it again.',
  invalid: 'This pass was reset or its holder was removed from the team. Their team manager can send a new one in a few seconds.',
  wrong_event: 'It is a Paddock Pass, but for a different event.',
  unknown: 'This code was not made by a Paddock Pass.',
  unlisted: 'It may have been issued or sent again since this phone’s door list was saved. Go online to check it, or ask an organiser with signal.',
  'no-list': 'Find signal to check this pass. Next time you have signal, save the door list on this phone so checks work without it.',
};
const GATE = 'stem-racing-india-door-gate', DEVICE = 'stem-racing-india-door-device';
const uuid = () => crypto.randomUUID();
const remembered = (key: string, make: () => string): string => {
  try { const had = localStorage.getItem(key); if (had !== null) return had; const made = make(); if (made) localStorage.setItem(key, made); return made; } catch { return make(); }
};

/** Door check: organisers and the Chair scan Paddock Passes at the entrance. Works from a saved list when there is no signal. */
export async function doorScreen(ctx: Ctx, eventId: string, deps: DoorDeps = {}): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event || spectatorOnly(roles) || !roles.some((r) => r.role === 'organiser' || r.role === 'chair'))
    return notFound('Door check is for event organisers and the Chair.', routeHref({ name: 'event', eventId }), 'Back to event');

  const online = deps.online ?? (() => navigator.onLine !== false), ask = deps.confirm ?? ((q: string) => window.confirm(q));
  const store = deps.store !== undefined ? deps.store : await openDoorStore().catch(() => null);
  const device = remembered(DEVICE, uuid);
  let alive = true, cache: DoorCache | null = store ? await store.load(eventId).catch(() => null) : null;
  let offset = cache?.offset ?? 0, waiting = store ? (await store.queued(eventId).catch(() => [])).length : 0;
  let last = { text: '', at: 0 }, checking = false, syncing = false, scanner: Scanner | null = null, reference: { destroy(): void } | null = null;
  const uploaded: SeenScan[] = [];
  const clock = () => Date.now() + offset;
  const timezone = () => cache?.list.timezone ?? 'Asia/Kolkata';
  const time = (iso: string | number) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: timezone(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); } catch { return ''; } };

  const gate = h('input', { type: 'text', maxlength: '40', placeholder: 'Main entrance', value: remembered(GATE, () => '') });
  gate.onchange = () => { try { localStorage.setItem(GATE, gate.value.trim()); } catch { /* kept for this visit only */ } };
  const video = h('video', { class: 'door-camera__video', playsinline: true, muted: true, hidden: true });
  const cameraNote = h('p', { class: 'muted small', role: 'status' });
  const cameraButton = h('button', { type: 'button', class: 'btn btn--primary' }, 'Start camera');
  const manual = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Pass code', placeholder: 'Type or scan a code' });
  const resultBox = h('section', { class: 'door-result door-result--idle', 'aria-live': 'assertive', 'aria-atomic': 'true' }, h('p', { class: 'door-result__mark', 'aria-hidden': 'true' }, '◎'), h('h2', null, 'Ready to scan'), h('p', null, 'Ask for the entry side of the pass: tap the card to turn it over.'));
  const referenceBox = h('div', { class: 'door-reference__mark' });
  const kit = h('section', { class: 'door-kit card stack' }), arrivals = h('section', { class: 'door-arrivals card stack' });

  function show(kind: Shown, result?: PassCheckResult, detail?: string): void {
    const who = result?.holder, parts: Array<Node | null> = [h('p', { class: 'door-result__mark', 'aria-hidden': 'true' }, MARK[kind]), h('h2', null, HEADING[kind])];
    if (who) {
      const colour = streamColour(who.stream?.index ?? null);
      parts.push(h('div', { class: 'door-result__who' },
        who.portrait ? h('img', { src: `data:image/jpeg;base64,${who.portrait}`, alt: `Portrait of ${who.name}` }) : h('div', { class: 'door-result__no-photo' }, 'No portrait'),
        h('div', { class: 'stack' }, h('strong', { class: 'door-result__name' }, who.name || 'Team manager'), h('span', null, who.role), h('span', null, `Team ${who.team.number} · ${who.team.name}`),
          h('span', { class: 'door-result__stream', style: `background:${colour.fill};color:${colour.ink}` }, who.stream?.name ?? 'Stream to be announced'))));
      if (result?.presenter) parts.push(h('p', { class: 'door-result__note' }, 'Shown by the team manager, on the student’s behalf.'));
      if (result?.firstSeenToday) parts.push(h('p', { class: 'door-result__note' }, `First seen today at ${time(result.firstSeenToday)}.`));
    }
    const advice = detail ?? ADVICE[kind];
    if (advice) parts.push(h('p', null, advice));
    if (result?.offline) parts.push(h('p', { class: 'door-result__note' }, `Checked on this phone, from the door list saved at ${time(cache?.downloadedAt ?? Date.now())}.`));
    resultBox.className = `door-result door-result--${kind}`;
    resultBox.replaceChildren(...parts.filter((n): n is Node => !!n));
    resultBox.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });   // on a phone the answer sits below the camera
    try { navigator.vibrate?.(kind === 'genuine' ? 70 : [60, 70, 60]); } catch { /* no vibration here */ }
  }

  function paintKit(): void {
    const parts: Array<Node | null> = [h('h2', null, 'Without signal')];
    if (!store) parts.push(h('p', null, 'This browser cannot keep a door list, so checks here need signal. Use your phone’s own browser, not a private tab.'));
    else {
      parts.push(h('p', null, cache
        ? `Door list saved on this phone at ${time(cache.downloadedAt)}: ${cache.list.passes.length} ${cache.list.passes.length === 1 ? 'pass' : 'passes'}. Passes sent after that need signal to check.`
        : 'No door list on this phone. Save it while you have signal and checks keep working when the signal drops.'));
      if (waiting) parts.push(h('p', { class: 'door-kit__waiting' }, `${waiting} ${waiting === 1 ? 'check' : 'checks'} waiting to upload. They go up by themselves when signal returns.`));
      parts.push(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn--secondary', onclick: () => void download() }, cache ? 'Update door list' : 'Save door list on this phone'),
        cache ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void forget() }, 'Remove from this phone') : null),
        h('p', { class: 'muted small' }, `The list holds each pass’s details and portrait. It is removed when you sign out, and by itself after ${DOOR_LIST_DAYS} days.`));
    }
    kit.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  async function download(): Promise<void> {
    if (!store) return;
    const note = h('p', { role: 'status' }, 'Saving the door list…');
    kit.append(note);
    try {
      // The clock is read around this one request. The portraits that follow can take a minute on a slow link.
      const before = Date.now(), list = await ctx.api.doorList(eventId), landed = Date.now(), portraits: Record<string, string> = {};
      const measured = (await measureClock(ctx)) ?? Math.round(Number(list.now) - (before + landed) / 2);
      let after: string | null = null;
      for (let page = 0; page < 200; page++) {
        const batch = await ctx.api.doorPortraits(eventId, after);
        if (!batch.length) break;
        for (const row of batch) portraits[row.id] = row.portrait;
        after = batch[batch.length - 1].id;
        if (alive) note.textContent = `Saving the door list… ${Object.keys(portraits).length} portraits`;
      }
      cache = { eventId, list, portraits, downloadedAt: Date.now(), offset: measured };
      offset = measured;
      await store.save(cache);
      if (alive) { paintKit(); startReference(list.pulseKey); }
    } catch (e) { if (alive) note.textContent = `The door list could not be saved. ${errorText(e)}`; }
  }
  async function forget(): Promise<void> {
    if (!store || !ask('Remove the door list from this phone? Checks will need signal until you save it again.')) return;
    await store.clear(eventId).catch(() => undefined);
    cache = null;
    if (alive) paintKit();
  }

  /** Sends up the checks made without signal. Each has its own id, so a retry can never count one twice. */
  async function sync(): Promise<void> {
    if (!store || syncing || !online()) return;
    syncing = true;
    try {
      for (;;) {
        const queued = await store.queued(eventId);
        if (!queued.length) break;
        const batch = queued.slice(0, 200);
        await ctx.api.recordPassChecks(eventId, batch);
        await store.dequeue(eventId, batch.map((c) => c.id));
        uploaded.push(...batch);
      }
    } catch { /* still queued: the next scan or the next "online" tries again */ }
    finally {
      syncing = false;
      waiting = await store.queued(eventId).then((q) => q.length, () => waiting);
      if (alive) paintKit();
    }
  }

  async function check(raw: string): Promise<void> {
    const text = raw.trim(), now = Date.now();
    if (!text) return;
    // The camera sees the same code many times a second, for as long as the pass is held up. That is one check, not
    // a new one every few seconds: only a code that has been out of sight for three seconds is checked again.
    if (text === last.text && now - last.at < 3000) { last.at = now; return; }
    if (checking) return;
    last = { text, at: now }; checking = true;
    try {
      let result: PassCheckResult | null = null;
      const checkId = uuid();
      if (online()) {
        // A phone can report signal and still reach nothing. The door does not wait on it: after a few seconds the saved list answers.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const asked = ctx.api.checkPass(eventId, text, { gate: gate.value.trim(), checkId, device });
        asked.catch(() => undefined);
        try { result = await Promise.race([asked, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deps.patience ?? 4000); })]); }
        catch (e) { if (!(e instanceof ApiError && e.code === 'network')) { if (alive) show('fault', undefined, errorText(e)); return; } }
        finally { clearTimeout(timer); }
      }
      if (result) { if (alive) show(result.result, result); void sync(); if (result.result === 'genuine') void loadArrivals(true); return; }
      if (!cache || !store) { if (alive) show('no-list'); return; }
      const scannedAt = new Date(clock()).toISOString();
      const offline = await verifyOffline(cache, text, clock(), [...uploaded, ...await store.queued(eventId)]);
      if (offline.record) {
        // The same id as the request that went unanswered: if that one did land, this upload adds nothing.
        const queued: QueuedCheck = { ...offline.record, id: checkId, gate: gate.value.trim(), device, scannedAt };
        await store.enqueue(eventId, queued); waiting++;
      }
      if (alive) { show(offline.result.result, offline.result); paintKit(); }
    } finally { checking = false; }
  }

  let arrivalsTimer: ReturnType<typeof setTimeout> | undefined;
  async function loadArrivals(soon = false): Promise<void> {
    if (soon) { clearTimeout(arrivalsTimer); arrivalsTimer = setTimeout(() => void loadArrivals(), 1500); return; }
    let got: PassArrivals | null = null, fault = '';
    try { got = await ctx.api.passArrivals(eventId); } catch (e) { fault = errorText(e); }
    if (!alive) return;
    const teams = new Map<string, PassArrivals['arrived']>();
    for (const a of got?.arrived ?? []) { const key = `${a.teamNumber} · ${a.teamName}`; teams.set(key, [...(teams.get(key) ?? []), a]); }
    arrivals.replaceChildren(...[h('h2', null, 'Arrivals'),
      got ? h('p', { class: 'door-arrivals__count' }, h('strong', null, `${got.arrived.length} of ${got.total}`), ' checked in today') : h('p', { class: 'muted' }, fault || 'Arrivals need signal.'),
      got && teams.size ? h('ul', { class: 'door-arrivals__list' }, [...teams].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([team, people]) =>
        h('li', null, h('strong', null, `Team ${team}`), h('ul', null, people.map((p) => h('li', null, `${p.name || 'Team manager'} · ${time(p.firstSeen)}${p.gate ? ` · ${p.gate}` : ''}`)))))) : null,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void loadArrivals() }, 'Refresh arrivals'))].filter((n) => n !== null));
  }

  function startReference(key: string): void {
    reference?.destroy();
    const made = pulseReference(key, { now: clock });
    reference = made; referenceBox.replaceChildren(made.el);
  }

  cameraButton.onclick = async () => {
    if (scanner) { scanner.stop(); scanner = null; video.hidden = true; cameraButton.textContent = 'Start camera'; cameraNote.textContent = ''; return; }
    cameraButton.disabled = true; cameraNote.textContent = 'Starting the camera…';
    try {
      video.hidden = false;
      scanner = await (deps.scanner ?? startScanner)(video, (text) => void check(text));
      if (!alive) { scanner.stop(); scanner = null; return; }
      cameraButton.textContent = 'Stop camera'; cameraNote.textContent = 'Hold the pass’s entry code in front of the camera.';
    } catch (e) { video.hidden = true; cameraNote.textContent = cameraFault(e); }
    finally { cameraButton.disabled = false; }
  };
  const onOnline = () => void sync();
  window.addEventListener('online', onOnline);
  ctx.onLeave(() => { alive = false; scanner?.stop(); reference?.destroy(); clearTimeout(arrivalsTimer); window.removeEventListener('online', onOnline); });

  const root = h('div', { class: 'stack stack--lg door-page' },
    h('header', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'RACE DAY / DOOR CHECK'), h('h1', null, 'Door check'),
      h('p', { class: 'lead' }, 'Scan the entry code on a Paddock Pass. A genuine pass shows the holder’s portrait here, so you can check the face in front of you.')),
    h('div', { class: 'door-grid' },
      h('section', { class: 'door-scan card stack' },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Where you are checking (optional)'), gate),
        h('div', { class: 'door-camera' }, video), h('div', { class: 'actions' }, cameraButton), cameraNote,
        h('form', { class: 'door-manual', onsubmit: (e: Event) => { e.preventDefault(); const text = manual.value; manual.value = ''; last = { text: '', at: 0 }; void check(text); } },
          manual, h('button', { type: 'submit', class: 'btn btn--ghost' }, 'Check')),
        h('p', { class: 'muted small' }, 'A handheld scanner works too: click the box, then scan.')),
      resultBox),
    h('section', { class: 'door-reference card stack' }, h('h2', null, 'Sync pulse'),
      h('p', null, 'Every genuine pass shows this shape and colour right now. For a quick look without scanning, compare the top corner of the card with this.'), referenceBox),
    kit, arrivals);

  paintKit();
  void loadArrivals();
  void sync();
  if (cache) startReference(cache.list.pulseKey);
  // With signal, the server's clock always wins over the one saved with the list.
  void measureClock(ctx).then((measured) => { if (alive && measured !== null) offset = measured; });
  void ctx.api.passPulseKey(eventId).then((key) => { if (alive) startReference(key); }).catch(() => { /* offline: the saved list's key is already showing */ });
  return root;
}
