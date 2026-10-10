import { describe, expect, it } from 'vitest';
import { ApiError, ScoreQueue, memoryKV, type KV, type QueueEvent } from '../../src/api';

type Call = { cardId: string; criterionId: string; score: number; comment: string };
function fakeApi(plan: (c: Call, n: number) => Promise<void> | void) {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      async saveScore(cardId: string, criterionId: string, score: number, comment = '') {
        const c = { cardId, criterionId, score, comment };
        calls.push(c);
        await plan(c, calls.length);
      },
    },
  };
}
// Records the comment argument exactly as passed (undefined stays undefined).
function rawApi(plan: (n: number) => Promise<void> | void) {
  const calls: { criterionId: string; score: number; comment: string | undefined }[] = [];
  return {
    calls,
    api: {
      async saveScore(_cardId: string, criterionId: string, score: number, comment?: string) {
        calls.push({ criterionId, score, comment });
        await plan(calls.length);
      },
    },
  };
}
const item = (criterionId: string, score: number, comment = '') => ({ cardId: 'c1', criterionId, score, comment });
const net = () => { throw new ApiError('network', 'offline'); };

describe('ScoreQueue', () => {
  it('sends queued scores in order and empties itself', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    q.enqueue(item('b', 6));
    expect(q.pending()).toBe(2);
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
    expect(q.pending()).toBe(0);
  });

  it('keeps scores while offline, survives a reload, and sends them when back online', async () => {
    const kv = memoryKV();
    let online = false;
    const { api, calls } = fakeApi(() => { if (!online) net(); });
    const events: QueueEvent[] = [];
    const q1 = new ScoreQueue(api, kv);
    q1.subscribe((e) => events.push(e));
    q1.enqueue(item('a', 5, 'good'));
    await q1.flush();
    expect(q1.pending()).toBe(1);
    expect(events.at(-1)).toEqual({ kind: 'offline', pending: 1, lastError: { code: 'network', message: 'offline' } });

    const q2 = new ScoreQueue(api, kv); // a page reload
    expect(q2.pendingFor('c1')).toEqual([expect.objectContaining({ criterionId: 'a', score: 5, comment: 'good' })]);
    online = true;
    await q2.flush();
    expect(q2.pending()).toBe(0);
    expect(calls.at(-1)).toEqual({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'good' });
    expect(new ScoreQueue(api, kv).pending()).toBe(0);
  });

  it('keeps only the latest value for a criterion', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    q.enqueue(item('a', 9));
    q.enqueue(item('a', 12));
    expect(q.pending()).toBe(1);
    await q.flush();
    expect(calls.map((c) => c.score)).toEqual([12]);
  });

  it('does not lose an edit made while the previous value is being sent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api, calls } = fakeApi(async (_c, n) => { if (n === 1) await gate; });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    const first = q.flush();
    q.enqueue(item('a', 7)); // typed while 5 is in flight
    release();
    await first;
    await q.flush();
    expect(calls.map((c) => c.score)).toEqual([5, 7]);
    expect(q.pending()).toBe(0);
  });

  it('drops an edit the server refuses (card locked or reopened elsewhere), says so, and carries on', async () => {
    const { api, calls } = fakeApi((c) => { if (c.criterionId === 'a') throw new ApiError('locked', 'This scorecard has been submitted'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 5));
    q.enqueue(item('b', 6));
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
    expect(q.pending()).toBe(0);
    expect(events).toContainEqual({ kind: 'dropped', item: expect.objectContaining({ criterionId: 'a' }), reason: expect.stringContaining('submitted') });
    expect(events.at(-1)).toEqual({ kind: 'saved', pending: 0 });
  });

  it('retries on an unknown server error instead of dropping the score', async () => {
    let fail = true;
    const { api } = fakeApi(() => { if (fail) throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    await q.flush();
    expect(q.pending()).toBe(1);
    fail = false;
    await q.flush();
    expect(q.pending()).toBe(0);
  });

  it('shares one flush between concurrent callers', async () => {
    const { api, calls } = fakeApi(async () => { await Promise.resolve(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    await Promise.all([q.flush(), q.flush(), q.flush()]);
    expect(calls).toHaveLength(1);
  });

  it('ignores corrupt or hostile stored data', () => {
    const { api } = fakeApi(() => {});
    for (const bad of ['not json', '{"a":1}', '[1,2]', '[{"cardId":1}]', 'null']) {
      const kv = memoryKV();
      kv.set(bad);
      expect(new ScoreQueue(api, kv).pending(), bad).toBe(0);
    }
  });

  it('reports pending items per card', () => {
    const { api } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 1, comment: '' });
    q.enqueue({ cardId: 'c2', criterionId: 'a', score: 2, comment: '' });
    expect(q.pendingFor('c2')).toHaveLength(1);
    expect(q.pendingFor('c3')).toEqual([]);
  });
});

describe('ScoreQueue data-loss guards', () => {
  it('a third edit after a failed in-flight send still wins (no stale value sent last)', async () => {
    let online = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api, calls } = fakeApi(async (_c, n) => { if (n === 1) { await gate; net(); } if (!online) net(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    const first = q.flush();
    q.enqueue(item('a', 7)); // while 5 is in flight
    release();
    await first; // 5 fails
    q.enqueue(item('a', 9)); // after the failure
    online = true;
    await q.flush();
    expect(calls.at(-1)).toMatchObject({ criterionId: 'a', score: 9 });
    expect(q.pending()).toBe(0);
    expect(q.pendingFor('c1')).toEqual([]);
  });

  it('keeps one entry per criterion when an in-flight send fails and was superseded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api } = fakeApi(async (_c, n) => { if (n === 1) { await gate; net(); } net(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    const first = q.flush();
    q.enqueue(item('a', 7));
    release();
    await first;
    expect(q.pendingFor('c1')).toEqual([expect.objectContaining({ score: 7 })]);
  });

  it('does not send the in-flight value twice nor drop the newer one when the send succeeds', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api, calls } = fakeApi(async (_c, n) => { if (n === 1) await gate; });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 5));
    const first = q.flush();
    q.enqueue(item('a', 7));
    q.enqueue(item('a', 8));
    expect(q.pending()).toBe(2); // the in-flight 5 and the latest 8
    release();
    await first;
    expect(calls.map((c) => c.score)).toEqual([5, 8]);
  });

  it('persists the queue so a reload mid-flight resends it (idempotent) rather than losing it', async () => {
    const kv = memoryKV();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api } = fakeApi(async () => { await gate; });
    const q1 = new ScoreQueue(api, kv);
    q1.enqueue(item('a', 5));
    void q1.flush();
    expect(new ScoreQueue(api, kv).pendingFor('c1')).toEqual([expect.objectContaining({ score: 5 })]);
    release();
  });

  it('keeps well-formed stored entries and skips only the malformed ones', () => {
    const { api } = fakeApi(() => {});
    const kv = memoryKV();
    kv.set(JSON.stringify([
      { cardId: 'c1', criterionId: 'a', score: 5, comment: 'ok', at: 1 },
      { cardId: 'c1', criterionId: 'b', score: 'x', comment: '', at: 2 },
      null,
      { cardId: 'c1', criterionId: 'c', score: 3, at: 3 },
      { cardId: 'c1', criterionId: 'd', score: 4, comment: 7, at: 4 },
      { cardId: 'c1', criterionId: 'e', score: 1e999, comment: '', at: 5 },
    ]));
    const q = new ScoreQueue(api, kv);
    expect(q.pendingFor('c1').map((i) => i.criterionId)).toEqual(['a', 'c']);
  });

  it('retries on a non-ApiError throw and on network/unknown, drops only on locked/forbidden/invalid/not-found', async () => {
    for (const [err, retained] of [
      [new ApiError('network', 'x'), true],
      [new ApiError('unknown', 'x'), true],
      [new TypeError('Failed to fetch'), true],
      [new ApiError('duplicate', 'x'), true],
      [new ApiError('locked', 'x'), false],
      [new ApiError('forbidden', 'x'), false],
      [new ApiError('invalid', 'Score out of range'), false],
      [new ApiError('not-found', 'x'), false],
    ] as const) {
      const { api } = fakeApi(() => { throw err; });
      const events: QueueEvent[] = [];
      const q = new ScoreQueue(api, memoryKV());
      q.subscribe((e) => events.push(e));
      q.enqueue(item('a', 5));
      await q.flush();
      expect(q.pending(), String(err)).toBe(retained ? 1 : 0);
      expect(events.some((e) => e.kind === 'dropped'), String(err)).toBe(!retained);
      expect(events.some((e) => e.kind === 'offline'), String(err)).toBe(retained);
    }
  });

  it('surfaces the server message when a score is dropped as invalid', async () => {
    const { api } = fakeApi(() => { throw new ApiError('invalid', 'Score must be between 0 and 10'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 50));
    await q.flush();
    expect(events).toContainEqual({ kind: 'dropped', item: expect.objectContaining({ score: 50 }), reason: 'Score must be between 0 and 10' });
  });

  it('passes an undefined comment through as undefined, not as an empty string', async () => {
    const { api, calls } = rawApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5 });
    await q.flush();
    expect(calls).toEqual([{ criterionId: 'a', score: 5, comment: undefined }]);
  });

  it('keeps an explicit empty comment as an empty string (clears the comment)', async () => {
    const { api, calls } = rawApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: '' });
    await q.flush();
    expect(calls[0].comment).toBe('');
  });

  it('coalescing a score-only edit over a queued comment keeps the queued comment', async () => {
    const { api, calls } = rawApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'nice cornering' });
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 8 });
    await q.flush();
    expect(calls).toEqual([{ criterionId: 'a', score: 8, comment: 'nice cornering' }]);
  });

  it('coalescing a comment over a queued score-only edit sends both the new score and the comment', async () => {
    const { api, calls } = rawApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5 });
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'added later' });
    await q.flush();
    expect(calls).toEqual([{ criterionId: 'a', score: 5, comment: 'added later' }]);
  });

  it('a score-only edit made while a comment is in flight that then fails does not lose the comment', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let online = false;
    const { api, calls } = rawApi(async (n) => { if (n === 1) { await gate; net(); } if (!online) net(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'keep me' });
    const first = q.flush();
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 6 });
    release();
    await first;
    online = true;
    await q.flush();
    expect(calls.at(-1)).toEqual({ criterionId: 'a', score: 6, comment: 'keep me' });
  });

  it('an undefined comment survives a reload as undefined', async () => {
    const kv = memoryKV();
    const { api, calls } = rawApi(() => net());
    const q1 = new ScoreQueue(api, kv);
    q1.enqueue({ cardId: 'c1', criterionId: 'a', score: 5 });
    await q1.flush();
    const { api: api2, calls: calls2 } = rawApi(() => {});
    const q2 = new ScoreQueue(api2, kv);
    await q2.flush();
    expect(calls.length).toBe(1);
    expect(calls2).toEqual([{ criterionId: 'a', score: 5, comment: undefined }]);
  });

  it('an item enqueued from a saved listener is sent by a following flush, not stranded', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    let once = true;
    q.subscribe((e) => { if (e.kind === 'saved' && once) { once = false; q.enqueue(item('b', 2)); void q.flush(); } });
    q.enqueue(item('a', 1));
    await q.flush();
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
    expect(q.pending()).toBe(0);
  });

  it('an item enqueued while a flush is finishing is picked up by the next flush call', async () => {
    const { api, calls } = fakeApi(async () => { await Promise.resolve(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    const first = q.flush();
    await first;
    q.enqueue(item('b', 2));
    await q.flush();
    expect(calls.map((c) => c.criterionId)).toEqual(['a', 'b']);
  });

  it('a throwing listener does not break the queue', async () => {
    const { api } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe(() => { throw new Error('boom'); });
    q.enqueue(item('a', 1));
    await expect(q.flush()).resolves.toBeUndefined();
    expect(q.pending()).toBe(0);
  });

  it('unsubscribe stops events', async () => {
    const { api } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV());
    const events: QueueEvent[] = [];
    const off = q.subscribe((e) => events.push(e));
    off();
    q.enqueue(item('a', 1));
    await q.flush();
    expect(events).toEqual([]);
  });
});

const auth = () => { throw new ApiError('unauthenticated', 'JWT expired'); };
const sendIds = (calls: { criterionId: string }[]) => calls.map((c) => c.criterionId);

describe('ScoreQueue signed out (C1)', () => {
  it('an expired token keeps every queued score, drops nothing, and reports signed-out', async () => {
    const { api, calls } = fakeApi(() => auth());
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    q.enqueue(item('c', 3));
    await q.flush();
    expect(q.pending()).toBe(3);
    expect(calls).toHaveLength(1); // stopped at the first refusal
    expect(events.some((e) => e.kind === 'dropped')).toBe(false);
    expect(events.at(-1)).toEqual({ kind: 'signed-out', pending: 3, reason: 'signed-out' });
    expect(q.status().signedOut).toBe(true);
    expect(q.rejected()).toEqual([]);
  });

  it('sends everything once signed in again', async () => {
    let signedIn = false;
    const { api, calls } = fakeApi(() => { if (!signedIn) auth(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    await q.flush();
    signedIn = true;
    await q.flush();
    expect(q.pending()).toBe(0);
    expect(sendIds(calls).slice(-2)).toEqual(['a', 'b']);
    expect(q.status().signedOut).toBe(false);
  });

  it('canSend false: nothing is sent or consumed, and signed-out is reported', async () => {
    const { api, calls } = fakeApi(() => {});
    const events: QueueEvent[] = [];
    let ok = false;
    const q = new ScoreQueue(api, memoryKV(), undefined, { canSend: async () => ok });
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    await q.flush();
    expect(calls).toHaveLength(0);
    expect(q.pending()).toBe(1);
    expect(events.at(-1)).toEqual({ kind: 'signed-out', pending: 1, reason: 'signed-out' });
    ok = true;
    await q.flush();
    expect(q.pending()).toBe(0);
    expect(q.status().signedOut).toBe(false);
  });

  it('a synchronous canSend works too', async () => {
    const { api, calls } = fakeApi(() => {});
    const q = new ScoreQueue(api, memoryKV(), undefined, { canSend: () => false });
    q.enqueue(item('a', 1));
    await q.flush();
    expect(calls).toHaveLength(0);
  });

  it('keeps an in-flight value and a newer edit across an unauthenticated failure', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { api } = fakeApi(async (_c, n) => { if (n === 1) { await gate; auth(); } });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'keep' });
    const f = q.flush();
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 6 });
    release();
    await f;
    expect(q.pendingFor('c1')).toEqual([expect.objectContaining({ score: 6, comment: 'keep' })]);
  });
});

describe('ScoreQueue rejected ledger (I2)', () => {
  it('records dropped scores in a separate persisted ledger that survives a reload', async () => {
    const kv = memoryKV();
    const ledger = memoryKV();
    const { api } = fakeApi((c) => { if (c.criterionId === 'a') throw new ApiError('locked', 'submitted'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, kv, () => 42, { rejectedKv: ledger });
    q.subscribe((e) => events.push(e));
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'x' });
    await q.flush();
    expect(events).toContainEqual(expect.objectContaining({ kind: 'dropped' }));
    expect(q.rejected()).toEqual([expect.objectContaining({ code: 'locked', at: 42, item: expect.objectContaining({ criterionId: 'a', score: 5, comment: 'x' }) })]);
    expect(kv.get()).toBe('[]');
    expect(ledger.get()).not.toBeNull();

    const q2 = new ScoreQueue(api, kv, undefined, { rejectedKv: ledger });
    expect(q2.rejected()).toHaveLength(1);
    expect(q2.rejected()[0].item.score).toBe(5);
  });

  it('clearRejected removes one entry by id, or all', async () => {
    const { api } = fakeApi(() => { throw new ApiError('invalid', 'bad'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    await q.flush();
    const [first] = q.rejected();
    expect(q.rejected()).toHaveLength(2);
    q.clearRejected(first.id);
    expect(q.rejected().map((r) => r.item.criterionId)).toEqual(['b']);
    q.clearRejected();
    expect(q.rejected()).toEqual([]);
  });

  it('ignores a corrupt ledger without crashing', () => {
    const { api } = fakeApi(() => {});
    for (const bad of ['nope', '{}', '[1]', 'null']) {
      const ledger = memoryKV();
      ledger.set(bad);
      expect(new ScoreQueue(api, memoryKV(), undefined, { rejectedKv: ledger }).rejected(), bad).toEqual([]);
    }
  });
});

describe('ScoreQueue head-of-line blocking (I1)', () => {
  it('status reports pending, the last error and whether the head is stuck', async () => {
    const { api } = fakeApi(() => { throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    expect(q.status()).toEqual({ pending: 0, signedOut: false, headStuck: false, persistFailed: false });
    q.enqueue(item('a', 1));
    await q.flush();
    expect(q.status()).toEqual({ pending: 1, lastError: { code: 'unknown', message: 'HTTP 500' }, signedOut: false, headStuck: true, persistFailed: false });
  });

  it('the offline event carries the last error', async () => {
    const { api } = fakeApi(() => { throw new ApiError('unknown', 'HTTP 500'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    await q.flush();
    expect(events.at(-1)).toEqual({ kind: 'offline', pending: 1, lastError: { code: 'unknown', message: 'HTTP 500' } });
  });

  it('a poisoned head does not block later items; it is rejected as stuck after 5 attempts', async () => {
    const { api, calls } = fakeApi((c) => { if (c.criterionId === 'bad') throw new ApiError('unknown', 'HTTP 500'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('bad', 1));
    q.enqueue(item('good', 2));
    await q.flush();
    expect(q.pendingFor('c1').map((i) => i.criterionId)).toEqual(['bad']); // good went through in the first flush
    expect(sendIds(calls)).toEqual(['bad', 'good']);
    for (let i = 0; i < 3; i++) { q.enqueue(item(`good${i}`, 2)); await q.flush(); } // others succeed alongside it
    expect(q.pending()).toBe(1);
    expect(q.rejected()).toEqual([]);
    q.enqueue(item('good4', 2));
    await q.flush(); // 5th attempt
    expect(q.pending()).toBe(0);
    expect(calls.filter((c) => c.criterionId === 'bad')).toHaveLength(5);
    expect(q.rejected()).toEqual([expect.objectContaining({ code: 'stuck', item: expect.objectContaining({ criterionId: 'bad' }) })]);
    expect(events).toContainEqual({ kind: 'dropped', item: expect.objectContaining({ criterionId: 'bad' }), reason: expect.any(String) });
    expect(events.at(-1)).toEqual({ kind: 'saved', pending: 0 });
    expect(sendIds(calls).filter((c) => c.startsWith('good'))).toHaveLength(5);
  });

  it('network errors never count toward the bound', async () => {
    let online = false;
    const { api } = fakeApi(() => { if (!online) net(); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    for (let i = 0; i < 20; i++) await q.flush();
    expect(q.pending()).toBe(1);
    expect(q.rejected()).toEqual([]);
    expect(q.status().headStuck).toBe(false);
    online = true;
    await q.flush();
    expect(q.pending()).toBe(0);
  });

  it('a network error stops the flush (everything else would fail too)', async () => {
    const { api, calls } = fakeApi(() => net());
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    await q.flush();
    expect(calls).toHaveLength(1);
  });
});

describe('ScoreQueue storage failures (I3, M1)', () => {
  const failingKV = (): KV & { broken: boolean } => {
    let v: string | null = null;
    const kv = { broken: true, get: () => v, set: (x: string) => { if (kv.broken) throw new Error('QuotaExceededError'); v = x; } };
    return kv;
  };

  it('keeps the item in memory, does not throw, and reports persist-failed', () => {
    const { api } = fakeApi(() => {});
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, failingKV());
    q.subscribe((e) => events.push(e));
    expect(() => q.enqueue(item('a', 1))).not.toThrow();
    expect(q.pending()).toBe(1);
    expect(events).toContainEqual({ kind: 'persist-failed' });
    expect(q.status().persistFailed).toBe(true);
  });

  it('still sends the in-memory item, and clears the flag once storage works again', async () => {
    const { api, calls } = fakeApi(() => {});
    const kv = failingKV();
    const q = new ScoreQueue(api, kv);
    q.enqueue(item('a', 1));
    kv.broken = false;
    await q.flush();
    expect(calls).toHaveLength(1);
    expect(q.status().persistFailed).toBe(false);
  });

  it('a persist failure after a successful send is not reported as offline', async () => {
    const { api } = fakeApi(() => {});
    const kv = failingKV();
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, kv);
    q.enqueue(item('a', 1));
    q.subscribe((e) => events.push(e));
    await q.flush();
    expect(q.pending()).toBe(0);
    expect(events.some((e) => e.kind === 'offline')).toBe(false);
    expect(events.at(-1)).toEqual({ kind: 'saved', pending: 0 });
    expect(events).toContainEqual({ kind: 'persist-failed' });
  });

  it('a failing rejected ledger is reported too', async () => {
    const { api } = fakeApi(() => { throw new ApiError('locked', 'x'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV(), undefined, { rejectedKv: failingKV() });
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    await q.flush();
    expect(q.rejected()).toHaveLength(1);
    expect(events).toContainEqual({ kind: 'persist-failed' });
  });
});

describe('ScoreQueue server outage (N1)', () => {
  it('an all-unknown server for 20 flushes parks nothing and keeps every score', async () => {
    const { api } = fakeApi(() => { throw new ApiError('unknown', 'HTTP 503'); });
    const events: QueueEvent[] = [];
    const q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    q.enqueue(item('c', 3));
    for (let i = 0; i < 20; i++) await q.flush();
    expect(q.pending()).toBe(3);
    expect(q.rejected()).toEqual([]);
    expect(events.some((e) => e.kind === 'dropped')).toBe(false);
    expect(events.at(-1)).toEqual({ kind: 'offline', pending: 3, lastError: { code: 'unknown', message: 'HTTP 503' } });
  });

  it('everything sends once the outage ends', async () => {
    let up = false;
    const { api, calls } = fakeApi(() => { if (!up) throw new ApiError('unknown', 'HTTP 502'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    for (let i = 0; i < 10; i++) await q.flush();
    up = true;
    await q.flush();
    expect(q.pending()).toBe(0);
    expect(sendIds(calls).slice(-2)).toEqual(['a', 'b']);
    expect(q.rejected()).toEqual([]);
  });

  it('a poisoned item beside succeeding ones is parked after 5 flushes; the others are sent', async () => {
    const { api, calls } = fakeApi((c) => { if (c.criterionId === 'bad') throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('bad', 1));
    for (let i = 0; i < 5; i++) { q.enqueue(item(`ok${i}`, 1)); await q.flush(); }
    expect(q.pending()).toBe(0);
    expect(q.rejected().map((r) => r.item.criterionId)).toEqual(['bad']);
    expect(sendIds(calls).filter((c) => c.startsWith('ok'))).toHaveLength(5);
  });

  it('a poisoned item that fails before a success in the same flush is still counted', async () => {
    const { api } = fakeApi((c) => { if (c.criterionId === 'bad') throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('bad', 1));
    for (let i = 0; i < 5; i++) { q.enqueue(item(`ok${i}`, 1)); await q.flush(); }
    expect(q.rejected()).toHaveLength(1);
  });

  it('outage flushes do not use up attempts that a later partial recovery would count', async () => {
    let up = false;
    const { api } = fakeApi((c) => { if (!up || c.criterionId === 'bad') throw new ApiError('unknown', 'HTTP 500'); });
    const q = new ScoreQueue(api, memoryKV());
    q.enqueue(item('bad', 1));
    for (let i = 0; i < 10; i++) await q.flush();
    up = true;
    q.enqueue(item('ok', 1));
    await q.flush();
    expect(q.pending()).toBe(1);
    expect(q.rejected()).toEqual([]); // only one counted attempt so far
  });
});

describe('ScoreQueue requeueRejected', () => {
  it('moves a rejected entry back to the end of the pending queue and persists both', async () => {
    const kv = memoryKV();
    const ledger = memoryKV();
    let refuse = true;
    const { api, calls } = fakeApi((c) => { if (refuse && c.criterionId === 'a') throw new ApiError('locked', 'submitted'); });
    const q = new ScoreQueue(api, kv, undefined, { rejectedKv: ledger });
    q.enqueue({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'hi' });
    await q.flush();
    q.enqueue(item('b', 1));
    const [r] = q.rejected();
    expect(q.requeueRejected(r.id)).toBe(true);
    expect(q.rejected()).toEqual([]);
    expect(q.pendingFor('c1').map((i) => i.criterionId)).toEqual(['b', 'a']);
    const q2 = new ScoreQueue(api, kv, undefined, { rejectedKv: ledger });
    expect(q2.pending()).toBe(2);
    expect(q2.rejected()).toEqual([]);
    refuse = false;
    await q2.flush();
    expect(calls.at(-1)).toEqual({ cardId: 'c1', criterionId: 'a', score: 5, comment: 'hi' });
    expect(q2.pending()).toBe(0);
  });

  it('returns false for an unknown id, and will not resurrect a value older than a pending edit', async () => {
    const { api } = fakeApi((c) => { if (c.score === 5) throw new ApiError('invalid', 'x'); });
    const q = new ScoreQueue(api, memoryKV());
    expect(q.requeueRejected('nope')).toBe(false);
    q.enqueue(item('a', 5));
    await q.flush();
    q.enqueue(item('a', 7));
    const [r] = q.rejected();
    expect(q.requeueRejected(r.id)).toBe(false);
    expect(q.pendingFor('c1')).toEqual([expect.objectContaining({ score: 7 })]);
  });
});

describe('ScoreQueue edits during a flush, and stale ledger entries', () => {
  it('an edit made mid-flush to an item with 4 failed attempts is not parked as stuck for the stale value', async () => {
    const events: QueueEvent[] = [];
    let q!: ScoreQueue;
    const { api } = fakeApi((c) => {
      if (c.criterionId === 'a') throw new ApiError('unknown', 'HTTP 500');
      if (c.criterionId === 'ok4') q.enqueue(item('a', 9)); // judge edits a while ok4 is being sent
    });
    q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    for (let i = 0; i < 4; i++) { q.enqueue(item(`ok${i}`, 1)); await q.flush(); }
    expect(q.rejected()).toEqual([]);
    q.enqueue(item('ok4', 1));
    await q.flush();
    expect(q.rejected()).toEqual([]);
    expect(events.some((e) => e.kind === 'dropped')).toBe(false);
    expect(q.pendingFor('c1')).toEqual([expect.objectContaining({ criterionId: 'a', score: 9 })]);
  });

  it('a stale item replaced mid-flush does not make the flush report offline when everything else was sent', async () => {
    let q!: ScoreQueue;
    const events: QueueEvent[] = [];
    let first = true;
    const { api } = fakeApi((c) => {
      if (c.criterionId === 'a' && first) { first = false; throw new ApiError('unknown', 'HTTP 500'); }
      if (c.criterionId === 'b') q.enqueue(item('a', 9));
    });
    q = new ScoreQueue(api, memoryKV());
    q.subscribe((e) => events.push(e));
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 2));
    await q.flush();
    expect(q.pending()).toBe(0); // a=9 was sent in the same flush
    expect(events.at(-1)).toEqual({ kind: 'saved', pending: 0 });
  });

  it('a later successful save removes rejected entries for the same criterion, and they can no longer be requeued', async () => {
    const { api } = fakeApi((c) => { if (c.score === 1) throw new ApiError('invalid', 'bad'); });
    const ledger = memoryKV();
    const q = new ScoreQueue(api, memoryKV(), undefined, { rejectedKv: ledger });
    q.enqueue(item('a', 1));
    q.enqueue(item('b', 1));
    await q.flush();
    const [ra, rb] = q.rejected();
    expect(q.rejected()).toHaveLength(2);
    q.enqueue(item('a', 7));
    await q.flush();
    expect(q.rejected().map((r) => r.item.criterionId)).toEqual(['b']);
    expect(q.requeueRejected(ra.id)).toBe(false);
    expect(q.pending()).toBe(0);
    expect(new ScoreQueue(api, memoryKV(), undefined, { rejectedKv: ledger }).rejected().map((r) => r.id)).toEqual([rb.id]);
  });

  it('signed-out clears as soon as canSend passes, even with nothing pending', async () => {
    const { api } = fakeApi(() => {});
    let ok = false;
    const q = new ScoreQueue(api, memoryKV(), undefined, { canSend: async () => ok });
    await q.flush();
    expect(q.status().signedOut).toBe(false); // nothing waits, so there is nothing to be signed out about
    q.enqueue(item('a', 1));
    await q.flush();
    expect(q.status()).toMatchObject({ pending: 1, signedOut: true });
    ok = true;
    q.enqueue(item('b', 2));
    // the next flush passes canSend and clears the flag before sending
    await q.flush();
    expect(q.status()).toMatchObject({ pending: 0, signedOut: false });
  });

  it('signed-out clears on an empty flush once a session exists', async () => {
    const { api } = fakeApi((_c, n) => { if (n === 1) throw new ApiError('unauthenticated', 'jwt'); });
    const q = new ScoreQueue(api, memoryKV(), undefined, { canSend: async () => true });
    q.enqueue(item('a', 1));
    await q.flush();
    expect(q.status().signedOut).toBe(true);
    await q.flush(); // retried and saved
    expect(q.status().signedOut).toBe(false);
    await q.flush(); // empty
    expect(q.status().signedOut).toBe(false);
  });
});

describe('two tabs sharing one store', () => {
  /** A server that keeps the last value written per criterion, like the database does. */
  const server = () => {
    const state = new Map<string, number>();
    const sent: string[] = [];
    return {
      state, sent,
      api: { async saveScore(card: string, crit: string, score: number) { sent.push(`${crit}=${score}`); state.set(`${card}/${crit}`, score); } },
    };
  };
  const shared = () => { const q = memoryKV(); const l = memoryKV(); return { q, l }; };
  const mk = (api: { saveScore(...a: never[]): Promise<void> }, s: { q: KV; l: KV }, clock: () => number, canSend = () => true) =>
    new ScoreQueue(api as never, s.q, clock, { rejectedKv: s.l, canSend });

  it('does not let a stale tab overwrite a newer value: A queues X=5, B loads then X=7, both flush, server ends at 7', async () => {
    const srv = server();
    const store = shared();
    let t = 0;
    let online = false;
    const gate = () => online;
    const a = mk(srv.api, store, () => ++t, gate);
    a.enqueue({ cardId: 'c', criterionId: 'x', score: 5 });
    const b = mk(srv.api, store, () => ++t, gate);
    expect(b.pending()).toBe(1);
    b.enqueue({ cardId: 'c', criterionId: 'x', score: 7 });
    online = true;
    await b.flush();
    await a.flush();
    expect(srv.state.get('c/x')).toBe(7);
    expect(srv.sent).not.toContain('x=5');
    expect(a.pending()).toBe(0);
    expect(b.pending()).toBe(0);
  });

  it('does not lose a score queued in another tab: A queues c1, B queues c2, A reloads and both are present', async () => {
    const srv = server();
    const store = shared();
    let t = 0;
    const offline = () => false;
    const a = mk(srv.api, store, () => ++t, offline);
    const b = mk(srv.api, store, () => ++t, offline);
    a.enqueue({ cardId: 'c', criterionId: 'c1', score: 1 });
    b.enqueue({ cardId: 'c', criterionId: 'c2', score: 2 });
    a.enqueue({ cardId: 'c', criterionId: 'c3', score: 3 });
    const reloaded = mk(srv.api, store, () => ++t, offline);
    expect(reloaded.pendingFor('c').map((i) => i.criterionId).sort()).toEqual(['c1', 'c2', 'c3']);
    // And the tabs themselves converge once they look at the store again.
    a.refresh();
    expect(a.pendingFor('c').map((i) => i.criterionId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('does not resurrect a score another tab already sent and removed', async () => {
    const srv = server();
    const store = shared();
    let t = 0;
    const a = mk(srv.api, store, () => ++t);
    const b = mk(srv.api, store, () => ++t);
    a.enqueue({ cardId: 'c', criterionId: 'x', score: 4 });
    b.refresh();
    await a.flush();
    expect(a.pending()).toBe(0);
    b.enqueue({ cardId: 'c', criterionId: 'y', score: 9 }); // B persists: must not bring X back
    const fresh = mk(srv.api, store, () => ++t);
    expect(fresh.pendingFor('c').map((i) => i.criterionId)).toEqual(['y']);
  });

  it('merges the rejected ledger by id across tabs and keeps a dismissal dismissed', async () => {
    const store = shared();
    let t = 0;
    const refuse = { async saveScore() { throw new ApiError('locked', 'locked'); } };
    const a = mk(refuse, store, () => ++t);
    const b = mk(refuse, store, () => ++t);
    a.enqueue({ cardId: 'c', criterionId: 'x', score: 1 });
    await a.flush();
    b.enqueue({ cardId: 'c', criterionId: 'y', score: 2 });
    await b.flush();
    const ids = [...a.rejected(), ...b.rejected()].map((r) => r.id);
    a.refresh();
    expect(a.rejected()).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    a.clearRejected(a.rejected()[0].id);
    b.refresh();
    expect(b.rejected()).toHaveLength(1);
  });

  it('serialises sending through the lock and re-reads the store before each send', async () => {
    const srv = server();
    const store = shared();
    let t = 0;
    const order: string[] = [];
    let chain: Promise<unknown> = Promise.resolve();
    const lock = <T,>(fn: () => Promise<T>) => { const r = chain.then(async () => { order.push('in'); const v = await fn(); order.push('out'); return v; }); chain = r.catch(() => {}); return r; };
    const mkLocked = () => new ScoreQueue(srv.api as never, store.q, () => ++t, { rejectedKv: store.l, withLock: lock });
    const a = mkLocked();
    const b = mkLocked();
    a.enqueue({ cardId: 'c', criterionId: 'x', score: 1 });
    await Promise.all([a.flush(), b.flush()]);
    expect(order).toEqual(['in', 'out', 'in', 'out']);
    expect(srv.sent).toEqual(['x=1']); // B found it already sent and removed
  });
});
