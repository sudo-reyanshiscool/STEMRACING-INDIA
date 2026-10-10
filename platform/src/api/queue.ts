import { ApiError, type Api, type ApiErrorCode } from './types';

export interface KV { get(): string | null; set(v: string): void }

export function memoryKV(): KV {
  let value: string | null = null;
  return { get: () => value, set: (v) => { value = v; } };
}

export function localStorageKV(key: string): KV {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(key, v); } catch { /* storage full or blocked: the queue still works in memory */ } },
  };
}

/**
 * `comment` undefined means "leave the stored comment alone" (matches Api.saveScore); a string, including '', replaces it.
 */
export interface QueuedScore { cardId: string; criterionId: string; score: number; comment?: string; at: number }

export type QueueEvent =
  | { kind: 'saved'; pending: number }
  | { kind: 'offline'; pending: number }
  | { kind: 'dropped'; item: QueuedScore; reason: string };

/** Only these mean the server has definitively refused the write. Everything else is retried: a score is never dropped on a guess. */
const DROP: ApiErrorCode[] = ['locked', 'forbidden', 'invalid', 'not-found'];

const REASONS: Partial<Record<ApiErrorCode, string>> = {
  locked: 'This scorecard was submitted or reopened elsewhere, so your latest change was not saved.',
  forbidden: 'You no longer have permission to score this team, so your latest change was not saved.',
  'not-found': 'This scorecard no longer exists, so your latest change was not saved.',
};

function load(raw: string | null): QueuedScore[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is QueuedScore =>
      !!x && typeof x === 'object' && typeof x.cardId === 'string' && typeof x.criterionId === 'string'
      && typeof x.score === 'number' && Number.isFinite(x.score)
      && (x.comment === undefined || typeof x.comment === 'string') && typeof x.at === 'number');
  } catch {
    return [];
  }
}

export class ScoreQueue {
  private items: QueuedScore[];
  private listeners = new Set<(e: QueueEvent) => void>();
  private running = false;
  private flushing: Promise<void> | null = null;
  private inFlight: QueuedScore | null = null;

  constructor(private api: Pick<Api, 'saveScore'>, private kv: KV, private clock: () => number = Date.now) {
    this.items = load(kv.get());
  }

  subscribe(cb: (e: QueueEvent) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  pending() { return this.items.length; }
  pendingFor(cardId: string) { return this.items.filter((i) => i.cardId === cardId).map((i) => ({ ...i })); }

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
    while (this.items.length > 0) {
      const item = this.items[0];
      this.inFlight = item;
      try {
        await this.api.saveScore(item.cardId, item.criterionId, item.score, item.comment);
        this.remove(item);
      } catch (e) {
        const code: ApiErrorCode = e instanceof ApiError ? e.code : 'network';
        if (!DROP.includes(code)) {
          // A newer value for the same criterion is queued behind it and will overwrite this one: discard the stale copy.
          if (this.items.some((x) => x !== item && x.cardId === item.cardId && x.criterionId === item.criterionId)) this.remove(item);
          return { kind: 'offline', pending: this.items.length };
        }
        this.remove(item);
        const reason = code === 'invalid' && e instanceof ApiError ? e.message : (REASONS[code] ?? 'The change could not be saved.');
        dropped.push({ kind: 'dropped', item, reason });
      } finally {
        this.inFlight = null;
      }
    }
    return { kind: 'saved', pending: 0 };
  }

  private remove(item: QueuedScore) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.persist();
  }

  private persist() { this.kv.set(JSON.stringify(this.items)); }
  private emit(e: QueueEvent) {
    for (const l of [...this.listeners]) {
      try { l(e); } catch { /* a faulty listener must not break the queue */ }
    }
  }
}
