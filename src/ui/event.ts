import { carStatus, summarise } from '../engine';
import { WF26 } from '../rules';
import { StoreError, type Car } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { carStatusTag } from './tags';

async function carLink(ctx: Ctx, car: Car): Promise<HTMLElement> {
  const insp = await ctx.store.getInspection(car.id);
  const s = summarise(WF26.rules, insp?.measurements ?? {});
  return h('a', { class: 'btn btn--ghost btn--small', href: routeHref({ name: 'car', carId: car.id }) },
    `Car ${car.label}`, ' ', carStatusTag(carStatus(s)), s.started ? ` ${s.total} pts` : '');
}

export async function eventScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const event = await ctx.store.getEvent(eventId);
  if (!event) return h('div', { class: 'stack' }, h('p', null, 'That event was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));

  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team number'), h('input', { name: 'number', required: true, maxlength: 12, autocomplete: 'off', inputmode: 'text' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team name'), h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'School or club (optional)'), h('input', { name: 'school', maxlength: 120, autocomplete: 'off' })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Add team'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await ctx.store.createTeam(eventId, { number: String(f.get('number')), name: String(f.get('name')), school: String(f.get('school')) });
      ctx.rerender();
    } catch (err) {
      error.textContent = err instanceof StoreError ? err.message : 'Could not save the team.';
      error.hidden = false;
    }
  });

  const teams = await ctx.store.listTeams(eventId);
  const cards = await Promise.all(teams.map(async (t) => {
    const cars = await ctx.store.carsForTeam(t.id);
    const links = await Promise.all(cars.map((c) => carLink(ctx, c)));
    return h('article', { class: 'card' },
      h('h3', null, `Team ${t.number} · ${t.name}`),
      t.school ? h('p', { class: 'small' }, t.school) : null,
      h('div', { class: 'actions' }, links),
      h('a', { href: routeHref({ name: 'compare', teamId: t.id }) }, 'Compare cars A and B'),
    );
  }));

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, 'All events'),
      h('p', { class: 'eyebrow' }, [event.date, event.venue].filter(Boolean).join(' · ')),
      h('h1', null, event.name),
    ),
    h('section', { class: 'section' }, h('h2', null, 'Teams'),
      teams.length === 0 ? h('p', { class: 'muted' }, 'No teams yet. Add the first team below.') : h('div', { class: 'grid' }, cards)),
    h('section', { class: 'section' }, h('h2', null, 'Add a team'), error, form),
  );
}
