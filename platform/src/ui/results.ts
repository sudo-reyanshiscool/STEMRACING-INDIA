import { ApiError, type CardRow, type FeedbackRow, type PenaltyRow, type RoleRow, type TeamRow } from '../api';
import type { RankRow, Ruleset } from '../engine';
import { errorText, notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};
const num = (n: number) => String(Math.round(n * 10) / 10);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Points available from what was actually judged: every scorecard area, plus a derived area once any team has a value. */
function availableMax(ruleset: Ruleset, rows: RankRow[]): number {
  return ruleset.areas
    .filter((a) => a.kind === 'scorecard' || rows.some((r) => r.areas[a.id] !== null && r.areas[a.id] !== undefined))
    .reduce((s, a) => s + a.max, 0);
}

/**
 * Own team only. Cards arrive already limited by the Api to this manager's submitted, released cards; they are filtered
 * to the managed teams again here, so a person who also holds a staff role never sees other teams' detail.
 */
function teamSection(ruleset: Ruleset, team: TeamRow, row: RankRow | undefined, cards: CardRow[], penalties: PenaltyRow[], feedback: FeedbackRow[]): HTMLElement {
  const mine = cards.filter((c) => c.teamId === team.id && c.status === 'submitted');
  const areas = ruleset.areas.filter((a) => a.kind === 'scorecard' && (mine.some((c) => c.areaId === a.id) || row?.areas[a.id] != null));
  const ownPenalties = penalties.filter((p) => p.teamId === team.id);
  return h('article', { class: 'card stack' },
    h('h3', { class: 'results-team' }, `Team ${team.number} · ${team.name}`),
    row
      ? h('p', null, `Rank ${row.rank}${row.tied ? ' (tied)' : ''}. Total ${num(row.total)} judged points`
        + (row.penalties > 0 ? `, after ${num(row.penalties)} penalty points.` : '.'))
      : h('p', { class: 'muted' }, 'Your team is not in this ranking.'),
    areas.length === 0 ? h('p', { class: 'muted' }, 'No scorecards have been submitted for your team yet.') : null,
    ...areas.map((a) => {
      const list = mine.filter((c) => c.areaId === a.id).sort((x, y) => byText(x.judgeId, y.judgeId));
      const score = row?.areas[a.id];
      return h('section', { class: 'stack' },
        h('h4', null, a.name),
        h('p', null, score === null || score === undefined ? 'Not judged yet.' : `Area score: ${num(score)} of ${a.max}`),
        ...list.map((c, i) => h('div', { class: 'stack' },
          h('p', { class: 'small muted' }, `Judge ${i + 1}`),
          h('ul', { class: 'list' }, a.criteria.map((cr) => h('li', null,
            h('strong', null, `${cr.name}: ${c.scores[cr.id] === undefined ? '—' : num(c.scores[cr.id])} / ${cr.max}`),
            c.comments[cr.id] ? h('span', { class: 'small results-comment' }, c.comments[cr.id]) : null))),
          ...feedback.filter((f) => f.cardId === c.id).flatMap((f) => [
            ['Overall Comment', f.overall], ['Key Strengths', f.strengths], ['Areas for Improvement', f.improvements],
          ].filter(([, value]) => value.trim()).map(([label, value]) => h('p', { class: 'small results-comment' }, h('strong', null, `${label}: `), value))))));
    }),
    ownPenalties.length === 0 ? null : h('section', { class: 'stack' },
      h('h4', null, 'Penalties'),
      h('ul', { class: 'list' }, ownPenalties.map((p) => h('li', null, h('strong', null, `−${num(p.points)}`), h('span', { class: 'small results-comment' }, p.reason))))));
}

export async function resultsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const signedIn = (await ctx.api.getSession()) !== null;
  // Signed out: only the public reads are made. Roles are for people who are signed in.
  const [event, latest, roles] = await Promise.all([
    ctx.api.getEvent(eventId),
    ctx.api.latestSnapshot(eventId),
    signedIn ? ctx.api.myRoles(eventId) : Promise.resolve([] as RoleRow[]),
  ]);
  if (!event) return notFound('Results have not been released yet.', signedIn ? '#/' : '#/', signedIn ? 'All events' : 'Sign in');
  const isStaff = roles.some((r) => r.role === 'organiser' || r.role === 'chair');
  const managed = [...new Set(roles.filter((r) => r.role === 'team_manager' && r.teamId).map((r) => r.teamId as string))];
  const eventHref = signedIn ? routeHref({ name: 'event', eventId }) : '#/';

  // The Api already withholds unreleased snapshots from everyone but staff; checked again so a lax backend leaks nothing.
  const snapshot = latest && (isStaff || (event.resultsReleased && latest.released)) ? latest : null;
  const publicLive = event.resultsReleased && snapshot !== null && snapshot.released;

  const head = h('div', { class: 'stack' },
    h('a', { class: 'back', href: eventHref }, signedIn ? event.name : 'Sign in'),
    event.startsOn ? h('p', { class: 'eyebrow' }, event.startsOn) : null,
    h('h1', null, `${event.name}: results`),
    isStaff && snapshot && !publicLive ? h('p', { class: 'notice', role: 'status' }, 'Not released. Only you can see this ranking.') : null);

  if (!event.resultsReleased && !isStaff) {
    return h('div', { class: 'stack stack--lg' }, head, h('p', { class: 'lead' }, 'Results have not been released yet.'));
  }
  if (!snapshot) {
    return h('div', { class: 'stack stack--lg' }, head,
      h('p', { class: 'lead' }, event.resultsReleased
        ? 'The ranking has not been published yet. Check back soon.'
        : 'Results have not been released yet.'));
  }

  const rows = snapshot.rows;
  const categories = event.ruleset.categories.filter((c) => rows.some((r) => r.categories[c.id] !== undefined));
  const fullMax = event.ruleset.areas.reduce((s, a) => s + a.max, 0);
  const anyTied = rows.some((r) => r.tied);

  const table = rows.length === 0 ? h('p', { class: 'muted' }, 'No teams are in this ranking.') : h('div', { class: 'table-wrap' },
    h('table', { class: 'table results-table' },
      h('caption', { class: 'small muted' }, 'Ranking, highest total first'),
      h('thead', null, h('tr', null, [
        h('th', { scope: 'col' }, 'Rank'), h('th', { scope: 'col' }, 'Team'),
        ...categories.map((c) => h('th', { scope: 'col', class: 'num' }, c.name)),
        h('th', { scope: 'col', class: 'num' }, 'Penalties'), h('th', { scope: 'col', class: 'num pin-end' }, 'Total'),
      ])),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, String(r.rank)),
        h('th', { scope: 'row', class: 'results-team' }, `Team ${r.number} · ${r.name}`,
          r.tied ? h('span', null, ' ', tag('Tied', 'risk')) : null,
          r.judgedComplete ? null : h('span', { class: 'small muted' }, ' (not fully judged)')),
        ...categories.map((c) => h('td', { class: 'num' }, r.categories[c.id] === undefined ? '—' : num(r.categories[c.id]))),
        h('td', { class: 'num' }, r.penalties === 0 ? '—' : `−${num(r.penalties)}`),
        h('td', { class: 'num pin-end' }, num(r.total)))))));

  let mine: HTMLElement | null = null;
  if (managed.length > 0 && event.resultsReleased && snapshot.released) {
    try {
      const [cards, penalties, teams, feedback] = await Promise.all([ctx.api.listCards(eventId), ctx.api.listPenalties(eventId), ctx.api.listTeams(eventId), ctx.api.listFeedback(eventId)]);
      const own = teams.filter((t) => managed.includes(t.id)).sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
      mine = h('section', { class: 'section stack' },
        h('h2', null, own.length > 1 ? 'Your teams' : 'Your team'),
        ...own.map((t) => teamSection(event.ruleset, t, rows.find((r) => r.teamId === t.id), cards, penalties, feedback)));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthenticated') throw e;
      console.error(e);
      mine = h('section', { class: 'section stack' }, h('h2', null, 'Your team'),
        h('p', { class: 'alert', role: 'alert' }, errorText(e)),
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.rerender() }, 'Try again'));
    }
  }

  return h('div', { class: 'stack stack--lg results' }, head,
    h('p', { class: 'notice' },
      `Judged points so far — racing and specification are not included yet. The most available so far is ${availableMax(event.ruleset, rows)} of ${fullMax} points.`),
    rows.some((r) => !r.judgedComplete)
      ? h('p', { class: 'notice' }, 'Provisional: some teams have areas that are not judged yet, so the order may still change.') : null,
    anyTied ? h('p', { class: 'notice' }, 'Tied teams share a rank: they have equal total points and an equal tie-break score.') : null,
    h('p', { class: 'muted small' }, `Ruleset: ${event.ruleset.name}. Snapshot taken ${when(snapshot.createdAt)}. Fingerprint of the scores: `,
      h('span', { class: 'results-hash' }, snapshot.inputHash), '.'),
    table, mine);
}
