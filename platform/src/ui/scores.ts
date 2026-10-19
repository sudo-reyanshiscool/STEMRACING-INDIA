import { areaTotal, validateScores } from '../engine';
import type { CardRow } from '../api';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { PANEL_LABEL } from './labels';
import { liveRefresh } from './live-refresh';
import { routeHref } from './router';

export async function scoresScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, session] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.getSession()]);
  if (!event || !session || !roles.length) return notFound('These scores are not available to your account.', '#/', 'All events');
  const staff = roles.some((r) => r.role === 'organiser' || r.role === 'chair');
  const lead = roles.some((r) => r.role === 'lead_judge');
  if (!staff && !lead && !roles.some((r) => r.role !== 'team_manager') && !(event.resultsReleased && roles.some((r) => r.role === 'team_manager'))) {
    return notFound('These scores are not available to your account.', routeHref({ name: 'event', eventId }), event.name);
  }
  let alive = true, revision = 0, fingerprint = '';
  ctx.onLeave(() => { alive = false; });
  const team = h('select', { 'aria-label': 'Filter scores by team' }, h('option', { value: '' }, 'All teams'));
  const panel = h('select', { 'aria-label': 'Filter scores by panel' }, h('option', { value: '' }, 'All panels'));
  const summary = h('p', { class: 'notice', role: 'status' });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const holder = h('div', { class: 'stack' });
  const refresh = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Refresh scores');
  const load = async () => {
    const [teams, cards, people, feedback] = await Promise.all([
      ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.listRoles(eventId), ctx.api.listFeedback(eventId),
    ]);
    return { teams, cards, people, feedback };
  };
  let data = await load();
  const options = () => {
    const selected = team.value, chosenPanel = panel.value;
    team.replaceChildren(h('option', { value: '' }, 'All teams'), ...[...data.teams].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))
      .map((t) => h('option', { value: t.id }, `Team ${t.number} · ${t.name}`)));
    if (data.teams.some((t) => t.id === selected)) team.value = selected;
    const panels = [...new Set(event.ruleset.areas.filter((a) => a.kind === 'scorecard' && a.panel).map((a) => a.panel!))];
    panel.replaceChildren(h('option', { value: '' }, 'All panels'), ...panels.map((p) => h('option', { value: p }, PANEL_LABEL[p])));
    if (panels.includes(chosenPanel as typeof panels[number])) panel.value = chosenPanel;
  };
  const draw = () => {
    const expanded = new Set([...holder.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.card));
    const visible = data.cards.filter((c) => (!team.value || c.teamId === team.value) && (!panel.value || c.panel === panel.value));
    const submitted = visible.filter((c) => c.status === 'submitted').length;
    summary.textContent = `${submitted} submitted · ${visible.length - submitted} draft. Only submitted scorecards count in Rankings.`;
    const teamName = (c: CardRow) => { const t = data.teams.find((t) => t.id === c.teamId); return t ? `Team ${t.number} · ${t.name}` : 'Removed team'; };
    const sorted = [...visible].sort((a, b) => teamName(a).localeCompare(teamName(b), 'en', { numeric: true }) || a.areaId.localeCompare(b.areaId) || a.judgeId.localeCompare(b.judgeId));
    holder.replaceChildren(sorted.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('caption', { class: 'small muted' }, 'Saved scorecards visible to your role'),
      h('thead', null, h('tr', null, ['Team', 'Area', 'Judge', 'Score', 'Status and details'].map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', null, sorted.map((c) => {
        const area = event.ruleset.areas.find((a) => a.id === c.areaId);
        if (!area) return null;
        const complete = validateScores(area, c.scores, { complete: true }).length === 0;
        const total = areaTotal(area, c.scores);
        const review = data.feedback.find((f) => f.cardId === c.id);
        const details = h('details', { 'data-card': c.id, open: expanded.has(c.id) }, h('summary', null, 'View scores and feedback'),
          h('dl', { class: 'score-breakdown' }, area.criteria.flatMap((criterion) => [h('dt', null, criterion.name), h('dd', null, `${c.scores[criterion.id] ?? '—'} / ${criterion.max}`)])),
          ...Object.entries(c.comments).filter(([, text]) => text).map(([id, value]) => h('p', { class: 'small results-comment' }, h('strong', null, `${area.criteria.find((x) => x.id === id)?.name ?? id}: `), value)),
          ...([['Overall Comment', review?.overall], ['Key Strengths', review?.strengths], ['Areas for Improvement', review?.improvements]] as const)
            .filter(([, value]) => value).map(([label, value]) => h('p', { class: 'small results-comment' }, h('strong', null, `${label}: `), value)),
          c.judgeId === session.userId && roles.some((r) => r.role === 'judge' && r.panel === c.panel && (r.teamId === null || r.teamId === c.teamId))
            ? h('a', { class: 'btn btn--ghost btn--small', href: routeHref({ name: 'scorecard', eventId, teamId: c.teamId, areaId: c.areaId }) }, c.status === 'draft' ? 'Continue scoring' : 'View submitted scorecard') : null);
        const judge = data.people.find((r) => r.userId === c.judgeId && r.email)?.email ?? (c.judgeId === session.userId ? session.email : 'Judge');
        return h('tr', null, h('th', { scope: 'row' }, teamName(c)), h('td', { 'data-label': 'Area' }, area.name), h('td', { 'data-label': 'Judge' }, judge),
          h('td', { 'data-label': 'Score', class: 'num' }, `${total} / ${area.max}`, !complete ? h('span', { class: 'small muted' }, ' · incomplete') : null),
          h('td', { 'data-label': 'Status and details' }, tag(c.status === 'submitted' ? 'Submitted' : 'Draft · not counted', c.status === 'submitted' ? 'pass' : 'risk'), details));
      })))) : h('p', { class: 'muted' }, 'No saved scorecards match this view. Judges can start from My scorecards.'));
  };
  const update = async () => {
    const request = ++revision, fresh = await load();
    if (!alive || request !== revision) return;
    const next = JSON.stringify(fresh);
    data = fresh;
    if (next !== fingerprint) { fingerprint = next; options(); draw(); }
    error.hidden = true;
  };
  fingerprint = JSON.stringify(data); options(); draw();
  team.addEventListener('change', draw); panel.addEventListener('change', draw);
  refresh.addEventListener('click', async () => {
    if (refresh.disabled) return; refresh.disabled = true;
    try { await update(); } catch (e) { if (alive) reportActionError(ctx, error, e); }
    finally { if (alive) refresh.disabled = false; }
  });
  liveRefresh(ctx, update, (e) => reportActionError(ctx, error, e));
  return h('div', { class: 'stack stack--lg' }, h('div', { class: 'stack' },
    h('a', { class: 'back', href: routeHref({ name: 'event', eventId }) }, event.name), h('h1', null, 'Scores'),
    h('p', { class: 'lead' }, staff ? 'All judges’ saved scores for this event, from draft through submission.' : lead ? 'Saved scores for the panels you lead, alongside your own cards.' : 'Only your own scorecards, plus submitted Specification scores for every team.'),
    h('p', { class: 'small muted' }, 'Updates every 10 seconds while this page is visible. Specification scores are shared with event staff. Other judges’ drafts and private judging notes stay in the judge’s scorecard and permitted moderation views.')),
    h('div', { class: 'actions score-filters' }, h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), team), h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Panel'), panel), refresh),
    summary, error, holder);
}
