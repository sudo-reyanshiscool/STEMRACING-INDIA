import {managerOnly} from './team-garage';
import {spectatorOnly,SPECTATOR_PAGES} from './spectator';
import { judgeOnly } from './judge-access';
import type { EventRow, RoleRow } from '../api';
import { h } from './dom';
import { routeHref, type Route } from './router';

/** All interfaces navigate the same event id; permissions still come from the API. */
export function eventNav(event: EventRow, roles: RoleRow[], current: Route['name'], options: { classic?: boolean } = {}): HTMLElement {
  if(spectatorOnly(roles))return h('nav',{class:'event-nav','aria-label':`${event.name} navigation`},SPECTATOR_PAGES.map(([label,name])=>h('a',{href:routeHref({name,eventId:event.id} as Route),'aria-current':name===current?'page':null},label)));
  if(judgeOnly(roles)) {
    const items:Array<[string,Route]>=[['Event',{name:'event',eventId:event.id}],['My scorecards',{name:'score',eventId:event.id}],['Scores',{name:'scores',eventId:event.id}]];
    if(roles.some(r=>r.role==='lead_judge'))items.push(['Moderation',{name:'moderate',eventId:event.id}]);
    items.push(['Results',{name:'results',eventId:event.id}]);
    return h('nav',{class:'event-nav','aria-label':`${event.name} navigation`},items.map(([label,route])=>h('a',{href:routeHref(route),'aria-current':route.name===current||(route.name==='score'&&['scorecard','inspection'].includes(current))?'page':null},label)));
  }
  const has = (...names: RoleRow['role'][]) => roles.some((r) => names.includes(r.role));
  if (options.classic) return classicEventNav(event, roles, current);
  const staff = has('organiser', 'chair');
  const seesScores = roles.some(r => r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased);
  const to = (name: string): Route => ({ name, eventId: event.id } as Route);
  /** Each page appears once, under the part of the event it belongs to. */
  const groups: Array<[string | null, Array<[string, Route] | false>]> = [
    [null, [['Event', to('event')]]],
    ['Set up', [
      staff && ['Scheduling & Streams', to('schedule')],
      staff && ['People', to('people')],
      staff && ['Draw lots', to('draw')],
      staff && ['Communications', to('communications')],
    ]],
    ['Teams', [
      staff && ['Teams', to('teams')],
      has('team_manager') && ['My Schedule', to('my-schedule')],
      (staff || has('team_manager')) && ['Submissions', to('submissions')],
      roles.length > 0 && ['Team files', to('team-files')],
      (staff || has('team_manager')) && ['Team branding', to('branding')],
      staff && ['Media Assets', to('media')],
      (staff || has('team_manager')) && ['Team feedback', to('team-feedback')],
    ]],
    ['Judging', [
      staff ? ['Judge', to('score')] : has('judge', 'scrutineer') && ['My scorecards', to('score')],
      seesScores && ['Scores', to('scores')],
      has('chair', 'lead_judge') && ['Moderation', to('moderate')],
    ]],
    ['Race day', [
      seesScores && ['Race control', to('racing')],
      staff && ['Graphics', to('graphics')],
    ]],
    ['Results', [
      staff && ['Rankings', to('rankings')],
      ['Results', to('results')],
    ]],
  ];
  const link = ([name, route]: [string, Route]) =>
    h('a', { href: routeHref(route), 'aria-current': route.name === current || (route.name === 'score' && (current === 'scorecard' || current === 'inspection')) ? 'page' : null }, name);
  const shown = groups.map(([label, items]) => [label, items.filter((i): i is [string, Route] => !!i)] as const).filter(([, items]) => items.length > 0);
  // A short menu reads better as one list; the headings only earn their place for organisers and the Chair.
  return h('nav', { class: managerOnly(roles)?'event-nav event-nav--garage':'event-nav', 'aria-label': `${event.name} navigation` },
    staff
      ? shown.flatMap(([label, items]): HTMLElement[] => label
          ? [h('div', { class: 'event-nav__group', role: 'group', 'aria-label': label }, h('p', { class: 'event-nav__label', 'aria-hidden': 'true' }, label), items.map(link))]
          : items.map(link))
      : shown.flatMap(([, items]) => items.map(link)));
}

/** The tab row used before the side menu, in its original order. Kept for the classic look. */
function classicEventNav(event: EventRow, roles: RoleRow[], current: Route['name']): HTMLElement {
  const has = (...names: RoleRow['role'][]) => roles.some((r) => names.includes(r.role));
  const items: Array<[string, Route]> = [['Event', { name: 'event', eventId: event.id }]];
  if (has('organiser', 'chair')) items.push(
    ['Scheduling & Streams',{name:'schedule',eventId:event.id}],
    ['Teams', { name: 'teams', eventId: event.id }],
    ['Media Assets', { name: 'media', eventId: event.id }],
    ['People', { name: 'people', eventId: event.id }],
    ['Draw lots', { name: 'draw', eventId: event.id }],
    ['Communications', { name: 'communications', eventId: event.id }]
  );
  if (has('organiser','chair')) items.push(['Judge', { name: 'score', eventId: event.id }]);
  else if (has('judge', 'scrutineer')) items.push(['My scorecards', { name: 'score', eventId: event.id }]);
  if (roles.some(r=>r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) items.push(['Scores', { name: 'scores', eventId: event.id }]);
  if (roles.some(r => r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) items.push(['Race control', { name: 'racing', eventId: event.id }]);
  if (has('organiser', 'chair')) items.push(['Graphics', { name: 'graphics', eventId: event.id }]);
  if (has('chair', 'lead_judge')) items.push(['Moderation', { name: 'moderate', eventId: event.id }]);
  if (has('organiser', 'chair')) items.push(['Rankings', { name: 'rankings', eventId: event.id }]);
  if(has('team_manager'))items.push(['My Schedule',{name:'my-schedule',eventId:event.id}]);
  if(has('organiser','chair','team_manager'))items.push(['Submissions',{name:'submissions',eventId:event.id}]);
  if(has('organiser','chair','team_manager'))items.push(['Team branding',{name:'branding',eventId:event.id}]);
  if (roles.length) items.push(['Team files', {name:'team-files', eventId:event.id}]);
  if (has('organiser', 'chair', 'team_manager')) items.push(['Team feedback', {name:'team-feedback', eventId:event.id}]);
  items.push(['Results', { name: 'results', eventId: event.id }]);
  return h('nav', { class: managerOnly(roles)?'event-nav event-nav--garage':'event-nav', 'aria-label': `${event.name} navigation` }, items.map(([name, route]) =>
    h('a', { href: routeHref(route), 'aria-current': route.name === current || (route.name === 'score' && (current === 'scorecard' || current === 'inspection')) ? 'page' : null }, name)));
}
