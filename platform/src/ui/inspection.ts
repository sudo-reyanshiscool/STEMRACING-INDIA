import { selectedRules } from '../technical';
import { buttonBusy } from './button-busy';
import type { Car, Inspection, Measurements, Value } from '../technical';
import { INDIA_TECHNICAL, SECTIONS, summarise } from '../technical';
import { downloadSheet } from '../pdf/resultSheet';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { ruleRow } from './inspection-rows';
import { routeHref } from './router';

export async function inspectionScreen(ctx: Ctx, eventId: string, teamId: string, car: Car): Promise<HTMLElement> {
  const [event, teams, roles, session, existing] = await Promise.all([
    ctx.api.getEvent(eventId),
    ctx.api.listTeams(eventId),
    ctx.api.myRoles(eventId),
    ctx.api.getSession(),
    ctx.api.getInspection(eventId, teamId, car),
  ]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const team = teams.find((t) => t.id === teamId);
  if (!team) return notFound('That team was not found.', routeHref({ name: 'score', eventId }), 'My scorecards');

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const isStaff = roles.some((r) => r.role === 'chair' || r.role === 'organiser');
  const canInspect = isStaff || roles.some((r) =>
    (r.role === 'scrutineer' && (r.teamId===null||r.teamId===teamId)) || (r.role === 'judge' && r.panel === 'scrutineering' && r.teamId===teamId),
  );

  let insp: Inspection = existing ?? {
    id: '',
    eventId,
    teamId,
    car,
    inspectorId: session?.userId ?? '',
    status: 'in_progress',
    rulesetId: INDIA_TECHNICAL.id,
    measurements: {},
    notes: {},
    startedAt: new Date().toISOString(),
    submittedAt: null,
    updatedAt: new Date().toISOString(),
    revision: 1,
  };

  if (!existing) insp.selectedArticles = (await ctx.api.getInspectionScope(eventId)).articles;
  const measurements: Measurements = { ...insp.measurements };
  const locked = event.resultsReleased || insp.status === 'submitted';
  const readOnly = !canInspect || locked;

  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const statusEl = h('span');

  const updateStatusBadge = () => {
    if (insp.status === 'submitted') {
      statusEl.replaceChildren(tag('Submitted', 'pass'));
    } else if (insp.status === 'reopened') {
      statusEl.replaceChildren(tag('Reopened', 'risk'));
    } else {
      statusEl.replaceChildren(tag('In progress', 'todo'));
    }
  };
  updateStatusBadge();

  // Save serialization queue
  let savePromise: Promise<unknown> = Promise.resolve();
  const save = () => {
    if (readOnly) return;
    savePromise = savePromise
      .then(async () => {
        const saved = await ctx.api.saveInspection(eventId, teamId, car, structuredClone(measurements));
        insp = saved;
        error.hidden = true;
      })
      .catch((e) => {
        if (alive) reportActionError(ctx, error, e);
      });
  };

  const exportPdfBtn = (extraCls = '') => {
    const btn = h('button', {
      class: `btn btn--ghost ${extraCls}`.trim(),
      type: 'button',
      'aria-label': `Export Car ${car} inspection sheet to PDF`,
    }, 'Export PDF');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Generating PDF…';
      try {
        const s = summarise(selectedRules(INDIA_TECHNICAL.rules, insp), measurements);
        const inspector = roles.find((r) => r.userId === insp.inspectorId)?.email || session?.email || '';
        await downloadSheet({
          eventName: event.name,
          teamNumber: team.number,
          teamName: team.name,
          school: team.school,
          carLabel: car,
          scrutineer: inspector,
          date: (insp.startedAt || new Date().toISOString()).slice(0, 10),
          rulesetName: INDIA_TECHNICAL.name,
          rulesetIssued: INDIA_TECHNICAL.issued,
          summary: s,
        });
      } catch (e) {
        if (alive) reportActionError(ctx, error, e);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
    return btn;
  };

  const total = h('span', { class: 'bar__total' }, '0');
  const meta = h('span', { class: 'bar__meta' });
  const otherCar = car === 'A' ? 'B' : 'A';

  const bar = h('div', { class: 'bar', role: 'status', 'aria-label': 'Penalty total' },
    h('span', null, h('span', { class: 'eyebrow' }, `Penalty points · Car ${car}`), h('br'), total),
    meta,
    h('div', { class: 'actions' },
      exportPdfBtn('btn--small'),
      h('a', {
        class: 'btn btn--ghost btn--small',
        href: routeHref({ name: 'inspection', eventId, teamId, car: otherCar }),
      }, `Switch to Car ${otherCar}`),
    ),
  );

  const rows = new Map<string, ReturnType<typeof ruleRow>>();
  const refresh = () => {
    const s = summarise(selectedRules(INDIA_TECHNICAL.rules, insp), measurements);
    for (const r of s.results) rows.get(r.article)?.showResult(r);
    total.textContent = String(s.total);
    const items = [
      h('span', null, `${s.pending.length} to do`),
      h('span', null, `${s.perfFailures.length} performance`),
      h('span', null, `${s.safetyFailures.length} safety`),
    ];
    if (s.ineligibleFor.length) {
      items.push(h('span', { class: 'small' }, 'Ineligible for Fastest Car or Best Engineered Car'));
    }
    meta.replaceChildren(...items);
  };

  const sectionEls = SECTIONS.map((sec) => {
    const rules = selectedRules(INDIA_TECHNICAL.rules, insp).filter((r) => r.section === sec.id);
    const ruleNodes = rules.map((rule) => {
      const row = ruleRow(rule, measurements[rule.article], readOnly, (v: Value) => {
        if (v === undefined) delete measurements[rule.article];
        else measurements[rule.article] = v;
        refresh();
        save();
      });
      rows.set(rule.article, row);
      return row.el;
    });
    return h('section', { class: 'section' }, h('h2', null, sec.title), ruleNodes);
  });

  // Action buttons
  const submitBtn = h('button', {
    class: 'btn btn--primary',
    type: 'button',
    disabled: readOnly || null,
  }, 'Submit inspection');

  submitBtn.addEventListener('click', async () => {
    if (readOnly) return;
    const s = summarise(selectedRules(INDIA_TECHNICAL.rules, insp), measurements);
    if (!s.complete) {
      const ok = window.confirm(`There are still ${s.pending.length} unmeasured items. Submit anyway?`);
      if (!ok) return;
    }
    if (submitBtn.disabled) return;
    const finish = buttonBusy(submitBtn, 'Submitting…');
    error.hidden = true;
    try {
      await savePromise;
      if (!insp.id) insp = await ctx.api.saveInspection(eventId,teamId,car,structuredClone(measurements));
      await ctx.api.submitInspection(insp.id);
      insp.status = 'submitted';
      updateStatusBadge();
      ctx.rerender();
    } catch (e) {
      finish();
      if (alive) reportActionError(ctx, error, e);
    }
  });

  const reopenBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Reopen inspection');
  reopenBtn.addEventListener('click', async () => {
    if (!insp.id) return;
    const reason = window.prompt('Enter reason for reopening inspection:');
    if (!reason?.trim()) return;
    error.hidden = true;
    try {
      await ctx.api.reopenInspection(insp.id, reason.trim());
      insp.status = 'reopened';
      updateStatusBadge();
      ctx.rerender();
    } catch (e) {
      if (alive) reportActionError(ctx, error, e);
    }
  });

  const actionArea = h('div', { class: 'actions' });
  if (canInspect && insp.status !== 'submitted' && !event.resultsReleased) {
    actionArea.appendChild(submitBtn);
  }
  if (isStaff && insp.status === 'submitted' && !event.resultsReleased) {
    actionArea.appendChild(reopenBtn);
  }
  actionArea.appendChild(exportPdfBtn());

  const screen = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'score', eventId }) }, 'Back to My scorecards'),
      h('p', { class: 'eyebrow' }, INDIA_TECHNICAL.name),
      h('h1', null, `Team ${team.number} · Car ${car} Technical Inspection`),
      h('p', { class: 'lead' }, team.name, ' ', statusEl),
      insp.selectedArticles !== undefined && insp.selectedArticles !== null ? h('p',{class:'notice'},`Selected inspection: ${insp.selectedArticles.length} regulations. Unselected regulations are not assessed or penalised.`) : null,
    ),
    error,
    bar,
    ...sectionEls,
    actionArea,
  );

  refresh();
  return screen;
}
