import { summarise, summarisePair, type Result } from '../engine';
import { WF26 } from '../rules';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const items = (rs: Result[]) =>
  rs.length === 0
    ? h('p', { class: 'muted' }, 'None.')
    : h('ul', { class: 'list' }, rs.map((r) => h('li', null, h('strong', null, `${r.article} ${r.name}`), h('span', { class: 'small' }, `${r.penalty} pts`))));

export async function compareScreen(ctx: Ctx, teamId: string): Promise<HTMLElement> {
  const team = await ctx.store.getTeam(teamId);
  if (!team) return h('div', { class: 'stack' }, h('p', null, 'That team was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  const cars = await ctx.store.carsForTeam(teamId);
  const [a, b] = cars;
  const sums = await Promise.all(cars.map(async (c) => summarise(WF26.rules, (await ctx.store.getInspection(c.id))?.measurements ?? {})));
  const pair = summarisePair(sums[0], sums[1]);

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'event', eventId: team.eventId }) }, 'Back to teams'),
      h('h1', null, `Team ${team.number}: Car A and Car B`),
      h('p', { class: 'lead' }, team.name)),
    h('div', { class: 'grid' },
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sums[0].total)), h('span', { class: 'stat__label' }, 'Penalty points, Car A')),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sums[1].total)), h('span', { class: 'stat__label' }, 'Penalty points, Car B')),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(pair.total)), h('span', { class: 'stat__label' }, 'Penalty points, both cars'))),
    h('section', { class: 'section' }, h('h2', null, 'Faults on both cars'),
      h('p', null, 'A shared design fault costs twice, once per car (T2.5.1).'), items(pair.shared)),
    h('section', { class: 'section' }, h('h2', null, 'Only Car A'), items(pair.onlyA)),
    h('section', { class: 'section' }, h('h2', null, 'Only Car B'), items(pair.onlyB)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId: a.id }) }, 'Open Car A'),
      h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId: b.id }) }, 'Open Car B')),
  );
}
