// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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

  const fill = (el: HTMLElement, sel: string, value: string, index = 0) => {
    const input = el.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel)[index]!;
    input.value = value; input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };
  const submit = async (el: HTMLElement) => { el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await new Promise((r) => setTimeout(r, 0)); };

  it('names a regional automatically from the city and year, and goes to it', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    expect(text(el)).toContain('STEM Racing India');
    await submit(el);
    expect(text(el.querySelector('[role=alert]')!)).toContain('Enter the city');
    fill(el, 'input[name=year]', '2027');
    fill(el, 'input[name=city]', '  Delhi ');
    expect(text(el)).toContain('STEM Racing India Delhi Regionals 1 2027');
    await submit(el);
    expect(location.hash).toMatch(/^#\/event\/event-/);
    expect((await api.listEvents()).map((e) => e.name)).toContain('STEM Racing India Delhi Regionals 1 2027');
  });

  it('creates several regionals at once, numbering each city separately', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    fill(el, 'input[name=year]', '2027');
    fill(el, 'select[name=count]', '3');
    expect(el.querySelectorAll('input[name=city]')).toHaveLength(3);
    ['Delhi', 'Mumbai', 'delhi'].forEach((c, i) => fill(el, 'input[name=city]', c, i));
    expect(text(el)).toContain('STEM Racing India delhi Regionals 2 2027');
    expect(text(el.querySelector('button[type=submit]')!)).toBe('Create 3 events');
    await submit(el);
    await vi.waitFor(() => expect(ctx.rerender).toHaveBeenCalled());
    expect((await api.listEvents()).map((e) => e.name)).toEqual(expect.arrayContaining([
      'STEM Racing India Delhi Regionals 1 2027', 'STEM Racing India Mumbai Regionals 1 2027', 'STEM Racing India delhi Regionals 2 2027']));
  });

  it('keeps typed cities when the number of regionals changes', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    fill(el, 'select[name=count]', '2');
    fill(el, 'input[name=city]', 'Pune', 1);
    fill(el, 'select[name=count]', '1');
    fill(el, 'select[name=count]', '2');
    expect(el.querySelectorAll<HTMLInputElement>('input[name=city]')[1]!.value).toBe('Pune');
  });

  it('still allows one event with a custom name', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    let calls = 0;
    const real = api.createEvent.bind(api);
    api.createEvent = async (i) => { calls++; return real(i); };
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    const custom = el.querySelector<HTMLInputElement>('input[name=custom]')!;
    custom.checked = true; custom.dispatchEvent(new Event('change'));
    expect(el.querySelector<HTMLElement>('input[name=city]')!.closest('label')!.hidden).toBe(true);
    fill(el, 'input[name=name]', ' ');
    await submit(el);
    expect(text(el.querySelector('[role=alert]')!)).toContain('Event name is required');
    expect((el.querySelector('form button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toBe(0);
    fill(el, 'input[name=name]', 'Test Event');
    await submit(el);
    expect(calls).toBe(1);
    expect(location.hash).toMatch(/^#\/event\/event-/);
  });

  it('shows create failures as fixed text, and goes to sign-in on a lapsed session', async () => {
    const { api } = await world();
    await api.signIn('org@x.test');
    const fail = (code: 'forbidden' | 'unauthenticated') => {
      const stub = new Proxy(api, { get: (t, k) => (k === 'createEvents' ? async () => { throw new ApiError(code, 'raw backend wording'); } : (t as never)[k]) }) as Api;
      return makeCtx(stub).ctx;
    };
    const ctx1 = fail('forbidden');
    const el = await eventsScreen(ctx1);
    fill(el, 'input[name=city]', 'Delhi');
    await submit(el);
    expect(text(el.querySelector('[role=alert]')!)).toContain('permission');
    expect(text(el)).not.toContain('raw backend wording');
    const ctx2 = fail('unauthenticated');
    const el2 = await eventsScreen(ctx2);
    fill(el2, 'input[name=city]', 'Delhi');
    await submit(el2);
    expect(ctx2.rerender).toHaveBeenCalled();
  });
});
