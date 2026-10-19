import type { EventRow, RoleRow } from '../api';
import { h } from './dom';
import { routeHref, type Route } from './router';

/** All interfaces navigate the same event id; permissions still come from the API. */
export function eventNav(event: EventRow, roles: RoleRow[], current: Route['name']): HTMLElement {
  const has = (...names: RoleRow['role'][]) => roles.some((r) => names.includes(r.role));
  const items: Array<[string, Route]> = [['Event', { name: 'event', eventId: event.id }]];
  if (has('organiser', 'chair')) items.push(['Teams', { name: 'teams', eventId: event.id }], ['People', { name: 'people', eventId: event.id }]);
  if (has('judge')) items.push(['My scorecards', { name: 'score', eventId: event.id }]);
  if (roles.some(r=>r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) items.push(['Scores', { name: 'scores', eventId: event.id }]);
  if (roles.some(r => r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) items.push(['Race control', { name: 'racing', eventId: event.id }]);
  if (has('chair', 'lead_judge')) items.push(['Moderation', { name: 'moderate', eventId: event.id }]);
  if (has('organiser', 'chair')) items.push(['Rankings', { name: 'rankings', eventId: event.id }]);
  items.push(['Results', { name: 'results', eventId: event.id }]);
  return h('nav', { class: 'event-nav', 'aria-label': `${event.name} navigation` }, items.map(([name, route]) =>
    h('a', { href: routeHref(route), 'aria-current': route.name === current || (route.name === 'score' && current === 'scorecard') ? 'page' : null }, name)));
}
