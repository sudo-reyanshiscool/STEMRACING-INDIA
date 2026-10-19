import { ApiError, type CardRow } from '../api';
import { areaTotal, bandIndex, type Criterion } from '../engine';
import { reportActionError } from './actions';
import { codeText, errorText, notFound, rejectedText } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { BAND_LABELS, NOMINATION_AWARDS } from '../rulesets/rubrics';
import { ReviewDraft } from './review-draft';

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

  const [savedReview, session] = await Promise.all([ctx.api.getReview(card.id), ctx.api.getSession()]);
  if (!session) return notFound('Sign in to open your scorecard.', back, 'Back to my scorecards');
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
  // Waiting changes are laid over a card that can still be edited. A locked card shows the server's values only:
  // anything still waiting for it is listed as not saved instead (see refresh).
  if (!locked) {
    for (const q of ctx.queue.pendingFor(card.id)) {
      values[q.criterionId] = q.score;
      if (q.comment !== undefined) comments[q.criterionId] = q.comment;
    }
  }
  /** Criteria this page has handed to the queue, so a cleared box still explains that a value is held. */
  const sent = new Set<string>();

  const status = h('p', { class: 'small', role: 'status' });
  const alertBox = h('p', { class: 'alert', role: 'alert', hidden: true });
  const rejectedMsg = h('p', null);
  const dismissRejected = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Dismiss');
  const rejectedBox = h('div', { class: 'alert stack', role: 'alert', hidden: true }, rejectedMsg, dismissRejected);
  const notice = h('p', { class: 'notice', hidden: !locked }, lockNote);
  const missingNote = h('p', { class: 'small' });
  const total = h('strong', null);
  const submit = h('button', { class: 'btn btn--primary', type: 'button' }, 'Submit scorecard');
  const saveNow = h('button', { class: 'btn btn--ghost btn--small', type: 'button', hidden: true }, 'Try saving again');
  const submitRow = h('div', { class: 'stack' }, missingNote, submit);
  const submitHolder = h('div', null);
  const blocks: { c: Criterion; bands: HTMLElement; note: HTMLElement; hint: HTMLElement; input: HTMLInputElement; comment: HTMLTextAreaElement }[] = [];
  let reviewed = false;
  const check = h('button', { class: 'btn btn--primary', type: 'button' }, 'Check card');
  const reviewSummary = h('section', { class: 'card stack score-review', hidden: true, tabindex: -1, 'aria-label': 'Scorecard review' });
  const reviewStatus = h('p', { class: 'small', 'aria-live': 'polite' });
  const retryReview = h('button', { class: 'btn btn--ghost btn--small', type: 'button', hidden: true }, 'Save notes and feedback again');
  const reviewFields: Array<HTMLTextAreaElement | HTMLInputElement> = [];
  const scoreButtons = new Map<string, HTMLButtonElement[]>();
  const review = new ReviewDraft(ctx.api, session.userId, card.id, card.reopenedCount, savedReview, area, ctx.demo,
    () => { if (alive) refresh(); }, !locked);
  const invalidate = () => { reviewed = false; reviewSummary.hidden = true; };
  let sessionNote = false;
  let submitting = false;

  const missing = () => area.criteria.filter((c) => values[c.id] === undefined);

  const refresh = () => {
    submit.hidden = !reviewed;
    check.hidden = locked;
    check.disabled = submitting;
    for (const field of reviewFields) field.disabled = locked || submitting;
    for (const [id, buttons] of scoreButtons) for (const button of buttons) {
      button.disabled = locked || submitting;
      button.setAttribute('aria-pressed', String(values[id] === Number(button.value)));
    }
    for (const b of blocks) {
      const selected = bandIndex(b.c, values[b.c.id]);
      b.bands.parentElement?.querySelectorAll('.rubric-band').forEach((band, i) => band.setAttribute('data-selected', String(i === selected)));
    }
    reviewStatus.textContent = review.pending
      ? review.error ? `Notes and feedback have not saved. ${errorText(review.error)}${!ctx.demo && !review.storageFailed ? ' A draft is saved on this device.' : ''}`
        : review.saving ? 'Saving notes and feedback…' : 'Notes and feedback waiting to save'
      : 'Notes and feedback saved';
    if (review.pending && review.storageFailed) reviewStatus.textContent += '. This browser cannot keep a draft. Keep this page open until saving succeeds.';
    retryReview.hidden = locked || !review.pending || review.saving;
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
    for (const b of blocks) {
      b.input.disabled = locked || submitting;
      b.comment.disabled = locked || submitting;
    }

    const waiting = ctx.queue.pendingFor(card.id);
    const pending = waiting.length;
    const s = ctx.queue.status();
    const rejectedHere = ctx.queue.rejected().filter((r) => r.item.cardId === card.id);
    const nameOf = (id: string) => area.criteria.find((c) => c.id === id)?.name ?? id;
    for (const b of blocks) {
      const empty = b.input.value.trim() === '';
      const held = card.scores[b.c.id] !== undefined || sent.has(b.c.id) || waiting.some((q) => q.criterionId === b.c.id);
      b.hint.hidden = !(empty && held);
    }
    const stillToScore = missing();
    submit.disabled = locked || submitting || stillToScore.length > 0 || badEntries.size > 0 || pending > 0 || rejectedHere.length > 0;
    missingNote.textContent = stillToScore.length > 0 ? `Still to score: ${stillToScore.map((c) => c.name).join(', ')}.`
      : pending > 0 ? `Waiting for ${changes(pending)} to save before you can submit.`
      : rejectedHere.length > 0 ? 'Enter the scores that were not saved again before you submit.' : '';
    saveNow.hidden = locked || pending === 0;

    const notSaved = rejectedHere.map((r) => `${nameOf(r.item.criterionId)} (you entered ${r.item.score})`);
    const codes = [...new Set(rejectedHere.map((r) => r.code))];
    rejectedBox.hidden = rejectedHere.length === 0;
    const again = locked ? '' : ` Enter ${rejectedHere.length === 1 ? 'it' : 'them'} again to save.`;
    rejectedMsg.textContent = rejectedHere.length === 0 ? '' : `${codes.map(rejectedText).join(' ')} Not saved: ${notSaved.join(', ')}.${again}`;

    if (locked) {
      status.textContent = pending > 0
        ? `Not saved: ${[...new Set(waiting.map((q) => nameOf(q.criterionId)))].join(', ')}. ${changes(pending)} waiting on this device cannot be applied to a locked scorecard.`
        : '';
      return;
    }
    const parts: string[] = [];
    if (sessionNote || (pending > 0 && s.signedOut)) parts.push(`${codeText('unauthenticated')}.${pending > 0 ? ` ${changes(pending)} waiting to save.` : ''}`);
    else if (pending > 0 && s.lastError?.code === 'network') parts.push(`Offline: ${changes(pending)} will save when you reconnect`);
    else if (pending > 0 && s.lastError) parts.push(`${changes(pending)} waiting to save. The server had a problem; saving will be tried again.`);
    else if (pending > 0) parts.push(`${changes(pending)} waiting to save`);
    else if (rejectedHere.length === 0) parts.push(review.pending ? 'Scores saved' : 'All changes saved');
    if (rejectedHere.length > 0) parts.push(`Not saved: ${notSaved.join(', ')}. Enter ${rejectedHere.length === 1 ? 'it' : 'them'} again`);
    if (s.persistFailed) parts.push('Scores could not be stored on this device. Keep this page open until they have been sent.');
    if (badEntries.size > 0) parts.push(`${badEntries.size === 1 ? '1 entry is' : `${badEntries.size} entries are`} not a valid score and has not been saved.`);
    const orphan = area.criteria.filter((c) => dirty.has(c.id) && values[c.id] === undefined);
    if (orphan.length > 0) parts.push('Comment will be saved once a score is entered');
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
    sent.add(c.id);
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
    const bands = h('div', { class: 'bands score-bands-summary' }, c.bands.map((b) => h('span', { 'aria-current': 'false' }, `${b.min}–${b.max}`)));
    const note = h('p', { class: 'small' });
    const hint = h('p', { class: 'small muted', hidden: true }, 'A saved score cannot be removed. Enter a new score to change it.');
    blocks.push({ c, bands, note, hint, input, comment });

    input.addEventListener('input', () => {
      if (locked || submitting) return;
      invalidate();
      const p = parseScore(input.value, c.max);
      err.hidden = p.kind !== 'bad';
      err.textContent = p.kind === 'bad' ? p.message : '';
      input.setAttribute('aria-invalid', String(p.kind === 'bad'));
      if (p.kind === 'bad') badEntries.add(c.id); else badEntries.delete(c.id);
      if (p.kind === 'ok') {
        values[c.id] = p.value;
        sendScore(c);
      } else {
        delete values[c.id];
      }
      refresh();
    });
    input.addEventListener('blur', () => {
      const p = parseScore(input.value, c.max);
      if (p.kind === 'ok' && input.value !== String(p.value)) input.value = String(p.value);
    });
    comment.addEventListener('input', () => {
      if (locked || submitting) return;
      invalidate();
      comments[c.id] = comment.value;
      dirty.add(c.id);
      if (values[c.id] !== undefined && !badEntries.has(c.id)) sendScore(c);
      refresh();
    });

    const buttons: HTMLButtonElement[] = [];
    scoreButtons.set(c.id, buttons);
    const rubric = h('div', { class: 'rubric-grid', role: 'group', 'aria-label': `${c.name} scores` }, c.bands.map((band, index) => {
      const choices = h('div', { class: 'score-choices' });
      for (let n = band.min; n <= band.max; n++) {
        const button = h('button', { type: 'button', class: 'score-choice', value: n, 'aria-label': `${c.name}: ${n} points`, 'aria-pressed': String(values[c.id] === n), disabled: locked }, String(n));
        button.addEventListener('click', () => {
          if (locked || submitting) return;
          input.value = String(n);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        buttons.push(button); choices.append(button);
      }
      return h('div', { class: 'rubric-band', 'data-band': index },
        h('p', { class: 'rubric-band__label' }, BAND_LABELS[index], ' ', h('span', null, `${band.min}–${band.max}`)),
        band.description ? h('p', { class: 'rubric-band__description' }, band.description) : null, choices);
    }));
    const privateNote = h('textarea', { rows: 2, maxlength: 1000, 'aria-label': `${c.name} private notes`, placeholder: 'Judges only — not shared with the team', disabled: locked });
    privateNote.value = review.value.criterionNotes[c.id] ?? '';
    reviewFields.push(privateNote);
    privateNote.addEventListener('input', () => {
      if (locked || submitting) return;
      invalidate(); review.edit((r) => { r.criterionNotes[c.id] = privateNote.value; });
    });
    return h('section', { class: 'score-criterion' },
      h('div', { class: 'row__head' }, h('h3', null, c.name), h('span', { class: 'muted' }, `${c.max} pts`)),
      bands, rubric, note,
      h('label', { class: 'field score-direct' }, h('span', { class: 'field__label' }, 'Or enter a score'), input), err, hint,
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Internal notes and questions to ask (judges only)'), privateNote),
      h('details', { class: 'legacy-feedback', open: !!comments[c.id] }, h('summary', null, 'Criterion feedback for the team (optional)'),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Shared with the team after results are released'), comment)),
    );
  };

  const feedbackField = (key: 'overall' | 'strengths' | 'improvements' | 'internalNotes', label: string, hint: string) => {
    const box = h('textarea', { rows: 4, maxlength: 4000, 'aria-label': label, required: key === 'overall', disabled: locked });
    box.value = review.value[key]; reviewFields.push(box);
    box.addEventListener('input', () => {
      if (locked || submitting) return;
      invalidate(); box.setAttribute('aria-invalid', 'false'); review.edit((r) => { r[key] = box.value; });
    });
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label, key === 'overall' ? h('span', { class: 'required' }, ' *') : null), box,
      h('span', { class: 'muted small' }, hint));
  };
  const overallField = feedbackField('overall', 'Overall Comment', 'General feedback for the team');
  const overallInput = overallField.querySelector('textarea')!;
  const feedback = h('section', { class: 'score-feedback stack stack--lg' }, h('h3', null, 'Team Feedback'),
    h('p', { class: 'small muted' }, 'Shared with this team after results are released.'),
    overallField,
    feedbackField('strengths', 'Key Strengths', 'Notable strengths demonstrated by the team'),
    feedbackField('improvements', 'Areas for Improvement', 'Suggestions for how the team could improve'),
    feedbackField('internalNotes', 'Internal Notes', 'Private notes for the judge, panel lead and Chair'),
    h('fieldset', { class: 'nomination-field stack' }, h('legend', null, 'Star Quality nominations'),
      h('p', { class: 'muted' }, 'Tick any award this team deserves to be nominated for. The tally across panels builds the short list.'),
      ...NOMINATION_AWARDS.map((award) => {
        const box = h('input', { type: 'checkbox', value: award.id, checked: review.value.nominations.includes(award.id), disabled: locked });
        reviewFields.push(box);
        box.addEventListener('change', () => {
          if (locked || submitting) return;
          invalidate(); review.edit((r) => { r.nominations = box.checked ? [...r.nominations, award.id] : r.nominations.filter((id) => id !== award.id); });
        });
        return h('label', { class: 'nomination-option' }, box, award.name);
      })), reviewStatus, retryReview);
  retryReview.addEventListener('click', () => { void review.flush(); });
  const reconnect = () => { if (!locked) void review.flush(); };
  window.addEventListener('online', reconnect);
  const retryTimer = setInterval(reconnect, 15000);

  const unsubscribe = ctx.queue.subscribe((e) => {
    if (!alive) return;
    if (e.kind === 'dropped') {
      if (e.item.cardId !== card.id) return;
      const entry = ctx.queue.rejected().find((r) => r.item.at === e.item.at && r.item.cardId === e.item.cardId && r.item.criterionId === e.item.criterionId);
      // The words come from the rejected ledger (see refresh); a refusal that means "no longer yours" also locks the form.
      if (entry?.code === 'locked') lock('This scorecard can no longer be changed here. Go back and open it again to see its current state.');
      else if (entry?.code === 'forbidden') lock('You can no longer score this team.');
      else if (entry?.code === 'not-found') lock('This scorecard no longer exists.');
    } else if (e.kind === 'saved') {
      sessionNote = false;
    }
    refresh();
  });
  ctx.onLeave(() => {
    alive = false; unsubscribe();
    window.removeEventListener('online', reconnect); clearInterval(retryTimer);
    if (!locked && review.pending) return review.flush().then(() => undefined).finally(() => review.dispose());
    review.dispose();
  });

  dismissRejected.addEventListener('click', () => {
    for (const r of ctx.queue.rejected()) if (r.item.cardId === card.id) ctx.queue.clearRejected(r.id);
    refresh();
  });

  saveNow.addEventListener('click', () => {
    // Plain flush: sends what is queued, as queued. Re-recording a value here could put an older one over a newer one.
    ctx.flush().catch((e) => { if (alive) reportActionError(ctx, alertBox, e); });
  });

  check.addEventListener('click', async () => {
    if (locked || submitting) return;
    alertBox.hidden = true;
    if (missing().length || badEntries.size) {
      showAlert('Score every criterion with a whole number in range before checking the card.');
      blocks.find((b) => values[b.c.id] === undefined || badEntries.has(b.c.id))?.input.focus(); return;
    }
    if (!review.value.overall.trim()) {
      showAlert('Add an Overall Comment for the team before checking the card.');
      overallInput.setAttribute('aria-invalid', 'true'); overallInput.focus(); return;
    }
    submitting = true; refresh();
    try {
      await ctx.flush();
      const saved = await review.flush();
      if (!alive) return;
      if (!saved || ctx.queue.pendingFor(card.id).length || ctx.queue.rejected().some((r) => r.item.cardId === card.id)) {
        showAlert('Some scores, notes or feedback have not saved. Save them before submitting.'); return;
      }
      reviewed = true;
      reviewSummary.replaceChildren(h('h3', null, 'Check your scorecard'),
        h('ul', { class: 'list' }, area.criteria.map((c) => h('li', null, `${c.name}: ${values[c.id]} / ${c.max}`))),
        h('p', null, `Total: ${areaTotal(area, values)} / ${area.max}`),
        h('p', { class: 'results-comment' }, review.value.overall),
        ...[['Key Strengths', review.value.strengths], ['Areas for Improvement', review.value.improvements]]
          .filter(([, value]) => value.trim()).map(([label, value]) => h('p', { class: 'results-comment' }, h('strong', null, `${label}: `), value)),
        ...(review.value.nominations.length ? [h('p', null, 'Award nominations: ', NOMINATION_AWARDS.filter((a) => review.value.nominations.includes(a.id)).map((a) => a.name).join(', '))] : []),
        h('p', { class: 'small muted' }, 'Submitting locks this card. Only the Chair can reopen it.'));
      reviewSummary.hidden = false; reviewSummary.focus();
    } catch (e) { if (alive) showAlert(errorText(e)); }
    finally { submitting = false; if (alive) refresh(); }
  });

  submit.addEventListener('click', async () => {
    // Validate before going busy.
    alertBox.hidden = true;
    const stillToScore = missing();
    if (locked || submitting) return;
    if (!reviewed || review.pending || !review.value.overall.trim()) { showAlert('Use Check card to review your scores and feedback before submitting.'); return; }
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

  const siblings = event.ruleset.areas.filter((a) => a.kind === 'scorecard' && a.panel === area.panel);
  const screen = h('div', { class: 'stack stack--lg scorecard-screen' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: back }, 'My scorecards'),
      h('p', { class: 'eyebrow' }, event.name),
      h('h1', null, area.name),
      h('p', { class: 'lead' }, `Team ${team.number} · ${team.name}`),
      notice,
    ),
    rejectedBox,
    alertBox,
    siblings.length > 1 ? h('nav', { class: 'score-section-nav', 'aria-label': 'Scorecard sections' }, siblings.map((a) => h('a', {
      href: routeHref({ name: 'scorecard', eventId, teamId, areaId: a.id }), 'aria-current': a.id === area.id ? 'page' : undefined,
    }, a.name.replace(/^[^:]+: /, '')))) : null,
    h('div', { class: 'score-sheet' },
      h('header', { class: 'score-section-heading' }, h('h2', null, area.name.replace(/^[^:]+: /, '')), h('span', { class: 'muted' }, `Max: ${area.max} pts`)),
      ...area.criteria.map(criterionBlock),
      h('div', { class: 'score-subtotal' }, h('span', null, 'Section Subtotal'), total), feedback),
    h('div', { class: 'stack score-actions' }, status, saveNow, check, reviewSummary, submitHolder),
  );
  refresh();
  return screen;
}
