import { ApiError, type CardRow } from '../api';
import { areaTotal, bandIndex, type Criterion } from '../engine';
import { reportActionError } from './actions';
import { codeText, errorText, notFound } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

export type ParsedScore = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad'; message: string };

/** ASCII digits only: Arabic-Indic and other digit scripts are rejected on purpose, so \d is not used. */
export function parseScore(input: string, max: number): ParsedScore {
  const t = input.trim();
  if (t === '') return { kind: 'empty' };
  if (!/^[0-9]+$/.test(t)) return { kind: 'bad', message: `Enter a whole number from 0 to ${max}` };
  const n = Number(t);
  if (n > max) return { kind: 'bad', message: `Scores go from 0 to ${max}` };
  return { kind: 'ok', value: n };
}

const CONFLICT_TEXT = 'You declared a conflict of interest with this team, so you cannot score it. Ask the Chair if this was a mistake.';
const RELEASED_TEXT = 'Results are released, so this scorecard cannot be changed.';
const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

export async function scorecardScreen(ctx: Ctx, eventId: string, teamId: string, areaId: string): Promise<HTMLElement> {
  const [event, teams, roles, conflictList] = await Promise.all([
    ctx.api.getEvent(eventId), ctx.api.listTeams(eventId), ctx.api.myRoles(eventId), ctx.api.myConflicts(eventId),
  ]);
  const area = event?.ruleset.areas.find((a) => a.id === areaId && a.kind === 'scorecard');
  const team = teams.find((t) => t.id === teamId);
  const back = routeHref({ name: 'score', eventId });
  if (!event || !area || !team) return notFound('That scorecard was not found.', back, 'Back to my scorecards');
  if (!roles.some((r) => r.role === 'judge' && r.panel === area.panel)) {
    return notFound('You do not judge this panel, so you cannot score this scorecard.', back, 'Back to my scorecards');
  }
  const conflicted = conflictList.includes(teamId);

  let card: CardRow;
  try {
    card = await ctx.api.openCard(eventId, teamId, areaId);
  } catch (e) {
    const message = e instanceof ApiError && e.code === 'forbidden' && conflicted ? CONFLICT_TEXT
      : e instanceof ApiError && e.code === 'locked' ? RELEASED_TEXT
      : errorText(e);
    return notFound(message, back, 'Back to my scorecards');
  }

  let alive = true;
  let locked = card.status === 'submitted' || conflicted || event.resultsReleased;
  let lockNote = card.status === 'submitted' ? 'Submitted. Only the Chair can reopen this scorecard.' : '';
  if (conflicted) lockNote = CONFLICT_TEXT;
  else if (event.resultsReleased) lockNote = card.status === 'submitted' ? `${lockNote} ${RELEASED_TEXT}` : RELEASED_TEXT;

  const values: Record<string, number> = { ...card.scores };
  const comments: Record<string, string> = { ...card.comments };
  /** Comments the judge edited here and that have not been handed to the queue yet. Only these are ever sent. */
  const dirty = new Set<string>();
  const badEntries = new Set<string>();
  for (const q of ctx.queue.pendingFor(card.id)) {
    values[q.criterionId] = q.score;
    if (q.comment !== undefined) comments[q.criterionId] = q.comment;
  }

  const status = h('p', { class: 'small', role: 'status' });
  const alertBox = h('p', { class: 'alert', role: 'alert', hidden: true });
  const notice = h('p', { class: 'notice', hidden: !locked }, lockNote);
  const missingNote = h('p', { class: 'small' });
  const total = h('strong', null);
  const submit = h('button', { class: 'btn btn--primary', type: 'button' }, 'Submit scorecard');
  const saveNow = h('button', { class: 'btn btn--ghost btn--small', type: 'button', hidden: true }, 'Try saving again');
  const submitRow = h('div', { class: 'stack' }, missingNote, submit);
  const submitHolder = h('div', null);
  const blocks: { c: Criterion; bands: HTMLElement; note: HTMLElement; input: HTMLInputElement; comment: HTMLTextAreaElement }[] = [];
  let sessionNote = false;
  let submitting = false;

  const missing = () => area.criteria.filter((c) => values[c.id] === undefined);

  const refresh = () => {
    total.textContent = `${areaTotal(area, values)} / ${area.max}`;
    for (const b of blocks) {
      const v = values[b.c.id];
      const idx = v === undefined ? -1 : bandIndex(b.c, v);
      [...b.bands.children].forEach((span, i) => span.setAttribute('aria-current', String(i === idx)));
      const band = idx >= 0 ? b.c.bands[idx] : null;
      b.note.textContent = v !== undefined && band ? `Score ${v} is in the ${band.min}–${band.max} band` : '';
    }
    notice.hidden = !locked;
    notice.textContent = lockNote;
    if (locked) submitHolder.replaceChildren(); else if (!submitHolder.firstChild) submitHolder.append(submitRow);
    for (const b of blocks) { b.input.disabled = locked; b.comment.disabled = locked; }

    const pending = ctx.queue.pendingFor(card.id).length;
    const s = ctx.queue.status();
    const stillToScore = missing();
    submit.disabled = locked || submitting || stillToScore.length > 0 || badEntries.size > 0 || pending > 0;
    missingNote.textContent = stillToScore.length > 0 ? `Still to score: ${stillToScore.map((c) => c.name).join(', ')}.`
      : pending > 0 ? `Waiting for ${changes(pending)} to save before you can submit.` : '';
    saveNow.hidden = locked || pending === 0;

    if (locked) {
      status.textContent = '';
      return;
    }
    const parts: string[] = [];
    if (sessionNote || (pending > 0 && s.signedOut)) parts.push(`${codeText('unauthenticated')}.${pending > 0 ? ` ${changes(pending)} waiting to save.` : ''}`);
    else if (pending > 0 && s.lastError?.code === 'network') parts.push(`Offline: ${changes(pending)} will save when you reconnect`);
    else if (pending > 0 && s.lastError) parts.push(`${changes(pending)} waiting to save. The server had a problem; saving will be tried again.`);
    else if (pending > 0) parts.push(`${changes(pending)} waiting to save`);
    else parts.push('All changes saved');
    if (s.persistFailed) parts.push('Scores could not be stored on this device. Keep this page open until they have been sent.');
    if (badEntries.size > 0) parts.push(`${badEntries.size === 1 ? '1 entry is' : `${badEntries.size} entries are`} not a valid score and has not been saved.`);
    status.textContent = parts.join('. ').replace(/\.\./g, '.');
  };

  const showAlert = (message: string) => { alertBox.textContent = message; alertBox.hidden = false; };

  const lock = (note: string) => { locked = true; lockNote = note; };

  const onEnqueueError = (e: unknown, c: Criterion, hadComment: boolean) => {
    if (hadComment) dirty.add(c.id);
    if (!alive) return;
    if (e instanceof ApiError && e.code === 'unauthenticated') sessionNote = true;
    else { console.error(e); showAlert(errorText(e)); }
    refresh();
  };

  const sendScore = (c: Criterion) => {
    const hadComment = dirty.has(c.id);
    const comment = hadComment ? comments[c.id] ?? '' : undefined;
    dirty.delete(c.id);
    sessionNote = false;
    ctx.enqueueScore({ cardId: card.id, criterionId: c.id, score: values[c.id], comment })
      .catch((e) => onEnqueueError(e, c, hadComment));
  };

  const criterionBlock = (c: Criterion) => {
    const input = h('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${c.name} (0 to ${c.max})`, 'aria-invalid': 'false',
      disabled: locked, value: values[c.id] === undefined ? '' : String(values[c.id]),
    });
    const err = h('p', { class: 'field__error', role: 'alert', hidden: true });
    const comment = h('textarea', { 'aria-label': `${c.name} comment`, maxlength: 1000, rows: 2, disabled: locked });
    comment.value = comments[c.id] ?? '';
    const bands = h('div', { class: 'bands' }, c.bands.map((b) => h('span', { 'aria-current': 'false' }, `${b.min}–${b.max}`)));
    const note = h('p', { class: 'small' });
    const hint = h('p', { class: 'small muted', hidden: true }, 'A saved score cannot be removed. Enter a new score to change it.');
    blocks.push({ c, bands, note, input, comment });

    input.addEventListener('input', () => {
      if (locked) return;
      const p = parseScore(input.value, c.max);
      err.hidden = p.kind !== 'bad';
      err.textContent = p.kind === 'bad' ? p.message : '';
      input.setAttribute('aria-invalid', String(p.kind === 'bad'));
      hint.hidden = p.kind !== 'empty' || card.scores[c.id] === undefined;
      if (p.kind === 'bad') badEntries.add(c.id); else badEntries.delete(c.id);
      if (p.kind === 'ok') {
        values[c.id] = p.value;
        sendScore(c);
      } else {
        delete values[c.id];
      }
      refresh();
    });
    comment.addEventListener('input', () => {
      if (locked) return;
      comments[c.id] = comment.value;
      dirty.add(c.id);
      if (values[c.id] !== undefined && !badEntries.has(c.id)) sendScore(c);
      refresh();
    });

    return h('section', { class: 'row' },
      h('div', { class: 'row__head' }, h('h3', null, c.name), h('span', { class: 'small muted' }, `0 to ${c.max}`)),
      bands,
      note,
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Score'), input),
      err,
      hint,
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Comment (optional)'), comment),
    );
  };

  const droppedText = (item: { at: number; cardId: string; criterionId: string }): { text: string; lock: string | null } => {
    const entry = ctx.queue.rejected().find((r) => r.item.at === item.at && r.item.cardId === item.cardId && r.item.criterionId === item.criterionId);
    switch (entry?.code) {
      case 'locked':
        return {
          text: 'This scorecard was submitted or reopened elsewhere, or results have been released, so your latest change was not saved. The scores you typed are still shown here.',
          lock: 'This scorecard can no longer be changed here. Go back and open it again to see its current state.',
        };
      case 'forbidden':
        return { text: 'You can no longer score this team, so your latest change was not saved. The scores you typed are still shown here.', lock: 'You can no longer score this team.' };
      case 'not-found':
        return { text: 'This scorecard no longer exists, so your latest change was not saved.', lock: 'This scorecard no longer exists.' };
      case 'invalid':
        return { text: 'A score or comment was not valid, so your latest change was not saved. Check it and try again.', lock: null };
      default:
        return { text: 'A change could not be saved after several attempts. It is kept on this device and listed at the top of the page with a Try again button.', lock: null };
    }
  };

  const unsubscribe = ctx.queue.subscribe((e) => {
    if (!alive) return;
    if (e.kind === 'dropped') {
      if (e.item.cardId !== card.id) return;
      const d = droppedText(e.item);
      showAlert(d.text);
      if (d.lock) lock(d.lock);
    } else if (e.kind === 'saved') {
      sessionNote = false;
    }
    refresh();
  });
  ctx.onLeave(() => { alive = false; unsubscribe(); });

  saveNow.addEventListener('click', () => {
    const first = ctx.queue.pendingFor(card.id)[0];
    if (!first) return;
    // Re-recording the first waiting change makes the host send the whole queue again, with exactly the same values.
    ctx.enqueueScore({ cardId: first.cardId, criterionId: first.criterionId, score: first.score, comment: first.comment })
      .catch((e) => { if (alive) reportActionError(ctx, alertBox, e); });
  });

  submit.addEventListener('click', async () => {
    // Validate before going busy.
    alertBox.hidden = true;
    const stillToScore = missing();
    if (locked || submitting) return;
    if (stillToScore.length > 0 || badEntries.size > 0) {
      showAlert(`Not submitted. ${stillToScore.length > 0 ? `Still to score: ${stillToScore.map((c) => c.name).join(', ')}.` : 'Fix the scores marked as not valid.'}`);
      blocks.find((b) => stillToScore.includes(b.c) || badEntries.has(b.c.id))?.input.focus();
      return;
    }
    if (ctx.queue.pendingFor(card.id).length > 0) {
      showAlert('Some scores have not reached the server yet. Wait for a connection, then submit.');
      return;
    }
    submitting = true;
    refresh();
    try {
      await ctx.api.submitCard(card.id);
      if (!alive) return;
      lock('Submitted. Only the Chair can reopen this scorecard.');
      card.status = 'submitted';
      ctx.rerender();
    } catch (e) {
      if (!alive) return;
      if (e instanceof ApiError && e.code === 'unauthenticated') {
        sessionNote = true;
      } else if (e instanceof ApiError && e.code === 'invalid') {
        const list = missing();
        showAlert(`Not submitted. ${list.length > 0 ? `Still to score: ${list.map((c) => c.name).join(', ')}.` : 'Check every score is a whole number in range, then try again.'}`);
        blocks.find((b) => list.includes(b.c))?.input.focus();
      } else if (e instanceof ApiError && e.code === 'locked') {
        showAlert('This scorecard was already submitted, or results are released, so it was not submitted again.');
        lock('This scorecard can no longer be changed here. Go back and open it again to see its current state.');
      } else {
        console.error(e);
        showAlert(errorText(e));
      }
    } finally {
      submitting = false;
      if (alive) refresh();
    }
  });

  const screen = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: back }, 'My scorecards'),
      h('p', { class: 'eyebrow' }, event.name),
      h('h1', null, area.name),
      h('p', { class: 'lead' }, `Team ${team.number} · ${team.name}`),
      notice,
    ),
    alertBox,
    ...area.criteria.map(criterionBlock),
    h('div', { class: 'stack' }, h('p', null, 'Total: ', total), status, saveNow, submitHolder),
  );
  refresh();
  return screen;
}
