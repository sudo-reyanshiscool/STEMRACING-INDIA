import type { Ctx } from './ctx';
import { errorText } from './common';
import { h } from './dom';
import { routeHref } from './router';

const today = () => new Date().toISOString().slice(0, 10);

export async function eventsScreen(ctx: Ctx): Promise<HTMLElement> {
  const events = await ctx.api.listEvents();
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today() })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const f = new FormData(form);
    try {
      const ev = await ctx.api.createEvent({ name: String(f.get('name')), startsOn: String(f.get('date') ?? '') || undefined });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  });
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'STEM Racing India National Finals'), h('h1', null, 'Events'),
      h('p', { class: 'lead' }, 'Judging, racing and results for each event, in one place.')),
    h('section', { class: 'section' },
      events.length === 0
        ? h('p', { class: 'muted' }, 'No events yet. Create one, or ask an organiser to invite you.')
        : h('ul', { class: 'list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, e.startsOn ?? ''), e.resultsReleased ? h('span', { class: 'tag tag--pass' }, 'Results released') : null)))),
    h('section', { class: 'section' }, h('h2', null, 'New event'), error, form),
  );
}
