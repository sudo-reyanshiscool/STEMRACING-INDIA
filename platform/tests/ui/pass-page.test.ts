// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PassCardData } from '../../src/api/passes';
import { RpcError } from '../../src/pass/client';
import { importSecret, macFor } from '../../src/pass/code';
import { startPassPage, type PassPage } from '../../src/pass/page';
import { memoryPassStore, type PassRecord, type PassStore } from '../../src/pass/store';

beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

const PASS = '0b0e6a52-8f1e-4c57-9d5c-1f6f4f5a2a11', OTHER = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const TOKEN = 'c'.repeat(64), SECRET = 'ab'.repeat(32);
const DEVICE = Date.parse('2026-12-12T04:00:00Z');
const card = (over: Partial<PassCardData> = {}): PassCardData => ({
  passId: PASS, kind: 'student', name: 'Asha Rao', role: 'Design Engineer', team: { number: '007', name: 'Velocity', school: 'Hill School' },
  event: { id: 'e1', name: 'North Regional 2026', startsOn: '2026-12-12', days: ['2026-12-12', '2026-12-13'] }, stream: { name: 'Blue', index: 0 },
  activities: [], timezone: 'Asia/Kolkata', portrait: null, pulseKey: 'cd'.repeat(32), now: DEVICE, ...over,
});
const record = async (over: Partial<PassCardData> = {}, more: Partial<PassRecord> = {}): Promise<PassRecord> =>
  ({ passId: over.passId ?? PASS, key: await importSecret(SECRET), card: card(over), offset: 0, savedAt: DEVICE, ...more });
const refused = () => new RpcError('pass link not valid', { code: '42501', status: 401 });
const noSignal = () => new RpcError('Failed to fetch', { offline: true });

const pages: PassPage[] = [];
async function open(opts: { store?: PassStore; hash?: string; rpc?: (name: string, args: Record<string, unknown>) => unknown; now?: () => number }) {
  const root = document.createElement('div'); document.body.append(root);
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => (opts.rpc ?? (() => { throw noSignal(); }))(name, args));
  const clearHash = vi.fn();
  const store = opts.store ?? memoryPassStore();
  const page = await startPassPage(root, { store, rpc: rpc as never, hash: opts.hash ?? '', clearHash, now: opts.now ?? (() => DEVICE), shader: false, confirm: () => true });
  pages.push(page);
  return { root, rpc, clearHash, store, page };
}
const text = (el: Element) => el.textContent ?? '';
const button = (root: Element, label: string) => [...root.querySelectorAll('button')].find((b) => text(b).includes(label))!;
afterEach(() => { pages.splice(0).forEach((p) => p.destroy()); document.body.replaceChildren(); });

describe('the pass page', () => {
  it('explains what to do when there is no pass on the phone', async () => {
    const { root, rpc } = await open({});
    expect(text(root)).toContain('No pass on this phone yet');
    expect(text(root)).toContain('Ask your team manager');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('adds a pass from the link after one tap, keeps it, and takes the link out of the address bar', async () => {
    const { root, rpc, clearHash, store, page } = await open({ hash: `#${PASS}.${TOKEN}`, rpc: (name) => {
      if (name === 'claim_pass') return { secret: SECRET, card: card() };
      throw noSignal();
    } });
    expect(rpc).not.toHaveBeenCalled();   // a link opened by mistake must not use it up
    button(root, 'Add pass to this phone').click();
    await page.idle();
    expect(rpc).toHaveBeenCalledWith('claim_pass', { p_pass: PASS, p_token: TOKEN });
    expect(clearHash).toHaveBeenCalled();
    const saved = await store.all();
    expect(saved).toHaveLength(1);
    expect(saved[0].passId).toBe(PASS);
    expect(saved[0].key.extractable).toBe(false);
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha Rao');
    expect(text(root)).not.toContain('Add pass to this phone');
  });

  it('says plainly when the link has already been used', async () => {
    const { root, clearHash, page, store } = await open({ hash: `#${PASS}.${TOKEN}`, rpc: () => { throw refused(); } });
    button(root, 'Add pass to this phone').click();
    await page.idle();
    expect(text(root)).toContain('This link has already been used. Ask your team manager for a new one.');
    expect(clearHash).toHaveBeenCalled();
    expect(await store.all()).toHaveLength(0);
  });

  it('keeps the link for another try when there is no signal', async () => {
    const { root, clearHash, page } = await open({ hash: `#${PASS}.${TOKEN}` });
    button(root, 'Add pass to this phone').click();
    await page.idle();
    expect(text(root)).toContain('needs signal');
    expect(clearHash).not.toHaveBeenCalled();
    expect(button(root, 'Add pass to this phone')).toBeTruthy();
  });

  it('shows a saved pass with no network at all', async () => {
    const { root, page } = await open({ store: memoryPassStore([await record()]) });
    await page.idle();
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha Rao');
    expect(text(root)).toContain('No signal');
    expect(root.querySelector('.pass-page__gone')).toBeNull();
  });

  it('lets a phone that holds several passes switch between them', async () => {
    const { root, page } = await open({ store: memoryPassStore([await record(), await record({ passId: OTHER, name: 'Dev Rao' })]) });
    await page.idle();
    const tabs = [...root.querySelectorAll('.pass-page__tabs button')];
    expect(tabs.map(text)).toEqual(['Asha Rao', 'Dev Rao']);
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha Rao');
    (tabs[1] as HTMLButtonElement).click();
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Dev Rao');
    expect(root.querySelectorAll('.pass-card')).toHaveLength(1);
  });

  it('corrects a wrong phone clock from the server before proving it holds the pass', async () => {
    const server = DEVICE + 10 * 60_000;   // the phone is ten minutes slow
    const key = await importSecret(SECRET);
    const { root, rpc, store, page } = await open({ store: memoryPassStore([await record()]), rpc: (name) => {
      if (name === 'pass_now') return server;
      if (name === 'pass_card') return card({ name: 'Asha R. Rao', now: server });
      throw noSignal();
    } });
    await page.idle();
    const step = Math.floor(server / 30_000);
    expect(rpc).toHaveBeenCalledWith('pass_card', { p_pass: PASS, p_step: step, p_mac: await macFor(key, PASS, step) });
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha R. Rao');
    expect((await store.all())[0].offset).toBe(10 * 60_000);
    expect(text(root.querySelector('.pass-card__clock')!)).toBe('09:40:00');
    expect(text(root)).toContain('Up to date');
  });

  it('says so when the pass was reset or moved, and lets the phone drop it', async () => {
    const { root, store, page } = await open({ store: memoryPassStore([await record()]), rpc: (name) => {
      if (name === 'pass_now') return DEVICE;
      throw refused();
    } });
    await page.idle();
    expect(root.querySelector('.pass-card')).toBeNull();
    expect(text(root)).toContain('This pass is no longer on this phone');
    expect((await store.all())[0].revoked).toBe(true);
    button(root, 'Remove').click();
    await page.idle();
    expect(await store.all()).toHaveLength(0);
    expect(text(root)).toContain('No pass on this phone yet');
  });

  it('does not give up a pass over a server hiccup', async () => {
    const { root, store, page } = await open({ store: memoryPassStore([await record()]), rpc: (name) => {
      if (name === 'pass_now') return DEVICE;
      throw new RpcError('upstream', { status: 503 });
    } });
    await page.idle();
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha Rao');
    expect((await store.all())[0].revoked).toBeFalsy();
  });

  it('brings a pass back if a later check finds it valid after all', async () => {
    let valid = false;
    const { root, page } = await open({ store: memoryPassStore([await record({}, { revoked: true })]), rpc: (name) => {
      if (name === 'pass_now') return DEVICE;
      if (valid) return card();
      throw refused();
    } });
    await page.idle();
    expect(root.querySelector('.pass-card')).toBeNull();
    valid = true;
    await page.refresh();
    expect(text(root.querySelector('.pass-card__name')!)).toBe('Asha Rao');
  });

  it('will not use up a link in a browser that cannot keep the pass', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const rpc = vi.fn();
    const page = await startPassPage(root, { store: null, rpc: rpc as never, hash: `#${PASS}.${TOKEN}`, clearHash: vi.fn(), shader: false });
    pages.push(page);
    expect(text(root)).toContain('cannot save a pass');
    expect(button(root, 'Add pass to this phone')).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
