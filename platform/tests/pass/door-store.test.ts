import { describe, expect, it } from 'vitest';
import type { DoorList } from '../../src/api/passes';
import { guardDoorLists, memoryDoorStore, DOOR_LIST_DAYS } from '../../src/pass/door-store';

const DAY = 86_400_000;
const list: DoorList = { now: 0, timezone: 'Asia/Kolkata', pulseKey: '00', passes: [] };
const saved = (eventId: string, downloadedAt: number) => ({ eventId, list, portraits: {}, downloadedAt, offset: 0 });
const turn = () => new Promise((r) => setTimeout(r, 0));

/** A stand-in for the app's sign-in state. */
function session(userId: string | null) {
  const listeners: Array<(s: { userId: string } | null) => void> = [];
  return {
    getSession: async () => (userId ? { userId } : null),
    onAuthChange: (cb: (s: { userId: string } | null) => void) => { listeners.push(cb); return () => undefined; },
    change: async (next: string | null) => { userId = next; listeners.forEach((cb) => cb(next ? { userId: next } : null)); await turn(); await turn(); },
  };
}

describe('door lists do not outstay their welcome', () => {
  it('removes lists more than three days old without anyone opening Door check for that event', async () => {
    let now = 0;
    const store = memoryDoorStore(() => now);
    await store.save(saved('old', 0));
    now = 2 * DAY; await store.save(saved('recent', now));
    now = (DOOR_LIST_DAYS + 1) * DAY;
    expect(await store.sweep()).toBe(1);
    expect(await store.sweep()).toBe(0);
    now = 2 * DAY;   // even with the clock put back, the old list is gone
    expect(await store.load('old')).toBeNull();
    expect(await store.load('recent')).not.toBeNull();
  });

  it('sweeps when the app starts, and wipes every list when the session ends or changes hands', async () => {
    let now = 0;
    const store = memoryDoorStore(() => now), auth = session('organiser');
    await store.save(saved('old', 0));
    now = 4 * DAY; await store.save(saved('today', now));
    await guardDoorLists(auth, { open: async () => store, kept: () => true });
    now = 0;
    expect(await store.load('old')).toBeNull();          // swept at start
    now = 4 * DAY;
    await auth.change('organiser');                        // a token refresh for the same person
    expect(await store.load('today')).not.toBeNull();
    await auth.change(null);                               // the session expired, with no Sign out pressed
    expect(await store.load('today')).toBeNull();
    await store.save(saved('again', now));
    await auth.change('organiser'); await auth.change('someone-else');
    expect(await store.load('again')).toBeNull();
  });

  it('wipes at start when nobody is signed in, and leaves storage alone when nothing was ever saved', async () => {
    const store = memoryDoorStore();
    await store.save(saved('left-behind', Date.now()));
    await guardDoorLists(session(null), { open: async () => store, kept: () => true });
    expect(await store.load('left-behind')).toBeNull();
    let opened = 0;
    await guardDoorLists(session('organiser'), { open: async () => { opened++; return store; }, kept: () => false });
    expect(opened).toBe(0);
  });
});
