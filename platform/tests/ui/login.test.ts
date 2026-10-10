// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';
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
});
