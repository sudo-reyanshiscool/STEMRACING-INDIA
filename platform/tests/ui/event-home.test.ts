// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { eventHomeScreen } from '../../src/ui/event-home';
import { EMAILS, makeCtx, releaseResults, text, world } from './helpers';

const tiles = async (email: string | null) => {
  const { api, ev } = await world();
  if (email) await api.signIn(email); else await api.signOut();
  const { ctx } = makeCtx(api);
  const el = await eventHomeScreen(ctx, ev.id);
  return [...el.querySelectorAll('a.tile')].map((a) => text(a.querySelector('h3')!));
};

describe('eventHomeScreen', () => {
  it('shows each role the tiles it can use', async () => {
    expect(await tiles(EMAILS.org)).toEqual(['Teams', 'People', 'Scores', 'Race control', 'Rankings', 'Results']);
    expect(await tiles(EMAILS.chair)).toEqual(['Teams', 'People', 'Scores', 'Race control', 'Moderation', 'Rankings', 'Results']);
    expect(await tiles(EMAILS.judge)).toEqual(['My scorecards', 'Scores', 'Race control', 'Results']);
    expect(await tiles(EMAILS.lead)).toEqual(['Scores', 'Race control', 'Moderation', 'Results']);
    expect(await tiles(EMAILS.mgr)).toEqual(['Results']);
  });

  it('shows the public only the results tile for a released event, and nothing for an unreleased one', async () => {
    const { api, ev } = await world();
    const { ctx } = makeCtx(api);
    await api.signOut();
    expect(text(await eventHomeScreen(ctx, ev.id))).toContain('not found');
    await api.signIn(EMAILS.chair);
    await releaseResults(api, ev.id);
    await api.signOut();
    const el = await eventHomeScreen(ctx, ev.id);
    expect([...el.querySelectorAll('a.tile h3')].map(text)).toEqual(['Results']);
    expect(text(el)).toContain('Nationals');
  });

  it('names the person roles for this event', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    expect(text(await eventHomeScreen(ctx, ev.id))).toContain('Judge: Verbal Presentation');
  });

  it('links each tile to its route and states release status in words', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await eventHomeScreen(ctx, ev.id);
    const hrefs = [...el.querySelectorAll('a.tile')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['teams', 'people', 'scores', 'racing', 'rankings', 'results'].map((s) => `#/event/${ev.id}/${s}`));
    expect(text(el)).toContain('Not released yet');
    await releaseResults(api, ev.id);
    expect(text(await eventHomeScreen(ctx, ev.id))).toContain('Results released');
  });

  it('keeps an event name with markup as text', async () => {
    const { api } = await world();
    await api.signIn(EMAILS.org);
    const bad = await api.createEvent({ name: '<img src=x onerror=alert(1)>' });
    const { ctx } = makeCtx(api);
    const el = await eventHomeScreen(ctx, bad.id);
    expect(el.querySelector('img')).toBeNull();
    expect(text(el)).toContain('<img src=x onerror=alert(1)>');
  });
});
