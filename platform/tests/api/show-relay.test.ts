import { describe, expect, it, vi } from 'vitest';
import { portableState, showPosition, showRelay, type ShowState } from '../../src/api/show-relay';

const state = (n: number, extra: Record<string, unknown> = {}): ShowState => ({
  n, tv: 0, src: 'hold', race: null, ana: null, awards: { i: 0, r: 1, winners: {}, nominees: {}, custom: null },
  pit: { show: false, mode: 'timer', end: 0, left: 3600000, full: 3600000 }, teams: null, ...extra,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('portableState', () => {
  it('swaps in-browser picture addresses for references and drops the ones it cannot place', () => {
    const refs: Record<string, string> = { 'blob:a': 'sri-pic:t1:team_logo:1', 'blob:b': 'sri-pic:t1:car_render_fl:2' };
    const out = portableState(state(1, {
      teams: [{ id: '001', name: 'One', logo: 'blob:a', car: 'blob:b', photo: 'blob:unknown', colors: ['#E6007E'] }],
      ana: { k: 1, scene: {}, teams: { '001': { logo: 'blob:a' } } },
    }), (url) => refs[url]);
    expect(out.teams).toEqual([{ id: '001', name: 'One', logo: 'sri-pic:t1:team_logo:1', car: 'sri-pic:t1:car_render_fl:2', colors: ['#E6007E'] }]);
    expect((out.ana as any).teams['001'].logo).toBe('sri-pic:t1:team_logo:1');
    expect(JSON.stringify(out)).not.toContain('blob:');
  });
});

describe('showPosition', () => {
  it('changes with what is on screen and not with what arrives by itself', () => {
    const base = showPosition(state(1));
    expect(showPosition(state(2, { tv: 4, teams: [{ id: '001' }], awards: { i: 0, r: 1, winners: { best: '001' }, nominees: { best: ['001'] }, custom: null } }))).toBe(base);
    expect(showPosition(state(3, { src: 'race', race: { k: 1, scene: 'both', t1: '001', t2: '002' } }))).not.toBe(base);
    expect(showPosition(state(3, { awards: { i: 4, r: 1, winners: {}, nominees: {} } }))).not.toBe(base);
    expect(showPosition(state(3, { pit: { show: true, mode: 'seats', end: 0, left: 3600000 } }))).not.toBe(base);
  });
});

describe('showRelay', () => {
  it('publishes straight away for an event nothing has been published for', async () => {
    const publish = vi.fn(async (_n: number, _state: Record<string, unknown>) => {});
    const relay = showRelay(publish, () => {});
    relay.offer(state(10));
    expect(publish).not.toHaveBeenCalled();   // not before the server has answered
    relay.ready(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe(10);
    expect(relay.driving()).toBe(true);
  });

  it('does not take over a running show when the page is only opened', async () => {
    const publish = vi.fn(async (_n: number, _state: Record<string, unknown>) => {});
    const relay = showRelay(publish, () => {});
    relay.offer(state(10));
    relay.ready(5000);
    relay.offer(state(11, { tv: 1, teams: [{ id: '001', name: 'One' }] }));   // data arriving is not the operator
    await settle();
    expect(publish).not.toHaveBeenCalled();
    expect(relay.driving()).toBe(false);
    relay.offer(state(12, { src: 'race', race: { k: 1, scene: 'both', t1: '001', t2: '002' } }));   // a step taken here
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    relay.offer(state(13, { tv: 2, src: 'race', race: { k: 1, scene: 'both', t1: '001', t2: '002' }, teams: [{ id: '001', name: 'One', school: 'S' }] }));
    await settle();
    expect(publish).toHaveBeenCalledTimes(2);   // once driving, changes to the teams go out too
  });

  it('counts a step taken before the server answered', async () => {
    const publish = vi.fn(async (_n: number, _state: Record<string, unknown>) => {});
    const relay = showRelay(publish, () => {});
    relay.offer(state(10));
    relay.offer(state(11, { src: 'race', race: { k: 1 } }));
    relay.ready(5000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('sends one at a time, skips repeats, and ends on the newest', async () => {
    let release: () => void = () => {};
    const seen: number[] = [];
    const publish = vi.fn((n: number) => { seen.push(n); return new Promise<void>((r) => { release = r; }); });
    const relay = showRelay(publish, () => {});
    relay.ready(0);
    relay.offer(state(1));
    relay.offer(state(2, { src: 'race', race: { k: 1 } }));
    relay.offer(state(3, { src: 'race', race: { k: 2 } }));
    expect(seen).toEqual([1]);
    release(); await settle();
    expect(seen).toEqual([1, 3]);
    release(); await settle();
    relay.offer(state(4, { src: 'race', race: { k: 2 } }));   // the same screen again, only the counter moved
    await settle();
    expect(seen).toEqual([1, 3]);
  });

  it('reports a failure and tries again', async () => {
    vi.useFakeTimers();
    try {
      const errors: unknown[] = [];
      const publish = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
      const relay = showRelay(publish, (e) => errors.push(e), 3000);
      relay.ready(0);
      relay.offer(state(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(publish).toHaveBeenCalledTimes(2);
      relay.stop();
    } finally { vi.useRealTimers(); }
  });
});
