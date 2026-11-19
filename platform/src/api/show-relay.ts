import { pictureRef } from './graphics-feed';

/** What the graphics control page says is on the big screen. `n` rises with every message it sends. */
export type ShowState = Record<string, unknown> & { n: number };

/**
 * The state as another device can use it: every picture address that only exists in this browser is swapped for the
 * reference that device fetches the picture by. An address with no reference is left out, as a team with no picture is.
 */
export function portableState(state: ShowState, ref: (url: string) => string | undefined = pictureRef): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state, (_key, value) => (typeof value === 'string' && value.startsWith('blob:') ? ref(value) : value)));
}

/**
 * Where the show is: the graphic, the awards step, the timer. It leaves out everything that arrives by itself (teams,
 * pictures, winners read from the event), so it only changes when the person running the show does something.
 */
export function showPosition(state: ShowState): string {
  const awards = (state.awards ?? {}) as Record<string, unknown>, ana = state.ana as Record<string, unknown> | null | undefined;
  return JSON.stringify([state.src, state.race ?? null, ana ? ana.k : null, [awards.i, awards.r, awards.custom ?? null], state.pit ?? null]);
}

export interface ShowRelay {
  /** Called once the server has said how many states were published before this page opened. */
  ready(published: number): void;
  /** Called with every state the control page sends. */
  offer(state: ShowState): void;
  /** True once this page is the one the other devices follow. */
  driving(): boolean;
  stop(): void;
}

/**
 * Decides when this control page's screen goes out to the other devices.
 *
 * A control page that is merely opened must not take over a show another laptop is running, so opening one sends
 * nothing: it starts sending at the first step taken on it, and from then on sends every change. The one exception is
 * an event nothing has been published for yet, where there is no show to disturb.
 */
export function showRelay(publish: (n: number, state: Record<string, unknown>) => Promise<void>, failed: (e: unknown) => void, retryMs = 3000): ShowRelay {
  let known = false, driving = false, busy = false, alive = true;
  let baseline: string | null = null, latest: ShowState | null = null, sent = '';
  let retry: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    if (!alive || !known || !latest || busy) return;
    if (!driving) { if (showPosition(latest) === baseline) return; driving = true; }
    const state = latest, out = portableState(state), body = JSON.stringify({ ...out, n: 0 });
    if (body === sent) return;
    busy = true;
    publish(state.n, out).then(() => { sent = body; return true; }, (e) => { failed(e); return false; }).then((ok) => {
      busy = false;
      if (!alive) return;
      // a change made while that one was on its way goes straight after it; a failure is tried again shortly
      if (ok) pump(); else { clearTimeout(retry); retry = setTimeout(pump, retryMs); }
    });
  };
  return {
    ready(published) { known = true; if (!published) driving = true; pump(); },
    offer(state) { if (baseline === null) baseline = showPosition(state); latest = state; pump(); },
    driving: () => driving,
    stop() { alive = false; clearTimeout(retry); },
  };
}
