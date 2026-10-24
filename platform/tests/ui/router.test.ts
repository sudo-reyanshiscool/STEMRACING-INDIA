import { describe, expect, it } from 'vitest';
import { parseHash, routeHref, type Route } from '../../src/ui/router';

describe('router', () => {
  it('parses every route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/security')).toEqual({ name: 'security' });
    expect(parseHash('#/event/e1')).toEqual({ name: 'event', eventId: 'e1' });
    expect(parseHash('#/event/e1/teams')).toEqual({ name: 'teams', eventId: 'e1' });
    expect(parseHash('#/event/e1/people')).toEqual({ name: 'people', eventId: 'e1' });
    expect(parseHash('#/event/e1/score')).toEqual({ name: 'score', eventId: 'e1' });
    expect(parseHash('#/event/e1/score/t1/verbal-technique')).toEqual({ name: 'scorecard', eventId: 'e1', teamId: 't1', areaId: 'verbal-technique' });
    expect(parseHash('#/event/e1/moderate')).toEqual({ name: 'moderate', eventId: 'e1' });
    expect(parseHash('#/event/e1/rankings')).toEqual({ name: 'rankings', eventId: 'e1' });
    expect(parseHash('#/event/e1/results')).toEqual({ name: 'results', eventId: 'e1' });
  });

  it('falls back to home for anything unknown or malformed', () => {
    for (const h of ['#/nonsense', '#/event', '#/event/', '#/event/e1/nope', '#/event/e1/score/t1', '#/event/e1/teams/extra', '#/event/%E0%A4%A', '#/event//teams']) {
      expect(parseHash(h), h).toEqual({ name: 'home' });
    }
  });

  it('round-trips ids containing spaces, slashes and non-Latin text', () => {
    const routes: Route[] = [
      { name: 'home' }, { name: 'security' }, { name: 'event', eventId: 'a b' }, { name: 'teams', eventId: 'a/b' },
      { name: 'scorecard', eventId: 'e 1', teamId: 'स्टेम', areaId: 'x/y' }, { name: 'results', eventId: 'é' },
    ];
    for (const r of routes) expect(parseHash(routeHref(r))).toEqual(r);
  });
});
