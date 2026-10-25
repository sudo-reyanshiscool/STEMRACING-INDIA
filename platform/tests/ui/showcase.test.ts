// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MemoryApi } from '../../src/api';
import { SHOWCASE_EVENT_ID, exitShowcaseHref } from '../../src/api/showcase';
import { showcaseSeed } from '../fixtures/showcase';
import { buildShowcaseExamples } from '../../src/api/showcase-examples';
import { makeCtx, text } from './helpers';
import { eventHomeScreen } from '../../src/ui/event-home';
import { teamsScreen } from '../../src/ui/teams';
import { peopleScreen } from '../../src/ui/people';
import { drawLotsScreen } from '../../src/ui/draw-lots';
import { communicationsScreen } from '../../src/ui/communications';
import { scoringScreen } from '../../src/ui/scoring';
import { scoresScreen } from '../../src/ui/scores';
import { moderationScreen } from '../../src/ui/moderation';
import { rankingsScreen } from '../../src/ui/rankings';
import { resultsScreen } from '../../src/ui/results';
import { racingScreen } from '../../src/ui/racing';
import { teamFilesScreen } from '../../src/ui/team-files';
import { teamFeedbackScreen } from '../../src/ui/team-feedback';
import { eventNav } from '../../src/ui/event-nav';
import { mountShowcaseBar } from '../../src/ui/showcase';

describe('showcase navigation and presentation', () => {
  it('saves a showcase override with a blank optional reason', async () => {
    const api = MemoryApi.forShowcase(showcaseSeed());
    const {ctx, leaves} = makeCtx(api);
    ctx.demo = true;
    const node = await moderationScreen(ctx, SHOWCASE_EVENT_ID);
    expect(text(node)).toContain('Reason (optional)');
    const form = node.querySelector('form[data-override]')!;
    (form.querySelector('input[name=value]') as HTMLInputElement).value = '10';
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = '';
    form.dispatchEvent(new Event('submit', {cancelable:true}));
    await vi.waitFor(async () => expect(await api.listOverrides(SHOWCASE_EVENT_ID)).toEqual([expect.objectContaining({value:10,reason:''})]));
    expect(text(node)).not.toContain('10 ()');
    await Promise.all(leaves.map(leave => leave()));
  });
  it.each([showcaseSeed, () => buildShowcaseExamples(showcaseSeed().event)])('exposes every event tab and renders each with populated temporary data: %s', async makeSeed => {
    const seed = makeSeed();
    const api = MemoryApi.forShowcase(seed);
    const nav = eventNav((await api.getEvent(SHOWCASE_EVENT_ID))!, await api.myRoles(SHOWCASE_EVENT_ID), 'event');
    expect([...nav.querySelectorAll('a')].map(text)).toEqual(['Event', 'Scheduling & Streams', 'Teams', 'People', 'Draw lots', 'Communications', 'Judge', 'Scores', 'Race control', 'Moderation', 'Rankings', 'Submissions', 'Team files', 'Team feedback', 'Results']);
    for (const screen of [eventHomeScreen, teamsScreen, peopleScreen, drawLotsScreen, communicationsScreen,
      scoringScreen, scoresScreen, moderationScreen, rankingsScreen, resultsScreen, racingScreen, teamFeedbackScreen, teamFilesScreen]) {
      const {ctx, leaves} = makeCtx(api);
      ctx.demo = true;
      const node = await screen(ctx, SHOWCASE_EVENT_ID);
      expect(node.querySelector('h1'), screen.name).not.toBeNull();
      expect(text(node.querySelector('h1')!)).not.toMatch(/not found|unavailable/i);
      if (screen === resultsScreen) for (const team of seed.teams) expect(text(node)).toContain(team.name);
      if (screen === communicationsScreen) expect(text(node)).toContain('Simulate announcement');
      if (screen === peopleScreen) expect(text(node)).toContain('Simulate invitation');
      if (screen === drawLotsScreen) expect(text(node)).not.toContain('SUPERCHARGED stays 001');
      await Promise.all(leaves.map(leave => leave()));
    }
  });

  it('offers the Test Event entry, hides it within the copy, and clearly identifies reset/exit', async () => {
    const api = MemoryApi.forShowcase(showcaseSeed());
    const {ctx} = makeCtx(api);
    const entry = await eventHomeScreen(ctx, SHOWCASE_EVENT_ID);
    expect(entry.querySelector('a[href^="?showcase="]')?.textContent).toBe('Open showcase');
    ctx.demo = true;
    expect((await eventHomeScreen(ctx, SHOWCASE_EVENT_ID)).querySelector('a[href^="?showcase="]')).toBeNull();
    const bar = document.createElement('aside');
    mountShowcaseBar(bar);
    expect(bar.hidden).toBe(false);
    expect(text(bar)).toContain('reset on reload');
    expect(text(bar)).toContain('Emails are simulated');
    expect(text(bar)).toContain('Reset showcase');
    expect(bar.querySelector('a')?.getAttribute('href')).toBe(exitShowcaseHref(location.pathname));
    expect(exitShowcaseHref('/')).not.toContain('?showcase');
  });
});
