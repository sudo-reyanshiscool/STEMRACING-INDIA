// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { parseScore, scorecardScreen } from '../../src/ui/scorecard';
import { EMAILS, makeCtx, releaseResults, reviewScorecard, text, world } from './helpers';

const ENGAGE = 'Engagement & Presentation Dynamics';
const TEAM = 'Team Contribution';
// Matched by attribute value, not a CSS selector: jsdom's selector engine mis-parses the "&" in "Engagement & ...".
const byLabel = <T extends Element>(el: HTMLElement, tagName: string, label: string) =>
  [...el.querySelectorAll(tagName)].find((n) => n.getAttribute('aria-label') === label) as T;
const input = (el: HTMLElement, name: string) => byLabel<HTMLInputElement>(el, 'input', `${name} (0 to 20)`);
const commentBox = (el: HTMLElement, name: string) => byLabel<HTMLTextAreaElement>(el, 'textarea', `${name} comment`);
const type = (i: HTMLInputElement | HTMLTextAreaElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const submitBtn = (el: HTMLElement) => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Submit scorecard') as HTMLButtonElement | undefined;
const visibleAlert = (el: HTMLElement) => el.querySelector('[role=alert]:not([hidden])');
const open = async () => {
  const { api, ev, t1, t2 } = await world();
  await api.signIn(EMAILS.judge);
  return { api, ev, t1, t2 };
};

describe('parseScore', () => {
  it('accepts whole numbers up to the maximum', () => {
    expect(parseScore('0', 20)).toEqual({ kind: 'ok', value: 0 });
    expect(parseScore(' 20 ', 20)).toEqual({ kind: 'ok', value: 20 });
    expect(parseScore('', 20)).toEqual({ kind: 'empty' });
    expect(parseScore('   ', 20)).toEqual({ kind: 'empty' });
  });
  it('rejects everything else with a readable message', () => {
    for (const bad of ['21', '4.5', '-1', 'abc', '1e1', '7x', '٣', '١٠']) {
      const p = parseScore(bad, 20);
      expect(p.kind, bad).toBe('bad');
    }
    expect(parseScore('21', 20)).toEqual({ kind: 'bad', message: 'Scores go from 0 to 20' });
    expect(parseScore('4.5', 15)).toEqual({ kind: 'bad', message: 'Enter a whole number from 0 to 15' });
  });
});

describe('scorecardScreen', () => {
  it('shows each criterion with its bands and a disabled submit button', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(text(el)).toContain('Verbal Presentation: Technique');
    expect(text(el)).toContain('Team 1 · One');
    expect(input(el, ENGAGE)).toBeDefined();
    expect(text(el.querySelector('.bands')!)).toContain('0–5');
    expect(text(el.querySelector('.bands')!)).toContain('16–20');
    expect(submitBtn(el)!.disabled).toBe(true);
    expect(text(el)).toContain('0 / 40');
  });

  it('flags scores outside the range or not whole numbers, never sends them, and keeps what was typed', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    const i = input(el, ENGAGE);
    for (const bad of ['21', '4.5', '-1', 'abc', '1e1']) {
      type(i, bad);
      expect(i.getAttribute('aria-invalid'), bad).toBe('true');
      expect(i.value).toBe(bad);
    }
    type(i, '4.5');
    expect(text(el)).toContain('Enter a whole number from 0 to 20');
    type(i, '21');
    expect(text(el)).toContain('Scores go from 0 to 20');
    await queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({});
    expect(text(el.querySelector('[role=status]')!)).toContain('not a valid score');
    type(i, '');
    expect(i.getAttribute('aria-invalid')).toBe('false');
  });

  it('saves a valid score, shows the band it falls in in words, and updates the running total', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    expect(text(el.querySelector('[role=status]')!)).toContain('1 change waiting to save');
    await queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({ 'engagement-presentation-dynamics': 14 });
    expect(text(el.querySelector('.bands [aria-current="true"]')!)).toBe('11–15');
    expect(text(el)).toContain('Score 14 is in the 11–15 band');
    expect(text(el)).toContain('14 / 40');
    expect(text(el.querySelector('[role=status]')!)).toContain('All changes saved');
  });

  it('keeps the comment with the score', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, TEAM), '12');
    type(commentBox(el, TEAM), 'Clear roles');
    await queue.flush();
    expect((await api.listCards(ev.id))[0].comments['team-contribution']).toBe('Clear roles');
  });

  it('sends a comment only when the judge edited it, so another device’s comment is not erased', async () => {
    const { api, ev, t1 } = await open();
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 5, 'Written elsewhere');
    const calls: Array<[string, string, number, string | undefined]> = [];
    const { ctx, queue } = makeCtx(api, { saveScore: async (c, k, s, m) => { calls.push([c, k, s, m]); await api.saveScore(c, k, s, m); } });
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(commentBox(el, TEAM).value).toBe('Written elsewhere');
    type(input(el, TEAM), '9');
    await queue.flush();
    expect(calls).toEqual([[card.id, 'team-contribution', 9, undefined]]);
    type(commentBox(el, TEAM), 'Edited here');
    await queue.flush();
    expect(calls[1]).toEqual([card.id, 'team-contribution', 9, 'Edited here']);
    expect((await api.listCards(ev.id))[0].comments['team-contribution']).toBe('Edited here');
  });

  it('keeps a comment typed before the score and sends it with the first score', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(commentBox(el, TEAM), 'Note first');
    await queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({});
    expect(commentBox(el, TEAM).value).toBe('Note first');
    type(input(el, TEAM), '7');
    await queue.flush();
    expect((await api.listCards(ev.id))[0].comments['team-contribution']).toBe('Note first');
  });

  it('submits once every criterion is scored, then shows a locked card with totals', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    expect(submitBtn(el)!.disabled).toBe(true);
    expect(text(el)).toContain(`Still to score: ${TEAM}`);
    type(input(el, TEAM), '12');
    await queue.flush();
    await reviewScorecard(el);
    expect(submitBtn(el)!.disabled).toBe(false);
    submitBtn(el)!.click();
    await vi.waitFor(async () => expect((await api.listCards(ev.id))[0].status).toBe('submitted'));
    expect(ctx.rerender).toHaveBeenCalled();
    expect(input(el, ENGAGE).disabled).toBe(true);

    const locked = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(input(locked, ENGAGE).disabled).toBe(true);
    expect(input(locked, ENGAGE).value).toBe('14');
    expect(commentBox(locked, ENGAGE).disabled).toBe(true);
    expect(submitBtn(locked)).toBeUndefined();
    expect(text(locked)).toContain('Only the Chair can reopen');
    expect(text(locked)).toContain('26 / 40');
    expect(text(locked)).toContain('Score 14 is in the 11–15 band');
  });

  it('re-enables submit after a failed attempt and succeeds on the next one', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    type(input(el, TEAM), '12');
    await queue.flush();
    await reviewScorecard(el);
    vi.spyOn(api, 'submitCard').mockRejectedValueOnce(new ApiError('network', 'raw: ECONNRESET db.internal'));
    submitBtn(el)!.click();
    await vi.waitFor(() => expect(visibleAlert(el)).not.toBeNull());
    expect(text(visibleAlert(el)!)).toContain('Could not reach the server');
    expect(text(el)).not.toContain('ECONNRESET');
    expect(submitBtn(el)!.disabled).toBe(false);
    expect(input(el, ENGAGE).value).toBe('14');
    submitBtn(el)!.click();
    await vi.waitFor(async () => expect((await api.listCards(ev.id))[0].status).toBe('submitted'));
  });

  it('says the card was not submitted, in words, when the server finds it incomplete', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    type(input(el, TEAM), '12');
    await queue.flush();
    await reviewScorecard(el);
    vi.spyOn(api, 'submitCard').mockRejectedValueOnce(new ApiError('invalid', 'Team Contribution has no score'));
    // The server disagrees with the local view (another device cleared a score): the form must say what to do.
    const card = (await api.listCards(ev.id))[0];
    card.scores = {};
    submitBtn(el)!.click();
    await vi.waitFor(() => expect(visibleAlert(el)).not.toBeNull());
    expect(text(visibleAlert(el)!)).toContain('Not submitted');
    expect(submitBtn(el)!.disabled).toBe(false);
  });

  it('keeps unsaved scores visible and blocks submit while offline', async () => {
    const { api, ev, t1 } = await open();
    const offline = { saveScore: async () => { throw new ApiError('network', 'No connection to the server'); } };
    const { ctx, queue } = makeCtx(api, offline);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    type(input(el, TEAM), '12');
    await queue.flush();
    expect(text(el.querySelector('[role=status]')!)).toMatch(/Offline: 2 changes will save/);
    expect(submitBtn(el)!.disabled).toBe(true);
    expect(input(el, ENGAGE).value).toBe('14');
    expect((await api.listCards(ev.id))[0].scores).toEqual({});
  });

  it('says scores are safe when the session has lapsed', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    ctx.enqueueScore = async () => { throw new ApiError('unauthenticated', 'Sign in to record scores'); };
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await vi.waitFor(() => expect(text(el.querySelector('[role=status]')!)).toContain('your scores are safe'));
    expect(input(el, ENGAGE).value).toBe('14');
  });

  it('shows a refused write without leaking the backend message', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    ctx.enqueueScore = async () => { throw new ApiError('unknown', 'duplicate key value violates constraint "scores_pkey"'); };
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await vi.waitFor(() => expect(visibleAlert(el)).not.toBeNull());
    expect(text(el)).not.toContain('scores_pkey');
    expect(text(visibleAlert(el)!)).toContain('Something went wrong');
  });

  it('restores queued scores after a reload', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    queue.enqueue({ cardId: card.id, criterionId: 'team-contribution', score: 9, comment: 'queued' });
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(input(el, TEAM).value).toBe('9');
    expect(commentBox(el, TEAM).value).toBe('queued');
    expect(text(el.querySelector('[role=status]')!)).toContain('1 change waiting to save');
  });

  it('tells the judge, and goes read-only without losing values, when an edit was refused as locked', async () => {
    const { api, ev, t1 } = await open();
    const locked = { saveScore: async () => { throw new ApiError('locked', 'This scorecard has been submitted'); } };
    const { ctx, queue } = makeCtx(api, locked);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await queue.flush();
    expect(text(visibleAlert(el)!)).toContain('submitted or reopened elsewhere');
    expect(input(el, ENGAGE).value).toBe('14');
    expect(input(el, ENGAGE).disabled).toBe(true);
    expect(submitBtn(el)).toBeUndefined();
  });

  it('never shows the raw reason of an invalid refusal', async () => {
    const { api, ev, t1 } = await open();
    const bad = { saveScore: async () => { throw new ApiError('invalid', 'check constraint "scores_score_check" failed'); } };
    const { ctx, queue } = makeCtx(api, bad);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await queue.flush();
    expect(text(el)).not.toContain('scores_score_check');
    expect(text(visibleAlert(el)!)).toContain('not valid');
    expect(input(el, ENGAGE).disabled).toBe(false);
  });

  it('refuses a conflicted team, another panel and an unknown area with a clear message', async () => {
    const { api, ev, t1, t2 } = await open();
    const { ctx } = makeCtx(api);
    await api.declareConflict(ev.id, t2.id);
    expect(text(await scorecardScreen(ctx, ev.id, t2.id, 'verbal-technique'))).toContain('conflict of interest');
    expect(text(await scorecardScreen(ctx, ev.id, t1.id, 'de-portfolio'))).toContain('not assigned to you');
    expect(text(await scorecardScreen(ctx, ev.id, t1.id, 'knockout'))).toContain('not found');
    expect(text(await scorecardScreen(ctx, ev.id, 'nope', 'verbal-technique'))).toContain('not found');
  });

  it('shows an existing card read-only once a conflict is declared', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 12);
    await api.declareConflict(ev.id, t1.id);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(text(el)).toContain('conflict of interest');
    expect(input(el, TEAM).value).toBe('12');
    expect(input(el, TEAM).disabled).toBe(true);
    expect(submitBtn(el)).toBeUndefined();
  });

  it('is read-only with a clear note once results are released', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 12);
    await api.signIn(EMAILS.org);
    await releaseResults(api, ev.id);
    await api.signIn(EMAILS.judge);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(text(el)).toContain('Results are released');
    expect(input(el, TEAM).disabled).toBe(true);
    expect(submitBtn(el)).toBeUndefined();
  });

  it('stops listening to the queue when the screen is left', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue, leaves } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    leaves.forEach((f) => f());
    const before = text(el.querySelector('[role=status]')!);
    queue.enqueue({ cardId: 'x', criterionId: 'y', score: 1 });
    await queue.flush();
    expect(text(el.querySelector('[role=status]')!)).toBe(before);
  });

  it('never puts typed text in the page as markup', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(commentBox(el, TEAM), '<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
  });
});
