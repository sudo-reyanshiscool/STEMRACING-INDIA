// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';
import { SHOWCASE_EVENT_ID, exitShowcaseHref } from '../../src/api/showcase';
import { showcaseSeed } from '../fixtures/showcase';
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
import { eventNav } from '../../src/ui/event-nav';
import { mountShowcaseBar } from '../../src/ui/showcase';

describe('showcase navigation and presentation', () => {
  it('exposes every event tab and renders each with populated temporary data', async () => {
    const api = MemoryApi.forShowcase(showcaseSeed());
    const nav = eventNav((await api.getEvent(SHOWCASE_EVENT_ID))!, await api.myRoles(SHOWCASE_EVENT_ID), 'event');
    expect([...nav.querySelectorAll('a')].map(text)).toEqual(['Event', 'Teams', 'People', 'Draw lots', 'Communications', 'Judge', 'Scores', 'Race control', 'Moderation', 'Rankings', 'Results']);
    for (const screen of [eventHomeScreen, teamsScreen, peopleScreen, drawLotsScreen, communicationsScreen,
      scoringScreen, scoresScreen, moderationScreen, rankingsScreen, resultsScreen, racingScreen]) {
      const {ctx, leaves} = makeCtx(api);
      ctx.demo = true;
      const node = await screen(ctx, SHOWCASE_EVENT_ID);
      expect(node.querySelector('h1'), screen.name).not.toBeNull();
      expect(text(node.querySelector('h1')!)).not.toMatch(/not found|unavailable/i);
      if (screen === resultsScreen) expect(text(node)).toContain('Showcase Team');
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
