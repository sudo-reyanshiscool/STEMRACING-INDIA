import {COMPETITION_LEVEL_LABEL} from '../api';
import { newEventsForm } from './event-builder';
import { batchPeopleControl } from './batch-people';
import {managerOnly} from './team-garage';
import { buttonBusy } from './button-busy';
import { organiserControls, ownerRoleBadge } from './organisers';
import type { Ctx } from './ctx';
import { reportActionError } from './actions';
import { h } from './dom';
import { routeHref } from './router';
import { eventDate } from './shell';
import { canShowcase, showcaseHref, SHOWCASE_EVENT_ID } from '../api/showcase';
import { shownInHideMode } from './hide-mode';


export async function eventsScreen(ctx: Ctx): Promise<HTMLElement> {
  const [allEvents, allDeleted, canCreateAny, fullAccess, viewer, hidden] = await Promise.all([ctx.api.listEvents(), ctx.api.listDeletedEvents(), ctx.api.canCreateEvent(), ctx.api.platformAccess(), ctx.api.getSession(), ctx.api.getOwnerHideMode()]);
  // The owner's hide mode leaves the Test Event and nothing else: no other events, no owner badge, no organiser tools.
  const events = hidden ? allEvents.filter(e => shownInHideMode(e.id)) : allEvents;
  const deleted = hidden ? [] : allDeleted;
  const canCreate = canCreateAny && !hidden;
  const access: typeof fullAccess = hidden ? { ...fullAccess, kind: null, canManage: false } : fullAccess;
  const owner=!hidden && access.kind==='admin' && !!viewer && access.viewerId===viewer.userId && access.ownerId===viewer.userId;
  const showcaseEvent = !ctx.demo ? events.find(e => e.id === SHOWCASE_EVENT_ID) : undefined;
  const showcaseAvailable = showcaseEvent ? canShowcase(showcaseEvent, await ctx.api.myRoles(showcaseEvent.id)) : false;
  const teamView=!canCreate&&!access.kind&&events.length>0&&(await Promise.all(events.map(e=>ctx.api.myRoles(e.id)))).some(managerOnly);
  let alive = true;
  ctx.onLeave(() => { alive = false; });
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
    return h('li', null, h('strong', null, event.name), event.startsOn ? h('time', { class: 'muted small', datetime: event.startsOn }, eventDate(event.startsOn)) : null, restore, failure);
  })));
  return h('div', { class: teamView?'garage garage-calendar stack stack--lg':'stack stack--lg' },
    h('header', { class: 'masthead' }, h('h1', null, 'Events'),
      h('p', { class: 'lead' }, teamView?'Your competition journey starts here. Open an event to enter your team garage.':'Judging, racing and results for each event, in one place.'),
      owner ? h('p',null,ownerRoleBadge()) : access.kind ? h('p', {class:'tag tag--pass'},access.displayTitle ? `${access.displayTitle} · ${access.kind==='competition'?'assigned events':'all events'}` : access.kind==='admin'?(access.ownerId===viewer?.userId?'Platform Admin · permanent access to every event':'Platform Administrator · all events'):access.kind==='platform'?'Platform Organiser · all events':access.kind==='spectator'?'Platform Spectator · read-only':'Competition Organiser · assigned events') : null),
    h('section', { class: 'section' },
      events.length === 0
        ? h('p', { class: 'muted' }, canCreate ? 'No events yet. Create one, or ask an organiser to invite you.' : 'No events yet. Ask an organiser to invite you to an event.')
        : h('ul', { class: 'list event-list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('p', { class: 'event-list__meta' }, e.startsOn ? h('time', { datetime: e.startsOn }, eventDate(e.startsOn)) : null, e.competitionLevel?h('span',{class:'tag'},COMPETITION_LEVEL_LABEL[e.competitionLevel]):null,e.resultsReleased ? h('span', { class: 'tag tag--pass' }, 'Results released') : null),
              showcaseAvailable && e.id === SHOWCASE_EVENT_ID ? h('a', { class: 'btn btn--ghost btn--small', href: showcaseHref(e.id) }, 'Open showcase') : null)))),
    canCreate ? h('section', { class: 'section' }, h('h2', null, 'New events'), newEventsForm(ctx, events, () => alive)) : null,
    (canCreate || access.canManage) && access.kind !== 'spectator' && events.length > 0 && !teamView ? batchPeopleControl(ctx, events) : null,
    deleted.length ? deletedSection : null,
    (access.canManage||access.kind==='spectator') ? organiserControls(ctx,access,viewer?.userId) : null,
  );
}
