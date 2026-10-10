// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ScoreQueue, localStorageKV } from '../../src/api';

describe('queue storage events', () => {
  it('picks up a score another tab stored when the storage event arrives', () => {
    localStorage.clear();
    const key = 'q-test';
    const a = new ScoreQueue({ saveScore: async () => {} }, localStorageKV(key), () => 1, { rejectedKv: localStorageKV('r-test') });
    expect(a.pending()).toBe(0);
    // What another tab's ScoreQueue would have written.
    localStorage.setItem(key, JSON.stringify([{ cardId: 'c', criterionId: 'x', score: 4, at: 5 }]));
    window.dispatchEvent(new StorageEvent('storage', { key }));
    expect(a.pending()).toBe(1);
    expect(a.pendingFor('c')[0].score).toBe(4);
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }));
    expect(a.pending()).toBe(1);
  });
});
