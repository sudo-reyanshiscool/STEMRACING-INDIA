import { ApiError, type CardRow, type EventRow, type OverrideRow, type PenaltyRow, type RoleRow, type SnapshotRow, type TeamRow } from '../api';
import { canonicalJson, rank, RankingInputError, sha256Hex, validateScores, type RankInputs, type Ranking, type Ruleset } from '../engine';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const RELEASED_LOCK = 'Results are released. Withdraw the release to change this.';
const SAVED_NOT_SHOWN = 'Your change was saved, but this screen could not be refreshed. Reload the page to see it.';
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const parseNumber = (raw: string): number | null => (/^-?[0-9]+([.,][0-9]+)?$/.test(raw) ? Number(raw.replace(',', '.')) : null);
const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) <= 1e-9;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/** Exactly what rank() receives and what a snapshot stores: submitted cards only, no comments, in a fixed order. */
type Inputs = Omit<RankInputs, 'ruleset' | 'derived'>;

function buildInputs(teams: TeamRow[], cards: CardRow[], overrides: OverrideRow[], penalties: PenaltyRow[]): Inputs {
  return {
    teams: [...teams].sort((a, b) => natural(a.number, b.number) || byText(a.id, b.id)).map((t) => ({ id: t.id, number: t.number, name: t.name })),
    cards: cards.filter((c) => c.status === 'submitted')
      .map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: { ...c.scores } }))
      .sort((a, b) => byText(a.teamId, b.teamId) || byText(a.areaId, b.areaId) || byText(a.judgeId, b.judgeId)),
    overrides: overrides.map((o) => ({ teamId: o.teamId, areaId: o.areaId, value: o.value }))
      .sort((a, b) => byText(a.teamId, b.teamId) || byText(a.areaId, b.areaId)),
    penalties: penalties.map((p) => ({ teamId: p.teamId, points: p.points }))
      .sort((a, b) => byText(a.teamId, b.teamId) || a.points - b.points),
  };
}

/** Plain-language list of what stops the engine from ranking, with names instead of ids. Empty when nothing is found. */
function diagnose(ruleset: Ruleset, inputs: Inputs, teams: TeamRow[], roles: RoleRow[]): string[] {
  const out: string[] = [];
  const team = (id: string) => { const t = teams.find((x) => x.id === id); return t ? `Team ${t.number} · ${t.name}` : 'a team that is no longer in this event'; };
  const judge = (id: string) => roles.find((r) => r.userId === id && r.email)?.email ?? 'a judge';
  const area = (id: string) => ruleset.areas.find((a) => a.id === id);
  const seen = new Set<string>();
  for (const c of inputs.cards) {
    const a = area(c.areaId);
    if (!a || a.kind !== 'scorecard') { out.push(`A scorecard for ${team(c.teamId)} is for an area that is not scored on a scorecard.`); continue; }
    const problems = validateScores(a, c.scores, { complete: true });
    if (problems.length > 0) out.push(`${judge(c.judgeId)}'s submitted scorecard for ${team(c.teamId)}, ${a.name}, has a score that is missing or not allowed. Reopen it from Moderation so the judge can correct it.`);
    const key = `${c.teamId}|${c.areaId}|${c.judgeId}`;
    if (seen.has(key)) out.push(`${judge(c.judgeId)} has more than one submitted scorecard for ${team(c.teamId)}, ${a.name}. Only one may be counted.`);
    seen.add(key);
  }
  const ovSeen = new Set<string>();
  for (const o of inputs.overrides) {
    const a = area(o.areaId);
    if (!a || a.kind !== 'scorecard') { out.push(`There is an override for ${team(o.teamId)} on an area that cannot be overridden.`); continue; }
    if (!Number.isFinite(o.value) || o.value < 0 || o.value > a.max) out.push(`The override for ${team(o.teamId)}, ${a.name}, is not between 0 and ${a.max}. Set it again from Moderation.`);
    else if (!oneDecimal(o.value)) out.push(`The override for ${team(o.teamId)}, ${a.name}, has more than one decimal place. Set it again from Moderation.`);
    const key = `${o.teamId}|${o.areaId}`;
    if (ovSeen.has(key)) out.push(`${team(o.teamId)} has two overrides for ${a.name}. Only one may be used.`);
    ovSeen.add(key);
  }
  for (const p of inputs.penalties) {
    if (!Number.isFinite(p.points) || p.points < 0) out.push(`A penalty for ${team(p.teamId)} is not a valid number of points.`);
  }
  return out;
}

/** `hash` is filled in a moment after the ranking so that a redraw never waits on the browser's digest call. */
type Outcome = { ok: true; ranking: Ranking; hash: string | null } | { ok: false; problems: string[] };
interface Computed {
  event: EventRow;
  teams: TeamRow[];
  penalties: PenaltyRow[];
  /** Submitted-or-not: cards still in draft, which the ranking never counts. */
  drafts: number;
  /** Submitted cards, counted in the ranking, whose judge declared a conflict with that team. */
  conflictCards: number;
  inputs: Inputs;
  latest: SnapshotRow | null;
  outcome: Outcome;
}

export async function rankingsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [first, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!first) return notFound('That event was not found.', '#/', 'All events');
  const eventHref = routeHref({ name: 'event', eventId });
  const isChair = roles.some((r) => r.role === 'chair');
  if (!isChair && !roles.some((r) => r.role === 'organiser')) return notFound('Only the organiser or chair can see the ranking.', eventHref, first.name);

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const holder = h('div', { class: 'stack stack--lg' });
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  let busy = false;
  let seq = 0;
  /** Hash of the ranking currently on screen: publishing refuses to go ahead if the data has moved on since. */
  let shownHash: string | null = null;
  /** The draft/tie situation the Chair has acknowledged, as a key. Only valid while the situation stays the same. */
  let ackedKey: string | null = null;
  /** The remove button waiting for its confirming second click. */
  let armed: { id: string; button: HTMLButtonElement } | null = null;

  const say = (text: string) => { notice.textContent = text; notice.hidden = false; };
  const clear = () => { notice.hidden = true; error.hidden = true; };

  const compute = async (): Promise<Computed | null> => {
    const [event, teams, cards, overrides, penalties, allRoles, latest, conflicts] = await Promise.all([
      ctx.api.getEvent(eventId), ctx.api.listTeams(eventId), ctx.api.listCards(eventId), ctx.api.listOverrides(eventId),
      ctx.api.listPenalties(eventId), ctx.api.listRoles(eventId), ctx.api.latestSnapshot(eventId), ctx.api.listConflicts(eventId),
    ]);
    if (!event) return null;
    const inputs = buildInputs(teams, cards, overrides, penalties);
    let outcome: Outcome;
    try {
      outcome = { ok: true, ranking: rank({ ruleset: event.ruleset, ...inputs }), hash: null };
    } catch (e) {
      if (!(e instanceof RankingInputError)) console.error(e);
      const found = diagnose(event.ruleset, inputs, teams, allRoles);
      outcome = {
        ok: false,
        problems: found.length > 0 ? found
          : ['Some scorecards, overrides or penalties do not fit the scoring rules. Review the scorecards and overrides in Moderation.'],
      };
    }
    const conflictCards = cards.filter((c) => c.status === 'submitted'
      && conflicts.some((x) => x.judgeId === c.judgeId && x.teamId === c.teamId)).length;
    return { event, teams, penalties, drafts: cards.filter((c) => c.status === 'draft').length, conflictCards, inputs, latest, outcome };
  };

  /**
   * SHA-256 of {rulesetId, inputs, rows}: the same bytes the snapshot is published with. Failing to hash counts as
   * an unrankable input, so the Chair sees a message rather than a half-drawn screen.
   */
  const settleHash = async (c: Computed): Promise<void> => {
    const o = c.outcome;
    if (!o.ok || o.hash !== null) return;
    try {
      o.hash = await sha256Hex(canonicalJson({ rulesetId: c.event.ruleset.id, inputs: c.inputs, rows: o.ranking.rows }));
    } catch (e) {
      console.error(e);
      c.outcome = { ok: false, problems: ['The fingerprint of the ranking could not be calculated. Reload the page and try again.'] };
    }
  };

  const draw = (c: Computed) => {
    const { event, teams, penalties, inputs, latest } = c;
    const outcome = c.outcome;
    drawn = c;
    armed = null;
    const released = event.resultsReleased;
    const team = (id: string) => teams.find((t) => t.id === id);
    const label = (id: string) => { const t = team(id); return t ? `Team ${t.number} · ${t.name}` : 'Unknown team'; };
    const pubSlot = h('p', { class: 'small' });
    const fpSlot = h('p', { class: 'small muted' });
    const controlsSlot = h('div', { class: 'stack' });
    const parts: Array<HTMLElement | null> = [];

    if (released) {
      parts.push(h('div', { class: 'notice stack' },
        h('p', null, tag('Results are released', 'pass')),
        h('p', null, 'Results are released. Teams and the public can see the latest published ranking. Overrides, penalties and reopening scorecards are locked. Withdraw the release to change this.')));
    }

    if (!outcome.ok) {
      parts.push(h('div', { class: 'alert stack', role: 'alert' },
        h('p', null, h('strong', null, 'The ranking cannot be calculated yet.')),
        h('ul', null, outcome.problems.map((p) => h('li', null, p))),
        h('p', null, isChair
          ? 'Fix these in Moderation, then come back. Nothing can be published or released until the ranking can be calculated.'
          : 'Ask the Chair to fix these. Nothing can be published or released until the ranking can be calculated.'),
        isChair ? h('a', { class: 'back', href: routeHref({ name: 'moderate', eventId }) }, 'Open Moderation') : null));
    } else {
      const { ranking } = outcome;
      const categories = event.ruleset.categories.filter((cat) => ranking.rows.some((r) => r.categories[cat.id] !== undefined));
      const fullMax = event.ruleset.areas.reduce((s, a) => s + a.max, 0);
      const tieArea = event.ruleset.areas.find((a) => a.id === event.ruleset.tieBreakAreaId)?.name ?? 'tie-break';
      const top = ranking.rows.length > 0 ? ranking.rows[0].total : 0;
      const cardCount = inputs.cards.length;

      if (ranking.provisional) {
        parts.push(h('p', { class: 'notice' }, 'Provisional: some teams have areas that are not judged yet, so rankings will change as scores arrive.'));
      }
      if (ranking.ties.length > 0) {
        parts.push(h('p', { class: 'notice' },
          `Tie: ${ranking.ties.map((g) => g.map((id) => label(id)).join(' and ')).join('; ')}. Equal total points and equal ${tieArea} score, so it is for the Chair to decide.`));
      }
      parts.push(h('p', { class: 'muted' },
        `Judged points so far: the leading team has ${Math.round(top * 10) / 10} of ${ranking.maxAvailable} available (${fullMax} once racing and specification are added). `
        + `Ranked from ${cardCount} submitted scorecard${cardCount === 1 ? '' : 's'}; drafts are never counted.`));

      parts.push(ranking.rows.length === 0 ? h('p', { class: 'muted' }, 'No teams yet.') : h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'small muted' }, 'Ranking, highest total first'),
        h('thead', null, h('tr', null, [
          h('th', { scope: 'col' }, 'Rank'), h('th', { scope: 'col' }, 'Team'),
          ...categories.map((cat) => h('th', { scope: 'col', class: 'num' }, cat.name)),
          h('th', { scope: 'col', class: 'num' }, 'Penalties'), h('th', { scope: 'col', class: 'num pin-end' }, 'Total'),
        ])),
        h('tbody', null, ranking.rows.map((r) => h('tr', null,
          h('td', null, String(r.rank)),
          h('th', { scope: 'row' }, `Team ${r.number} · ${r.name}`,
            r.tied ? h('span', null, ' ', tag('Tie', 'risk')) : null,
            r.judgedComplete ? null : h('span', { class: 'small muted' }, ' (not fully judged)')),
          ...categories.map((cat) => h('td', { class: 'num' }, r.categories[cat.id] === undefined ? '—' : String(r.categories[cat.id]))),
          h('td', { class: 'num' }, r.penalties === 0 ? '—' : `−${r.penalties}`),
          h('td', { class: 'num pin-end' }, String(r.total))))))));

      parts.push(pubSlot, fpSlot);
    }

    if (penalties.length > 0) {
      parts.push(h('section', { class: 'section' }, h('h2', null, 'Penalties'),
        h('ul', { class: 'list' }, penalties.map((p) => h('li', null,
          h('strong', null, `${label(p.teamId)}: −${p.points}`), h('span', { class: 'small' }, p.reason),
          isChair && !released ? removeButton(p, label(p.teamId)) : null))),
        isChair && released ? h('p', { class: 'small muted' }, 'Penalties are locked while results are released. Withdraw the release to change this.') : null));
    }

    if (isChair) {
      parts.push(h('section', { class: 'section' }, h('h2', null, 'Protest penalty'), penaltySection(c)));
      parts.push(h('section', { class: 'section' }, h('h2', null, 'Publish and release'), controlsSlot));
    }
    holder.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));

    /** The parts that depend on the fingerprint: filled now as "checking", and again once the digest is known. */
    const fill = () => {
      const o = c.outcome;
      const hash = o.ok ? o.hash : null;
      shownHash = hash;
      if (o.ok) {
        const stale = latest !== null && hash !== null && latest.inputHash !== hash;
        pubSlot.textContent = latest === null ? 'No ranking has been published yet.'
          : hash === null ? `Published ranking from ${when(latest.createdAt)}: checking whether it matches the ranking above.`
          : stale ? `Published ranking from ${when(latest.createdAt)}: it is out of date because scores, overrides or penalties have changed since. Publish the ranking again.`
          : `Published ranking from ${when(latest.createdAt)}: it matches the ranking above.`;
        fpSlot.replaceChildren('Input fingerprint (SHA-256): ', h('code', null, hash ?? 'calculating'));
      }
      controlsSlot.replaceChildren(...(isChair ? [publishSection(c)] : []));
    };
    fill();
    if (c.outcome.ok && c.outcome.hash === null) {
      void settleHash(c).then(() => {
        if (!alive || drawn !== c) return;
        if (c.outcome.ok) fill(); else draw(c); // hashing failed: the screen now shows that as a problem
      });
    }
  };
  let drawn: Computed | null = null;

  const refresh = async () => {
    const mine = ++seq;
    const c = await compute();
    if (!alive || mine !== seq || !c) return;
    draw(c);
  };

  /** One write at a time. The write's own failure and a failed redraw afterwards are told apart. */
  const act = async (button: HTMLButtonElement, work: () => Promise<void>, done: string | null, redraw = true, lockedText = RELEASED_LOCK) => {
    busy = true;
    button.disabled = true;
    try {
      try {
        await work();
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.code === 'locked') await refresh().catch(() => undefined);
        reportActionError(ctx, error, err, { locked: lockedText });
        return;
      }
      if (redraw) {
        try {
          await refresh();
        } catch (err) {
          console.error(err);
          if (alive) { error.textContent = SAVED_NOT_SHOWN; error.hidden = false; }
          return;
        }
      }
      if (alive && done) say(done);
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  const removeButton = (p: PenaltyRow, teamLabel: string) => {
    const btn = h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Remove the penalty of ${p.points} points from ${teamLabel}: ${p.reason}` }, 'Remove penalty');
    btn.addEventListener('click', () => {
      if (busy) return;
      clear();
      if (!armed || armed.id !== p.id) {
        if (armed) armed.button.textContent = 'Remove penalty';
        armed = { id: p.id, button: btn };
        btn.textContent = 'Confirm: remove this penalty';
        return;
      }
      armed = null;
      void act(btn, () => ctx.api.removePenalty(p.id), `Penalty removed from ${teamLabel}: ${p.reason}.`);
    });
    return btn;
  };

  const penaltySection = (c: Computed): HTMLElement => {
    const { event, teams } = c;
    if (event.resultsReleased) return h('p', { class: 'muted' }, 'Penalties are locked while results are released. Withdraw the release to change this.');
    if (teams.length === 0) return h('p', { class: 'muted' }, 'Add teams before adding a penalty.');
    const preset = event.ruleset.protestPenalty;
    const sorted = [...teams].sort((a, b) => natural(a.number, b.number));
    const teamSel = h('select', { name: 'team' }, sorted.map((t) => h('option', { value: t.id }, `Team ${t.number} · ${t.name}`)));
    const points = h('input', { name: 'points', inputmode: 'decimal', autocomplete: 'off', value: String(preset) });
    const reason = h('input', { name: 'reason', autocomplete: 'off', maxlength: 500 });
    const presetBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, `Use the protest penalty (${preset} points)`);
    presetBtn.addEventListener('click', () => { points.value = String(preset); });
    const submit = h('button', { class: 'btn btn--ghost btn--small', type: 'submit' }, 'Add penalty');
    const form = h('form', { class: 'inline-form', 'data-penalty': '', novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), teamSel),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Points'), points),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Reason (required, for example an unsuccessful protest)'), reason),
      presetBtn, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      clear();
      const n = parseNumber(points.value.trim());
      const why = reason.value.trim();
      const problem = !teamSel.value ? 'Choose a team.'
        : n === null ? 'Enter the penalty as a number of points, for example 15.'
        : n <= 0 || n > 100 ? 'A penalty must be above 0 and at most 100 points.'
        : !oneDecimal(n) ? 'A penalty can have at most one decimal place.'
        : why.length < 3 ? 'Give a reason of at least 3 characters.'
        : null;
      if (problem !== null || n === null) {
        error.textContent = problem ?? '';
        error.hidden = false;
        return;
      }
      const teamId = teamSel.value;
      const t = teams.find((x) => x.id === teamId);
      void act(submit, () => ctx.api.addPenalty(eventId, teamId, n, why), `Penalty of ${n} added to Team ${t?.number ?? ''}.`);
    });
    return form;
  };

  const needsAck = (c: Computed) => c.drafts > 0 || c.conflictCards > 0 || (c.outcome.ok && c.outcome.ranking.ties.length > 0);
  const ackKey = (c: Computed) => `${c.drafts}|${c.outcome.ok ? c.outcome.ranking.ties.length : 0}|${c.conflictCards}`;
  const ackLabel = (c: Computed) => {
    const ties = c.outcome.ok ? c.outcome.ranking.ties.length : 0;
    const parts = [
      c.drafts > 0 ? `${c.drafts} card${c.drafts === 1 ? '' : 's'} still in draft` : null,
      ties > 0 ? `${ties} tie${ties === 1 ? '' : 's'} not settled` : null,
      c.conflictCards > 0 ? `${c.conflictCards} counted card${c.conflictCards === 1 ? '' : 's'} from a judge who declared a conflict` : null,
    ].filter(Boolean);
    return `Publish with ${parts.join(' and ')}`;
  };

  const ackBox = (c: Computed) => {
    const box = h('input', { type: 'checkbox', name: 'ack' });
    box.checked = ackedKey === ackKey(c);
    box.addEventListener('change', () => { ackedKey = box.checked ? ackKey(c) : null; });
    return h('label', { class: 'field' }, box, ' ', ackLabel(c), h('span', { class: 'small muted' }, ' This also covers releasing.'));
  };

  const publishSection = (c: Computed): HTMLElement => {
    const { event, latest, outcome, teams } = c;
    const released = event.resultsReleased;
    const publish = h('button', { class: 'btn btn--primary', type: 'button' }, 'Publish ranking');
    const release = h('button', { class: 'btn btn--ghost', type: 'button' }, released ? 'Withdraw released results' : 'Release results to teams and the public');
    const hash = outcome.ok ? outcome.hash : null;
    const current = hash !== null && latest !== null && latest.inputHash === hash;
    let why: string | null = null;
    if (released) why = null;
    else if (!outcome.ok) why = 'Fix the ranking problems above before publishing or releasing.';
    else if (teams.length === 0) why = 'Add teams before publishing a ranking.';
    else if (hash === null) why = 'Calculating the ranking fingerprint. This takes a moment.';
    publish.disabled = released || why !== null;
    const releaseWhy = released ? null
      : why ?? (latest === null ? 'Publish the ranking before releasing it, so teams and the public see exactly this ranking.'
        : !current ? 'The published ranking is out of date. Publish it again before releasing.' : null);
    release.disabled = releaseWhy !== null;

    /** Validated before anything is disabled or sent: unacknowledged drafts or ties stop the click with an explanation. */
    const ackMissing = () => {
      if (!needsAck(c) || ackedKey === ackKey(c)) return false;
      error.textContent = `Tick "${ackLabel(c)}" to continue. Drafts are not counted, and tied teams still need the Chair's decision.`;
      error.hidden = false;
      return true;
    };
    const ackChanged = (fresh: Computed) => {
      if (!needsAck(fresh) || ackedKey === ackKey(fresh)) return false;
      draw(fresh);
      say('The number of draft cards, ties or conflicted cards changed since you last looked. Check the summary, tick the box again, then continue.');
      return true;
    };

    publish.addEventListener('click', () => {
      if (busy) return;
      clear();
      if (ackMissing()) return;
      void act(publish, async () => {
        const fresh = await compute();
        if (fresh) await settleHash(fresh);
        if (!alive || !fresh) return;
        if (fresh.event.resultsReleased) { draw(fresh); say('Results were released in the meantime, so nothing was published. Withdraw the release first.'); return; }
        if (!fresh.outcome.ok || fresh.outcome.hash === null) { draw(fresh); return; }
        if (ackChanged(fresh)) return;
        if (fresh.outcome.hash !== shownHash) {
          draw(fresh);
          say('Scores, overrides or penalties changed since you last looked. The ranking above has been refreshed. Check it, then publish again.');
          return;
        }
        const snap = await ctx.api.publishSnapshot(eventId, {
          rulesetId: fresh.event.ruleset.id, inputHash: fresh.outcome.hash, inputs: fresh.inputs, rows: fresh.outcome.ranking.rows,
        });
        await refresh();
        say(`Published ranking saved at ${when(snap.createdAt)}. Fingerprint ${snap.inputHash.slice(0, 12)}. Publishing again after changes creates a new snapshot; earlier ones are kept.`);
      }, null, false);
    });

    release.addEventListener('click', () => {
      if (busy) return;
      clear();
      if (!released && ackMissing()) return;
      void act(release, async () => {
        if (released) {
          await ctx.api.setReleased(eventId, false);
          await refresh();
          say('Results are no longer released. Overrides, penalties and reopening are unlocked.');
          return;
        }
        const fresh = await compute();
        if (fresh) await settleHash(fresh);
        if (!alive || !fresh) return;
        if (ackChanged(fresh)) return;
        if (!fresh.outcome.ok || fresh.latest === null || fresh.latest.inputHash !== fresh.outcome.hash) {
          draw(fresh);
          say('The published ranking no longer matches the current scores, so nothing was released. Publish the ranking again first.');
          return;
        }
        await ctx.api.setReleased(eventId, true);
        await refresh();
        say('Results are released. Teams and the public can now see the published ranking.');
      }, null, false, 'The server says the published ranking is out of date, so nothing was released. The screen has been refreshed: check it, publish the ranking again, then release.');
    });

    return h('div', { class: 'stack' },
      h('p', null, released ? 'Results are released.' : 'Results are hidden from teams and the public until you release them.'),
      outcome.ok && outcome.ranking.provisional && !released
        ? h('p', { class: 'small' }, 'This ranking is provisional: releasing it shows results while some areas are still not judged.') : null,
      !released && c.drafts > 0 ? h('p', { class: 'notice' }, `${c.drafts} scorecard${c.drafts === 1 ? ' is still a draft and is' : 's are still drafts and are'} not counted in this ranking.`) : null,
      !released && c.conflictCards > 0 ? h('p', { class: 'notice' }, `${c.conflictCards} counted card${c.conflictCards === 1 ? ' belongs' : 's belong'} to a judge who declared a conflict of interest with that team. Reopen ${c.conflictCards === 1 ? 'it' : 'them'} in Moderation to leave ${c.conflictCards === 1 ? 'it' : 'them'} out, or tick the box below to publish with ${c.conflictCards === 1 ? 'it' : 'them'} counted.`) : null,
      !released && outcome.ok && outcome.ranking.ties.length > 0 ? h('p', { class: 'notice' }, 'Settle ties before releasing: the tied teams are listed above and the ranking does not decide between them.') : null,
      !released && needsAck(c) ? ackBox(c) : null,
      released ? h('p', { class: 'small' }, 'Publishing is paused while results are released. Withdraw the release to publish again.') : null,
      why !== null ? h('p', { class: 'small' }, why) : null,
      releaseWhy !== null && releaseWhy !== why ? h('p', { class: 'small' }, releaseWhy) : null,
      h('div', { class: 'actions' }, publish, release));
  };

  const initial = await compute();
  if (!initial) return notFound('That event was not found.', '#/', 'All events');
  await settleHash(initial); // the first paint already has its fingerprint
  draw(initial);

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: eventHref }, first.name), h('h1', null, 'Rankings'),
      h('p', { class: 'lead' }, 'Totals from submitted scorecards, Chair overrides and protest penalties. Specification and racing points join in later phases.')),
    error, notice, holder,
  );
}
