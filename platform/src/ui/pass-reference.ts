import type { RoleRow } from '../api';
import { importSecret, pulseAt, PULSE_MS } from '../pass/code';
import { PULSE_COLOUR_NAMES, PULSE_GLYPH_NAMES, pulseMark } from '../pass/card/streams';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

/**
 * The sync pulse reference: the shape and colour every genuine Paddock Pass at the event shows right now.
 * Staff compare a pass against it at a glance. It needs the event's key once, then runs with no signal.
 */
export function pulseReference(keyHex: string, options: { now?: () => number } = {}): { el: HTMLElement; destroy(): void } {
  const now = options.now ?? Date.now;
  const mark = h('div', { class: 'pass-ref__mark' }), name = h('p', { class: 'pass-ref__name', 'aria-hidden': 'true' }), bar = h('i');
  const el = h('div', { class: 'pass-ref' }, mark, h('div', { class: 'pass-ref__text' }, name, h('div', { class: 'pass-ref__bar', 'aria-hidden': 'true' }, bar)));
  let key: CryptoKey | null = null, shown = -1, stopped = false, seen = false;
  const tick = async () => {
    if (stopped) return;
    if (el.isConnected) seen = true; else if (seen) { destroy(); return; }
    const t = now();
    bar.style.transform = `scaleX(${(1 - (t % PULSE_MS) / PULSE_MS).toFixed(3)})`;
    if (!key || Math.floor(t / PULSE_MS) === shown) return;
    const pulse = await pulseAt(key, t);
    if (stopped) return;
    shown = pulse.k;
    mark.replaceChildren(pulseMark(pulse.glyph, pulse.colour));
    name.textContent = `${PULSE_COLOUR_NAMES[pulse.colour]} ${PULSE_GLYPH_NAMES[pulse.glyph]}`;
  };
  const timer = setInterval(() => void tick(), 250);
  function destroy(): void { stopped = true; clearInterval(timer); }
  void importSecret(keyHex).then((k) => { key = k; return tick(); }).catch(() => { name.textContent = 'The reference could not be shown on this device.'; });
  return { el, destroy };
}

/** How far this device's clock is from the server's, from one small round trip. Null when the server cannot be asked. */
export async function measureClock(ctx: Ctx): Promise<number | null> {
  try { const before = Date.now(), server = await ctx.api.passClock(), after = Date.now(); return Number.isFinite(server) ? Math.round(server - (before + after) / 2) : null; }
  catch { return null; }
}
/** The same, for where there is nothing better to fall back on than this device's own clock. */
export async function clockOffset(ctx: Ctx): Promise<number> { return (await measureClock(ctx)) ?? 0; }

/** "Pass check" on the event page, for everyone with a staff role. Null for team managers and spectators, who do not get the key. */
export function passCheckPanel(ctx: Ctx, eventId: string, roles: RoleRow[]): HTMLElement | null {
  if (!roles.some((r) => r.role !== 'team_manager' && r.role !== 'spectator')) return null;
  const body = h('div', { class: 'pass-check__body' });
  const section = h('section', { class: 'card stack pass-check' },
    h('h2', null, 'Pass check'),
    h('p', null, 'Every genuine Paddock Pass shows this shape and colour at the same moment. It changes every 8 seconds. A pass that is out of step is a screenshot or a recording.'),
    body,
    roles.some((r) => r.role === 'organiser' || r.role === 'chair') ? h('div', { class: 'actions' }, h('a', { class: 'btn btn--secondary', href: routeHref({ name: 'door', eventId }) }, 'Open Door check')) : null);
  let live: { destroy(): void } | null = null, left = false;
  ctx.onLeave(() => { left = true; live?.destroy(); });
  void Promise.all([ctx.api.passPulseKey(eventId), clockOffset(ctx)]).then(([key, offset]) => {
    if (left) return;
    const reference = pulseReference(key, { now: () => Date.now() + offset });
    live = reference; body.replaceChildren(reference.el);
  }).catch(() => { section.remove(); });
  return section;
}
