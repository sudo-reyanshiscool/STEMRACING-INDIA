// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PassCardData } from '../../src/api/passes';
import { createPassCard, nextActivities, validDates } from '../../src/pass/card/card';
import { streamColour } from '../../src/pass/card/streams';

const NOW = Date.parse('2026-12-12T04:00:00Z');   // 09:30 in India
const data = (over: Partial<PassCardData> = {}): PassCardData => ({
  passId: '0b0e6a52-8f1e-4c57-9d5c-1f6f4f5a2a11', kind: 'student', name: 'Asha Rao', role: 'Design Engineer',
  team: { number: '007', name: 'Velocity', school: 'Hill School' },
  event: { id: 'e1', name: 'North Regional 2026', startsOn: '2026-12-12', days: ['2026-12-12', '2026-12-13'] },
  stream: { name: 'Blue', index: 0 },
  activities: [
    { title: 'Scrutineering', kind: 'activity', start: '2026-12-12T03:00:00Z', end: '2026-12-12T03:20:00Z', location: 'Bay 2' },
    { title: 'Verbal presentation', kind: 'judging', start: '2026-12-12T05:00:00Z', end: '2026-12-12T05:20:00Z', location: 'Room 4' },
    { title: 'Racing', kind: 'racing', start: '2026-12-12T07:00:00Z', end: '2026-12-12T07:30:00Z', location: '' },
    { title: 'Pit display', kind: 'judging', start: '2026-12-12T09:00:00Z', end: null, location: '' },
  ],
  timezone: 'Asia/Kolkata', portrait: null, pulseKey: 'ab'.repeat(32), now: NOW, ...over,
});
const cards: Array<{ destroy(): void }> = [];
const make = (over: Partial<PassCardData> = {}, options: Parameters<typeof createPassCard>[1] = {}) => {
  const card = createPassCard(data(over), { now: () => NOW, ...options });
  cards.push(card); document.body.append(card.el);
  return card;
};
const q = (el: Element, cls: string) => el.querySelector(`.${cls}`)!;
afterEach(() => {
  cards.splice(0).forEach((c) => c.destroy()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  delete (globalThis as { Path2D?: unknown }).Path2D;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
const turns = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/**
 * An iPhone's rule for the phone's orientation: it must be asked for, and only from inside a tap.
 * Safari counts the end of a touch and the click as a tap, but not the moment the finger lands.
 */
function iphone(answer: 'granted' | 'denied' = 'granted', hiccups = 0) {
  let tapping = false;
  /** What each ask came to: the holder's answer, or that the phone would not even put the question. */
  const asks: string[] = [];
  const requestPermission = vi.fn(async () => {
    if (!tapping || hiccups-- > 0) { asks.push('not asked'); throw new Error('NotAllowedError'); }
    asks.push(answer); return answer;
  });
  (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = { requestPermission };
  const tap = async (el: HTMLElement) => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    tapping = true;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    tapping = false;
    await turns();
  };
  return { requestPermission, tap, asks };
}
const listensToOrientation = () => vi.spyOn(window, 'addEventListener').mock.calls.some(([type]) => type === 'deviceorientation');

describe('the pass card', () => {
  it('shows who the holder is as real text', () => {
    const { el } = make();
    expect(q(el, 'pass-card__name').textContent).toBe('Asha Rao');
    expect(q(el, 'pass-card__role').textContent).toBe('Design Engineer');
    expect(q(el, 'pass-card__number').textContent).toBe('007');
    expect(q(el, 'pass-card__team').textContent).toBe('Velocity');
    expect(q(el, 'pass-card__school').textContent).toBe('Hill School');
    expect(q(el, 'pass-card__stream').textContent).toBe('Blue');
    expect(q(el, 'pass-card__event').textContent).toBe('North Regional 2026');
    expect(q(el, 'pass-card__live').textContent).toContain('valid 12–13 Dec 2026');
    expect(q(el, 'pass-card__clock').textContent).toBe('09:30:00');
  });

  it('is the plain card where there is no WebGL, with no canvas left blank over it', () => {
    const { el } = make();
    expect(el.classList.contains('pass-card--basic')).toBe(true);
    expect(el.querySelector('.pass-card__fx')).toBeNull();
  });

  it('marks a manager with the solid role style and a student without', () => {
    expect(q(make({ kind: 'manager', role: 'Team Manager' }).el, 'pass-card__role').classList.contains('is-manager')).toBe(true);
    expect(q(make().el, 'pass-card__role').classList.contains('is-manager')).toBe(false);
  });

  it('says the stream is to be announced when the team has none', () => {
    expect(q(make({ stream: null }).el, 'pass-card__stream').textContent).toBe('Stream to be announced');
  });

  it('shows the portrait when there is one and the track shape when there is not', () => {
    const withPhoto = make({ portrait: 'AAAA' }).el;
    expect(withPhoto.querySelector('.pass-card__photo img')!.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
    expect(withPhoto.querySelector('.pass-card__photo img')!.getAttribute('alt')).toBe('Portrait of Asha Rao');
    expect(make().el.querySelector('.pass-card__photo img')).toBeNull();
  });

  it('paints the stream colour', () => {
    const { el } = make({ stream: { name: 'Red', index: 2 } });
    expect(el.style.getPropertyValue('--pc-stream')).toBe(streamColour(2).fill);
  });

  it('turns over to the entry side with the code and what is next', async () => {
    const code = vi.fn(async () => 'SRI1.0B0E6A528F1E4C579D5C1F6F4F5A2A11.59000000.0123456789ABCDEF');
    const card = make({}, { code });
    expect(card.back).toBe(false);
    card.flip();
    expect(card.back).toBe(true);
    expect(card.el.classList.contains('is-flipped')).toBe(true);
    expect(q(card.el, 'pass-card__face--back').getAttribute('aria-hidden')).toBe('false');
    expect(q(card.el, 'pass-card__face--front').getAttribute('aria-hidden')).toBe('true');
    await vi.waitFor(() => expect(code).toHaveBeenCalled());
    expect(card.el.querySelector('.pass-card__qr-tile canvas')).not.toBeNull();
    const next = [...card.el.querySelectorAll('.pass-card__next li')].map((li) => li.textContent);
    expect(next).toEqual(['10:30Verbal presentation · Room 4', '12:30Racing']);
  });

  it('says so plainly when this phone holds no code for the pass', async () => {
    const card = make({}, { code: async () => null });
    card.flip(true);
    await vi.waitFor(() => expect(q(card.el, 'pass-card__qr-tile').textContent).toContain('cannot show the entry code'));
    expect(card.el.querySelector('.pass-card__qr-tile canvas')).toBeNull();
  });

  it('turns over on a tap or the Enter key, but not after a drag', () => {
    const card = make();
    card.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(card.back).toBe(true);
    card.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card.back).toBe(false);
    card.el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    card.el.dispatchEvent(new MouseEvent('click', { clientX: 90, clientY: 10, bubbles: true }));
    expect(card.back).toBe(false);
  });

  it('follows an iPhone\'s tilt after the first tap', async () => {
    const phone = iphone(), heard = vi.spyOn(window, 'addEventListener');
    const { el } = make();
    await phone.tap(el);
    expect(phone.asks).toEqual(['granted']);
    expect(heard.mock.calls.some(([type]) => type === 'deviceorientation')).toBe(true);
    await phone.tap(el);
    expect(phone.asks).toEqual(['granted']);   // asked once, not on every tap
  });

  it('asks an iPhone again on the next tap if the question could not be put, but never after a no', async () => {
    const phone = iphone('denied', 1);
    const { el } = make();
    await phone.tap(el);
    expect(phone.asks).toEqual(['not asked']);
    await phone.tap(el);
    expect(phone.asks).toEqual(['not asked', 'denied']);
    await phone.tap(el);
    expect(phone.asks).toEqual(['not asked', 'denied']);   // the holder said no: touch tilts the card instead
    expect(listensToOrientation()).toBe(false);
  });

  it('keeps the screen awake on the entry side, and takes that back after the phone was locked or the page hidden', async () => {
    const release = vi.fn(async () => undefined), request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const card = make({}, { code: async () => 'SRI1.TEST' });
    card.flip(true); await turns();
    expect(request).toHaveBeenCalledTimes(1);
    // The browser drops the lock by itself when the page is hidden.
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange')); await turns();
    expect(request).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange')); await turns();
    expect(request).toHaveBeenCalledTimes(2);
    // Not on the front, where nobody is scanning.
    card.flip(false); await turns();
    document.dispatchEvent(new Event('visibilitychange')); await turns();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back to the plain card, still readable, if the graphics are taken away part-way through', () => {
    // A stand-in graphics context that accepts everything, as a working phone's would.
    const gl: unknown = new Proxy(function () { /* callable */ }, {
      get: (_t, key) => (key === Symbol.toPrimitive ? () => 1 : typeof key !== 'string' || key === 'then' ? undefined : /^[A-Z0-9_]+$/.test(key) ? 1 : gl), apply: () => gl });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => gl) as never);
    (globalThis as { Path2D?: unknown }).Path2D = class { /* the foil's cut-out shapes */ };
    const { el } = make({}, { shader: true });
    const canvas = el.querySelector('canvas.pass-card__fx')!;
    expect(canvas).not.toBeNull();
    expect(el.classList.contains('pass-card--basic')).toBe(false);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(el.classList.contains('pass-card--basic')).toBe(true);
    expect(el.querySelector('canvas.pass-card__fx')).toBeNull();          // no dead canvas left over the card
    expect(q(el, 'pass-card__name').textContent).toBe('Asha Rao');
    expect(q(el, 'pass-card__number').textContent).toBe('007');
  });

  it('holds still for people who ask for less motion', () => {
    expect(make({}, { reducedMotion: true }).el.classList.contains('pass-card--still')).toBe(true);
    expect(make({}, { reducedMotion: false }).el.classList.contains('pass-card--still')).toBe(false);
  });

  it('takes new details without being rebuilt', () => {
    const card = make();
    card.update(data({ name: 'Asha R.', stream: { name: 'Green', index: 3 } }));
    expect(q(card.el, 'pass-card__name').textContent).toBe('Asha R.');
    expect(q(card.el, 'pass-card__stream').textContent).toBe('Green');
  });

  it('stops its timers when destroyed', () => {
    vi.useFakeTimers();
    const card = make();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    card.destroy();
    vi.advanceTimersByTime(1000);   // lets the turning-over timer, if any, run out
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('valid dates', () => {
  const ev = (days: string[], startsOn: string | null = null) => ({ id: 'e', name: 'E', startsOn, days });
  it('reads as one line whatever the span', () => {
    expect(validDates(ev(['2026-12-12']))).toBe('12 Dec 2026');
    expect(validDates(ev(['2026-12-13', '2026-12-12']))).toBe('12–13 Dec 2026');
    expect(validDates(ev(['2026-11-30', '2026-12-01']))).toBe('30 Nov – 1 Dec 2026');
    expect(validDates(ev(['2026-12-31', '2027-01-01']))).toBe('31 Dec 2026 – 1 Jan 2027');
    expect(validDates(ev([], '2026-12-12'))).toBe('12 Dec 2026');
    expect(validDates(ev([]))).toBe('');
  });
});

describe('next activities', () => {
  it('keeps the one under way, drops what is over, and gives the soonest first', () => {
    const list = data().activities;
    expect(nextActivities(list, Date.parse('2026-12-12T03:10:00Z')).map((a) => a.title)).toEqual(['Scrutineering', 'Verbal presentation']);
    expect(nextActivities(list, Date.parse('2026-12-12T08:00:00Z')).map((a) => a.title)).toEqual(['Pit display']);
    expect(nextActivities(list, Date.parse('2026-12-12T10:00:00Z'))).toEqual([]);
  });
});
