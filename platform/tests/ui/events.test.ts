// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, type Api } from '../../src/api';
import { eventsScreen } from '../../src/ui/events';
import { makeCtx, text, world } from './helpers';

describe('eventsScreen', () => {
  it('lists the events the person belongs to as links, with the date', async () => {
    const { api, ev } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const link = el.querySelector(`a[href="#/event/${ev.id}"]`)!;
    expect(text(link)).toBe('Nationals');
    expect(text(el)).toContain('2026-11-01');
  });

  it('says so when there are no events, and hides creation from strangers but shows it to organisers', async () => {
    const { api } = await world();
    await api.signIn('stranger@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    expect(text(el)).toContain('No events yet. Ask an organiser to invite you to an event.');
    expect(el.querySelector('input[name=name]')).toBeNull();

    (api as any).setCreatorAllowlist(['creator@x.test']);
    await api.signIn('creator@x.test');
    const { ctx: ctx2 } = makeCtx(api);
    const el2 = await eventsScreen(ctx2);
    expect(text(el2)).toContain('No events yet. Create one, or ask an organiser to invite you.');
    expect(el2.querySelector('input[name=name]')).not.toBeNull();
  });

  it('creates an event and goes to it, or shows why not', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const form = el.querySelector('form')!;
    (form.querySelector('input[name=name]') as HTMLInputElement).value = '   ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('Event name is required');
    (form.querySelector('input[name=name]') as HTMLInputElement).value = 'Regional';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(location.hash).toMatch(/^#\/event\/event-/);
  });

  it('recovers after a blank name: button enabled, then one create', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    let calls = 0;
    const real = api.createEvent.bind(api);
    api.createEvent = async (i) => { calls++; return real(i); };
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const form = el.querySelector('form')!;
    const name = form.querySelector('input[name=name]') as HTMLInputElement;
    name.value = ' ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect((form.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toBe(0);
    name.value = 'Regional';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });

  it('shows create failures as fixed text, and goes to sign-in on a lapsed session', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const fail = (code: 'forbidden' | 'unauthenticated') => {
      const stub = new Proxy(api, { get: (t, k) => (k === 'createEvent' ? async () => { throw new ApiError(code, 'raw backend wording'); } : (t as never)[k]) }) as Api;
      return makeCtx(stub).ctx;
    };
    const ctx1 = fail('forbidden');
    const el = await eventsScreen(ctx1);
    (el.querySelector('input[name=name]') as HTMLInputElement).value = 'X';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(text(el.querySelector('[role=alert]')!)).toContain('permission');
    const ctx2 = fail('unauthenticated');
    const el2 = await eventsScreen(ctx2);
    (el2.querySelector('input[name=name]') as HTMLInputElement).value = 'X';
    el2.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx2.rerender).toHaveBeenCalled();
  });
});
