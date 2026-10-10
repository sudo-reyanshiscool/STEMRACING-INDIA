// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type CardRow, type OverrideRow } from '../../src/api';
import { rankingsScreen } from '../../src/ui/rankings';
import { EMAILS, makeCtx, text, world } from './helpers';

type World = Awaited<ReturnType<typeof world>>;
const wait = () => new Promise((r) => setTimeout(r, 0));
const scoreTeam = async (api: World['api'], evId: string, teamId: string, a: number, b: number, comment?: string) => {
  await api.signIn(EMAILS.judge);
  const c = await api.openCard(evId, teamId, 'verbal-technique');
  await api.saveScore(c.id, 'engagement-presentation-dynamics', a, comment);
  await api.saveScore(c.id, 'team-contribution', b);
  await api.submitCard(c.id);
  return c.id;
};
const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const alertText = (el: HTMLElement) => text(el.querySelector('[role=alert]:not([hidden])') ?? document.createElement('i'));
const wrap = (api: Api, over: Partial<Record<keyof Api, unknown>>): Api => new Proxy(api, { get: (t, k) => (k in over ? over[k as keyof Api] : (t as never)[k]) });
const setPenalty = (el: HTMLElement, o: { team?: string; points?: string; reason?: string }) => {
  const form = el.querySelector('form[data-penalty]') as HTMLFormElement;
  if (o.team !== undefined) (form.querySelector('select[name=team]') as HTMLSelectElement).value = o.team;
  if (o.points !== undefined) (form.querySelector('input[name=points]') as HTMLInputElement).value = o.points;
  if (o.reason !== undefined) (form.querySelector('input[name=reason]') as HTMLInputElement).value = o.reason;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
};

describe('rankingsScreen', () => {
  it('ranks teams by total and says the ranking is provisional until every area is judged', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await scoreTeam(api, ev.id, t2.id, 5, 5);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    expect(rows[0][0]).toBe('1');
    expect(rows[0][1]).toContain('Team 1 · One');
    expect(rows[0].at(-1)).toBe('26');
    expect(rows[1][0]).toBe('2');
    expect(rows[1][1]).toContain('Team 2 · Two');
    expect(text(el)).toContain('Provisional');
    expect(text(el)).toContain('of 650');
  });

  it('says in words how many submitted cards were ranked and shows the input fingerprint', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await scoreTeam(api, ev.id, t2.id, 5, 5);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Ranked from 2 submitted scorecards');
    expect(text(el)).toMatch(/[0-9a-f]{64}/);
  });

  it('flags teams on equal points as a tie for the Chair to decide', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Tie');
    expect(text(el)).toContain('Chair to decide');
  });

  it('adds a protest penalty with a reason and re-ranks', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const form = el.querySelector('form[data-penalty]') as HTMLFormElement;
    expect((form.querySelector('input[name=points]') as HTMLInputElement).value).toBe('15');
    (form.querySelector('select[name=team]') as HTMLSelectElement).value = t1.id;
    (form.querySelector('input[name=reason]') as HTMLInputElement).value = 'Unsuccessful appeal';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();
    expect([...el.querySelectorAll('tbody tr')][0].lastElementChild!.textContent).toBe('11');
    expect(text(el)).toContain('Unsuccessful appeal');
  });

  it('validates a penalty before calling the API, bad then good, and submits once', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const add = vi.fn(api.addPenalty.bind(api));
    const { ctx } = makeCtx(wrap(api, { addPenalty: add }));
    const el = await rankingsScreen(ctx, ev.id);
    for (const [points, reason, expected] of [['0', 'Unsuccessful appeal', 'above 0'], ['101', 'Unsuccessful appeal', '100'], ['abc', 'Unsuccessful appeal', 'number'], ['2.55', 'Unsuccessful appeal', 'one decimal'], ['15', 'no', '3 characters']] as const) {
      setPenalty(el, { team: t1.id, points, reason });
      await wait();
      expect(alertText(el)).toContain(expected);
    }
    expect(add).not.toHaveBeenCalled();
    setPenalty(el, { team: t1.id, points: '15', reason: 'Unsuccessful appeal' });
    setPenalty(el, { team: t1.id, points: '15', reason: 'Unsuccessful appeal' });
    await wait();
    await wait();
    expect(add).toHaveBeenCalledTimes(1);
    expect(await api.listPenalties(ev.id)).toHaveLength(1);
  });

  it('has a one-click protest penalty preset that restores the ruleset value', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const form = el.querySelector('form[data-penalty]') as HTMLFormElement;
    const points = form.querySelector('input[name=points]') as HTMLInputElement;
    points.value = '3';
    button(el, 'Use the protest penalty (15 points)').click();
    expect(points.value).toBe('15');
  });

  it('publishes an immutable snapshot with a hash, and releases and withdraws results', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const snap = await api.latestSnapshot(ev.id);
    expect(snap?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap?.rows[0]).toMatchObject({ teamId: t1.id, total: 26, rank: 1 });
    await vi.waitFor(() => expect(text(el)).toContain('Published'));

    button(el, 'Release results to teams and the public').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(true));
    await vi.waitFor(() => expect(button(el, 'Withdraw released results')).toBeDefined());
    expect(text(el)).toContain('Results are released');
    button(el, 'Withdraw released results').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(false));
  });

  it('keeps comments and drafts out of the snapshot inputs', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12, 'SECRET judge comment');
    await api.signIn(EMAILS.judge);
    const d = await api.openCard(ev.id, t2.id, 'verbal-technique');
    await api.saveScore(d.id, 'team-contribution', 7, 'DRAFT comment');
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const snap = (await api.latestSnapshot(ev.id))!;
    const inputs = (await api.getSnapshotInputs(snap.id)) as { cards: { teamId: string }[] };
    expect(inputs.cards).toHaveLength(1);
    expect(inputs.cards[0].teamId).toBe(t1.id);
    const json = JSON.stringify(inputs);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('DRAFT');
    expect(JSON.stringify(snap)).not.toContain('SECRET');
  });

  it('produces the same hash for the same inputs', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const first = (await api.latestSnapshot(ev.id))!;
    await vi.waitFor(() => expect(button(el, 'Publish ranking').disabled).toBe(false));
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect((await api.latestSnapshot(ev.id))!.id).not.toBe(first.id));
    expect((await api.latestSnapshot(ev.id))!.inputHash).toBe(first.inputHash);
  });

  it('will not release until the published ranking matches the current one', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(button(el, 'Release results to teams and the public').disabled).toBe(true);
    expect(text(el)).toContain('Publish the ranking before releasing');
    button(el, 'Publish ranking').click();
    await vi.waitFor(() => expect(button(el, 'Release results to teams and the public').disabled).toBe(false));
    setPenalty(el, { team: t1.id, points: '5', reason: 'Late arrival' });
    await vi.waitFor(() => expect(button(el, 'Release results to teams and the public').disabled).toBe(true));
    expect(text(el)).toContain('out of date');
  });

  it('refreshes instead of publishing when scores changed since the screen was drawn', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    await scoreTeam(api, ev.id, t2.id, 20, 20);
    await api.signIn(EMAILS.chair);
    button(el, 'Publish ranking').click();
    await vi.waitFor(() => expect(text(el)).toContain('changed since'));
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    expect([...el.querySelectorAll('tbody tr')][0].lastElementChild!.textContent).toBe('40');
  });

  it('shows a released event in words, locks penalties and still lets the Chair withdraw', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    await api.setReleased(ev.id, true);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Results are released');
    expect(text(el)).toContain('Withdraw the release to change this');
    expect(el.querySelector('form[data-penalty]')).toBeNull();
    button(el, 'Withdraw released results').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(false));
    await vi.waitFor(() => expect(el.querySelector('form[data-penalty]')).not.toBeNull());
  });

  it('turns a locked penalty refusal into the withdraw-the-release text', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    await api.setReleased(ev.id, true);
    setPenalty(el, { team: t1.id, points: '15', reason: 'Unsuccessful appeal' });
    await wait();
    expect(alertText(el)).toContain('Withdraw the release to change this');
  });

  it('explains an unrankable input in plain words and leaves the Chair a way to fix it', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const bad: OverrideRow[] = [{ eventId: ev.id, teamId: t1.id, areaId: 'verbal-technique', value: 12.34, reason: 'x' }];
    const { ctx } = makeCtx(wrap(api, { listOverrides: async () => bad }));
    const el = await rankingsScreen(ctx, ev.id);
    const msg = alertText(el);
    expect(msg).toContain('Team 1 · One');
    expect(msg).toContain('one decimal');
    expect(msg).not.toContain('RankingInputError');
    expect(msg).not.toContain(t1.id);
    expect(button(el, 'Publish ranking')?.disabled ?? true).toBe(true);
    expect(el.querySelector('a[href$="/moderate"]')).not.toBeNull();
    expect(el.querySelector('form[data-penalty]')).not.toBeNull();
  });

  it('names the judge and team when a judge has two cards for the same area', async () => {
    const { api, ev, t1 } = await world();
    const id = await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const cards = await api.listCards(ev.id);
    const dup: CardRow[] = [...cards, { ...cards.find((c) => c.id === id)!, id: 'dup' }];
    const { ctx } = makeCtx(wrap(api, { listCards: async () => dup }));
    const el = await rankingsScreen(ctx, ev.id);
    expect(alertText(el)).toContain('judge@x.test');
    expect(alertText(el)).toContain('more than one');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('never shows a raw backend message when publishing fails', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(wrap(api, { publishSnapshot: async () => { throw new ApiError('unknown', 'relation ranking_snapshots does not exist'); } }));
    const el = await rankingsScreen(ctx, ev.id);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    button(el, 'Publish ranking').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('Something went wrong'));
    expect(alertText(el)).not.toContain('relation');
    expect(button(el, 'Publish ranking').disabled).toBe(false);
  });

  it('lets the organiser read the ranking but not publish, and refuses everyone else', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(button(el, 'Publish ranking')).toBeUndefined();
    await api.signIn(EMAILS.judge);
    expect(text(await rankingsScreen(ctx, ev.id))).toContain('Only the organiser or chair');
  });
});
