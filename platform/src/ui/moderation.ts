import type { CardRow, OverrideRow, Panel, TeamRow } from '../api';
import { ApiError } from '../api';
import { areaTotal, round1, validateScores, type Area } from '../engine';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

export interface ModerationRow {
  teamId: string;
  teamLabel: string;
  areaId: string;
  judges: { cardId: string; judgeId: string; status: 'draft' | 'submitted'; total: number | null }[];
  mean: number | null;
  override: OverrideRow | null;
}

/** One row per team. Only submitted, complete cards enter the mean; drafts are listed but never counted. */
export function buildModeration(area: Area, teams: TeamRow[], cards: CardRow[], overrides: OverrideRow[]): ModerationRow[] {
  return teams.map((t) => {
    const judges = cards.filter((c) => c.teamId === t.id && c.areaId === area.id).map((c) => ({
      cardId: c.id, judgeId: c.judgeId, status: c.status,
      total: validateScores(area, c.scores, { complete: true }).length === 0 ? areaTotal(area, c.scores) : null,
    }));
    const done = judges.filter((j) => j.status === 'submitted' && j.total !== null).map((j) => j.total as number);
    return {
      teamId: t.id, teamLabel: `Team ${t.number} · ${t.name}`, areaId: area.id, judges,
      mean: done.length > 0 ? round1(done.reduce((a, b) => a + b, 0) / done.length) : null,
      override: overrides.find((o) => o.teamId === t.id && o.areaId === area.id) ?? null,
    };
  });
}

const RELEASED_LOCK = 'Results are released. Withdraw the release to change this.';
const REASON_PROBLEM = 'Give a reason of at least 3 characters.';

/** Strict: optional minus, ASCII digits, one optional decimal part. No exponents, no Infinity, no digit scripts. */
const parseNumber = (raw: string): number | null => (/^-?[0-9]+([.,][0-9]+)?$/.test(raw) ? Number(raw.replace(',', '.')) : null);

export async function moderationScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [first, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!first) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const isChair = roles.some((r) => r.role === 'chair');
  const leadPanels = roles.filter((r) => r.role === 'lead_judge').map((r) => r.panel as Panel);
  if (!isChair && leadPanels.length === 0) return notFound('Only the Chair and lead judges can moderate.', eventHref, first.name);

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const areas = first.ruleset.areas.filter((a) => a.kind === 'scorecard' && (isChair || leadPanels.includes(a.panel as Panel)));
  const select = h('select', { name: 'area', 'aria-label': 'Area' }, areas.map((a) => h('option', { value: a.id }, a.name)));
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const status = h('p', { class: 'notice', role: 'status', hidden: true });
  const releasedNote = h('p', { class: 'notice', hidden: true });
  const table = h('div', { class: 'table-wrap' });
  let busy = false;
  let shown = 0;

  const load = async () => {
    const [event, teams, cards, overrides, allRoles] = await Promise.all([
      ctx.api.getEvent(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.listOverrides(eventId), ctx.api.listRoles(eventId),
    ]);
    return { event, teams, cards, overrides, allRoles };
  };
  type Loaded = Awaited<ReturnType<typeof load>>;

  const draw = (data: Loaded) => {
    const area = areas.find((a) => a.id === select.value) ?? areas[0];
    if (!area) {
      table.replaceChildren(h('p', { class: 'muted' }, 'There are no scorecard areas for you to moderate.'));
      return;
    }
    const released = data.event?.resultsReleased ?? false;
    releasedNote.hidden = !released;
    releasedNote.textContent = released ? 'Results are released, so scores cannot be changed or reopened. Withdraw the release to change this.' : '';
    const who = (judgeId: string, i: number) => data.allRoles.find((r) => r.userId === judgeId && r.email)?.email ?? `Judge ${i + 1}`;
    const canChange = isChair && !released;
    const rows = buildModeration(area, [...data.teams].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true })), data.cards, data.overrides);

    const reopenForm = (cardId: string, judge: string, teamLabel: string) => {
      const reason = h('input', { name: 'reason', autocomplete: 'off', maxlength: 500, 'aria-label': `Reason to reopen ${judge}'s card for ${teamLabel}` });
      const submit = h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, 'Reopen');
      const form = h('form', { class: 'inline-form', 'data-reopen': cardId, novalidate: true },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason to reopen'), reason), submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        error.hidden = true;
        status.hidden = true;
        const why = reason.value.trim();
        if (why.length < 3) {
          error.textContent = 'Give a reason of at least 3 characters to reopen this scorecard.';
          error.hidden = false;
          return;
        }
        void act(submit, () => ctx.api.reopenCard(cardId, why), `Scorecard reopened for ${teamLabel}. ${judge} can edit it again.`, true);
      });
      return form;
    };

    const overrideForm = (row: ModerationRow) => {
      const value = h('input', { name: 'value', inputmode: 'decimal', autocomplete: 'off', value: row.override ? String(row.override.value) : '', 'aria-label': `Override score for ${row.teamLabel}, 0 to ${area.max}` });
      const reason = h('input', { name: 'reason', autocomplete: 'off', maxlength: 500, 'aria-label': `Reason for the override for ${row.teamLabel}` });
      const submit = h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, row.override ? 'Change override' : 'Set override');
      const form = h('form', { class: 'inline-form', 'data-override': row.teamId, novalidate: true },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, `Score (0 to ${area.max})`), value),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason'), reason), submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (busy) return;
        error.hidden = true;
        status.hidden = true;
        const n = parseNumber(value.value.trim());
        const why = reason.value.trim();
        const problem = n === null ? 'Enter the override as a number, for example 31 or 31.5.'
          : n < 0 || n > area.max ? `The override must be between 0 and ${area.max}.`
          : Math.abs(n * 10 - Math.round(n * 10)) > 1e-9 ? 'The override can have at most one decimal place.'
          : why.length < 3 ? REASON_PROBLEM
          : null;
        if (problem !== null || n === null) {
          error.textContent = problem ?? '';
          error.hidden = false;
          return;
        }
        void act(submit, () => ctx.api.setOverride(eventId, row.teamId, area.id, n, why), `Override saved: ${row.teamLabel}, ${area.name}, ${n}.`, false);
      });
      return form;
    };

    table.replaceChildren(h('table', { class: 'table' },
      h('caption', { class: 'small muted' }, `${area.name}, out of ${area.max}. Only submitted scorecards count; drafts are listed but never counted.`),
      h('thead', null, h('tr', null, ['Team', 'Judges', 'Mean of submitted', 'Chair override'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('th', { scope: 'row' }, r.teamLabel),
        h('td', null, r.judges.length === 0 ? h('span', { class: 'muted' }, 'No cards yet') : h('ul', { class: 'list' }, r.judges.map((j, i) => {
          const judge = who(j.judgeId, i);
          return h('li', null,
            j.status === 'submitted' ? `${judge}: ${j.total ?? 'incomplete'} ` : `${judge}: draft, not counted `,
            tag(j.status, j.status === 'submitted' ? 'pass' : 'risk'),
            canChange && j.status === 'submitted' ? reopenForm(j.cardId, judge, r.teamLabel) : null);
        }))),
        h('td', { class: 'num' }, r.mean === null ? '—' : String(r.mean)),
        h('td', null,
          r.override ? h('p', { class: 'small' }, `Override: ${r.override.value} (${r.override.reason})`) : null,
          canChange ? overrideForm(r) : null))))));
  };

  const refresh = async () => {
    const mine = ++shown;
    const data = await load();
    if (!alive || mine !== shown) return;
    draw(data);
  };

  /** Runs one write: guards double submits, refreshes after, and always re-enables the button. */
  const act = async (button: HTMLButtonElement, work: () => Promise<void>, done: string, isReopen: boolean) => {
    busy = true;
    button.disabled = true;
    try {
      try {
        await work();
      } catch (err) {
        if (!alive) return;
        let message = RELEASED_LOCK;
        if (err instanceof ApiError && err.code === 'locked') {
          const ev = await ctx.api.getEvent(eventId).catch(() => null);
          if (!ev?.resultsReleased && isReopen) message = 'That scorecard is no longer submitted, so it cannot be reopened. The list has been refreshed.';
          await refresh().catch(() => undefined);
        }
        reportActionError(ctx, error, err, { locked: message });
        return;
      }
      try {
        await refresh();
      } catch (err) {
        console.error(err);
        if (alive) { error.textContent = 'Your change was saved, but this screen could not be refreshed. Reload the page to see it.'; error.hidden = false; }
        return;
      }
      if (alive) { status.textContent = done; status.hidden = false; }
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  select.addEventListener('change', () => {
    error.hidden = true;
    status.hidden = true;
    refresh().catch((e) => { if (alive) reportActionError(ctx, error, e); });
  });

  const data = await load();
  const busyArea = areas.find((a) => data.cards.some((c) => c.areaId === a.id));
  if (busyArea) select.value = busyArea.id;
  draw(data);

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, first.name), h('h1', null, 'Moderation'),
      h('p', { class: 'lead' }, isChair
        ? "Review each judge's total, reopen a card with a reason, or override an area score."
        : "Review your panel's scores. Only the Chair can change them.")),
    releasedNote, error, status,
    h('label', { class: 'field', style: 'max-width: 420px' }, h('span', { class: 'field__label' }, 'Area'), select),
    table,
  );
}
