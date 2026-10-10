// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ScoreQueue, memoryKV, type KV } from '../../src/api';
import { mountSyncBar } from '../../src/ui/syncbar';
import { text } from './helpers';

const item = { cardId: 'c1', criterionId: 'k1', score: 3 };
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(saveScore: (...a: unknown[]) => Promise<void>, kv: KV = memoryKV()) {
  const queue = new ScoreQueue({ saveScore } as never, kv);
  const root = document.createElement('div');
  const bar = mountSyncBar(root, queue);
  return { queue, root, bar };
}

afterEach(() => { vi.useRealTimers(); });

describe('syncbar', () => {
  it('says in words that everything is saved when nothing waits', () => {
    const { root } = setup(async () => {});
    expect(text(root)).toContain('All scores saved');
  });

  it('counts waiting scores and says when the network is the problem', async () => {
    const { queue, root } = setup(async () => { throw new ApiError('network', 'x'); });
    queue.enqueue(item);
    await queue.flush();
    await tick();
    expect(text(root)).toContain('1 score waiting to send');
    expect(text(root)).toContain('Could not reach the server');
  });

  it('says to sign in again and that scores are safe when signed out', async () => {
    const { queue, root } = setup(async () => { throw new ApiError('unauthenticated', 'jwt'); });
    queue.enqueue(item);
    await queue.flush();
    await tick();
    expect(text(root)).toContain('Sign in again — your scores are safe');
  });

  it('shows no sign-in banner when signed out with nothing waiting', async () => {
    const queue = new ScoreQueue({ saveScore: async () => {} } as never, memoryKV(), undefined, { canSend: () => false });
    const root = document.createElement('div');
    mountSyncBar(root, queue);
    await queue.flush();
    await tick();
    expect(text(root)).not.toContain('Sign in again');
    expect(text(root)).toContain('All scores saved');
  });

  it('is hidden while there is no active queue', () => {
    const queue = new ScoreQueue({ saveScore: async () => {} } as never, memoryKV());
    const root = document.createElement('div');
    mountSyncBar(root, Object.assign(queue, { active: () => false }));
    expect(root.hidden).toBe(true);
    expect(text(root)).toBe('');
  });

  it('warns when the device could not store the queue', async () => {
    const kv: KV = { get: () => null, set: () => { throw new Error('quota'); } };
    const { queue, root } = setup(async () => { throw new ApiError('network', 'x'); }, kv);
    queue.enqueue(item);
    await tick();
    expect(text(root)).toContain('could not be stored on this device');
  });

  it('lists rejected scores and lets the person retry or dismiss them, flushing after a retry', async () => {
    let calls = 0;
    const { queue, root } = setup(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError('locked', 'x');
    });
    queue.enqueue(item);
    await queue.flush();
    await tick();
    expect(queue.rejected()).toHaveLength(1);
    expect(text(root)).toContain('was not saved');
    const retry = [...root.querySelectorAll('button')].find((b) => text(b) === 'Try again')!;
    retry.click();
    await tick();
    await tick();
    expect(calls).toBe(2);
    expect(queue.rejected()).toHaveLength(0);
    expect(text(root)).toContain('All scores saved');
  });

  it('dismisses a rejected score', async () => {
    const { queue, root } = setup(async () => { throw new ApiError('forbidden', 'x'); });
    queue.enqueue(item);
    await queue.flush();
    await tick();
    [...root.querySelectorAll('button')].find((b) => text(b) === 'Dismiss')!.click();
    expect(queue.rejected()).toHaveLength(0);
  });

  it('flushes on the online event and on an interval, and stops on dispose', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const { queue, bar } = setup(save);
    queue.enqueue(item);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    queue.enqueue({ ...item, score: 4 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save).toHaveBeenCalledTimes(2);
    bar.dispose();
    queue.enqueue({ ...item, score: 5 });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
