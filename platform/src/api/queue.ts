import { ApiError, type Api, type ApiErrorCode } from './types';

/** `set` must throw if the value could not be stored: the queue turns that into a visible 'persist-failed'. */
export interface KV { get(): string | null; set(v: string): void }

export function memoryKV(): KV {
  let value: string | null = null;
  return { get: () => value, set: (v) => { value = v; } };
}

export function localStorageKV(key: string): KV {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (v) => { localStorage.setItem(key, v); }, // throws when storage is full or blocked; the queue reports it
  };
}

/**
 * `comment` undefined means "leave the stored comment alone" (matches Api.saveScore); a string, including '', replaces it.
 */
export interface QueuedScore { cardId: string; criterionId: string; score: number; comment?: string; at: number }

export type RejectCode = ApiErrorCode | 'stuck';
/** A score the server refused (or that kept failing). Kept until the user clears it so a drop is never silent. */
export interface Rejected { id: string; item: QueuedScore; code: RejectCode; reason: string; at: number }

export type QueueEvent =
  | { kind: 'saved'; pending: number }
  | { kind: 'offline'; pending: number; lastError?: { code: ApiErrorCode; message: string } }
  /** No valid session: nothing was sent or dropped. The UI should say "Sign in again, your scores are safe". */
  | { kind: 'signed-out'; pending: number; reason: 'signed-out' }
  | { kind: 'dropped'; item: QueuedScore; reason: string }
  | { kind: 'persist-failed' }
  /** The rejected ledger changed outside a flush (dismissed or requeued), so open screens should re-read it. */
  | { kind: 'ledger' };

export interface QueueStatus {
  pending: number;
  lastError?: { code: ApiErrorCode; message: string };
  signedOut: boolean;
  /** The oldest queued score keeps failing with a server error (not a network error). */
  headStuck: boolean;
  persistFailed: boolean;
}

export interface QueueOptions {
  /** Return false when there is no usable session: flush then sends and consumes nothing and reports 'signed-out'. */
  canSend?: () => boolean | Promise<boolean>;
  /** Where the rejected ledger lives (a different key from the queue). Defaults to memory only. */
  rejectedKv?: KV;
}

/** Only these mean the server has definitively refused the write. Everything else is retried: a score is never dropped on a guess. */
const DROP: ApiErrorCode[] = ['locked', 'forbidden', 'invalid', 'not-found'];
/** Server-side failures (not network, not signed-out) are retried this many times per item, then moved to the ledger. */
export const MAX_ATTEMPTS = 5;

const REASONS: Partial<Record<ApiErrorCode, string>> = {
  locked: 'This scorecard was submitted or reopened elsewhere, so your latest change was not saved.',
  forbidden: 'You no longer have permission to score this team, so your latest change was not saved.',
  'not-found': 'This scorecard no longer exists, so your latest change was not saved.',
};

function validItem(x: unknown): x is QueuedScore {
  if (!x || typeof x !== 'object') return false;
  const v = x as Record<string, unknown>;
  return typeof v.cardId === 'string' && typeof v.criterionId === 'string'
    && typeof v.score === 'number' && Number.isFinite(v.score)
    && (v.comment === undefined || typeof v.comment === 'string') && typeof v.at === 'number';
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const load = (raw: string | null): QueuedScore[] => parseArray(raw).filter(validItem);

function loadRejected(raw: string | null): Rejected[] {
  return parseArray(raw).filter((x): x is Rejected => {
    if (!x || typeof x !== 'object') return false;
    const v = x as Record<string, unknown>;
    return typeof v.id === 'string' && typeof v.code === 'string' && typeof v.reason === 'string' && typeof v.at === 'number' && validItem(v.item);
  });
}

type LastError = { code: ApiErrorCode; message: string };

export class ScoreQueue {
  private items: QueuedScore[];
  private ledger: Rejected[];
  private listeners = new Set<(e: QueueEvent) => void>();
  private running = false;
  private flushing: Promise<void> | null = null;
  private inFlight: QueuedScore | null = null;
  private attempts = new Map<QueuedScore, number>();
  /** Items whose last send failed with a server error (drives status().headStuck). */
  private struggling = new Set<QueuedScore>();
  private lastError: LastError | undefined;
  private signedOut = false;
  private failed = { queue: false, ledger: false };
  private seq = 0;
  private canSend?: () => boolean | Promise<boolean>;
  private rejectedKv: KV;

  constructor(private api: Pick<Api, 'saveScore'>, private kv: KV, private clock: () => number = Date.now, opts: QueueOptions = {}) {
    this.canSend = opts.canSend;
    this.rejectedKv = opts.rejectedKv ?? memoryKV();
    this.items = load(kv.get());
    this.ledger = loadRejected(this.rejectedKv.get());
  }

  subscribe(cb: (e: QueueEvent) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  pending() { return this.items.length; }
  pendingFor(cardId: string) { return this.items.filter((i) => i.cardId === cardId).map((i) => ({ ...i })); }

  status(): QueueStatus {
    const head = this.items[0];
    const s: QueueStatus = {
      pending: this.items.length,
      signedOut: this.signedOut,
      headStuck: !!head && this.struggling.has(head),
      persistFailed: this.failed.queue || this.failed.ledger,
    };
    if (this.lastError) s.lastError = { ...this.lastError };
    return s;
  }

  rejected(): Rejected[] { return this.ledger.map((r) => ({ ...r, item: { ...r.item } })); }

  clearRejected(id?: string) {
    this.ledger = id === undefined ? [] : this.ledger.filter((r) => r.id !== id);
    this.persistLedger();
    this.emit({ kind: 'ledger' });
  }

  /**
   * Moves a rejected entry back to the end of the pending queue. Returns false if there is no such entry, or if a
   * newer edit for the same criterion is already pending (the old value must not overwrite it). It does not flush:
   * the caller must call flush() afterwards.
   */
  requeueRejected(id: string): boolean {
    const r = this.ledger.find((x) => x.id === id);
    if (!r) return false;
    if (this.items.some((x) => x.cardId === r.item.cardId && x.criterionId === r.item.criterionId)) return false;
    this.items.push({ ...r.item });
    this.persist(); // queue first: a crash between the two writes leaves a duplicate, never a loss
    this.ledger = this.ledger.filter((x) => x.id !== id);
    this.persistLedger();
    this.emit({ kind: 'ledger' });
    return true;
  }

  enqueue(i: { cardId: string; criterionId: string; score: number; comment?: string }) {
    const same = (x: QueuedScore) => x.cardId === i.cardId && x.criterionId === i.criterionId;
    // A score-only edit must not erase a comment that is still waiting to be sent (or is being sent right now and
    // may yet fail), so it inherits the most recent comment among the entries it supersedes.
    let comment = i.comment;
    if (comment === undefined) {
      for (const x of this.items) if (same(x) && x.comment !== undefined) comment = x.comment;
    }
    const next: QueuedScore = { cardId: i.cardId, criterionId: i.criterionId, score: i.score, at: this.clock() };
    if (comment !== undefined) next.comment = comment;
    // Drop every older unsent value for this criterion, but never the one being sent right now.
    for (const x of this.items) if (same(x) && x !== this.inFlight) { this.attempts.delete(x); this.struggling.delete(x); }
    this.items = this.items.filter((x) => !same(x) || x === this.inFlight);
    this.items.push(next);
    this.persist();
  }

  /** One flush at a time: concurrent callers share the running one. Call again to pick up anything enqueued since. */
  flush(): Promise<void> {
    if (this.running && this.flushing) return this.flushing;
    this.running = true;
    this.flushing = this.run();
    return this.flushing;
  }

  private async run() {
    let event: QueueEvent | null = null;
    const dropped: QueueEvent[] = [];
    try {
      event = await this.drain(dropped);
    } finally {
      this.running = false;
    }
    for (const d of dropped) this.emit(d);
    if (event) this.emit(event);
  }

  private async drain(dropped: QueueEvent[]): Promise<QueueEvent> {
    if (this.canSend) {
      let ok = true;
      try { ok = await this.canSend(); } catch { ok = true; } // a broken check must not strand scores: let the server decide
      if (!ok) {
        // Signed out only matters when something is waiting; an empty queue has nothing to reassure about.
        this.signedOut = this.items.length > 0;
        return { kind: 'signed-out', pending: this.items.length, reason: 'signed-out' };
      }
      this.signedOut = false; // a usable session: any earlier signed-out state is over, whether or not anything is queued
    }
    const skipped = new Set<QueuedScore>(); // failed with a server error this flush; try the rest
    let succeeded = 0;
    for (;;) {
      const item = this.items.find((x) => !skipped.has(x));
      if (!item) break;
      this.inFlight = item;
      try {
        await this.api.saveScore(item.cardId, item.criterionId, item.score, item.comment);
        this.signedOut = false;
        succeeded += 1;
        this.remove(item);
        this.supersedeRejected(item);
      } catch (e) {
        const code: ApiErrorCode = e instanceof ApiError ? e.code : 'network';
        const message = e instanceof Error ? e.message : String(e);
        this.lastError = { code, message };
        // A newer value for the same criterion is queued behind it and will overwrite this one: discard the stale copy.
        const superseded = () => this.items.some((x) => x !== item && x.cardId === item.cardId && x.criterionId === item.criterionId);
        if (code === 'unauthenticated') {
          this.signedOut = true;
          if (superseded()) this.remove(item);
          return { kind: 'signed-out', pending: this.items.length, reason: 'signed-out' };
        }
        if (code === 'network') {
          if (superseded()) this.remove(item);
          return { kind: 'offline', pending: this.items.length, lastError: { ...this.lastError } };
        }
        if (DROP.includes(code)) {
          const reason = code === 'invalid' && e instanceof ApiError ? e.message : (REASONS[code] ?? 'The change could not be saved.');
          this.reject(item, code, reason, dropped);
        } else if (superseded()) {
          this.remove(item);
        } else {
          // Counted against the item only at the end of the flush, and only if something else got through.
          skipped.add(item);
          this.struggling.add(item);
        }
      } finally {
        this.inFlight = null;
      }
    }
    // Every attempted item failing with a server error is an outage (502/503/504), not a poisoned item: count nothing.
    // If something else succeeded in this flush, the failures are item-specific and count towards the bound.
    // Skip anything enqueue() replaced during the flush: its value is stale and must neither be counted nor parked.
    for (const item of [...skipped]) {
      if (!this.items.includes(item)) {
        skipped.delete(item);
        this.attempts.delete(item);
        this.struggling.delete(item);
      }
    }
    if (succeeded > 0) {
      for (const item of [...skipped]) {
        const n = (this.attempts.get(item) ?? 0) + 1;
        this.attempts.set(item, n);
        if (n >= MAX_ATTEMPTS) {
          const msg = this.lastError?.message ?? 'server error';
          this.reject(item, 'stuck', `This change could not be saved after ${MAX_ATTEMPTS} attempts (${msg}).`, dropped);
          skipped.delete(item);
        }
      }
    }
    if (skipped.size > 0) return { kind: 'offline', pending: this.items.length, ...(this.lastError ? { lastError: { ...this.lastError } } : {}) };
    this.lastError = undefined;
    return { kind: 'saved', pending: 0 };
  }

  /** A saved value makes any older rejected value for the same criterion obsolete: requeueing it would overwrite this one. */
  private supersedeRejected(saved: QueuedScore) {
    const keep = this.ledger.filter((r) => !(r.item.cardId === saved.cardId && r.item.criterionId === saved.criterionId && r.item.at <= saved.at));
    if (keep.length === this.ledger.length) return;
    this.ledger = keep;
    this.persistLedger();
  }

  private reject(item: QueuedScore, code: RejectCode, reason: string, dropped: QueueEvent[]) {
    this.remove(item);
    this.seq += 1;
    this.ledger.push({ id: `${this.clock()}-${this.seq}-${Math.random().toString(36).slice(2, 8)}`, item: { ...item }, code, reason, at: this.clock() });
    this.persistLedger();
    dropped.push({ kind: 'dropped', item, reason });
  }

  private remove(item: QueuedScore) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.attempts.delete(item);
    this.struggling.delete(item);
    this.persist();
  }

  private persist() { this.store('queue', () => this.kv.set(JSON.stringify(this.items))); }
  private persistLedger() { this.store('ledger', () => this.rejectedKv.set(JSON.stringify(this.ledger))); }

  /** Storage trouble never throws into the caller and never loses the in-memory state; it is reported instead. */
  private store(which: 'queue' | 'ledger', write: () => void) {
    try {
      write();
      this.failed[which] = false;
    } catch {
      this.failed[which] = true;
      this.emit({ kind: 'persist-failed' });
    }
  }

  private emit(e: QueueEvent) {
    for (const l of [...this.listeners]) {
      try { l(e); } catch { /* a faulty listener must not break the queue */ }
    }
  }
}
