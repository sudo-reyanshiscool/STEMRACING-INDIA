import cssText from './card.css?inline';
import { h } from '../../ui/dom';
import type { PassActivity, PassCardData } from '../../api/passes';
import { importSecret, pulseAt, PULSE_MS, STEP_MS } from '../code';
import { drawMask } from './mask';
import { drawQr } from './qr';
import { createFoil, type Foil } from './shader';
import { PULSE_COLOURS, pulseMark, streamColour } from './streams';
import { createTilt } from './tilt';

export interface PassCardOptions {
  /** The entry code for right now, or null when this phone holds no secret for the pass. */
  code?: () => Promise<string | null>;
  /** The time in milliseconds, corrected to the server's clock where the phone's own is wrong. */
  now?: () => number;
  /** false keeps the plain card and never starts the shader. */
  shader?: boolean;
  reducedMotion?: boolean;
  /** Turn the card over when it is tapped. On by default. */
  tapToFlip?: boolean;
  /** false builds the card at rest: no timers and no graphics context until setActive(true). */
  active?: boolean;
  /** Shown in place of the QR when there is no code to show. */
  noCodeText?: string;
}
export interface PassCard {
  el: HTMLElement;
  update(data: PassCardData): void;
  /** Turns the card over, or to the named side. */
  flip(back?: boolean): void;
  readonly back: boolean;
  /** An inactive card stops its timers and gives up its graphics context. Only the card being looked at need be active. */
  setActive(on: boolean): void;
  destroy(): void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12–13 Dec 2026" from the schedule's days, or the event's start date when there is no schedule yet. */
export function validDates(event: PassCardData['event']): string {
  const days = (event.days.length ? [...event.days].sort() : event.startsOn ? [event.startsOn] : []).map((d) => /^(\d{4})-(\d{2})-(\d{2})/.exec(d)).filter((m): m is RegExpExecArray => !!m);
  if (!days.length) return '';
  const first = days[0], last = days[days.length - 1];
  const part = (m: RegExpExecArray, month: boolean, year: boolean) => `${Number(m[3])}${month ? ` ${MONTHS[Number(m[2]) - 1] ?? ''}` : ''}${year ? ` ${m[1]}` : ''}`;
  if (first[0] === last[0]) return part(first, true, true);
  if (first[1] === last[1] && first[2] === last[2]) return `${part(first, false, false)}–${part(last, true, true)}`;
  return `${part(first, true, first[1] !== last[1])} – ${part(last, true, true)}`;
}

/** The activities still to come, soonest first. One that has started but not finished still counts. */
export function nextActivities(activities: PassActivity[], nowMs: number, limit = 2): PassActivity[] {
  return activities.filter((a) => { const until = Date.parse(a.end ?? a.start); return Number.isFinite(until) && until >= nowMs; })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, limit);
}

function clockIn(timezone: string): (ms: number) => string {
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  catch { format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  return (ms) => format.format(new Date(ms));
}

function ensureStyles(): void {
  if (document.getElementById('pass-card-styles')) return;
  const style = document.createElement('style');
  style.id = 'pass-card-styles';
  style.textContent = cssText;
  document.head.append(style);
}

const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
/** A steady number between 0 and 1 from the pass id, so each card's line work is its own. */
const seedOf = (id: string) => { let v = 2166136261; for (let i = 0; i < id.length; i++) v = Math.imul(v ^ id.charCodeAt(i), 16777619); return ((v >>> 0) % 1000) / 1000; };
const raf: (f: (ms: number) => void) => number = typeof requestAnimationFrame === 'function' ? (f) => requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16) as unknown as number;
const caf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

export function createPassCard(initial: PassCardData, options: PassCardOptions = {}): PassCard {
  ensureStyles();
  const now = options.now ?? Date.now;
  const still = options.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let data = initial, active = false, back = false, destroyed = false, wasConnected = false;
  let foil: Foil | null = null, portrait: HTMLImageElement | null = null, frameId = 0, houseId: ReturnType<typeof setInterval> | null = null, frames = 0;
  let pulseKey: CryptoKey | null = null, pulseKeyHex = '', pulseK = -1, pulseColour: [number, number, number] = [1, 1, 1];
  let shownStep = -1, codeBusy = false, clock = clockIn(data.timezone), wake: { release(): Promise<void> } | null = null, downAt: [number, number] | null = null;

  const fxHost = h('div', { class: 'pass-card__fx-host' });
  const number = h('span', { class: 'pass-card__number', 'aria-hidden': 'true' });
  const logo = h('img', { class: 'pass-card__logo', src: '/brand/logo-india-mono-white.png', alt: 'STEM Racing India' });
  const eventName = h('p', { class: 'pass-card__event' });
  const pulseBox = h('div', { class: 'pass-card__pulse' });
  const photo = h('div', { class: 'pass-card__photo' });
  const name = h('p', { class: 'pass-card__name' }), role = h('p', { class: 'pass-card__role' }), label = h('p', { class: 'pass-card__label' });
  const team = h('p', { class: 'pass-card__team' }), school = h('p', { class: 'pass-card__school' });
  const live = h('p', { class: 'pass-card__live' }), stream = h('span', { class: 'pass-card__stream' }), clockEl = h('span', { class: 'pass-card__clock' });
  const front = h('section', { class: 'pass-card__face pass-card__face--front' },
    h('div', { class: 'pass-card__carbon' }), fxHost, h('div', { class: 'pass-card__track', 'aria-hidden': 'true' }), h('div', { class: 'pass-card__patch', 'aria-hidden': 'true' }, h('i')), number,
    h('div', { class: 'pass-card__head' }, logo, eventName), h('p', { class: 'pass-card__pulse-label', 'aria-hidden': 'true' }, 'Sync', h('br'), 'pulse'), pulseBox, photo,
    h('div', { class: 'pass-card__who' }, name, role, h('div', { class: 'pass-card__rule' }), label, team, school), live,
    h('div', { class: 'pass-card__strip' }, stream, clockEl), h('div', { class: 'pass-card__glare' }));

  const kind = h('span'), qrCanvas = h('canvas', { width: '396', height: '396', 'aria-label': 'Entry code' }), qrTile = h('div', { class: 'pass-card__qr-tile' }, qrCanvas);
  const qrBar = h('i'), backName = h('strong'), backLine = h('span'), next = h('ul', { class: 'pass-card__next' });
  const backFace = h('section', { class: 'pass-card__face pass-card__face--back', 'aria-hidden': 'true' },
    h('div', { class: 'pass-card__carbon' }), h('div', { class: 'pass-card__back-top' }, h('strong', null, 'Entry scan'), kind),
    h('div', { class: 'pass-card__qr' }, qrTile, h('div', { class: 'pass-card__qr-bar' }, qrBar), h('p', { class: 'pass-card__qr-note' }, 'New code every 30 seconds. A screenshot stops working.')),
    h('div', { class: 'pass-card__back-who' }, backName, backLine, next), h('div', { class: 'pass-card__glare' }));
  const body = h('div', { class: 'pass-card__body' }, front, backFace);
  const el = h('div', { class: `pass-card pass-card--basic${still ? ' pass-card--still' : ''}`, tabindex: '0', role: 'group' }, h('div', { class: 'pass-card__shadow' }), body);
  const tilt = createTilt(el, { reduce: still });

  function paintNext(): void {
    const upcoming = nextActivities(data.activities, now());
    const time = (iso: string) => clock(Date.parse(iso)).slice(0, 5);
    next.replaceChildren(...(upcoming.length
      ? upcoming.map((a) => h('li', null, h('time', { datetime: a.start }, time(a.start)), h('span', null, a.location ? `${a.title} · ${a.location}` : a.title)))
      : [h('li', null, h('span', null, data.activities.length ? 'Nothing more on your schedule.' : 'Your schedule will appear here once it is published.'))]));
  }

  function paint(): void {
    const colour = streamColour(data.stream?.index ?? null), dates = validDates(data.event), manager = data.kind === 'manager';
    const holder = data.name || (manager ? 'Team Manager' : 'Team member');
    el.style.setProperty('--pc-stream', colour.fill); el.style.setProperty('--pc-stream-ink', colour.ink);
    el.setAttribute('aria-label', `${holder}, ${data.role}, team ${data.team.number} ${data.team.name}. Press Enter to turn the card over.`);
    number.textContent = data.team.number; number.classList.toggle('is-long', data.team.number.length > 3);
    eventName.textContent = data.event.name; eventName.title = data.event.name;
    name.textContent = holder; name.classList.toggle('is-long', holder.length > 22);
    role.textContent = data.role; role.classList.toggle('is-manager', manager);
    role.hidden = manager && !data.name;   // an unnamed manager's card already says Team Manager where the name goes
    label.textContent = `Team ${data.team.number}`; team.textContent = data.team.name; school.textContent = data.team.school;
    live.replaceChildren(h('b', null, '● '), dates ? `Live · valid ${dates}` : 'Live');
    stream.textContent = data.stream?.name ?? 'Stream to be announced'; stream.classList.toggle('is-long', !data.stream || data.stream.name.length > 10);
    kind.textContent = manager ? 'Team manager' : 'Student';
    backName.textContent = holder;
    backLine.textContent = [`Team ${data.team.number}`, data.team.name, data.stream?.name].filter(Boolean).join(' · ');
    clock = clockIn(data.timezone); clockEl.textContent = clock(now());
    paintNext();
    if (data.portrait) {
      const src = `data:image/jpeg;base64,${data.portrait}`;
      if (portrait?.src !== src) {
        const img = h('img', { alt: `Portrait of ${holder}`, src });
        img.addEventListener('load', () => { if (portrait === img) remask(); });
        portrait = img;
      }
      photo.replaceChildren(portrait);
    } else { portrait = null; photo.replaceChildren(h('i', { 'aria-hidden': 'true' })); }
    if (data.pulseKey !== pulseKeyHex) {
      pulseKeyHex = data.pulseKey; pulseKey = null; pulseK = -1;
      const wanted = pulseKeyHex;
      importSecret(wanted).then((key) => { if (wanted === pulseKeyHex && !destroyed) { pulseKey = key; void paintPulse(); } }).catch(() => { /* no key: the card simply shows no pulse */ });
    }
    remask();
  }

  async function paintPulse(): Promise<void> {
    if (!pulseKey) return;
    const k = Math.floor(now() / PULSE_MS);
    if (k === pulseK) return;
    pulseK = k;
    const p = await pulseAt(pulseKey, now());
    if (destroyed || p.k !== pulseK) return;
    pulseColour = hexRgb(PULSE_COLOURS[p.colour]);
    pulseBox.replaceChildren(pulseMark(p.glyph, p.colour));
  }

  function remask(): void {
    if (!foil) return;
    const mask = drawMask(data.team.number, portrait?.complete && portrait.naturalWidth ? portrait : null);
    if (mask) foil.setMask(mask); else stopFoil();
  }
  function stopFoil(): void {
    foil?.destroy(); foil = null;
    fxHost.replaceChildren(); el.classList.add('pass-card--basic');
  }
  function startFoil(): void {
    if (foil || options.shader === false) return;
    // A context that has been given up cannot be taken back, so each start gets a fresh canvas.
    const canvas = h('canvas', { class: 'pass-card__fx', 'aria-hidden': 'true' });
    fxHost.replaceChildren(canvas);
    foil = createFoil(canvas, () => { foil = null; fxHost.replaceChildren(); el.classList.add('pass-card--basic'); });
    if (!foil) { fxHost.replaceChildren(); return; }
    el.classList.remove('pass-card--basic');
    remask();
    // The foil number is cut from the display face, which may still be loading on a first visit.
    document.fonts?.load?.('italic 700 100px Magistral').then(() => { if (!destroyed) remask(); }).catch(() => { /* drawn in the fallback face */ });
  }

  function draw(seconds: number): void {
    const s = el.style;
    s.setProperty('--pc-ry', `${(tilt.x * 14).toFixed(2)}deg`); s.setProperty('--pc-rx', `${(-tilt.y * 10).toFixed(2)}deg`);
    s.setProperty('--pc-gx', `${(50 + tilt.x * 42).toFixed(1)}%`); s.setProperty('--pc-gy', `${(32 + tilt.y * 38).toFixed(1)}%`); s.setProperty('--pc-tilt', tilt.x.toFixed(3));
    if (foil && !back && !document.hidden) foil.render({ seconds, tiltX: tilt.x, tiltY: tilt.y, seed: seedOf(data.passId), pulse: pulseColour, pulseT: (now() % PULSE_MS) / PULSE_MS, motion: !still });
  }
  function frame(ms: number): void {
    if (!active) return;
    const moved = tilt.step(ms / 1000);
    // Thirty frames a second is plenty while the card is at rest.
    if (moved || frames++ % 2 === 0) draw(ms / 1000);
    frameId = raf(frame);
  }

  async function paintCode(force = false): Promise<void> {
    const t = now(), step = Math.floor(t / STEP_MS);
    qrBar.style.transform = `scaleX(${(1 - (t % STEP_MS) / STEP_MS).toFixed(3)})`;
    if (!back || codeBusy || (!force && step === shownStep)) return;
    codeBusy = true;
    try {
      const code = options.code ? await options.code() : null;
      if (destroyed) return;
      shownStep = step;
      if (code) { if (qrCanvas.parentElement !== qrTile) qrTile.replaceChildren(qrCanvas); drawQr(qrCanvas, code); }
      else qrTile.replaceChildren(h('p', null, options.noCodeText ?? 'This phone cannot show the entry code for this pass.'));
    } catch {
      qrTile.replaceChildren(h('p', null, 'The entry code could not be made. Close the pass and open it again.'));
    } finally { codeBusy = false; }
  }

  function house(): void {
    if (el.isConnected) wasConnected = true;
    else if (wasConnected) { setActive(false); return; }   // the screen holding the card has gone
    const text = clock(now());
    if (clockEl.textContent !== text) { clockEl.textContent = text; if (text.endsWith(':00') || text.endsWith(':30')) paintNext(); }
    void paintPulse(); void paintCode();
    if (still) { tilt.step(performance.now() / 1000); draw(performance.now() / 1000); }
  }

  function setActive(on: boolean): void {
    if (destroyed || on === active) return;
    active = on;
    if (on) {
      startFoil(); house();
      houseId = setInterval(house, 250);
      if (!still) frameId = raf(frame); else draw(performance.now() / 1000);
    } else {
      if (houseId !== null) clearInterval(houseId);
      houseId = null; caf(frameId); stopFoil(); releaseWake();
    }
  }

  function releaseWake(): void { void wake?.release().catch(() => { /* already released */ }); wake = null; }
  /** Keeps the screen on while someone is holding the code up to a scanner. */
  function holdWake(): void {
    if (wake || !back || destroyed || document.hidden) return;
    const lock = (navigator as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    lock?.request('screen').then((held) => { if (back && !destroyed && !wake) wake = held; else void held.release(); }).catch(() => { /* not allowed here: the phone's own timeout applies */ });
  }
  // The browser lets go of the screen by itself whenever the page is hidden or the phone locked, so it is asked again on return.
  const onVisibility = () => { if (document.hidden) wake = null; else holdWake(); };
  document.addEventListener('visibilitychange', onVisibility);
  function flip(to: boolean = !back): void {
    if (to === back) return;
    back = to;
    el.classList.toggle('is-flipped', back); body.classList.add('is-turning');
    setTimeout(() => body.classList.remove('is-turning'), 750);
    front.setAttribute('aria-hidden', String(back)); backFace.setAttribute('aria-hidden', String(!back));
    if (back) {
      void paintCode(true);
      holdWake();
    } else releaseWake();
  }

  el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('click', (e) => {
    tilt.arm();
    const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : 0;
    downAt = null;
    if (options.tapToFlip !== false && moved < 8) flip();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });

  front.setAttribute('aria-hidden', 'false');
  paint();
  if (options.active !== false) setActive(true);

  return {
    el,
    update(nextData) { data = nextData; paint(); if (back) void paintCode(true); },
    flip,
    get back() { return back; },
    setActive,
    destroy() { if (destroyed) return; setActive(false); destroyed = true; tilt.destroy(); document.removeEventListener('visibilitychange', onVisibility); },
  };
}
