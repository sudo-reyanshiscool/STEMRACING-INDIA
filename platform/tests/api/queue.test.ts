import { describe, expect, it } from 'vitest';
import { ApiError, ScoreQueue, memoryKV, type QueueEvent } from '../../src/api';

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
    expect(events.at(-1)).toEqual({ kind: 'offline', pending: 1 });

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
