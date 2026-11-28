// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PassCheckResult } from '../../src/api';
import { memoryDoorStore, type DoorStore } from '../../src/pass/door-store';
import { doorScreen } from '../../src/ui/door';
import { passCheckPanel } from '../../src/ui/pass-reference';
import { makeCtx, text } from './helpers';
import { JPEG, PASS_EMAILS, passWorld, settle, useNodeCrypto } from './pass-helpers';

beforeAll(useNodeCrypto);
const leavers: Array<() => void> = [];
type World = Awaited<ReturnType<typeof passWorld>>;
async function open(w: World, deps: Parameters<typeof doorScreen>[2] = {}) {
  const { ctx, leaves } = makeCtx(w.api);
  const root = await doorScreen(ctx, w.ev.id, { store: memoryDoorStore(), confirm: () => true, ...deps });
  document.body.append(root); leavers.push(...leaves);
  await settle();
  return root;
}
async function scan(root: Element, code: string) {
  const input = root.querySelector('.door-manual input') as HTMLInputElement;
  input.value = code;
  input.form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await settle(10);
}
const result = (root: Element) => root.querySelector('.door-result')!;
const button = (root: Element, label: string) => [...root.querySelectorAll('button')].find((b) => text(b).trim() === label) as HTMLButtonElement;
const asOrganiser = async () => { const w = await passWorld(); await w.api.signIn(PASS_EMAILS.org); return w; };
afterEach(() => { leavers.splice(0).forEach((f) => f()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Door check', () => {
  it('checks a live pass and shows who is at the door', async () => {
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao');
    const root = await open(w);
    expect(text(root.querySelector('h1')!)).toBe('Door check');
    await scan(root, await phone.code());
    expect(result(root).classList.contains('door-result--genuine')).toBe(true);
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
    expect(text(result(root))).toContain('Asha Rao');
    expect(text(result(root))).toContain('Design Engineer');
    expect(text(result(root))).toContain('Team 1 · Velocity');
    button(root, 'Refresh arrivals').click(); await settle();
    expect(text(root.querySelector('.door-arrivals')!)).toContain('1 of 3 checked in today');
    expect(text(root.querySelector('.door-arrivals')!)).toContain('Asha Rao');
  });

  it('gives every outcome its own plain heading', async () => {
    const w = await asOrganiser();
    const holder = { name: 'Asha Rao', role: 'Design Engineer', kind: 'student' as const, team: { number: '1', name: 'Velocity' }, stream: { name: 'Blue', index: 0 }, portrait: JPEG };
    const cases: Array<[PassCheckResult, string, string[]]> = [
      [{ result: 'genuine', holder, presenter: true, firstSeenToday: '2026-12-12T03:22:00Z' }, 'Genuine pass', ['Shown by the team manager', 'First seen today at 08:52', 'Blue']],
      [{ result: 'replay', holder, presenter: false, firstSeenToday: null }, 'This code was just scanned', ['Asha Rao']],
      [{ result: 'expired' }, 'Expired code', ['live pass']],
      [{ result: 'invalid' }, 'Reset or removed', ['team manager']],
      [{ result: 'wrong_event' }, 'Not a pass for this event', []],
      [{ result: 'unknown' }, 'Not a Paddock Pass', []],
    ];
    const root = await open(w);
    const spy = vi.spyOn(w.api, 'checkPass');
    const seen = new Set<string>();
    for (const [i, [reply, heading, notes]] of cases.entries()) {
      spy.mockResolvedValueOnce(reply);
      await scan(root, `code-${i}`);
      expect(text(result(root).querySelector('h2')!)).toBe(heading);
      for (const note of notes) expect(text(result(root))).toContain(note);
      seen.add(result(root).className);
    }
    expect(seen.size).toBe(cases.length);   // a different look for each
    expect(result(root).querySelector('img')).toBeNull();
    expect(spy).toHaveBeenLastCalledWith(w.ev.id, 'code-5', expect.objectContaining({ gate: '', device: expect.any(String), checkId: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
  });

  it('checks from the saved door list with no signal, then uploads each check once', async () => {
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao');
    const store = memoryDoorStore();
    let online = true;
    const root = await open(w, { store, online: () => online });
    button(root, 'Save door list on this phone').click(); await settle(12);
    expect(text(root.querySelector('.door-kit')!)).toContain('3 passes');
    expect((await store.load(w.ev.id))!.list.passes.map((p) => p.name)).toEqual(['', 'Asha Rao', 'Dev Shah']);

    online = false;
    const check = vi.spyOn(w.api, 'checkPass'), upload = vi.spyOn(w.api, 'recordPassChecks');
    await scan(root, await phone.code());
    expect(check).not.toHaveBeenCalled();
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
    expect(text(result(root))).toContain('Checked on this phone');
    expect(text(root.querySelector('.door-kit')!)).toContain('1 check waiting to upload');

    online = true;
    window.dispatchEvent(new Event('online')); await settle(10);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await store.queued(w.ev.id)).toHaveLength(0);
    expect(text(root.querySelector('.door-kit')!)).not.toContain('waiting to upload');
    window.dispatchEvent(new Event('online')); await settle(10);
    expect(upload).toHaveBeenCalledTimes(1);
    expect((await w.api.passArrivals(w.ev.id)).arrived.map((a) => a.name)).toEqual(['Asha Rao']);
  });

  it('never calls a pass fake because the saved list is old', async () => {
    const w = await asOrganiser();
    const store = memoryDoorStore();
    const root = await open(w, { store, online: () => false });
    await store.save({ eventId: w.ev.id, list: await w.api.doorList(w.ev.id), portraits: {}, downloadedAt: Date.now(), offset: 0 });
    const late = await w.onPhone('Dev Shah');   // put on a phone after the list was saved
    const fresh = await open(w, { store, online: () => false });
    await scan(fresh, await late.code());
    expect(text(result(fresh).querySelector('h2')!)).toBe('Not on this phone’s list');
    expect(text(result(fresh))).toContain('Go online to check');
    expect(await store.queued(w.ev.id)).toHaveLength(0);
    expect(root).toBeTruthy();
  });

  it('says what to do when there is no signal and no saved list', async () => {
    const w = await asOrganiser();
    const root = await open(w, { online: () => false });
    await scan(root, 'SRI1.0B0E6A528F1E4C579D5C1F6F4F5A2A11.1.0123456789ABCDEF');
    expect(text(result(root).querySelector('h2')!)).toBe('No signal, and no door list on this phone');
  });

  it('falls back to the saved list when the server cannot be reached mid-scan', async () => {
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao');
    const store: DoorStore = memoryDoorStore();
    await store.save({ eventId: w.ev.id, list: await w.api.doorList(w.ev.id), portraits: {}, downloadedAt: Date.now(), offset: 0 });
    const root = await open(w, { store });
    const { ApiError } = await import('../../src/api');
    vi.spyOn(w.api, 'checkPass').mockRejectedValue(new ApiError('network', 'offline'));
    await scan(root, await phone.code());
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
    expect(await store.queued(w.ev.id)).toHaveLength(1);
  });

  it('keeps a pass green while it is held in front of the camera', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao');
    let seen: (text: string) => void = () => undefined;
    const root = await open(w, { scanner: async (_video, onCode) => { seen = onCode; return { stop() { /* nothing to stop */ } }; } });
    button(root, 'Start camera').click(); await settle();
    const check = vi.spyOn(w.api, 'checkPass'), code = await phone.code();
    // Staff take ten seconds to compare the face: the camera reads the same code the whole time.
    for (let second = 0; second < 10; second++) { seen(code); await settle(10); vi.setSystemTime(Date.now() + 1000); }
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('sets the scanner clock from the server, however long the portraits take to arrive', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const w = await asOrganiser();
    const store = memoryDoorStore(), portraits = w.api.doorPortraits.bind(w.api);
    vi.spyOn(w.api, 'doorPortraits').mockImplementation(async (...args) => { vi.setSystemTime(Date.now() + 20_000); return portraits(...args); });
    const root = await open(w, { store });
    button(root, 'Save door list on this phone').click(); await settle(12);
    expect(Math.abs((await store.load(w.ev.id))!.offset)).toBeLessThan(1000);
  });

  it('trusts the server clock over a saved one whenever there is signal', async () => {
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao');
    const store = memoryDoorStore();
    // A list saved with a clock reading two minutes out, as a slow download used to leave it.
    await store.save({ eventId: w.ev.id, list: await w.api.doorList(w.ev.id), portraits: {}, downloadedAt: Date.now(), offset: -120_000 });
    let online = true;
    const root = await open(w, { store, online: () => online });
    online = false;
    await scan(root, await phone.code());
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
  });

  it('stops waiting for a server that does not answer, and checks from the saved list', async () => {
    const w = await asOrganiser();
    const phone = await w.onPhone('Asha Rao'), dev = await w.onPhone('Dev Shah');
    const store = memoryDoorStore();
    await store.save({ eventId: w.ev.id, list: await w.api.doorList(w.ev.id), portraits: {}, downloadedAt: Date.now(), offset: 0 });
    const root = await open(w, { store, patience: 20 });
    let sent = '';
    vi.spyOn(w.api, 'checkPass').mockImplementation((_event, _code, options) => { sent = options?.checkId ?? ''; return new Promise(() => undefined); });
    await scan(root, await phone.code());
    await new Promise((r) => setTimeout(r, 60)); await settle(10);
    expect(text(result(root).querySelector('h2')!)).toBe('Genuine pass');
    expect(text(result(root))).toContain('Checked on this phone');
    // If the first request did land, the upload of this check carries the same id and is counted once.
    expect((await store.queued(w.ev.id)).map((c) => c.id)).toEqual([sent]);
    // The door is not stuck: the next person can be checked straight away.
    await scan(root, await dev.code());
    await new Promise((r) => setTimeout(r, 60)); await settle(10);
    expect(text(result(root))).toContain('Dev Shah');
  });

  it('removes the saved list when asked', async () => {
    const w = await asOrganiser();
    const store = memoryDoorStore();
    const root = await open(w, { store });
    button(root, 'Save door list on this phone').click(); await settle(12);
    button(root, 'Remove from this phone').click(); await settle();
    expect(await store.load(w.ev.id)).toBeNull();
    expect(text(root.querySelector('.door-kit')!)).toContain('No door list on this phone');
  });

  it('shows the sync pulse to compare passes against', async () => {
    const w = await asOrganiser();
    const root = await open(w);
    expect(root.querySelector('.pass-ref svg')!.getAttribute('aria-label')).toMatch(/^Sync pulse: \w+ \w+$/);
  });

  it('is only for organisers and the Chair', async () => {
    const w = await passWorld();
    expect(text(await open(w))).toContain('Door check is for event organisers and the Chair');
    await w.api.signIn(PASS_EMAILS.judge);
    expect(text(await open(w))).toContain('Door check is for event organisers and the Chair');
    await w.api.signIn(PASS_EMAILS.chair);
    expect(text((await open(w)).querySelector('h1')!)).toBe('Door check');
  });
});

describe('the pass check reference on the event page', () => {
  it('shows staff the current pulse, and team managers nothing', async () => {
    const w = await passWorld();
    await w.api.signIn(PASS_EMAILS.judge);
    const { ctx, leaves } = makeCtx(w.api); leavers.push(...leaves);
    const panel = passCheckPanel(ctx, w.ev.id, await w.api.myRoles(w.ev.id))!;
    document.body.append(panel); await settle();
    expect(text(panel.querySelector('h2')!)).toBe('Pass check');
    expect(panel.querySelector('.pass-ref svg')).not.toBeNull();
    await w.api.signIn(PASS_EMAILS.mgr);
    expect(passCheckPanel(ctx, w.ev.id, await w.api.myRoles(w.ev.id))).toBeNull();
  });
});
