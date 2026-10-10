// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi, memoryKV, type KV } from '../../src/api';
import { QueueHost } from '../../src/ui/queuehost';
import { loginScreen } from '../../src/ui/login';
import { makeCtx, text } from './helpers';

const submit = (el: HTMLElement, email: string) => {
  (el.querySelector('input[name=email]') as HTMLInputElement).value = email;
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
};

class ApiErrorShim extends ApiError { constructor() { super('network', 'fetch failed'); } }

describe('loginScreen', () => {
  it('signs in and asks the app to re-render', async () => {
    const api = new MemoryApi();
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'Person@X.test');
    await new Promise((r) => setTimeout(r, 0));
    expect((await api.getSession())?.email).toBe('person@x.test');
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it('shows a readable message for a bad address and does not sign in', async () => {
    const api = new MemoryApi();
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'not an email');
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('valid email');
    expect(await api.getSession()).toBeNull();
  });

  it('rejects a bad address before calling the API', async () => {
    const api = new MemoryApi();
    let calls = 0;
    api.signIn = async () => { calls++; };
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'a b@x.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(0);
    expect(text(el.querySelector('[role=alert]')!)).toContain('valid email');
  });

  it('says what happens when the link has to be opened from an email', async () => {
    const api = new MemoryApi();
    api.getSession = async () => null; // a real backend does not sign in until the link is opened
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'a@x.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=status]')!)).toContain('a@x.test');
  });

  it('reassures a signed-out person that scores waiting on this device are safe', async () => {
    const api = new MemoryApi();
    const { ctx, queue } = makeCtx(api);
    queue.enqueue({ cardId: 'c1', criterionId: 'k1', score: 3 });
    const el = loginScreen(ctx);
    expect(text(el)).toContain('Sign in again — your scores are safe');
  });

  it('shows plain text, not the raw error, when the backend cannot be reached', async () => {
    const api = new MemoryApi();
    api.signIn = async () => { throw new ApiErrorShim(); };
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'a@x.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('Could not reach the server');
  });

  it('disables the submit button while signing in, then re-enables it', async () => {
    const api = new MemoryApi();
    let release!: () => void;
    api.signIn = () => new Promise<void>((r) => { release = r; });
    api.getSession = async () => null;
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    const btn = el.querySelector('button[type=submit]') as HTMLButtonElement;
    submit(el, 'a@x.test');
    expect(btn.disabled).toBe(true);
    submit(el, 'a@x.test'); // a second submit while in flight is ignored
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(false);
  });

  it('via the host, tells a signed-out person how many scores wait for the last-known user', async () => {
    const api = new MemoryApi();
    await api.signIn('a@x.test');
    const kvs = new Map<string, KV>();
    const kv = (k: string) => { if (!kvs.has(k)) kvs.set(k, memoryKV()); return kvs.get(k)!; };
    const host = new QueueHost({ api, storage: (u) => ({ queue: kv(`q:${u}`), rejected: kv(`r:${u}`) }), lastUser: memoryKV() });
    await host.track();
    await api.signOut();
    await host.enqueueScore({ cardId: 'c1', criterionId: 'k1', score: 3 });
    await host.enqueueScore({ cardId: 'c1', criterionId: 'k2', score: 4 });
    const { ctx } = makeCtx(api);
    const el = loginScreen({ ...ctx, queue: host, enqueueScore: (i) => host.enqueueScore(i) });
    expect(text(el)).toContain('Sign in again — your scores are safe');
    expect(text(el)).toContain('2 scores are waiting');
  });
});
