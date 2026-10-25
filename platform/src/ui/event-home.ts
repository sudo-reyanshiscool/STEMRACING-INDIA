import {managerOnly,teamGarage} from './team-garage';
import {spectatorOnly,SPECTATOR_PAGES} from './spectator';
import { judgePageAllowed } from './judge-access';
import { inspectionScopeControl } from './inspection-scope';
import type { Role } from '../api';
import type { Ctx } from './ctx';
import { notFound } from './common';
import { h } from './dom';
import { PANEL_LABEL, ROLE_LABEL } from './labels';
import { parseHash, routeHref, type Route } from './router';
import { deleteEventControl } from './delete-event';
import { canShowcase, showcaseHref } from '../api/showcase';

export async function eventHomeScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found, or its results have not been released.', '#/', 'All events');
  if(managerOnly(roles))return teamGarage(ctx,event,roles);
  const has = (...r: Role[]) => roles.some((x) => r.includes(x.role));

  const tile = (title: string, body: string, route: Route) =>
    h('a', { class: 'tile', href: routeHref(route) }, h('h3', null, title), h('p', { class: 'muted' }, body));

  const tiles: HTMLElement[] = [];
  if(has('organiser','chair'))tiles.push(tile('Scheduling & Streams','Allocate streams, build the master timeline and publish team schedules.',{name:'schedule',eventId}));
  if (has('organiser', 'chair')) tiles.push(tile('Teams', 'Add and review the teams entered.', { name: 'teams', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('People', 'Invite judges, officials and team managers.', { name: 'people', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('Draw lots', 'Preview random team numbers and balanced judge assignments.', {name:'draw',eventId}));
  if (has('organiser','chair')) tiles.push(tile('Judge', 'Choose a team and panel to complete your own scorecards.', { name: 'score', eventId }));
  else if (has('judge','lead_judge','scrutineer')) tiles.push(tile('My scorecards', 'Score the teams assigned to each of your panels.', { name: 'score', eventId }));
  if (roles.some(r=>r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) tiles.push(tile('Scores', 'Follow saved scores, drafts and submissions across the event.', { name: 'scores', eventId }));
  if (roles.some(r => r.role !== 'team_manager') || (has('team_manager') && event.resultsReleased)) tiles.push(tile('Race control', 'Pair teams, record lane times and follow Denford track readings.', { name: 'racing', eventId }));
  if (has('chair', 'lead_judge')) tiles.push(tile('Moderation', "Review judges' scores, override and reopen.", { name: 'moderate', eventId }));
  if (has('organiser', 'chair')) tiles.push(tile('Rankings', 'Combine scores, add penalties, publish and release.', { name: 'rankings', eventId }));
  if(has('organiser','chair','team_manager'))tiles.push(tile('Submissions','Submit portfolios, check deadlines and track late penalties.',{name:'submissions',eventId}));
  if (roles.length) tiles.push(tile('Team files', 'Upload logos and portfolios or download assigned team submissions.', {name:'team-files', eventId}));
  if (has('organiser', 'chair', 'team_manager')) tiles.push(tile('Team feedback', 'Report judging concerns and follow organiser responses.', {name:'team-feedback', eventId}));
  tiles.push(tile('Results', ctx.demo ? 'Explore the populated standings, awards and team PDFs.' : event.resultsReleased ? 'Results released.' : 'Not released yet.', { name: 'results', eventId }));

  if(spectatorOnly(roles)) {tiles.length=0;for(const [label,name] of SPECTATOR_PAGES.filter(([,name])=>name!=='event'))tiles.push(tile(label,`View ${label.toLowerCase()} without making changes.`,{name,eventId} as Route));}
  const mine = [...new Set(roles.map((r) => (r.panel ? `${ROLE_LABEL[r.role]}: ${PANEL_LABEL[r.panel]}` : ROLE_LABEL[r.role])))];
  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, 'All events'),
      h('p', { class: 'eyebrow' }, [event.startsOn, event.resultsReleased ? 'Results released' : null].filter(Boolean).join(' · ')),
      h('h1', null, event.name),
      mine.length > 0 ? h('p', { class: 'lead' }, `You are: ${mine.join('; ')}`) : null,
    ),
    !ctx.demo && canShowcase(event, roles) ? h('section', { class: 'showcase-entry' },
      h('div', { class: 'stack' }, h('h2', null, 'Showcase Test Event'),
        h('p', null, 'Explore every tab using the existing scores and results. Try changes freely; reloading resets your temporary copy.')),
      h('div', {class: 'actions'},
        h('a', { class: 'btn btn--primary', href: showcaseHref(event.id) }, 'Open showcase'),
        h('a', { class: 'btn btn--ghost', href: showcaseHref(event.id, true) }, 'Six-team example'))) : null,
    h('div', { class: 'tiles' }, tiles.filter(t=>judgePageAllowed(roles, parseHash(t.getAttribute('href')??'').name))),
    has('organiser', 'chair') ? h('section', { class: 'card stack' },
      h('h2', null, 'Media Assets & Background Removal'),
      h('p', null, 'Process team photographs with AI background removal, review transparent cutouts, and approve team assets for live arena broadcast graphics.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn--secondary', href: routeHref({ name: 'media', eventId }) }, 'Open Media Assets →')
      )
    ) : null,
    has('organiser','chair') ? await inspectionScopeControl(ctx,eventId) : null,
    has('organiser') ? deleteEventControl(ctx, event) : null,
  );
}
