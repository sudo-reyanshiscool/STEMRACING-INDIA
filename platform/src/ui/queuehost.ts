import { ApiError, ScoreQueue, type Api, type KV, type QueueEvent, type QueueStatus, type Rejected } from '../api';

export type HostEvent = QueueEvent | { kind: 'switched' };
type Enqueue = Parameters<ScoreQueue['enqueue']>[0];

export interface UserStorage { queue: KV; rejected: KV }
export interface QueueHostOptions {
  api: Pick<Api, 'getSession' | 'saveScore' | 'onAuthChange'>;
  /** Storage for one user. Must be keyed by user id so one person's scores are never visible to another. */
  storage(userId: string): UserStorage;
  clock?: () => number;
}

const EMPTY: QueueStatus = { pending: 0, signedOut: false, headStuck: false, persistFailed: false };

/**
 * One ScoreQueue per signed-in user. The queue and its rejected ledger are stored per user id, the active queue
 * follows the session, and a signed-out device has no active queue at all (enqueue is refused, status is empty).
 * A user's queue instance is kept for the page's life so signing back in resumes it, never a second copy.
 * Every send re-checks that the session still belongs to the queue's owner, so a flush that is mid-way when the
 * person changes can never send the next score as someone else.
 */
export class QueueHost {
  private queues = new Map<string, ScoreQueue>();
  private current: { userId: string; queue: ScoreQueue } | null = null;
  private listeners = new Set<(e: HostEvent) => void>();
  private detach: (() => void) | null = null;
  private stopTracking: (() => void) | null = null;

  constructor(private opts: QueueHostOptions) {}

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
      q = new ScoreQueue(guarded, st.queue, this.opts.clock ?? Date.now, { canSend: owns, rejectedKv: st.rejected });
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
  }

  untrack() { this.stopTracking?.(); this.stopTracking = null; }

  /** Idempotent. Detaches the old queue's listener (no leaks, no double notification) and activates the new one. */
  setUser(userId: string | null): void {
    if ((this.current?.userId ?? null) === userId) return;
    this.detach?.();
    this.detach = null;
    this.current = userId ? { userId, queue: this.queueFor(userId) } : null;
    if (this.current) this.detach = this.current.queue.subscribe((e) => this.emit(e));
    this.emit({ kind: 'switched' });
    if (this.current) void this.flush();
  }

  active(): boolean { return this.current !== null; }
  userId(): string | null { return this.current?.userId ?? null; }

  /** Enqueue and send straight away. Refused when nobody is signed in: scores are never queued anonymously. */
  async enqueueScore(i: Enqueue): Promise<void> {
    const c = this.current;
    if (!c) throw new ApiError('unauthenticated', 'Sign in to record scores');
    c.queue.enqueue(i);
    await c.queue.flush();
  }

  async flush(): Promise<void> {
    try {
      await this.current?.queue.flush();
    } catch (e) {
      console.error('Score flush failed', e);
    }
  }

  status(): QueueStatus { return this.current ? this.current.queue.status() : { ...EMPTY }; }
  rejected(): Rejected[] { return this.current ? this.current.queue.rejected() : []; }
  pending(): number { return this.current ? this.current.queue.pending() : 0; }
  pendingFor(cardId: string) { return this.current ? this.current.queue.pendingFor(cardId) : []; }
  requeueRejected(id: string): boolean { return this.current ? this.current.queue.requeueRejected(id) : false; }
  clearRejected(id?: string): void { this.current?.queue.clearRejected(id); }

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
