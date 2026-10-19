import type { Role } from '../api';
import type { Ctx } from './ctx';
import { notFound } from './common';
import { h } from './dom';
import { PANEL_LABEL, ROLE_LABEL } from './labels';
import { routeHref, type Route } from './router';
import { deleteEventControl } from './delete-event';

export async function eventHomeScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found, or its results have not been released.', '#/', 'All events');
  const has = (...r: Role[]) => roles.some((x) => r.includes(x.role));

  const tile = (title: string, body: string, route: Route) =>
    h('a', { class: 'tile', href: routeHref(route) }, h('h3', null, title), h('p', { class: 'muted' }, body));

  const tiles: HTMLElement[] = [];
  if (has('organiser', 'chair')) tiles.push(tile('Teams', 'Add and review the teams entered.', { name: 'teams', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('People', 'Invite judges, officials and team managers.', { name: 'people', eventId }));
  if (has('judge')) tiles.push(tile('My scorecards', 'Score the teams assigned to each of your panels.', { name: 'score', eventId }));
  if (roles.some(r=>r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) tiles.push(tile('Scores', 'Follow saved scores, drafts and submissions across the event.', { name: 'scores', eventId }));
  if (roles.some(r => r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) tiles.push(tile('Race control', 'Pair teams, record lane times and follow Denford track readings.', { name: 'racing', eventId }));
  if (has('chair', 'lead_judge')) tiles.push(tile('Moderation', "Review judges' scores, override and reopen.", { name: 'moderate', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('Rankings', 'Combine scores, add penalties, publish and release.', { name: 'rankings', eventId }));
  tiles.push(tile('Results', event.resultsReleased ? 'Results released.' : 'Not released yet.', { name: 'results', eventId }));

  const mine = [...new Set(roles.map((r) => (r.panel ? `${ROLE_LABEL[r.role]}: ${PANEL_LABEL[r.panel]}` : ROLE_LABEL[r.role])))];
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, 'All events'),
      h('p', { class: 'eyebrow' }, [event.startsOn, event.resultsReleased ? 'Results released' : null].filter(Boolean).join(' · ')),
      h('h1', null, event.name),
      mine.length > 0 ? h('p', { class: 'lead' }, `You are: ${mine.join('; ')}`) : null,
    ),
    h('div', { class: 'tiles' }, tiles),
    has('organiser') ? deleteEventControl(ctx, event) : null,
  );
}
