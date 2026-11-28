import { describe, expect, it } from 'vitest';
import type { DoorEntry, DoorList } from '../../src/api/passes';
import { codeAt, importSecret, STEP_MS } from '../../src/pass/code';
import { memoryDoorStore, DOOR_LIST_DAYS } from '../../src/pass/door-store';
import { verifyOffline, type SeenScan } from '../../src/pass/verify';

const NOW = Date.parse('2026-12-12T04:00:10Z');
const ASHA = '0b0e6a52-8f1e-4c57-9d5c-1f6f4f5a2a11', DEV = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', LATE = '11111111-2222-4333-8444-555555555555';
const HOLDER = 'ab'.repeat(32), PRESENTER = 'cd'.repeat(32);
const entry = (over: Partial<DoorEntry>): DoorEntry => ({ id: ASHA, kind: 'student', name: 'Asha Rao', role: 'Design Engineer', team: { number: '007', name: 'Velocity' }, stream: { name: 'Blue', index: 0 }, holder: HOLDER, presenter: PRESENTER, hasPortrait: true, ...over });
const list: DoorList = { now: NOW, timezone: 'Asia/Kolkata', pulseKey: 'ef'.repeat(32), passes: [entry({}), entry({ id: DEV, name: 'Dev Shah', holder: null, presenter: null, hasPortrait: false })] };
const cache = { list, portraits: { [ASHA]: 'AAAA' } };
const code = async (secret: string, pass = ASHA, at = NOW) => codeAt(await importSecret(secret), pass, at);
const seen = (over: Partial<SeenScan> = {}): SeenScan => ({ passId: ASHA, step: Math.floor(NOW / STEP_MS), presenter: false, result: 'genuine', scannedAt: new Date(NOW - 60_000).toISOString(), ...over });

describe('checking a pass with no signal', () => {
  it('accepts a live code and shows who it belongs to', async () => {
    const got = await verifyOffline(cache, await code(HOLDER), NOW);
    expect(got.result).toMatchObject({ result: 'genuine', offline: true, presenter: false, firstSeenToday: null });
    expect(got.result.holder).toEqual({ name: 'Asha Rao', role: 'Design Engineer', kind: 'student', team: { number: '007', name: 'Velocity' }, stream: { name: 'Blue', index: 0 }, portrait: 'AAAA' });
    expect(got.record).toEqual({ passId: ASHA, step: Math.floor(NOW / STEP_MS), result: 'genuine', presenter: false });
  });
  it('accepts the window either side, and lower-case input', async () => {
    expect((await verifyOffline(cache, await code(HOLDER, ASHA, NOW - STEP_MS), NOW)).result.result).toBe('genuine');
    expect((await verifyOffline(cache, await code(HOLDER, ASHA, NOW + STEP_MS), NOW)).result.result).toBe('genuine');
    expect((await verifyOffline(cache, (await code(HOLDER)).toLowerCase(), NOW)).result.result).toBe('genuine');
  });
  it('calls an old code expired, and does not record it', async () => {
    const got = await verifyOffline(cache, await code(HOLDER, ASHA, NOW - 5 * 60_000), NOW);
    expect(got.result).toEqual({ result: 'expired', offline: true });
    expect(got.record).toBeNull();
  });
  it('says when the team manager is showing a student’s pass', async () => {
    const got = await verifyOffline(cache, await code(PRESENTER), NOW);
    expect(got.result).toMatchObject({ result: 'genuine', presenter: true });
    expect(got.record?.presenter).toBe(true);
  });
  it('never calls a pass fake just because this phone’s list is out of date', async () => {
    // Issued after the list was downloaded, sent again since, or never yet on a phone when it was.
    for (const c of [await code(HOLDER, LATE), await code('12'.repeat(32)), await code(HOLDER, DEV)]) {
      const got = await verifyOffline(cache, c, NOW);
      expect(got.result).toEqual({ result: 'unlisted', offline: true });
      expect(got.record).toBeNull();
    }
  });
  it('knows a code that is not a pass at all', async () => {
    for (const junk of ['', 'https://example.test/', 'SRI1.nope', 'SRI2.0B0E6A528F1E4C579D5C1F6F4F5A2A11.1.0123456789ABCDEF'])
      expect((await verifyOffline(cache, junk, NOW)).result).toEqual({ result: 'unknown', offline: true });
  });
  it('flags the same code shown again, but not this scanner reading it twice', async () => {
    const c = await code(HOLDER);
    const twice = await verifyOffline(cache, c, NOW, [seen({ scannedAt: new Date(NOW - 2000).toISOString() })]);
    expect(twice.result.result).toBe('genuine');
    expect(twice.record).toBeNull();
    const again = await verifyOffline(cache, c, NOW, [seen({ scannedAt: new Date(NOW - 20_000).toISOString() })]);
    expect(again.result.result).toBe('replay');
    expect(again.record).toMatchObject({ result: 'replay' });
    // The manager's phone and the student's make different codes in one window: one of each is not a repeat.
    expect((await verifyOffline(cache, await code(PRESENTER), NOW, [seen({ scannedAt: new Date(NOW - 20_000).toISOString() })])).result.result).toBe('genuine');
  });
  it('remembers when the person was first seen today, by the event’s clock', async () => {
    const morning = new Date(NOW - 3 * 3_600_000).toISOString(), yesterday = new Date(NOW - 12 * 3_600_000).toISOString();
    const got = await verifyOffline(cache, await code(HOLDER), NOW, [seen({ step: 5, scannedAt: yesterday }), seen({ step: 6, scannedAt: morning }), seen({ step: 7, result: 'replay', scannedAt: yesterday })]);
    expect(got.result).toMatchObject({ result: 'genuine', firstSeenToday: morning });
  });
});

describe('the door list kept on a phone', () => {
  const saved = (at: number) => ({ eventId: 'e1', list, portraits: {}, downloadedAt: at, offset: 0 });
  it('is given back while fresh and dropped after three days', async () => {
    let now = NOW;
    const store = memoryDoorStore(() => now);
    await store.save(saved(NOW));
    expect((await store.load('e1'))?.list.passes).toHaveLength(2);
    now = NOW + DOOR_LIST_DAYS * 86_400_000 + 1;
    expect(await store.load('e1')).toBeNull();
    now = NOW;
    expect(await store.load('e1')).toBeNull();   // really deleted, not just hidden
  });
  it('keeps waiting checks apart from the list, so removing the list loses none', async () => {
    const store = memoryDoorStore(() => NOW);
    await store.save(saved(NOW));
    const check = { id: 'c1', passId: ASHA, step: 1, result: 'genuine' as const, presenter: false, gate: 'Main', device: 'd', scannedAt: new Date(NOW).toISOString() };
    await store.enqueue('e1', check); await store.enqueue('e1', { ...check, id: 'c2' }); await store.enqueue('e2', { ...check, id: 'c3' });
    await store.clear();
    expect(await store.load('e1')).toBeNull();
    expect((await store.queued('e1')).map((c) => c.id)).toEqual(['c1', 'c2']);
    await store.dequeue('e1', ['c1']);
    expect((await store.queued('e1')).map((c) => c.id)).toEqual(['c2']);
    expect((await store.queued('e2')).map((c) => c.id)).toEqual(['c3']);
  });
});
