import { ApiError, ScoreQueue, memoryKV, type Api, type KV, type QueueEvent, type QueueStatus, type Rejected } from '../api';

export type HostEvent = QueueEvent | { kind: 'switched' };
type Enqueue = Parameters<ScoreQueue['enqueue']>[0];

export interface UserStorage { queue: KV; rejected: KV }
export interface QueueHostOptions {
  api: Pick<Api, 'getSession' | 'saveScore' | 'onAuthChange'>;
  /** Storage for one user. Must be keyed by user id so one person's scores are never visible to another. */
  storage(userId: string): UserStorage;
  clock?: () => number;
  /** Remembers the last signed-in user id (not a secret) so a reload while signed out still knows whose scores wait. */
  lastUser?: KV;
  /** Lock manager for electing one sender per user across tabs. Defaults to navigator.locks where it exists. */
  locks?: Pick<LockManager, 'request'> | null;
}

const EMPTY: QueueStatus = { pending: 0, signedOut: false, headStuck: false, persistFailed: false };

/**
 * One ScoreQueue per signed-in user. The queue and its rejected ledger are stored per user id, the active queue
 * follows the session, and a signed-out device has no active queue at all (enqueue is refused, status is empty).
 * A user's queue instance is kept for the page's life so signing back in resumes it, never a second copy.
 * When the session lapses (signed out, token expired offline) a score being entered is still queued, under the
 * last-known user's storage: it is never sent as anyone else, and shows as waiting until that person signs in.
 * Only a device that has never had a signed-in user refuses to queue.
 * Every send re-checks that the session still belongs to the queue's owner, so a flush that is mid-way when the
 * person changes can never send the next score as someone else.
 */
export class QueueHost {
  private queues = new Map<string, ScoreQueue>();
  private current: { userId: string; queue: ScoreQueue } | null = null;
  private listeners = new Set<(e: HostEvent) => void>();
  private detach: (() => void) | null = null;
  private stopTracking: (() => void) | null = null;
  private lastUserId: string | null;
  private lastUserKv: KV;
  /** True from a sign-in until the first queue event: the session check has not resolved, so do not show "sign in again". */
  private optimistic = false;

  constructor(private opts: QueueHostOptions) {
    this.lastUserKv = opts.lastUser ?? memoryKV();
    let stored: string | null = null;
    try { stored = this.lastUserKv.get(); } catch { stored = null; }
    this.lastUserId = stored && stored.length > 0 ? stored : null;
  }

  /** The queue to show and to record into: the signed-in user's, else the last-known user's, else none. */
  private view(): ScoreQueue | null {
    if (this.current) return this.current.queue;
    return this.lastUserId ? this.queueFor(this.lastUserId) : null;
  }

  private rewire() {
    this.detach?.();
    this.detach = null;
    const q = this.view();
    if (q) this.detach = q.subscribe((e) => { this.optimistic = false; this.emit(e); });
  }

  private queueFor(userId: string): ScoreQueue {
    let q = this.queues.get(userId);
    if (!q) {
      const st = this.opts.storage(userId);
      const owns = async () => (await this.opts.api.getSession())?.userId === userId;
      const guarded: Pick<Api, 'saveScore'> = {
        saveScore: async (...a: Parameters<Api['saveScore']>) => {
          if (!(await owns())) throw new ApiError('unauthenticated', 'The signed-in person changed');
          return this.opts.api.saveScore(...a);
        },
      };
      // One sender per user across tabs. Where there are no locks (old browsers, tests) the queue still re-reads the
      // store before every send, so two tabs cannot overwrite each other with stale values.
      const locks = this.opts.locks === undefined ? (typeof navigator === 'undefined' ? null : (navigator.locks ?? null)) : this.opts.locks;
      const withLock = locks ? <T,>(fn: () => Promise<T>) => locks.request(`stem-racing-score-queue:${userId}`, fn) as Promise<T> : undefined;
      q = new ScoreQueue(guarded, st.queue, this.opts.clock ?? Date.now, { canSend: owns, rejectedKv: st.rejected, withLock });
      this.queues.set(userId, q);
    }
    return q;
  }

  /** Follows the api's session from now on. Call once; returns when the current session has been applied. */
  async track(): Promise<void> {
    this.stopTracking?.();
    this.stopTracking = this.opts.api.onAuthChange((s) => this.setUser(s?.userId ?? null));
    const s = await this.opts.api.getSession();
    this.setUser(s?.userId ?? null);
    this.rewire(); // also covers a signed-out start: listen to the last-known user's queue
  }

  untrack() { this.stopTracking?.(); this.stopTracking = null; }

  /** Idempotent. Detaches the old queue's listener (no leaks, no double notification) and activates the new one. */
  setUser(userId: string | null): void {
    if ((this.current?.userId ?? null) === userId) return;
    this.current = userId ? { userId, queue: this.queueFor(userId) } : null;
    if (userId) {
      this.lastUserId = userId;
      try { this.lastUserKv.set(userId); } catch { /* the in-memory value still serves this page */ }
      this.optimistic = true;
    } else {
      this.optimistic = false;
    }
    this.rewire();
    this.emit({ kind: 'switched' });
    if (this.current) {
      void this.flush().finally(() => {
        if (this.optimistic) { this.optimistic = false; this.emit({ kind: 'switched' }); }
      });
    }
  }

  /** Visible: someone is signed in, or the last-known user has scores waiting (or refused) that they should see. */
  active(): boolean {
    if (this.current) return true;
    const q = this.view();
    return !!q && (q.pending() > 0 || q.rejected().length > 0);
  }
  userId(): string | null { return this.current?.userId ?? null; }

  /** Enqueue and send straight away. Refused only on a device that has never had a signed-in user. */
  async enqueueScore(i: Enqueue): Promise<void> {
    const q = this.view();
    if (!q) throw new ApiError('unauthenticated', 'Sign in to record scores');
    q.enqueue(i);
    await q.flush(); // with no session this sends nothing and reports "signed out"; the score stays queued
    // Joining a flush that was already past its checks leaves the new score unattempted (no error, not signed out):
    // run once more so its state is real rather than assumed.
    const s = q.status();
    if (s.pending > 0 && !s.signedOut && !s.lastError) await q.flush();
  }

  async flush(): Promise<void> {
    try {
      await this.view()?.flush();
    } catch (e) {
      console.error('Score flush failed', e);
    }
  }

  status(): QueueStatus {
    const q = this.view();
    if (!q) return { ...EMPTY };
    const s = q.status();
    return this.optimistic && this.current ? { ...s, signedOut: false } : s;
  }
  rejected(): Rejected[] { return this.view()?.rejected() ?? []; }
  pending(): number { return this.view()?.pending() ?? 0; }
  pendingFor(cardId: string) { return this.view()?.pendingFor(cardId) ?? []; }
  requeueRejected(id: string): boolean { return this.view()?.requeueRejected(id) ?? false; }
  clearRejected(id?: string): void { this.view()?.clearRejected(id); }

  subscribe(cb: (e: HostEvent) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(e: HostEvent) {
    for (const l of [...this.listeners]) {
      try { l(e); } catch { /* a faulty listener must not break the host */ }
    }
  }
}
