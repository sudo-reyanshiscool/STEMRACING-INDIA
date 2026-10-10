import { vi } from 'vitest';
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
