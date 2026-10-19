// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type CardRow, type OverrideRow } from '../../src/api';
import { rankingsScreen } from '../../src/ui/rankings';
import { EMAILS, makeCtx, releaseResults, text, world } from './helpers';

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
const tick = (el: HTMLElement, on = true) => {
  const box = el.querySelector('input[name=ack]') as HTMLInputElement;
  box.checked = on;
  box.dispatchEvent(new Event('change'));
};
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

  it('pins the Total column so it stays in view when the table scrolls sideways on a phone', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const pinned = [...el.querySelectorAll('.pin-end')];
    expect(pinned.length).toBe(1 + 2); // header plus one row per team
    expect(text(pinned[0] as HTMLElement)).toBe('Total');
    expect([...el.querySelectorAll('thead th')].at(-1)).toBe(pinned[0]);
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

    // A click while the previous action is still finishing is ignored by design, so click until it takes.
    await vi.waitFor(async () => {
      button(el, 'Release results to teams and the public')?.click();
      expect((await api.getEvent(ev.id))?.resultsReleased).toBe(true);
    });
    await vi.waitFor(() => expect(button(el, 'Withdraw released results')).toBeDefined());
    expect(text(el)).toContain('Results are released');
    await vi.waitFor(async () => {
      button(el, 'Withdraw released results')?.click();
      expect((await api.getEvent(ev.id))?.resultsReleased).toBe(false);
    });
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
    tick(el);
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
    await releaseResults(api, ev.id);
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
    await releaseResults(api, ev.id);
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

  it('removes a mistaken penalty only after a second, confirming click, and re-ranks', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    await api.addPenalty(ev.id, t1.id, 15, 'Entered by mistake');
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Entered by mistake');
    expect([...el.querySelectorAll('tbody tr')][0].lastElementChild!.textContent).toBe('11');
    button(el, 'Remove penalty').click();
    await wait();
    expect(await api.listPenalties(ev.id)).toHaveLength(1);
    button(el, 'Confirm: remove this penalty').click();
    await vi.waitFor(async () => expect(await api.listPenalties(ev.id)).toEqual([]));
    await vi.waitFor(() => expect([...el.querySelectorAll('tbody tr')][0].lastElementChild!.textContent).toBe('26'));
  });

  it('refuses a published fingerprint once a penalty has been removed', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    await api.addPenalty(ev.id, t1.id, 5, 'Entered by mistake');
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    const before = (await api.latestSnapshot(ev.id))!.inputHash;
    await vi.waitFor(() => expect(button(el, 'Release results to teams and the public').disabled).toBe(false));
    button(el, 'Remove penalty').click();
    button(el, 'Confirm: remove this penalty').click();
    await vi.waitFor(() => expect(text(el)).toContain('out of date'));
    expect(button(el, 'Release results to teams and the public').disabled).toBe(true);
    await vi.waitFor(() => expect(button(el, 'Publish ranking').disabled).toBe(false));
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect((await api.latestSnapshot(ev.id))!.inputHash).not.toBe(before));
  });

  it('shows no remove button while released, and explains a locked refusal', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.addPenalty(ev.id, t1.id, 5, 'Late arrival');
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    button(el, 'Remove penalty').click();
    await releaseResults(api, ev.id);
    button(el, 'Confirm: remove this penalty').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('Withdraw the release to change this'));
    await vi.waitFor(() => expect(button(el, 'Remove penalty')).toBeUndefined());
    expect(await api.listPenalties(ev.id)).toHaveLength(1);
  });

  it('needs an explicit acknowledgement to publish or release with cards still in draft', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.judge);
    const d = await api.openCard(ev.id, t2.id, 'verbal-technique');
    await api.saveScore(d.id, 'team-contribution', 5);
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('1 scorecard is still a draft');
    expect(text(el.querySelector('label:has(input[name=ack])')!)).toContain('Publish with 1 card still in draft');
    button(el, 'Publish ranking').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('still in draft'));
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    tick(el);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    await vi.waitFor(() => expect(button(el, 'Release results to teams and the public').disabled).toBe(false));
    tick(el, false);
    button(el, 'Release results to teams and the public').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('still in draft'));
    expect((await api.getEvent(ev.id))?.resultsReleased).toBe(false);
    tick(el);
    button(el, 'Release results to teams and the public').click();
    await vi.waitFor(async () => expect((await api.getEvent(ev.id))?.resultsReleased).toBe(true));
  });

  it('asks the Chair to settle ties before releasing and needs the same acknowledgement', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('Settle ties before releasing');
    expect(text(el.querySelector('label:has(input[name=ack])')!)).toContain('tie');
    button(el, 'Publish ranking').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('tie'));
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    tick(el);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
  });

  it('lets the organiser publish rankings, and refuses judges', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    expect(button(el, 'Publish ranking')).toBeDefined();
    await api.signIn(EMAILS.judge);
    expect(text(await rankingsScreen(ctx, ev.id))).toContain('Only the organiser or chair');
  });
});

describe('rankingsScreen conflicted cards', () => {
  it('says how many counted cards belong to a judge who declared a conflict, and needs the acknowledgement', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await scoreTeam(api, ev.id, t2.id, 5, 5);
    await api.signIn(EMAILS.chair);
    const judgeId = (await api.listCards(ev.id))[0].judgeId;
    const conflicted = wrap(api, { listConflicts: async () => [{ eventId: ev.id, judgeId, teamId: t1.id }] });
    const { ctx } = makeCtx(conflicted);
    const el = await rankingsScreen(ctx, ev.id);
    expect(text(el)).toContain('1 counted card belongs to a judge who declared a conflict');
    expect(el.querySelector('input[name=ack]')).not.toBeNull();
    button(el, 'Publish ranking').click();
    await wait();
    expect(alertText(el)).toContain('conflict');
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    tick(el);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
  });
});

describe('rankingsScreen after an override is removed', () => {
  it('shows the published ranking as out of date, because the fingerprint covers overrides', async () => {
    const { api, ev, t1, t2 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await scoreTeam(api, ev.id, t2.id, 5, 5);
    await api.signIn(EMAILS.chair);
    await api.setOverride(ev.id, t2.id, 'verbal-technique', 39, 'Cross-moderated');
    const { ctx } = makeCtx(api);
    let el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    el = await rankingsScreen(makeCtx(api).ctx, ev.id);
    expect(text(el)).toContain('matches the ranking above');
    await api.removeOverride(ev.id, t2.id, 'verbal-technique');
    el = await rankingsScreen(makeCtx(api).ctx, ev.id);
    expect(text(el)).not.toContain('matches the ranking above');
    expect(text(el)).toContain('out of date');
  });
});

describe('rankingsScreen when the server refuses a release', () => {
  it('explains an out-of-date refusal in words and refreshes, instead of the released-results text', async () => {
    const { api, ev, t1 } = await world();
    await scoreTeam(api, ev.id, t1.id, 14, 12);
    await api.signIn(EMAILS.chair);
    const refusing = wrap(api, { setReleased: async () => { throw new ApiError('locked', 'The published ranking is out of date. Publish it again before releasing.'); } });
    const { ctx } = makeCtx(refusing);
    let el = await rankingsScreen(ctx, ev.id);
    button(el, 'Publish ranking').click();
    await vi.waitFor(async () => expect(await api.latestSnapshot(ev.id)).not.toBeNull());
    el = await rankingsScreen(makeCtx(refusing).ctx, ev.id);
    button(el, 'Release results to teams and the public').click();
    await vi.waitFor(() => expect(alertText(el)).toContain('out of date'));
    const t = alertText(el);
    expect(t).toContain('out of date');
    expect(t).not.toContain('Results are released, so');
    expect((await api.getEvent(ev.id))!.resultsReleased).toBe(false);
  });
});

describe('rankingsScreen with technical inspections', () => {
  it('incorporates Car A and Car B submitted inspection penalties into Specification category derived score', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'scrut@x.test', role: 'scrutineer' });
    await api.signIn('scrut@x.test');
    await api.claimInvitations();
    // Car A has T3.6 at 49.0 g (1 g under 50.0 g min = -10 pts)
    const ia = await api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 49.0 });
    // Car B has no penalties
    const ib = await api.saveInspection(ev.id, t1.id, 'B', { 'T3.6': 50.0 });
    await api.submitInspection(ia.id);
    await api.submitInspection(ib.id);

    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await rankingsScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    const t1Row = rows.find((r) => r[1].includes('Team 1 · One'))!;
    expect(t1Row[2]).toBe('90');
  });
});
