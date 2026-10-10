// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RankRow } from '../../src/engine';
import { resultsScreen } from '../../src/ui/results';
import { EMAILS, makeCtx, releaseResults, text, world } from './helpers';

const HASH = 'c'.repeat(64);
const row = (over: Partial<RankRow>): RankRow => ({
  rank: 1, teamId: 't', number: '1', name: 'One', areas: {}, categories: { verbal: 26 }, subtotal: 26, penalties: 0, total: 26, judgedComplete: true, tied: false, ...over,
});
const cells = (el: Element) => [...el.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));

describe('resultsScreen', () => {
  it('shows an unreleased event to nobody outside the event, with no data', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(text(el)).toContain('not been released');
    expect(el.querySelector('table')).toBeNull();
    expect(text(el)).not.toContain(HASH);
  });

  it('says results are not released yet to a signed-in team member before release, with no data', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    await api.signIn(EMAILS.mgr);
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(text(el)).toContain('Results have not been released yet');
    expect(el.querySelector('table')).toBeNull();
  });

  it('says results are not published yet if a released event has no visible snapshot', async () => {
    // The server refuses to release without a ranking, so this is a defensive state: the screen must still say so.
    const { api, ev } = await world();
    await releaseResults(api, ev.id);
    await api.signOut();
    const none = new Proxy(api, { get: (t, k) => (k === 'latestSnapshot' ? async () => null : (t as never)[k]) });
    const { ctx } = makeCtx(none as typeof api);
    expect(text(await resultsScreen(ctx, ev.id))).toContain('not been published');
  });

  it('shows the public the released ranking, hostile names as plain text, judged-so-far wording, date and hash', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, {
      rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: { secret: 'judge-private' },
      rows: [row({ teamId: t1.id, name: '<img src=x onerror=alert(1)> 🚗', judgedComplete: false }), row({ rank: 2, teamId: 'x', number: '2', name: 'Two', total: 20, categories: { verbal: 20 } })],
    });
    await releaseResults(api, ev.id);
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(el.querySelector('img')).toBeNull();
    const rows = cells(el);
    expect(rows[0][1]).toContain('<img src=x onerror=alert(1)> 🚗');
    expect(rows[0].at(-1)).toBe('26');
    const t = text(el);
    expect(t).toContain('Judged points so far — racing and specification are not included yet');
    expect(t).toContain('650 of 1000');
    expect(t).toContain(HASH);
    expect(t).toMatch(/Snapshot taken \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(t).toContain('Provisional');
    expect(t).not.toContain('Your scorecards');
    expect(t).not.toContain('judge-private');
    expect(t).not.toContain('Not released');
  });

  it('shows the latest snapshot to the public', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id, name: 'Released' })] });
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: 'd'.repeat(64), inputs: {}, rows: [row({ teamId: t1.id, name: 'Second run' })] });
    await releaseResults(api, ev.id);
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(text(el)).toContain('Second run');
    expect(text(el)).not.toContain('Released');
    expect(text(el)).toContain('d'.repeat(64));
  });

  it('shows a team manager their own breakdown with comments after release, and nothing of other teams', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(EMAILS.judge);
    for (const [team, c] of [[t1, 'Clear roles'], [t2, 'Other team comment']] as const) {
      const card = await api.openCard(ev.id, team.id, 'verbal-technique');
      await api.saveScore(card.id, 'engagement-presentation-dynamics', 14, 'Engaging');
      await api.saveScore(card.id, 'team-contribution', 12, c);
      await api.submitCard(card.id);
    }
    // a draft card of the manager's team must never appear
    const draft = await api.openCard(ev.id, t1.id, 'verbal-composition');
    await api.saveScore(draft.id, 'content-quality', 9, 'Draft thought');
    await api.signIn(EMAILS.chair);
    await api.addPenalty(ev.id, t1.id, 2, 'Late to the pit');
    await api.addPenalty(ev.id, t2.id, 3, 'Other team penalty reason');
    await api.signIn(EMAILS.mgr);
    const { ctx } = makeCtx(api);
    expect(text(await resultsScreen(ctx, ev.id))).toContain('not been released');
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, {
      rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {},
      rows: [row({ teamId: t1.id, areas: { 'verbal-technique': 26 }, penalties: 2, total: 24 }), row({ rank: 2, teamId: t2.id, number: '2', name: 'Two', areas: { 'verbal-technique': 26 }, penalties: 3, total: 23 })],
    });
    await releaseResults(api, ev.id);
    await api.signIn(EMAILS.mgr);
    const el = await resultsScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('Your team');
    expect(t).toContain('Verbal Presentation: Technique');
    expect(t).toContain('26 of 40');
    expect(t).toContain('Clear roles');
    expect(t).toContain('14 / 20');
    expect(t).toContain('Late to the pit');
    expect(t).not.toContain('Other team comment');
    expect(t).not.toContain('Other team penalty reason');
    expect(t).not.toContain('Draft thought');
    expect(t).not.toContain(EMAILS.judge);
    expect(t).toContain('Judge 1');
  });

  it('does not show a judge or a staff member any scorecard breakdown on the results page', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'engagement-presentation-dynamics', 10);
    await api.saveScore(card.id, 'team-contribution', 12, 'Private note');
    await api.submitCard(card.id);
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    await releaseResults(api, ev.id);
    for (const who of [EMAILS.judge, EMAILS.chair]) {
      await api.signIn(who);
      const { ctx } = makeCtx(api);
      const t = text(await resultsScreen(ctx, ev.id));
      expect(t).not.toContain('Private note');
      expect(t).not.toContain('Your team');
    }
  });

  it('shows staff the latest snapshot before release, marked as not released', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    const { ctx } = makeCtx(api);
    const t = text(await resultsScreen(ctx, ev.id));
    expect(t).toContain('Not released');
    expect(t).toContain('One');
  });

  it('shows tied teams with a shared rank and says so in words', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ tied: true }), row({ number: '2', name: 'Two', teamId: 'x', tied: true }), row({ rank: 3, number: '3', name: 'Three', teamId: 'y', total: 5 })] });
    await releaseResults(api, ev.id);
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    const rows = cells(el);
    expect(rows.map((r) => r[0])).toEqual(['1', '1', '3']);
    expect(text(el)).toContain('Tied');
    expect(text(el)).toContain('share a rank');
  });

  it('keeps 40 teams with very long names inside a scrolling table wrapper that wraps names', async () => {
    const { api, ev } = await world();
    const long = 'Extraordinarily'.repeat(12);
    const rows = Array.from({ length: 40 }, (_, i) => row({ rank: i + 1, teamId: `t${i}`, number: String(i + 1), name: `${long} ${i}`, total: 100 - i }));
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows });
    await releaseResults(api, ev.id);
    await api.signOut();
    const { ctx } = makeCtx(api);
    const el = await resultsScreen(ctx, ev.id);
    expect(el.querySelectorAll('tbody tr').length).toBe(40);
    const table = el.querySelector('table')!;
    expect(table.closest('.table-wrap')).not.toBeNull();
    expect(table.classList.contains('results-table')).toBe(true);
    expect(el.querySelector('tbody th[scope="row"]')!.classList.contains('results-team')).toBe(true);
  });

  it('shows fixed text, not the backend message, when the manager data cannot be read', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.chair);
    await api.publishSnapshot(ev.id, { rulesetId: 'india-national-finals-2026', inputHash: HASH, inputs: {}, rows: [row({ teamId: t1.id })] });
    await releaseResults(api, ev.id);
    await api.signIn(EMAILS.mgr);
    const { ApiError } = await import('../../src/api');
    const failing = Object.create(api) as typeof api;
    failing.listCards = async () => { throw new ApiError('unknown', 'relation "cards" violates constraint xyz'); };
    const { ctx } = makeCtx(failing);
    const el = await resultsScreen(ctx, ev.id);
    expect(text(el)).not.toContain('xyz');
    expect(text(el)).toContain('Something went wrong');
    expect(el.querySelector('table')).not.toBeNull();
  });
});
