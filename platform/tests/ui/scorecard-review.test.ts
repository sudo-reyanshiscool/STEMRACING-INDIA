// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ScoreQueue, memoryKV } from '../../src/api';
import { scorecardScreen } from '../../src/ui/scorecard';
import { scoringScreen } from '../../src/ui/scoring';
import { mountSyncBar } from '../../src/ui/syncbar';
import { EMAILS, makeCtx, text, world } from './helpers';

const ENGAGE = 'Engagement & Presentation Dynamics';
const ENGAGE_ID = 'engagement-presentation-dynamics';
const TEAM = 'Team Contribution';
const byLabel = <T extends Element>(el: HTMLElement, tagName: string, label: string) =>
  [...el.querySelectorAll(tagName)].find((n) => n.getAttribute('aria-label') === label) as T;
const input = (el: HTMLElement, name: string) => byLabel<HTMLInputElement>(el, 'input', `${name} (0 to 20)`);
const commentBox = (el: HTMLElement, name: string) => byLabel<HTMLTextAreaElement>(el, 'textarea', `${name} comment`);
const type = (i: HTMLInputElement | HTMLTextAreaElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const visible = (el: HTMLElement, needle: string) =>
  [...el.querySelectorAll('p')].some((p) => !p.hidden && !p.closest('[hidden]') && (p.textContent ?? '').includes(needle));
const tick = () => new Promise((r) => setTimeout(r, 0));
const open = async () => {
  const { api, ev, t1, t2 } = await world();
  await api.signIn(EMAILS.judge);
  return { api, ev, t1, t2 };
};

describe('review fixes: scorecard', () => {
  it('C1: Try saving again never puts an older in-flight score over a newer one', async () => {
    const { api, ev, t1 } = await open();
    let release!: () => void;
    let n = 0;
    const slow = {
      saveScore: async (c: string, k: string, s: number, m?: string) => {
        n += 1;
        if (n === 1) await new Promise<void>((r) => { release = r; });
        await api.saveScore(c, k, s, m);
      },
    };
    const { ctx, queue } = makeCtx(api, slow);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '1');
    type(input(el, ENGAGE), '14');
    button(el, 'Try saving again')!.click();
    release();
    await queue.flush();
    await vi.waitFor(async () => expect((await api.listCards(ev.id))[0].scores[ENGAGE_ID]).toBe(14));
    expect(queue.pending()).toBe(0);
  });

  it('I1: a rejected change blocks submit, is named in words and survives other edits', async () => {
    const { api, ev, t1 } = await open();
    const picky = {
      saveScore: async (c: string, k: string, s: number, m?: string) => {
        if (k === ENGAGE_ID && s === 14) throw new ApiError('invalid', 'raw: check constraint scores_chk');
        await api.saveScore(c, k, s, m);
      },
    };
    const { ctx, queue } = makeCtx(api, picky);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await queue.flush();
    type(input(el, TEAM), '12');
    await queue.flush();
    expect(button(el, 'Submit scorecard')!.disabled).toBe(true);
    expect(text(el.querySelector('[role=status]')!)).toContain(`Not saved: ${ENGAGE}`);
    expect(visible(el, 'Not saved')).toBe(true);
    expect(text(el)).not.toContain('scores_chk');
    // Entering a value that the server accepts clears the rejection and allows submit.
    type(input(el, ENGAGE), '15');
    await queue.flush();
    expect(button(el, 'Submit scorecard')!.disabled).toBe(false);
    expect(text(el.querySelector('[role=status]')!)).toContain('All changes saved');
  });

  it('I1: a rejection stored before the page loaded still blocks submit and is named', async () => {
    const { api, ev, t1 } = await open();
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, ENGAGE_ID, 5);
    await api.saveScore(card.id, 'team-contribution', 12);
    const { ctx } = makeCtx(api);
    const rejectedKv = memoryKV();
    rejectedKv.set(JSON.stringify([{ id: 'r1', item: { cardId: card.id, criterionId: ENGAGE_ID, score: 14, at: 1 }, code: 'stuck', reason: 'raw 502 from db', at: 2 }]));
    const queue = new ScoreQueue(api, memoryKV(), undefined, { rejectedKv });
    ctx.queue = queue;
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(button(el, 'Submit scorecard')!.disabled).toBe(true);
    expect(text(el.querySelector('[role=status]')!)).toContain(`Not saved: ${ENGAGE}`);
    expect(text(el)).not.toContain('raw 502');
  });

  it('I3: a cleared box that the server or queue still holds explains why and blocks submit', async () => {
    const { api, ev, t1 } = await open();
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, ENGAGE_ID, 14);
    await api.saveScore(card.id, 'team-contribution', 12);
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(button(el, 'Submit scorecard')!.disabled).toBe(false);
    type(input(el, ENGAGE), '');
    expect(visible(el, 'cannot be removed')).toBe(true);
    expect(button(el, 'Submit scorecard')!.disabled).toBe(true);
    type(input(el, ENGAGE), '15');
    expect(visible(el, 'cannot be removed')).toBe(false);

    const offline = { saveScore: async () => { throw new ApiError('network', 'x'); } };
    const w = await open();
    const c2 = makeCtx(w.api, offline);
    const el2 = await scorecardScreen(c2.ctx, w.ev.id, w.t2.id, 'verbal-technique');
    type(input(el2, TEAM), '8');
    await c2.queue.flush();
    type(input(el2, TEAM), '');
    expect(visible(el2, 'cannot be removed')).toBe(true);
  });

  it('I4: a submitted card never shows waiting values and lists them as not saved', async () => {
    const { api, ev, t1 } = await open();
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, ENGAGE_ID, 14);
    await api.saveScore(card.id, 'team-contribution', 12);
    await api.submitCard(card.id);
    const { ctx, queue } = makeCtx(api);
    queue.enqueue({ cardId: card.id, criterionId: 'team-contribution', score: 3, comment: 'late' });
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    expect(input(el, TEAM).value).toBe('12');
    expect(commentBox(el, TEAM).value).toBe('');
    expect(text(el)).toContain(`Not saved: ${TEAM}`);
    expect(text(el)).toContain('26 / 40');
  });

  it('I4: inputs are disabled while the submit request is in flight', async () => {
    const { api, ev, t1 } = await open();
    const { ctx, queue } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    type(input(el, TEAM), '12');
    await queue.flush();
    let release!: () => void;
    vi.spyOn(api, 'submitCard').mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    button(el, 'Submit scorecard')!.click();
    await tick();
    expect(input(el, ENGAGE).disabled).toBe(true);
    expect(commentBox(el, ENGAGE).disabled).toBe(true);
    release();
    await tick();
  });

  it('keeps a comment typed before a valid score and says so', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(commentBox(el, TEAM), 'Note first');
    expect(text(el.querySelector('[role=status]')!)).toContain('Comment will be saved once a score is entered');
    type(input(el, TEAM), '12');
    expect(text(el.querySelector('[role=status]')!)).not.toContain('Comment will be saved');
  });

  it('normalises leading zeros on blur', async () => {
    const { api, ev, t1 } = await open();
    const { ctx } = makeCtx(api);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    const i = input(el, TEAM);
    type(i, '007');
    i.dispatchEvent(new Event('blur'));
    expect(i.value).toBe('7');
    type(i, 'abc');
    i.dispatchEvent(new Event('blur'));
    expect(i.value).toBe('abc');
  });
});

describe('review fixes: worklist and sync bar', () => {
  it('I2: shows only the signed-in judge’s own cards, not other judges’ cards seen via another role', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, ENGAGE_ID, 5);
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: EMAILS.lead, role: 'judge', panel: 'verbal' });
    await api.signIn(EMAILS.lead);
    await api.claimInvitations();
    expect((await api.listCards(ev.id)).length).toBe(1); // the lead can see the other judge's card
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).not.toContain('Draft');
    expect(text(el)).toContain('Not started');
  });

  it('I2: declare while locked says what to do in judge language', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    vi.spyOn(api, 'declareConflict').mockRejectedValueOnce(new ApiError('locked', 'raw'));
    const el = await scoringScreen(ctx, ev.id);
    const btn = () => [...el.querySelectorAll('button')].filter((b) => /conflict|Confirm/.test(b.textContent ?? ''));
    btn()[0].click();
    btn()[0].click();
    await tick();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('ask the Chair');
  });

  it('I5: the sync bar shows fixed text per code, never the stored reason', async () => {
    const rejectedKv = memoryKV();
    const entry = (id: string, code: string) => ({ id, item: { cardId: 'c', criterionId: 'k', score: 3, at: 1 }, code, reason: `RAW-${code}-constraint "x_pkey"`, at: 2 });
    rejectedKv.set(JSON.stringify(['invalid', 'locked', 'forbidden', 'not-found', 'stuck', 'unknown'].map((c, n) => entry(String(n), c))));
    const queue = new ScoreQueue({ saveScore: async () => {} } as never, memoryKV(), undefined, { rejectedKv });
    const root = document.createElement('div');
    mountSyncBar(root, queue);
    expect(text(root)).not.toContain('RAW-');
    expect(text(root)).not.toContain('x_pkey');
    expect(text(root)).toContain('This change could not be saved after several tries');
    expect(text(root)).toContain('was not valid');
    expect(text(root)).toContain('submitted or reopened elsewhere');
  });
});

describe('re-review fixes', () => {
  const rejectedSetup = async () => {
    const { api, ev, t1 } = await open();
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, ENGAGE_ID, 14);
    await api.saveScore(card.id, 'team-contribution', 12);
    const { ctx } = makeCtx(api);
    const rejectedKv = memoryKV();
    rejectedKv.set(JSON.stringify([{ id: 'r1', item: { cardId: card.id, criterionId: ENGAGE_ID, score: 14, at: 1 }, code: 'invalid', reason: 'raw', at: 2 }]));
    const queue = new ScoreQueue(api, memoryKV(), undefined, { rejectedKv });
    ctx.queue = queue;
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    return { api, ev, t1, ctx, queue, el, card };
  };

  it('N1: dismissing in the sync bar re-enables submit and clears the alert without any edit', async () => {
    const { queue, el } = await rejectedSetup();
    const root = document.createElement('div');
    mountSyncBar(root, queue);
    expect(button(el, 'Submit scorecard')!.disabled).toBe(true);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss')!.click();
    expect(button(el, 'Submit scorecard')!.disabled).toBe(false);
    expect(visible(el, 'Not saved')).toBe(false);
    expect(el.querySelector('[role=alert]:not([hidden])')).toBeNull();
  });

  it('N1: a requeue from the sync bar is also reflected in the open scorecard', async () => {
    const { queue, el, card } = await rejectedSetup();
    queue.requeueRejected('r1');
    expect(text(el.querySelector('[role=status]')!)).toContain('1 change waiting to save');
    expect(queue.pendingFor(card.id)).toHaveLength(1);
  });

  it('N3: the alert has its own Dismiss button for this card’s entries', async () => {
    const { queue, el } = await rejectedSetup();
    button(el, 'Dismiss')!.click();
    expect(queue.rejected()).toHaveLength(0);
    expect(button(el, 'Submit scorecard')!.disabled).toBe(false);
    expect(el.querySelector('[role=alert]:not([hidden])')).toBeNull();
  });

  it('N2: a locked card does not tell the judge to enter the score again', async () => {
    const { api, ev, t1 } = await open();
    const locked = { saveScore: async () => { throw new ApiError('locked', 'x'); } };
    const { ctx, queue } = makeCtx(api, locked);
    const el = await scorecardScreen(ctx, ev.id, t1.id, 'verbal-technique');
    type(input(el, ENGAGE), '14');
    await queue.flush();
    expect(el.querySelector('[role=alert]:not([hidden])')!.textContent).toContain('Not saved');
    expect(text(el)).not.toContain('again to save');
    expect(text(el.querySelector('[role=status]')!)).not.toContain('Enter it again');
  });
});
