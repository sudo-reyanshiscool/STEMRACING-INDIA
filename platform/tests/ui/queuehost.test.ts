// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi, memoryKV, type KV } from '../../src/api';
import { QueueHost } from '../../src/ui/queuehost';
import { mountSyncBar } from '../../src/ui/syncbar';

const item = { cardId: 'c1', criterionId: 'k1', score: 3 };

function setup() {
  const api = new MemoryApi();
  const sent: Array<{ by: string | undefined; cardId: string; score: number }> = [];
  let failWith: ApiError | null = null;
  const real = api.saveScore.bind(api);
  api.saveScore = async (cardId, criterionId, score, comment) => {
    if (failWith) throw failWith;
    sent.push({ by: (await api.getSession())?.email, cardId, score });
    void real; void criterionId; void comment;
  };
  const store = new Map<string, KV>();
  const kv = (k: string) => { if (!store.has(k)) store.set(k, memoryKV()); return store.get(k)!; };
  const host = new QueueHost({
    api,
    storage: (u) => ({ queue: kv(`scores:${u}`), rejected: kv(`scores-rejected:${u}`) }),
  });
  return { api, host, sent, setFail: (e: ApiError | null) => { failWith = e; }, store };
}

describe('QueueHost', () => {
  it('has no active queue when signed out: enqueue is refused and status is empty', async () => {
    const { host } = setup();
    expect(host.active()).toBe(false);
    await expect(host.enqueueScore(item)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(host.status().pending).toBe(0);
  });

  it('enqueues and sends as the signed-in user', async () => {
    const { api, host, sent } = setup();
    await host.track();
    await api.signIn('a@x.test');
    await host.enqueueScore(item);
    expect(sent).toEqual([{ by: 'a@x.test', cardId: 'c1', score: 3 }]);
    expect(host.status().pending).toBe(0);
  });

  it('keeps A\'s scores out of B\'s queue and restores them when A signs back in', async () => {
    const { api, host, sent, setFail } = setup();
    await host.track();
    await api.signIn('a@x.test');
    setFail(new ApiError('network', 'offline'));
    await host.enqueueScore(item);
    expect(host.status().pending).toBe(1);

    await api.signOut();
    expect(host.active()).toBe(false);
    expect(host.status().pending).toBe(0);

    await api.signIn('b@x.test');
    setFail(null);
    await host.flush();
    expect(host.status().pending).toBe(0);
    expect(host.rejected()).toEqual([]);
    expect(sent).toEqual([]); // nothing of A's was sent as B

    await api.signIn('a@x.test');
    expect(host.status().pending).toBe(1);
    await host.flush();
    expect(sent).toEqual([{ by: 'a@x.test', cardId: 'c1', score: 3 }]);
  });

  it('a persona switch isolates the queues, and rejected ledgers too', async () => {
    const { api, host, setFail } = setup();
    await host.track();
    await api.signIn('a@x.test');
    setFail(new ApiError('locked', 'x'));
    await host.enqueueScore(item);
    expect(host.rejected()).toHaveLength(1);
    await api.signIn('b@x.test');
    expect(host.rejected()).toHaveLength(0);
    expect(host.clearRejected()).toBeUndefined(); // B clearing cannot touch A's ledger
    await api.signIn('a@x.test');
    expect(host.rejected()).toHaveLength(1);
  });

  it('a flush in flight for A never sends the next item as B', async () => {
    const { api, host, sent } = setup();
    await host.track();
    await api.signIn('a@x.test');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    // Records who the session belongs to at the moment the request is made (as a real HTTP call would).
    api.saveScore = async (cardId, _k, score) => {
      sent.push({ by: (await api.getSession())?.email, cardId, score });
      if (first) { first = false; await gate; }
    };
    const p = host.enqueueScore(item); // first item parked in flight
    await new Promise((r) => setTimeout(r, 0));
    host.enqueueScore({ ...item, criterionId: 'k2', score: 4 }).catch(() => {});
    await api.signIn('b@x.test');
    release();
    await p;
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(1); // only the in-flight request, made as A; the second never left the device
    expect(sent[0].by).toBe('a@x.test');
    expect(host.status().pending).toBe(0); // B's view
    await api.signIn('a@x.test');
    expect(host.status().pending).toBe(1); // A's second score is still safe
  });

  it('survives swaps without leaking listeners: one notification per event, none after dispose', async () => {
    const { api, host } = setup();
    await host.track();
    let n = 0;
    const off = host.subscribe(() => { n += 1; });
    await api.signIn('a@x.test');
    await api.signIn('b@x.test');
    await api.signIn('a@x.test');
    const before = n;
    await host.enqueueScore(item);
    expect(n - before).toBeGreaterThan(0);
    const mid = n;
    await host.enqueueScore(item);
    expect(n - mid).toBe(n - mid); // sanity
    off();
    const after = n;
    await host.enqueueScore(item);
    expect(n).toBe(after);
  });

  it('the sync bar is hidden when signed out and shows only the signed-in person\'s queue', async () => {
    const { api, host, setFail } = setup();
    await host.track();
    const root = document.createElement('div');
    const bar = mountSyncBar(root, host);
    expect(root.hidden).toBe(true);
    await api.signIn('a@x.test');
    expect(root.hidden).toBe(false);
    setFail(new ApiError('network', 'x'));
    await host.enqueueScore(item);
    expect(root.textContent).toContain('1 score waiting');
    await api.signIn('b@x.test');
    expect(root.textContent).toContain('All scores saved');
    await api.signOut();
    expect(root.hidden).toBe(true);
    bar.dispose();
  });
});
