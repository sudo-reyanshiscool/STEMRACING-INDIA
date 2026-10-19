// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type CardRow, type OverrideRow, type TeamRow } from '../../src/api';
import { INDIA_2026 } from '../../src/rulesets';
import { buildModeration, moderationScreen } from '../../src/ui/moderation';
import { EMAILS, makeCtx, releaseResults, text, world } from './helpers';

const area = INDIA_2026.areas.find((a) => a.id === 'verbal-technique')!;
const team = (id: string, number: string): TeamRow => ({ id, eventId: 'e', number, name: `T${number}`, school: '' });
const card = (id: string, teamId: string, judgeId: string, status: 'draft' | 'submitted', scores: Record<string, number>): CardRow => ({
  id, eventId: 'e', teamId, areaId: 'verbal-technique', panel: 'verbal', judgeId, status, reopenedCount: 0, scores, comments: {},
});
const full = (a: number, b: number) => ({ 'engagement-presentation-dynamics': a, 'team-contribution': b });
const wait = () => new Promise((r) => setTimeout(r, 0));
const alertText = (el: HTMLElement) => text(el.querySelector('[role=alert]:not([hidden])') ?? document.createElement('i'));

describe('buildModeration', () => {
  it('averages only submitted, complete cards and reports unfinished ones as incomplete', () => {
    const rows = buildModeration(area, [team('t1', '1'), team('t2', '2')], [
      card('c1', 't1', 'jA', 'submitted', full(14, 12)),
      card('c2', 't1', 'jB', 'submitted', full(15, 15)),
      card('c3', 't1', 'jC', 'draft', { 'team-contribution': 5 }),
    ], []);
    expect(rows[0].mean).toBe(28);
    expect(rows[0].judges.map((j) => j.total)).toEqual([26, 30, null]);
    expect(rows[1]).toMatchObject({ mean: null, judges: [], override: null });
    expect(rows[0].teamLabel).toBe('Team 1 · T1');
  });

  it('attaches the override for the team and area only', () => {
    const o: OverrideRow[] = [
      { eventId: 'e', teamId: 't1', areaId: 'verbal-technique', value: 31, reason: 'Moderated' },
      { eventId: 'e', teamId: 't1', areaId: 'de-portfolio', value: 100, reason: 'Other area' },
    ];
    expect(buildModeration(area, [team('t1', '1')], [], o)[0].override?.value).toBe(31);
  });

  it('rounds a repeating mean to one decimal', () => {
    const rows = buildModeration(area, [team('t1', '1')], [
      card('a', 't1', 'j1', 'submitted', full(1, 0)), card('b', 't1', 'j2', 'submitted', full(1, 0)), card('c', 't1', 'j3', 'submitted', full(2, 0)),
    ], []);
    expect(rows[0].mean).toBe(1.3);
  });

  it('never counts a complete draft in the mean', () => {
    const rows = buildModeration(area, [team('t1', '1')], [
      card('a', 't1', 'j1', 'submitted', full(10, 10)), card('b', 't1', 'j2', 'draft', full(20, 20)),
    ], []);
    expect(rows[0].mean).toBe(20);
  });
});

describe('moderationScreen', () => {
  const submitOne = async (api: Awaited<ReturnType<typeof world>>['api'], evId: string, teamId: string) => {
    await api.signIn(EMAILS.judge);
    const c = await api.openCard(evId, teamId, 'verbal-technique');
    await api.saveScore(c.id, 'engagement-presentation-dynamics', 14);
    await api.saveScore(c.id, 'team-contribution', 12);
    await api.submitCard(c.id);
    return c.id;
  };
  const overrideForm = (el: HTMLElement) => el.querySelector('form[data-override]') as HTMLFormElement;
  const setOverride = (form: HTMLFormElement, v: string, r: string) => {
    (form.querySelector('input[name=value]') as HTMLInputElement).value = v;
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = r;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const spied = <K extends keyof Api>(api: Api, method: K, impl: (...a: never[]) => unknown): Api =>
    new Proxy(api, { get: (t, k) => (k === method ? impl : (t as never)[k]) });

  it('shows the judges totals by email, the mean and status', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('judge@x.test');
    expect(t).toContain('26');
    expect(t).toContain('submitted');
    expect(t).toContain('Team 1 · One');
  });

  it('says a draft is not counted and offers no reopen for it', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const c = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(c.id, 'team-contribution', 5);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    expect(text(el)).toContain('draft');
    expect(text(el)).toContain('not counted');
    expect(el.querySelector('form[data-reopen]')).toBeNull();
  });

  it('lets the Chair reopen a submitted card with a reason, and explains a missing reason', async () => {
    const { api, ev, t1 } = await world();
    const cardId = await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const form = el.querySelector('form[data-reopen]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('reason');
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'Judge asked to fix a typo';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    await api.signIn(EMAILS.judge);
    expect((await api.listCards(ev.id)).find((c) => c.id === cardId)?.status).toBe('draft');
  });

  it('refuses a two-character reopen reason before calling the API, then accepts a good one once', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const reopen = vi.fn(api.reopenCard.bind(api));
    const { ctx } = makeCtx(spied(api, 'reopenCard', reopen as never));
    const el = await moderationScreen(ctx, ev.id);
    const form = el.querySelector('form[data-reopen]') as HTMLFormElement;
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'ok';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(reopen).not.toHaveBeenCalled();
    expect(alertText(el)).toContain('3 characters');
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'Typo in score';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it('lets the Chair override an area score within its maximum', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const form = overrideForm(el);
    const set = (v: string, r: string) => setOverride(form, v, r);
    set('41', 'Too high');
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('between 0 and 40');
    set('abc', 'Not a number');
    await wait();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('number');
    set('31', 'Cross-moderated with the panel');
    await wait();
    expect((await api.listOverrides(ev.id))[0]).toMatchObject({ areaId: 'verbal-technique', value: 31 });
    expect(text(el)).toContain('Override: 31');
  });

  it('rejects overrides with two decimals, a negative value or a short reason without calling the API', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const set = vi.fn(api.setOverride.bind(api));
    const { ctx } = makeCtx(spied(api, 'setOverride', set as never));
    const el = await moderationScreen(ctx, ev.id);
    const form = overrideForm(el);
    for (const [v, r, expected] of [['31.25', 'Fine reason', 'one decimal'], ['-1', 'Fine reason', 'between 0 and 40'], ['31', 'no', '3 characters'], ['', 'Fine reason', 'number']] as const) {
      setOverride(form, v, r);
      await wait();
      expect(alertText(el)).toContain(expected);
    }
    expect(set).not.toHaveBeenCalled();
    setOverride(form, '31.5', 'Panel agreed');
    setOverride(form, '31.5', 'Panel agreed');
    await wait();
    expect(set).toHaveBeenCalledTimes(1);
    expect((await api.listOverrides(ev.id))[0].value).toBe(31.5);
  });

  it('offers overrides for scorecard areas only', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const options = [...el.querySelectorAll('select option')].map((o) => o.getAttribute('value'));
    expect(options).toContain('verbal-technique');
    expect(options).not.toContain('specifications');
  });

  it('shows results are released and locks changes, naming the way out', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    await releaseResults(api, ev.id);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    expect(text(el)).toContain('Results are released');
    expect(text(el)).toContain('Withdraw the release to change this');
    expect(el.querySelector('form')).toBeNull();
    expect(text(el)).toContain('26');
  });

  it('explains a locked refusal when the release happens after the screen opened', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    await releaseResults(api, ev.id);
    setOverride(overrideForm(el), '30', 'Panel agreed');
    await wait();
    expect(alertText(el)).toContain('Withdraw the release to change this');
  });

  it('never shows a raw backend message and sends a lapsed session back to sign-in', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    let code: 'unknown' | 'unauthenticated' = 'unknown';
    const { ctx } = makeCtx(spied(api, 'setOverride', (async () => { throw new ApiError(code, 'duplicate key violates constraint overrides_pkey'); }) as never));
    const el = await moderationScreen(ctx, ev.id);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setOverride(overrideForm(el), '30', 'Panel agreed');
    await wait();
    expect(alertText(el)).not.toContain('constraint');
    expect(alertText(el)).toContain('Something went wrong');
    code = 'unauthenticated';
    setOverride(overrideForm(el), '30', 'Panel agreed');
    await wait();
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it('says in words that an override replaces the judges mean and prefills the reason when editing', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.chair);
    await api.setOverride(ev.id, t1.id, 'verbal-technique', 31, 'Cross-moderated with the panel');
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    expect(text(el)).toContain("Override replaces the judges' mean of 26");
    expect((overrideForm(el).querySelector('input[name=reason]') as HTMLInputElement).value).toBe('Cross-moderated with the panel');
  });

  it('counts cards still in draft per team and says they are not counted', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(EMAILS.judge);
    const d = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(d.id, 'team-contribution', 5);
    await submitOne(api, ev.id, t2.id);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('tbody tr')].map(text);
    expect(rows[0]).toContain('1 card still in draft, not counted');
    expect(rows[1]).not.toContain('still in draft');
  });

  it('gives the same judge the same label in every row', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'judge2@x.test', name:'Test Judge',role: 'judge', panel: 'verbal' });
    await api.signIn('judge2@x.test');
    await api.claimInvitations();
    const c = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(c.id, 'engagement-presentation-dynamics', 10);
    await api.saveScore(c.id, 'team-contribution', 10);
    await api.submitCard(c.id);
    await submitOne(api, ev.id, t1.id);
    await submitOne(api, ev.id, t2.id);
    await api.signIn(EMAILS.lead);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('tbody tr')].map(text);
    // judge2 sorts first, so judge@ is "Judge 2" in both rows, not "Judge 1" in the row where it is alone.
    expect(rows[0]).toContain('Judge 2: 26');
    expect(rows[0]).toContain('Judge 1: 20');
    expect(rows[1]).toContain('Judge 2: 26');
    expect(rows[1]).not.toContain('Judge 1');
  });

  it('is read-only for a lead judge and closed to everyone else', async () => {
    const { api, ev, t1 } = await world();
    await submitOne(api, ev.id, t1.id);
    await api.signIn(EMAILS.lead);
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    expect(text(el)).toContain('26');
    expect(el.querySelector('form')).toBeNull();
    await api.signIn(EMAILS.judge);
    expect(text(await moderationScreen(ctx, ev.id))).toContain('Only the Chair and lead judges');
  });
});

describe('moderation flags conflicted cards', () => {
  it('marks a counted card whose judge declared a conflict with that team', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const c = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(c.id, 'engagement-presentation-dynamics', 14);
    await api.saveScore(c.id, 'team-contribution', 12);
    await api.submitCard(c.id);
    await api.signIn(EMAILS.chair);
    const judgeId = (await api.listCards(ev.id))[0].judgeId;
    // Cards submitted before the database refused late declarations can exist: the screen must still say so.
    const withConflict = new Proxy(api, { get: (t, k) => (k === 'listConflicts' ? async () => [{ eventId: ev.id, judgeId, teamId: t1.id }] : (t as never)[k]) });
    const { ctx } = makeCtx(withConflict as Api);
    const el = await moderationScreen(ctx, ev.id);
    const sel = el.querySelector('select[name=area]') as HTMLSelectElement;
    sel.value = 'verbal-technique';
    sel.dispatchEvent(new Event('change'));
    await wait();
    const flag = el.querySelector(`[data-conflict="${c.id}"]`);
    expect(flag).not.toBeNull();
    expect(text(flag as HTMLElement)).toContain('still counts');
  });
});

describe('removing an override', () => {
  const setup = async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.setOverride(ev.id, t1.id, 'verbal-technique', 30, 'Cross-moderated');
    const { ctx } = makeCtx(api);
    const el = await moderationScreen(ctx, ev.id);
    const sel = el.querySelector('select[name=area]') as HTMLSelectElement;
    sel.value = 'verbal-technique';
    sel.dispatchEvent(new Event('change'));
    await wait();
    return { api, ev, t1, el };
  };
  const removeButton = (el: HTMLElement) => [...el.querySelectorAll('button')].find((b) => /remove override|confirm: remove/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

  it('needs a second click to confirm, then removes it and the screen refreshes', async () => {
    const { api, ev, el } = await setup();
    const first = removeButton(el)!;
    expect(first).toBeDefined();
    first.click();
    await wait();
    expect(await api.listOverrides(ev.id)).toHaveLength(1);
    expect(text(removeButton(el)!)).toMatch(/confirm/i);
    removeButton(el)!.click();
    await wait(); await wait();
    expect(await api.listOverrides(ev.id)).toEqual([]);
    expect(removeButton(el)).toBeUndefined();
    expect(text(el)).toContain('Override removed');
  });

  it('is not offered while results are released', async () => {
    const { api, ev, el } = await setup();
    await releaseResults(api, ev.id);
    const sel = el.querySelector('select[name=area]') as HTMLSelectElement;
    sel.dispatchEvent(new Event('change'));
    await wait();
    expect(removeButton(el)).toBeUndefined();
  });
});
