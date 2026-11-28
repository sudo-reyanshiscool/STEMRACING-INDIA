import { parsePassLink, type PassCardData } from '../api/passes';
import { h } from '../ui/dom';
import { createPassCard, type PassCard } from './card/card';
import { RpcError, type Rpc } from './client';
import { codeAt, currentStep, importSecret, macFor } from './code';
import type { PassRecord, PassStore } from './store';

export interface PassPageDeps {
  /** Null where this browser cannot keep a pass. */
  store: PassStore | null;
  rpc: Rpc;
  /** The part of the address after the #, where a new pass's link carries its token. */
  hash?: string;
  clearHash?: () => void;
  /** This phone's clock. */
  now?: () => number;
  shader?: boolean;
  confirm?: (question: string) => boolean;
}
export interface PassPage {
  /** Checks each saved pass with the server: fresh details, the right time, and whether it is still on this phone. */
  refresh(): Promise<void>;
  /** Settles once nothing is in progress. */
  idle(): Promise<void>;
  destroy(): void;
}

const REFUSED = '42501', DAY = 86_400_000, CHOSEN = 'sri-pass-selected';
type Signal = 'checking' | 'ok' | 'none' | 'fault';
const SIGNAL_TEXT: Record<Signal, string> = {
  checking: 'Checking for updates…',
  ok: 'Up to date. Saved on this phone, so it works without signal.',
  none: 'No signal. Your saved pass still works.',
  fault: 'Could not check for updates just now. Your saved pass still works.',
};

function finished(card: PassCardData, nowMs: number): boolean {
  const last = [...card.event.days].sort().pop() ?? card.event.startsOn;
  const end = last ? Date.parse(`${last.slice(0, 10)}T00:00:00Z`) : NaN;
  return Number.isFinite(end) && nowMs > end + 3 * DAY;
}

export async function startPassPage(root: HTMLElement, deps: PassPageDeps): Promise<PassPage> {
  const { store, rpc } = deps, now = deps.now ?? Date.now, ask = deps.confirm ?? ((q: string) => window.confirm(q));
  let records: PassRecord[] = store ? await store.all().catch(() => []) : [];
  let link = parsePassLink(deps.hash ?? ''), notice: string | null = null, signal: Signal = records.length ? 'checking' : 'ok', adding = false, destroyed = false;
  let selected: string | null = null;
  try { selected = localStorage.getItem(CHOSEN); } catch { /* storage is off: start on the first pass */ }
  let view: PassCard | null = null, viewOf: string | null = null;
  let work: Promise<void> = Promise.resolve();
  const run = (task: () => Promise<void>) => (work = work.then(task, task).catch(() => { /* reported on the page */ }));
  const find = (id: string) => records.find((r) => r.passId === id);
  const keep = async (record: PassRecord) => { records = find(record.passId) ? records.map((r) => (r.passId === record.passId ? record : r)) : [...records, record]; await store?.put(record); };
  const choose = (id: string) => { selected = id; try { localStorage.setItem(CHOSEN, id); } catch { /* not kept: no harm */ } };

  function showCard(record: PassRecord | undefined): HTMLElement | null {
    if (!record || record.revoked) { view?.destroy(); view = null; viewOf = null; return null; }
    if (view && viewOf === record.passId) { view.update(record.card); return view.el; }
    view?.destroy();
    const id = record.passId;
    view = createPassCard(record.card, {
      shader: deps.shader,
      now: () => now() + (find(id)?.offset ?? 0),
      code: async () => { const live = find(id); return live && !live.revoked ? codeAt(live.key, id, now() + live.offset) : null; },
    });
    viewOf = id;
    return view.el;
  }

  function render(): void {
    if (destroyed) return;
    const current = find(selected ?? '') ?? records[0];
    const parts: Array<Node | null> = [h('header', { class: 'pass-page__head' }, h('img', { src: '/brand/signifier.png', alt: '' }), h('h1', null, 'Paddock Pass'))];
    if (!store) parts.push(h('p', { class: 'pass-page__notice', role: 'alert' }, 'This browser cannot save a pass. Open the link in your phone’s own browser (Safari or Chrome), not a private tab.'));
    if (notice) parts.push(h('p', { class: 'pass-page__notice', role: 'alert' }, notice));
    if (link && store) parts.push(h('section', { class: 'pass-page__claim' },
      h('h2', null, 'Your Paddock Pass is ready'),
      h('p', null, 'A pass lives on one phone at a time. Add it here only if this is the phone you will bring to the event.'),
      h('button', { type: 'button', class: 'pass-page__go', disabled: adding, onclick: () => void run(claim) }, adding ? 'Adding your pass…' : 'Add pass to this phone')));
    if (records.length > 1) parts.push(h('nav', { class: 'pass-page__tabs', 'aria-label': 'Passes on this phone' },
      records.map((r) => h('button', { type: 'button', 'aria-pressed': String(r === current), onclick: () => { choose(r.passId); render(); } }, r.card.name || 'Pass'))));
    const cardEl = showCard(current);
    if (cardEl) {
      parts.push(h('div', { class: 'pass-page__stage' }, cardEl), h('p', { class: 'pass-page__hint' }, 'Tap the card to show your entry code.'), h('p', { class: 'pass-page__state', role: 'status' }, SIGNAL_TEXT[signal]));
      if (current && finished(current.card, now() + current.offset)) parts.push(h('p', { class: 'pass-page__state' }, 'This event has finished. ', h('button', { type: 'button', class: 'pass-page__link', onclick: () => remove(current) }, 'Remove this pass')));
    } else if (current) {
      parts.push(h('section', { class: 'pass-page__gone' },
        h('h2', null, 'This pass is no longer on this phone'),
        h('p', null, `${current.card.name ? `${current.card.name}’s pass` : 'It'} was reset or sent to another phone. Ask your team manager for a new link.`),
        h('button', { type: 'button', class: 'pass-page__go', onclick: () => remove(current) }, 'Remove from this phone')));
    } else if (!link) {
      parts.push(h('section', { class: 'pass-page__empty' },
        h('h2', null, 'No pass on this phone yet'),
        h('p', null, 'Ask your team manager to send your Paddock Pass. Then open the link they send, or point this phone’s camera at the code on their screen.')));
    }
    if (records.length || link) parts.push(h('p', { class: 'pass-page__small' }, 'Your pass is kept in this browser on this phone. Open it here again before the event. If it has gone, your team manager can send a new link in seconds.'));
    root.replaceChildren(h('div', { class: 'pass-page' }, parts));
  }

  function remove(record: PassRecord): void {
    if (!ask('Remove this pass from this phone? To get it back you would need a new link from your team manager.')) return;
    void run(async () => { await store?.remove(record.passId); records = records.filter((r) => r.passId !== record.passId); render(); });
  }

  async function claim(): Promise<void> {
    if (!link || !store || adding) return;
    const { passId, token } = link;
    adding = true; notice = null; render();
    try {
      const got = await rpc<{ secret: string; card: PassCardData }>('claim_pass', { p_pass: passId, p_token: token });
      link = null; deps.clearHash?.();
      try {
        await keep({ passId, key: await importSecret(got.secret), card: got.card, offset: Math.round(Number(got.card.now) - now()), savedAt: now() });
        choose(passId); signal = 'ok';
        void navigator.storage?.persist?.().catch(() => false);
      } catch { notice = 'This phone could not save the pass. Ask your team manager for a new link and open it in your phone’s own browser.'; }
    } catch (e) {
      if (e instanceof RpcError && e.code === REFUSED) {
        link = null; deps.clearHash?.();
        // Opening the same link again on the phone that already holds the pass is not an error.
        if (find(passId)) choose(passId); else notice = 'This link has already been used. Ask your team manager for a new one.';
      } else if (e instanceof RpcError && e.offline) notice = 'Adding a pass needs signal. Find a connection, then try again.';
      else notice = 'The pass could not be added just now. Try again in a moment.';
    } finally { adding = false; render(); }
  }

  async function refresh(): Promise<void> {
    if (!records.length || destroyed) return;
    let offset: number;
    try {
      const before = now(), server = Number(await rpc<number>('pass_now')), after = now();
      if (!Number.isFinite(server)) throw new RpcError('no time');
      offset = Math.round(server - (before + after) / 2);
    } catch (e) { signal = e instanceof RpcError && e.offline ? 'none' : 'fault'; render(); return; }
    let outcome: Signal = 'ok';
    for (const record of [...records]) {
      const step = currentStep(now() + offset);
      try {
        const card = await rpc<PassCardData>('pass_card', { p_pass: record.passId, p_step: step, p_mac: await macFor(record.key, record.passId, step) });
        await keep({ ...record, card, offset, revoked: false });
      } catch (e) {
        if (e instanceof RpcError && e.code === REFUSED) await keep({ ...record, offset, revoked: true }).catch(() => { /* shown anyway */ });
        else outcome = e instanceof RpcError && e.offline ? 'none' : 'fault';
      }
    }
    signal = outcome; render();
  }

  render();
  if (records.length) void run(refresh);
  return {
    refresh: () => run(refresh),
    async idle() { let seen: Promise<void>; do { seen = work; await seen; } while (seen !== work); },
    destroy() { destroyed = true; view?.destroy(); view = null; },
  };
}
