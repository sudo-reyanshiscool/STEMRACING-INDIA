import { summarise, type CarSummary, type Result } from '../engine';
import { WF26 } from '../rules';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { classTag } from './tags';

function resultList(items: Result[]): HTMLElement {
  return h('ul', { class: 'list' }, items.map((r) =>
    h('li', null,
      h('div', { class: 'row__head' }, h('strong', null, `${r.article} ${r.name}`), classTag(r.cls), h('strong', null, `${r.penalty} pts`)),
      [...r.detail, ...r.notes].map((t) => h('p', { class: 'small' }, t)))));
}

export function summaryView(s: CarSummary, extra: { carLabel: string; actions: HTMLElement[] }): HTMLElement {
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stat' },
      h('span', { class: 'stat__value' }, String(s.total)),
      h('span', { class: 'stat__label' }, `Penalty points, Car ${extra.carLabel}`)),
    !s.started ? h('p', { class: 'lead' }, 'Nothing has been entered for this car yet.') : null,
    s.ineligibleFor.length
      ? h('p', { class: 'alert', role: 'status' }, `Not eligible for ${s.ineligibleFor.join(' or ')} (T2.4.2): ${s.perfFailures.length} Performance infringement${s.perfFailures.length === 1 ? '' : 's'}.`)
      : null,
    s.perfFailures.length ? h('section', { class: 'section' }, h('h2', null, 'Performance'), resultList(s.perfFailures)) : null,
    s.safetyFailures.length
      ? h('section', { class: 'section' }, h('h2', null, 'Safety'),
          h('p', null, 'Fix these in the single 20-minute service session after initial specification judging, or the car is not safe to race.'),
          resultList(s.safetyFailures))
      : null,
    s.generalFailures.length ? h('section', { class: 'section' }, h('h2', null, 'General'), resultList(s.generalFailures)) : null,
    s.atRisk.length
      ? h('section', { class: 'section' }, h('h2', null, 'At risk'),
          h('p', null, 'Within 0.5 of a limit. Paint, decals and machining variance can tip these over.'),
          h('ul', { class: 'list' }, s.atRisk.map((r) => h('li', null, h('strong', null, `${r.article} ${r.name}`)))))
      : null,
    s.invalid.length
      ? h('section', { class: 'section' }, h('h2', null, 'Needs a number'), h('ul', { class: 'list' }, s.invalid.map((r) => h('li', null, `${r.article} ${r.name}`))))
      : null,
    s.pending.length
      ? h('p', { class: 'muted' }, `${s.pending.length} row${s.pending.length === 1 ? '' : 's'} still to do.`)
      : null,
    h('div', { class: 'actions' }, extra.actions),
  );
}

export async function summaryScreen(ctx: Ctx, carId: string): Promise<HTMLElement> {
  const car = await ctx.store.getCar(carId);
  const team = car ? await ctx.store.getTeam(car.teamId) : undefined;
  const event = team ? await ctx.store.getEvent(team.eventId) : undefined;
  if (!car || !team || !event) {
    return h('div', { class: 'stack' }, h('p', null, 'That car was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  }
  const insp = await ctx.store.getInspection(carId);
  const s = summarise(WF26.rules, insp?.measurements ?? {});

  const pdf = h('button', { class: 'btn btn--primary', type: 'button', 'data-action': 'download-pdf', disabled: true }, 'Download PDF');
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'car', carId }) }, 'Back to checklist'),
      h('p', { class: 'eyebrow' }, event.name),
      h('h1', null, `Team ${team.number} · Car ${car.label}`),
      h('p', { class: 'lead' }, team.name)),
    summaryView(s, {
      carLabel: car.label,
      actions: [
        pdf,
        h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'car', carId }) }, 'Back to checklist'),
        h('a', { class: 'btn btn--ghost', href: routeHref({ name: 'compare', teamId: team.id }) }, 'Compare cars A and B'),
      ],
    }),
  );
}
