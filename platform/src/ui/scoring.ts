import type { CardRow, Panel } from '../api';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { PANEL_LABEL } from './labels';
import { routeHref } from './router';

export async function scoringScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, teams, allCards, conflictList, session] = await Promise.all([
    ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.myConflicts(eventId),
    ctx.api.getSession(),
  ]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const panels = [...new Set(roles.filter((r) => r.role === 'judge' && r.panel).map((r) => r.panel as Panel))];
  if (panels.length === 0) return notFound('You are not a judge on any panel for this event.', eventHref, event.name);

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const conflicts = new Set(conflictList);
  // listCards also returns other judges' cards to a Chair, Organiser or Lead Judge: only the person's own count here.
  const myCards: CardRow[] = allCards.filter((c) => !!session && c.judgeId === session.userId);
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const body = h('div', { class: 'stack stack--lg' });
  /** Which team's declare button is armed (waiting for the second, confirming press). One at a time. */
  let armed: string | null = null;
  let declaring = false;

  const stateOf = (teamId: string, areaId: string, criteria: number) => {
    const c = myCards.find((x) => x.teamId === teamId && x.areaId === areaId);
    if (!c) return { label: 'Not started', node: tag('Not started', 'todo') };
    if (c.status === 'submitted') return { label: 'Submitted', node: tag('Submitted', 'pass') };
    const label = `Draft, ${Object.keys(c.scores).length} of ${criteria} scored`;
    return { label, node: tag(label, 'risk') };
  };

  const render = () => {
    body.replaceChildren(
      ...panels.map((panel) => {
        const areas = event.ruleset.areas.filter((a) => a.kind === 'scorecard' && a.panel === panel);
        return h('section', { class: 'section' },
          h('h2', null, PANEL_LABEL[panel]),
          h('div', { class: 'grid' }, teams.map((t) => {
            const conflicted = conflicts.has(t.id);
            const declare = h('button', { class: 'linkish', type: 'button' },
              armed === t.id ? 'Confirm: I cannot judge this team' : 'I have a conflict with this team');
            declare.addEventListener('click', async () => {
              if (declaring) return;
              error.hidden = true;
              if (armed !== t.id) {
                armed = t.id;
                render();
                return;
              }
              declaring = true;
              declare.disabled = true;
              try {
                await ctx.api.declareConflict(eventId, t.id);
                conflicts.add(t.id);
                armed = null;
              } catch (e) {
                armed = null;
                if (alive) reportActionError(ctx, error, e, { locked: 'Results are released or this card is submitted — ask the Chair.' });
              } finally {
                declaring = false;
                if (alive) render();
              }
            });
            return h('article', { class: 'card' },
              h('h3', null, `Team ${t.number} · ${t.name}`),
              conflicted
                ? h('p', { class: 'small' }, 'You declared a conflict of interest with this team. Ask the Chair if this was a mistake.')
                : h('div', { class: 'stack' },
                    ...areas.map((a) => {
                      const s = stateOf(t.id, a.id, a.criteria.length);
                      return h('a', {
                        class: 'btn btn--ghost btn--small',
                        href: routeHref({ name: 'scorecard', eventId, teamId: t.id, areaId: a.id }),
                        'aria-label': `${a.name}, Team ${t.number}, ${s.label}`,
                      }, a.name, ' ', s.node);
                    }),
                    declare),
            );
          })),
        );
      }),
    );
  };
  render();

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, event.name), h('h1', null, 'My scorecards'),
      h('p', { class: 'lead' }, 'Choose a team and an area. Scores save as you type and can be edited until you submit.'),
      h('p', { class: 'small muted' }, 'If you have a conflict of interest with a team, declare it. A declaration cannot be removed on this screen: ask the Chair.')),
    error, body,
  );
}
