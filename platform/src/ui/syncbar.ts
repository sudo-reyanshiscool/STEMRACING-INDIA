import type { Rejected, ScoreQueue } from '../api';
import { codeText } from './common';
import { h } from './dom';

export const FLUSH_INTERVAL_MS = 30_000;

type Enqueue = Parameters<ScoreQueue['enqueue']>[0];

/** Every screen that records a score goes through this, so a save is always attempted straight away. */
export async function enqueueScore(queue: ScoreQueue, i: Enqueue): Promise<void> {
  queue.enqueue(i);
  await queue.flush();
}

const scores = (n: number) => `${n} score${n === 1 ? '' : 's'}`;

/**
 * Renders the queue's state in words (never colour alone) and keeps it flushing: on the window 'online' event and on
 * an interval. Callers flush on enqueue via enqueueScore. dispose() removes every listener and timer.
 */
export function mountSyncBar(root: HTMLElement, queue: ScoreQueue): { refresh(): void; dispose(): void } {
  const line = h('p', { class: 'sync-bar__line', role: 'status' });
  const extra = h('div', { class: 'stack' });
  root.replaceChildren(h('div', { class: 'sync-bar__in' }, line, extra));

  const rejectedRow = (r: Rejected) =>
    h('div', { class: 'notice', role: 'alert' },
      h('p', null, `A change was not saved: ${r.reason}`),
      h('div', { class: 'inline-form' },
        h('button', {
          class: 'btn btn--ghost btn--small', type: 'button',
          onclick: () => {
            // false means a newer edit for the same score is already waiting: this old value is obsolete.
            if (!queue.requeueRejected(r.id)) queue.clearRejected(r.id);
            void queue.flush();
            refresh();
          },
        }, 'Try again'),
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => { queue.clearRejected(r.id); refresh(); } }, 'Dismiss'),
      ));

  function refresh() {
    const s = queue.status();
    const parts: string[] = [];
    if (s.signedOut) parts.push(codeText('unauthenticated'));
    else if (s.pending > 0) parts.push(`${scores(s.pending)} waiting to send.`);
    else parts.push('All scores saved');
    if (s.signedOut && s.pending > 0) parts.push(`${scores(s.pending)} waiting to send.`);
    if (!s.signedOut && s.pending > 0 && s.lastError) parts.push(`${codeText(s.lastError.code)} Scores stay on this device until they are sent.`);
    if (s.persistFailed) parts.push('Scores could not be stored on this device. Keep this page open until they have been sent.');
    line.textContent = parts.join(' ');
    root.dataset.state = s.persistFailed ? 'warning' : s.pending > 0 || s.signedOut ? 'waiting' : 'ok';
    extra.replaceChildren(...queue.rejected().map(rejectedRow));
  }

  const unsubscribe = queue.subscribe(refresh);
  const online = () => { void queue.flush(); };
  window.addEventListener('online', online);
  const timer = setInterval(() => { if (queue.pending() > 0 || queue.status().signedOut) void queue.flush(); }, FLUSH_INTERVAL_MS);
  refresh();

  return {
    refresh,
    dispose() {
      unsubscribe();
      window.removeEventListener('online', online);
      clearInterval(timer);
    },
  };
}
