import { describe, expect, it } from 'vitest';
import { parseHash, routeHref } from '../../src/ui/router';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/event/e1')).toEqual({ name: 'event', eventId: 'e1' });
    expect(parseHash('#/car/c1')).toEqual({ name: 'car', carId: 'c1' });
    expect(parseHash('#/car/c1/summary')).toEqual({ name: 'summary', carId: 'c1' });
    expect(parseHash('#/team/t1/compare')).toEqual({ name: 'compare', teamId: 't1' });
  });
  it('falls back to home for anything unknown', () => {
    expect(parseHash('#/nonsense')).toEqual({ name: 'home' });
    expect(parseHash('#/car/')).toEqual({ name: 'home' });
  });
  it('round-trips and encodes ids', () => {
    for (const r of [
      { name: 'home' }, { name: 'event', eventId: 'a b' }, { name: 'car', carId: 'c/1' },
      { name: 'summary', carId: 'c1' }, { name: 'compare', teamId: 't1' },
    ] as const) {
      expect(parseHash(routeHref(r))).toEqual(r);
    }
  });
});
