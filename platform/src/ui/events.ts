import { buttonBusy } from './button-busy';
import { organiserControls } from './organisers';
import type { Ctx } from './ctx';
import { reportActionError } from './actions';
import { h } from './dom';
import { routeHref } from './router';
import { canShowcase, showcaseHref, SHOWCASE_EVENT_ID } from '../api/showcase';

const today = () => new Date().toISOString().slice(0, 10);

export async function eventsScreen(ctx: Ctx): Promise<HTMLElement> {
  const [events, deleted, canCreate, access, viewer] = await Promise.all([ctx.api.listEvents(), ctx.api.listDeletedEvents(), ctx.api.canCreateEvent(), ctx.api.platformAccess(), ctx.api.getSession()]);
  const showcaseEvent = !ctx.demo ? events.find(e => e.id === SHOWCASE_EVENT_ID) : undefined;
  const showcaseAvailable = showcaseEvent ? canShowcase(showcaseEvent, await ctx.api.myRoles(showcaseEvent.id)) : false;
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event');
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today() })),
    submitBtn,
  );
  let busy = false;
  const deletedSection = h('details', { class: 'section' }, h('summary', null, `Deleted events (${deleted.length})`));
  if (deleted.length) deletedSection.append(h('ul', { class: 'list' }, deleted.map((event) => {
    const restore = h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Restore ${event.name}` }, 'Restore event');
    const failure = h('p', { class: 'alert', role: 'alert', hidden: true });
    restore.addEventListener('click', async () => {
      if (restore.disabled) return;
      const finish = buttonBusy(restore, 'Restoring…'); failure.hidden = true;
      try { await ctx.api.restoreEvent(event.id); if (alive) ctx.rerender(); }
      catch (e) { if (alive) { reportActionError(ctx, failure, e); } }
      finally { finish(); }
    });
    return h('li', null, h('strong', null, event.name), h('span', { class: 'muted small' }, event.startsOn ?? ''), restore, failure);
  })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true;
    const f = new FormData(form);
    if (!String(f.get('name') ?? '').trim()) {
      error.textContent = 'Event name is required.';
      error.hidden = false;
      return;
    }
    busy = true;
    const finish = buttonBusy(submitBtn, 'Creating event…');
    try {
      const ev = await ctx.api.createEvent({ name: String(f.get('name')), startsOn: String(f.get('date') ?? '') || undefined });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      reportActionError(ctx, error, err);
    } finally {
      busy = false;
      finish();
    }
  });
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'STEM Racing India · Nationals & Regionals'), h('h1', null, 'Events'),
      h('p', { class: 'lead' }, 'Judging, racing and results for each event, in one place.'),
      access.kind ? h('p', {class:'tag tag--pass'},access.kind==='admin'?'Platform Admin · permanent access to every event':access.kind==='platform'?'Platform Organiser · all events':'Competition Organiser · assigned events') : null),
    h('section', { class: 'section' },
      events.length === 0
        ? h('p', { class: 'muted' }, canCreate ? 'No events yet. Create one, or ask an organiser to invite you.' : 'No events yet. Ask an organiser to invite you to an event.')
        : h('ul', { class: 'list event-list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, e.startsOn ?? ''), e.resultsReleased ? h('span', { class: 'tag tag--pass' }, 'Results released') : null,
              showcaseAvailable && e.id === SHOWCASE_EVENT_ID ? h('a', { class: 'btn btn--ghost btn--small', href: showcaseHref(e.id) }, 'Open showcase') : null)))),
    canCreate ? h('section', { class: 'section' }, h('h2', null, 'New event'), error, form) : null,
    deleted.length ? deletedSection : null,
    access.canManage ? organiserControls(ctx,access,viewer?.userId) : null,
  );
}
