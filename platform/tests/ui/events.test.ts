// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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

  it('says so when there are no events, and offers to create one', async () => {
    const { api } = await world();
    await api.signIn('stranger@x.test');
    const { ctx } = makeCtx(api);
    const el = await eventsScreen(ctx);
    expect(text(el)).toContain('No events yet');
    expect(el.querySelector('input[name=name]')).not.toBeNull();
  });

  it('creates an event and goes to it, or shows why not', async () => {
    const { api } = await world();
    await api.signIn('new@x.test');
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
});
