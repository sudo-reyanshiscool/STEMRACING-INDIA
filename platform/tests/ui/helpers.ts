import { vi } from 'vitest';
import type { RankRow } from '../../src/engine';
import { MemoryApi, ScoreQueue, memoryKV, type Api } from '../../src/api';
import type { Ctx } from '../../src/ui/ctx';

export const EMAILS = { org: 'org@x.test', chair: 'chair@x.test', judge: 'judge@x.test', lead: 'lead@x.test', mgr: 'mgr@x.test' } as const;

/** An event with two teams and one person in each role. Leaves the session signed in as the team manager. */
export async function world() {
  const api = new MemoryApi();
  await api.signIn(EMAILS.org);
  const ev = await api.createEvent({ name: 'Nationals', startsOn: '2026-11-01' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'One' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Two' });
  await api.invite(ev.id, { email: EMAILS.chair, role: 'chair' });
  await api.invite(ev.id, { email: EMAILS.judge, role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: EMAILS.lead, role: 'lead_judge', panel: 'verbal' });
  await api.invite(ev.id, { email: EMAILS.mgr, role: 'team_manager', teamId: t1.id });
  for (const e of [EMAILS.chair, EMAILS.judge, EMAILS.lead, EMAILS.mgr]) {
    await api.signIn(e);
    await api.claimInvitations();
  }
  return { api, ev, t1, t2 };
}

export function makeCtx(api: Api, queueApi: Pick<Api, 'saveScore'> = api) {
  const main = document.createElement('div');
  const leaves: Array<() => void> = [];
  const queue = new ScoreQueue(queueApi, memoryKV());
  const ctx: Ctx = {
    api, queue, enqueueScore: async (i) => { queue.enqueue(i); await queue.flush(); }, flush: () => queue.flush(), main, demo: false,
    rerender: vi.fn(), onLeave: (f) => { leaves.push(f); },
  };
  return { ctx, leaves, queue };
}

export const text = (el: Element) => el.textContent ?? '';

/**
 * Releases results as the Chair, the way the server demands: the latest published ranking must match what is counted.
 * If it does not (or none exists) a snapshot of the current inputs is published first. Restores whoever was signed in.
 */
export async function releaseResults(api: MemoryApi, eventId: string, rows: RankRow[] = []) {
  const before = await api.getSession();
  await api.signIn(EMAILS.chair);
  try {
    await api.setReleased(eventId, true);
  } catch {
    const [teams, cards, overrides, penalties, event] = await Promise.all([
      api.listTeams(eventId), api.listCards(eventId), api.listOverrides(eventId), api.listPenalties(eventId), api.getEvent(eventId),
    ]);
    const inputs = {
      teams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
      cards: cards.filter((c) => c.status === 'submitted').map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: c.scores })),
      overrides: overrides.map((o) => ({ teamId: o.teamId, areaId: o.areaId, value: o.value })),
      penalties: penalties.map((p) => ({ teamId: p.teamId, points: p.points })),
    };
    await api.publishSnapshot(eventId, { rulesetId: event!.ruleset.id, inputHash: 'a'.repeat(64), inputs, rows });
    await api.setReleased(eventId, true);
  }
  if (before) await api.signIn(before.email);
}

/** Complete the required feedback and review step before testing final submission. */
export async function reviewScorecard(el: HTMLElement) {
  const overall = el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Overall Comment"]')!;
  overall.value = 'Clear presentation and strong teamwork.';
  overall.dispatchEvent(new Event('input', { bubbles: true }));
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Check card')!.click();
  await vi.waitFor(() => expectVisible());
  function expectVisible() {
    const summary = el.querySelector<HTMLElement>('[aria-label="Scorecard review"]');
    if (!summary || summary.hidden) throw new Error('Scorecard review has not opened');
  }
}
