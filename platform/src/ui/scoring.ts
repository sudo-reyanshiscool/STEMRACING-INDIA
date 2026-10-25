import type { CardRow, Panel } from '../api';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { liveRefresh } from './live-refresh';
import { PANEL_LABEL } from './labels';
import { routeHref } from './router';

export async function scoringScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, teams, allCards, conflictList, session, exemptionList, inspections] = await Promise.all([
    ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.myConflicts(eventId),
    ctx.api.getSession(), ctx.api.listJudgeExemptions(eventId), ctx.api.listInspections(eventId).catch(() => []),
  ]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const staff=roles.some(r=>r.role==='organiser'||r.role==='chair');
  const panels = [...new Set(staff?event.ruleset.areas.filter(a=>a.kind==='scorecard'&&a.panel).map(a=>a.panel as Panel):[
    ...roles.filter((r) => r.role === 'judge' && r.panel).map((r) => r.panel as Panel),
    ...(roles.some((r) => r.role === 'scrutineer') ? ['scrutineering' as Panel] : []),
  ])];
  if(panels.length===0 && roles.some(r=>r.role==='lead_judge')) return h('div',{class:'stack'},h('h1',null,'My scorecards'),h('p',null,'You have no individual judging assignments. Review your panel’s scorecards in Moderation.'),h('a',{href:routeHref({name:'moderate',eventId})},'Open Moderation'));
  if (panels.length === 0) return notFound('You are not a judge on any panel for this event.', eventHref, event.name);

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const conflicts = new Set(conflictList);
  // listCards also returns other judges' cards to a Chair, Organiser or Lead Judge: only the person's own count here.
  const myCards: CardRow[] = allCards.filter((c) => !!session && c.judgeId === session.userId);
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const body = h('div', { class: 'stack stack--lg' });
  /** Which team's declare button is armed (waiting for the second, confirming press). One at a time. */
  const selectionKey = `stem-racing-judge-panel:${eventId}:${session?.userId ?? ''}`;
  let selectedPanel = panels[0];
  try { const saved = sessionStorage.getItem(selectionKey) as Panel | null; if (saved && panels.includes(saved)) selectedPanel = saved; } catch { /* Storage can be disabled. */ }
  const panelButtons = panels.map(panel => h('button', {
    type: 'button', class: 'btn btn--ghost', 'aria-pressed': String(panel === selectedPanel),
    'aria-controls': `judge-panel-${panel}`,
  }, PANEL_LABEL[panel]));
  const chooser = panels.length > 1 ? h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, staff?'Choose a panel to complete your own scorecards:':`You are assigned to ${panels.length} judging panels. Choose a panel:`),
    h('div', { class: 'panel-switcher', role: 'group', 'aria-label': 'Your judging panels' }, panelButtons)) : null;
  let selectedTeam='';
  const teamSelectionKey=`${selectionKey}:team`;
  try{const saved=sessionStorage.getItem(teamSelectionKey);if(saved&&teams.some(t=>t.id===saved))selectedTeam=saved;}catch{/* Selection still works without storage. */}
  const teamSelect=staff?h('select',{'aria-label':'Team to judge'},h('option',{value:''},'Choose a team'),[...teams].sort((a,b)=>a.number.localeCompare(b.number,'en',{numeric:true})).map(t=>h('option',{value:t.id},`Team ${t.number} · ${t.name}`))):null;
  if(teamSelect)teamSelect.value=selectedTeam;
  const teamChooser=teamSelect?h('label',{class:'field'},h('span',{class:'field__label'},'Team'),teamSelect):null;
  let armed: string | null = null;
  let declaring = false;

  const stateOf = (teamId: string, areaId: string, criteria: number) => {
    const c = myCards.find((x) => x.teamId === teamId && x.areaId === areaId);
    if (!c) return { label: 'Not started', node: tag('Not started', 'todo') };
    if (c.status === 'submitted') return { label: 'Submitted', node: tag('Submitted', 'pass') };
    const label = `Draft, ${Object.keys(c.scores).length} of ${criteria} scored`;
    return { label, node: tag(label, 'risk') };
  };

  const stateOfInspection = (teamId: string, car: 'A' | 'B') => {
    const insp = inspections.find((i) => i.teamId === teamId && i.car === car);
    if (!insp) return { label: 'Not started', node: tag('Not started', 'todo') };
    if (insp.status === 'submitted') return { label: 'Submitted', node: tag('Submitted', 'pass') };
    if (insp.status === 'reopened') return { label: 'Reopened', node: tag('Reopened', 'risk') };
    const count = Object.keys(insp.measurements).length;
    const label = `Draft, ${count} measured`;
    return { label, node: tag(label, 'risk') };
  };

  const render = () => {
    body.replaceChildren(
      ...panels.map((panel) => {
        const areas = event.ruleset.areas.filter((a) => a.kind === 'scorecard' && a.panel === panel);
        return h('section', { class: 'section', id: `judge-panel-${panel}`, hidden: panel !== selectedPanel, 'aria-labelledby': `judge-panel-heading-${panel}` },
          h('h2', { id: `judge-panel-heading-${panel}` }, PANEL_LABEL[panel]),
          !staff&&panel!=='scrutineering'&&!roles.some(r=>r.role==='judge'&&r.panel===panel&&r.teamId!==null)?h('p',{class:'notice'},'No teams are assigned to you on this panel. Ask an organiser to assign your teams.'):null,
          staff&&!selectedTeam?h('p',{class:'muted'},'Choose a team above to open its scorecards.'):null,
          h('div', { class: 'grid' }, teams.filter(t=>staff?t.id===selectedTeam:roles.some(r=>(r.role==='judge' && r.panel===panel && r.teamId===t.id) || (panel==='scrutineering' && r.role==='scrutineer' && (r.teamId===null || r.teamId===t.id)))).map((t) => {
            const conflicted = conflicts.has(t.id);
            const exemption = exemptionList.find(x=>x.judgeId===session?.userId && x.teamId===t.id);
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
            const content = panel === 'scrutineering' ? h('div', { class: 'stack' },
              h('div', { class: 'stack', style: 'gap: 4px; margin-bottom: 6px' },
                h('strong', { class: 'small muted', style: 'text-transform: uppercase; letter-spacing: 0.05em' }, 'Specification Judging (Dimensions)'),
                ...(['A', 'B'] as const).map((car) => {
                  const s = stateOfInspection(t.id, car);
                  return h('a', {
                    class: 'btn btn--ghost btn--small',
                    href: routeHref({ name: 'inspection', eventId, teamId: t.id, car }),
                    'aria-label': `Car ${car} Technical Inspection, Team ${t.number}, ${s.label}`,
                  }, `Car ${car} Inspection`, ' ', s.node);
                }),
              ),
              h('div', { class: 'stack', style: 'gap: 4px' },
                h('strong', { class: 'small muted', style: 'text-transform: uppercase; letter-spacing: 0.05em' }, 'Scrutineering Scorecards'),
                ...areas.map((a) => {
                  const s = stateOf(t.id, a.id, a.criteria.length);
                  return h('a', {
                    class: 'btn btn--ghost btn--small',
                    href: routeHref({ name: 'scorecard', eventId, teamId: t.id, areaId: a.id }),
                    'aria-label': `${a.name}, Team ${t.number}, ${s.label}`,
                  }, a.name, ' ', s.node);
                }),
              ),
              declare,
            ) : h('div', { class: 'stack' },
              ...areas.map((a) => {
                const s = stateOf(t.id, a.id, a.criteria.length);
                return h('a', {
                  class: 'btn btn--ghost btn--small',
                  href: routeHref({ name: 'scorecard', eventId, teamId: t.id, areaId: a.id }),
                  'aria-label': `${a.name}, Team ${t.number}, ${s.label}`,
                }, a.name, ' ', s.node);
              }),
              declare,
            );
            return h('article', { class: 'card' },
              h('h3', null, `Team ${t.number} · ${t.name}`),
              exemption ? h('p',{class:'notice'},'Exempt from judging this team.',exemption.reason?` ${exemption.reason}`:'') : conflicted
                ? h('p', { class: 'small' }, 'You declared a conflict of interest with this team. Ask the Chair if this was a mistake.')
                : content,
            );
          })),
        );
      }),
    );
  };
  if(teamSelect)teamSelect.onchange=()=>{selectedTeam=teamSelect.value;try{sessionStorage.setItem(teamSelectionKey,selectedTeam);}catch{/* Selection still works without storage. */}armed=null;render();};
  panelButtons.forEach((button, index) => button.addEventListener('click', () => {
    selectedPanel = panels[index]; armed = null;
    try { sessionStorage.setItem(selectionKey,selectedPanel); } catch { /* Selection still works without storage. */ }
    panelButtons.forEach((b,i) => b.setAttribute('aria-pressed',String(i === index)));
    render();
  }));
  render();
  const assignmentFingerprint = JSON.stringify([roles, exemptionList]);
  const refreshAssignments = async () => {
    await ctx.api.claimInvitations();
    const fresh = await Promise.all([ctx.api.myRoles(eventId), ctx.api.listJudgeExemptions(eventId)]);
    if (alive && JSON.stringify(fresh) !== assignmentFingerprint) ctx.rerender();
  };
  const refresh = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Refresh assignments');
  refresh.addEventListener('click', async () => {
    if (refresh.disabled) return;
    refresh.disabled = true; error.hidden = true;
    try { await refreshAssignments(); } catch (e) { if (alive) reportActionError(ctx,error,e); }
    finally { if (alive) refresh.disabled = false; }
  });
  liveRefresh(ctx,refreshAssignments,e=>reportActionError(ctx,error,e));

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, event.name), h('h1', null, staff?'Judge':'My scorecards'), teamChooser,chooser,
      h('p', { class: 'lead' }, ctx.demo?'Choose a team and panel. Existing marks and feedback open in an editable showcase draft. Changes affect this temporary copy only.':staff?'Choose a team and panel. Your scores are recorded under your own account and count when submitted.':'Choose one of your assigned teams and an area. Scores save as you type and can be edited until you submit.'),
      event.resultsReleased?h('p',{class:'notice'},'Results are released. Existing scorecards are read-only; withdraw the release before adding or changing scores.'):null,
      h('p', { class: 'small muted' }, 'If you have a conflict of interest with a team, declare it. A declaration cannot be removed on this screen: ask the Chair.')),
    h('div', { class: 'actions' }, refresh, h('p', { class: 'small muted' }, 'Assignments update every 10 seconds and when you return to this page.')), error, body,
  );
}
