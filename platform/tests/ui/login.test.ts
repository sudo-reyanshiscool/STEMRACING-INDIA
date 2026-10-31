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

  it('recovers after a typo: the button stays enabled and a corrected address signs in once', async () => {
    const api = new MemoryApi();
    let calls = 0;
    const real = api.signIn.bind(api);
    api.signIn = async (e: string) => { calls++; await real(e); };
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    submit(el, 'typo');
    await new Promise((r) => setTimeout(r, 0));
    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toBe(0);
    submit(el, 'good@x.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect((await api.getSession())?.email).toBe('good@x.test');
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

describe('email-code sign-in',()=>{
  it('shows callback errors and offers code entry for invitation emails too',()=>{
    const {ctx}=makeCtx(new MemoryApi());const el=loginScreen(ctx,{authError:'This sign-in link expired.'});
    expect(text(el)).toContain('This sign-in link expired.');expect(el.querySelector('[name=code]')).not.toBeNull();expect(el.querySelector('details')!.open).toBe(true);
  });
  it('verifies a code and re-renders, without requesting another email',async()=>{
    const api=new MemoryApi();let verified:unknown;api.verifyEmailCode=async(...args)=>{verified=args;};let sent=0;api.signIn=async()=>{sent++;};
    const {ctx}=makeCtx(api);const el=loginScreen(ctx);
    (el.querySelector('[name=email]') as HTMLInputElement).value=' School@X.test ';
    (el.querySelector('[name=code]') as HTMLInputElement).value='1234 5678';
    el.querySelector('form[aria-label="Verify email code"]')!.dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));
    expect(verified).toEqual(['school@x.test','12345678']);expect(sent).toBe(0);expect(ctx.rerender).toHaveBeenCalled();expect((el.querySelector('[name=code]') as HTMLInputElement).value).toBe('');
  });
  it('rejects malformed codes locally and explains expired server codes',async()=>{
    const api=new MemoryApi();let calls=0;api.verifyEmailCode=async()=>{calls++;throw new ApiError('invalid-auth','raw error');};const {ctx}=makeCtx(api);const el=loginScreen(ctx);
    (el.querySelector('[name=email]') as HTMLInputElement).value='school@x.test';const code=el.querySelector('[name=code]') as HTMLInputElement;
    const verify=()=>el.querySelector('form[aria-label="Verify email code"]')!.dispatchEvent(new Event('submit',{cancelable:true}));
    code.value='abc';verify();expect(calls).toBe(0);
    code.value='12345678';verify();await new Promise(r=>setTimeout(r,0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('expired or was already used');expect(text(el)).not.toContain('raw error');
  });
});

it('opens password sign-in for a non-deliverable address without sending email',async()=>{
 const api=new MemoryApi();let emails=0;api.signIn=async()=>{emails++;};
 const {ctx}=makeCtx(api);const el=loginScreen(ctx);
 submit(el,'private@accounts.invalid');await new Promise(r=>setTimeout(r,0));
 expect(emails).toBe(0);expect(el.querySelector('form[aria-label="Password sign-in"]')?.parentElement?.hasAttribute('open')).toBe(true);
 expect(text(el.querySelector('[role=alert]')!)).toContain('Use password sign-in');
 expect(text(el.querySelector('[role=status]')!)).not.toContain('sent');
});
it('submits the password separately, clears it and re-renders without email delivery',async()=>{
 const api=new MemoryApi();const calls:Array<[string,string]>=[];
 api.signInWithPassword=async(email,password)=>{calls.push([email,password]);};
 let emails=0;api.signIn=async()=>{emails++;};
 const {ctx}=makeCtx(api);const el=loginScreen(ctx);
 (el.querySelector('[name=email]') as HTMLInputElement).value=' Private@Accounts.invalid ';
 const input=el.querySelector('[name=password]') as HTMLInputElement;input.value='synthetic-only-password';
 el.querySelector('form[aria-label="Password sign-in"]')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await new Promise(r=>setTimeout(r,0));
 expect(calls).toEqual([['private@accounts.invalid','synthetic-only-password']]);expect(emails).toBe(0);expect(input.value).toBe('');expect(input.type).toBe('password');expect(ctx.rerender).toHaveBeenCalled();
});
it('keeps failed passwords private and offers a retry without asking for email',async()=>{
 const api=new MemoryApi();api.signInWithPassword=async()=>{throw new ApiError('invalid-auth','raw credential failure');};
 const {ctx}=makeCtx(api);const el=loginScreen(ctx);
 (el.querySelector('[name=email]') as HTMLInputElement).value='private@accounts.invalid';
 const input=el.querySelector('[name=password]') as HTMLInputElement;input.value='synthetic-only-password';
 const form=el.querySelector('form[aria-label="Password sign-in"]')!;form.dispatchEvent(new Event('submit',{cancelable:true}));
 await new Promise(r=>setTimeout(r,0));
 expect(input.value).toBe('');expect(text(el)).not.toContain('raw credential failure');expect(text(el.querySelector('[role=alert]')!)).toContain('Check your private sign-in email and password');
 expect((form.querySelector('button') as HTMLButtonElement).disabled).toBe(false);expect(ctx.rerender).not.toHaveBeenCalled();
});
