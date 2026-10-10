import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ApiError, createSupabaseApi, type Api } from '../../src/api';
import { canonicalJson, rank, sha256Hex } from '../../src/engine';

/**
 * End to end against a LOCAL Supabase (supabase start): real Postgres, PostgREST, Auth and row-level security.
 * Runs only when SMOKE_SUPABASE_URL, SMOKE_ANON_KEY and SMOKE_SERVICE_ROLE_KEY are set and the URL is localhost.
 * The service role key is read from `supabase status` into the environment of one command; it is never committed
 * and must never be a hosted project's key.
 */
const URL_ = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_ANON_KEY;
const SERVICE = process.env.SMOKE_SERVICE_ROLE_KEY;
const run = !!(URL_ && ANON && SERVICE) && /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_ ?? '');

/** Test setup only: the Chair clears a declared conflict, so the rest of the flow can score that team. */
async function as_chair_clear_conflict(admin: SupabaseClient, eventId: string, teamId: string) {
  const { error } = await admin.from('judge_conflicts').delete().eq('event_id', eventId).eq('team_id', teamId);
  if (error) throw error;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.code;
    throw e;
  }
  return 'ok';
};

describe.skipIf(!run)('local Supabase smoke test', () => {
  it('runs the whole judging flow against real Postgres, Auth and row-level security', async () => {
    const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    const stamp = Date.now();
    const password = 'smoke-test-password';
    const emails = {
      org: `org${stamp}@smoke.test`, chair: `chair${stamp}@smoke.test`, judge: `judge${stamp}@smoke.test`, mgr: `mgr${stamp}@smoke.test`,
      unconfirmed: `unconfirmed${stamp}@smoke.test`,
    };
    const clients: Record<string, SupabaseClient> = {};
    const asUser = async (email: string): Promise<Api> => {
      const c = createClient(URL_!, ANON!, { auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      clients[email] = c;
      return createSupabaseApi(URL_!, ANON!, c);
    };
    for (const [k, e] of Object.entries(emails)) {
      const { error } = await admin.auth.admin.createUser({ email: e, password, email_confirm: k !== 'unconfirmed' });
      if (error) throw error;
    }

    // Anonymous: nothing to claim, and the privileged functions are not executable at all.
    const anonClient = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const anon = createSupabaseApi(URL_!, ANON!, anonClient);
    expect(await anon.getSession()).toBeNull();
    expect(await anon.claimInvitations()).toBe(0);
    expect(await code(anon.openCard('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'verbal-technique'))).toBe('unauthenticated');
    expect(await code(anon.createEvent({ name: 'Nope' }))).toBe('forbidden');
    for (const [fn, args] of [
      ['audit_write', { p_event: '00000000-0000-0000-0000-000000000000', p_action: 'x', p_entity: 'x', p_entity_id: 'x', p_detail: {} }],
      ['claim_invitations', {}],
      ['create_event', { p_name: 'x', p_starts_on: null, p_ruleset: {} }],
    ] as const) {
      const { error } = await anonClient.rpc(fn, args);
      expect(error?.code, `anon execute ${fn}`).toBe('42501');
    }

    const org = await asUser(emails.org);
    const ev = await org.createEvent({ name: `Smoke ${stamp}`, startsOn: '2026-11-01' });
    const t1 = await org.createTeam(ev.id, { number: '1', name: 'One', school: 'School One' });
    const t2 = await org.createTeam(ev.id, { number: '2', name: 'Two' });
    expect(t1.school).toBe('School One');
    expect(await code(org.createTeam(ev.id, { number: ' 1 ', name: 'Dup' }))).toBe('duplicate');
    await org.invite(ev.id, { email: emails.chair, role: 'chair' });
    await org.invite(ev.id, { email: emails.judge, role: 'judge', panel: 'verbal' });
    await org.invite(ev.id, { email: emails.mgr, role: 'team_manager', teamId: t1.id });
    await org.invite(ev.id, { email: emails.unconfirmed, role: 'chair' });
    expect((await org.listInvitations(ev.id)).length).toBe(4);

    // An account whose email is not confirmed cannot claim: Auth refuses the password sign-in outright.
    const unconfirmed = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const refused = await unconfirmed.auth.signInWithPassword({ email: emails.unconfirmed, password });
    expect(refused.error?.code).toBe('email_not_confirmed');

    const chair = await asUser(emails.chair);
    const judge = await asUser(emails.judge);
    const mgr = await asUser(emails.mgr);
    for (const a of [chair, judge, mgr]) expect(await a.claimInvitations()).toBe(1);
    expect(await chair.claimInvitations()).toBe(0);
    expect((await org.listRoles(ev.id)).map((r) => r.role).sort()).toEqual(['chair', 'judge', 'organiser', 'team_manager']);
    expect((await org.listInvitations(ev.id)).map((i) => i.email)).toEqual([emails.unconfirmed]);

    // Scoring.
    expect(await code(judge.openCard(ev.id, t1.id, 'de-portfolio'))).toBe('forbidden');
    const card = await judge.openCard(ev.id, t1.id, 'verbal-technique');
    expect(card.panel).toBe('verbal');
    expect(card.status).toBe('draft');
    expect((await judge.openCard(ev.id, t1.id, 'verbal-technique')).id).toBe(card.id);
    expect(await code(judge.saveScore(card.id, 'team-contribution', 21))).toBe('invalid');
    await judge.saveScore(card.id, 'team-contribution', 12, 'Clear roles');
    expect(await code(judge.submitCard(card.id))).toBe('invalid');
    await judge.saveScore(card.id, 'engagement-presentation-dynamics', 14);
    // Comment undefined leaves the comment alone; a string, even '', replaces it.
    await judge.saveScore(card.id, 'team-contribution', 12);
    let mine = (await judge.listCards(ev.id)).find((c) => c.id === card.id)!;
    expect(mine.comments['team-contribution']).toBe('Clear roles');
    expect(mine.scores).toEqual({ 'team-contribution': 12, 'engagement-presentation-dynamics': 14 });
    await judge.submitCard(card.id);
    expect(await code(judge.saveScore(card.id, 'team-contribution', 3))).toBe('locked');
    expect(await code(judge.submitCard(card.id))).toBe('locked');
    expect(await code(judge.reopenCard(card.id, 'please'))).toBe('forbidden');

    await chair.reopenCard(card.id, 'Judge asked to fix a typo');
    await judge.saveScore(card.id, 'team-contribution', 13, '');
    mine = (await judge.listCards(ev.id)).find((c) => c.id === card.id)!;
    expect(mine.comments['team-contribution']).toBe('');
    expect(mine.reopenedCount).toBe(1);
    await judge.submitCard(card.id);

    // A conflict cannot be declared after submitting for that team; the Chair sees declared conflicts.
    expect(await code(judge.declareConflict(ev.id, t1.id))).toBe('locked');
    await judge.declareConflict(ev.id, t2.id);
    expect((await chair.listConflicts(ev.id)).map((c) => c.teamId)).toEqual([t2.id]);
    expect(await mgr.listConflicts(ev.id)).toEqual([]);
    await as_chair_clear_conflict(admin, ev.id, t2.id);

    // A second card left in draft: it must stay invisible to the team manager and must freeze on release.
    const draft = await judge.openCard(ev.id, t2.id, 'verbal-technique');
    await judge.saveScore(draft.id, 'team-contribution', 5);

    expect(await mgr.listCards(ev.id)).toEqual([]);
    await chair.setOverride(ev.id, t2.id, 'pit-display', 40, 'Cross-moderated by the Chair');
    await chair.setOverride(ev.id, t2.id, 'pit-display', 41, 'Re-moderated');
    expect((await chair.listOverrides(ev.id)).map((o) => [o.areaId, o.value])).toEqual([['pit-display', 41]]);
    await chair.addPenalty(ev.id, t1.id, 15, 'Unsuccessful appeal');
    expect(await code(judge.addPenalty(ev.id, t1.id, 5, 'Not mine to give'))).toBe('forbidden');

    const publish = async () => {
      const [teams, cards, overrides, penalties] = await Promise.all([
        chair.listTeams(ev.id), chair.listCards(ev.id), chair.listOverrides(ev.id), chair.listPenalties(ev.id),
      ]);
      const inputs = {
        teams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
        cards: cards.filter((c) => c.status === 'submitted').map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: c.scores })),
        overrides: overrides.map((o) => ({ teamId: o.teamId, areaId: o.areaId, value: o.value })),
        penalties: penalties.map((p) => ({ teamId: p.teamId, points: p.points })),
      };
      const ranking = rank({ ruleset: ev.ruleset, ...inputs });
      const hash = await sha256Hex(canonicalJson({ rulesetId: ev.ruleset.id, inputs, rows: ranking.rows }));
      const snap = await chair.publishSnapshot(ev.id, { rulesetId: ev.ruleset.id, inputHash: hash, inputs, rows: ranking.rows });
      return { snap, inputs, ranking, hash };
    };
    let first = await publish();
    expect(first.ranking.rows.find((r) => r.teamId === t1.id)!.total).toBe(27 - 15);
    expect(first.snap.inputHash).toBe(first.hash);
    expect(Object.keys(first.snap)).not.toContain('inputs');

    // A snapshot can only be released-capable.
    const hidden = await clients[emails.chair].from('ranking_snapshots').insert({
      event_id: ev.id, ruleset_id: ev.ruleset.id, input_hash: 'f'.repeat(64), inputs: {}, rows: [], released: false,
    });
    expect(hidden.error?.code).toBe('23514');

    // Release is decided by the server: a direct update is not granted, and a ranking that is out of date is refused.
    const direct = await clients[emails.chair].from('events').update({ results_released: true }).eq('id', ev.id).select('id');
    expect(direct.error?.code).toBe('42501');
    await chair.setOverride(ev.id, t2.id, 'pit-display', 42, 'Late correction');
    expect(await code(chair.setReleased(ev.id, true))).toBe('locked');
    expect(await code(org.setReleased(ev.id, true))).toBe('forbidden');
    first = await publish();
    expect(first.ranking.rows.find((r) => r.teamId === t1.id)!.total).toBe(27 - 15);

    // Not released yet: the public sees nothing, the team manager sees no cards.
    expect(await anon.latestSnapshot(ev.id)).toBeNull();
    expect(await anon.getEvent(ev.id)).toBeNull();
    expect(await anon.listTeams(ev.id)).toEqual([]);
    expect(await anon.listCards(ev.id)).toEqual([]);
    expect(await code(judge.setReleased(ev.id, true))).toBe('forbidden');
    await chair.setReleased(ev.id, true);
    expect((await chair.getEvent(ev.id))!.resultsReleased).toBe(true);

    // Released: public reads the snapshot, not its inputs.
    expect((await anon.latestSnapshot(ev.id))?.id).toBe(first.snap.id);
    expect((await anon.getEvent(ev.id))?.resultsReleased).toBe(true);
    expect((await anon.listTeams(ev.id)).map((t) => t.number)).toEqual(['1', '2']);
    const colRead = await anonClient.from('ranking_snapshots').select('inputs').eq('id', first.snap.id);
    expect(colRead.error?.code).toBe('42501');
    expect((await mgr.latestSnapshot(ev.id))?.id).toBe(first.snap.id);
    const mgrRead = await clients[emails.mgr].from('ranking_snapshots').select('inputs').eq('id', first.snap.id);
    expect(mgrRead.error?.code).toBe('42501');
    expect(await code(anon.getSnapshotInputs(first.snap.id))).toBe('forbidden');
    expect(await code(mgr.getSnapshotInputs(first.snap.id))).toBe('forbidden');
    expect(await code(judge.getSnapshotInputs(first.snap.id))).toBe('forbidden');
    expect(await chair.getSnapshotInputs(first.snap.id)).toEqual(JSON.parse(JSON.stringify(first.inputs)));
    expect(await org.getSnapshotInputs(first.snap.id)).toEqual(JSON.parse(JSON.stringify(first.inputs)));

    // Team manager: only submitted cards of their own team.
    expect((await mgr.listCards(ev.id)).map((c) => [c.teamId, c.status])).toEqual([[t1.id, 'submitted']]);

    // Freeze: cards, scores, overrides and penalties are locked until the Chair withdraws the release.
    expect(await code(judge.saveScore(draft.id, 'team-contribution', 6))).toBe('locked');
    expect(await code(judge.submitCard(draft.id))).toBe('locked');
    expect(await code(judge.openCard(ev.id, t2.id, 'verbal-composition'))).toBe('locked');
    expect(await code(chair.reopenCard(card.id, 'Too late for this'))).toBe('locked');
    expect(await code(chair.setOverride(ev.id, t2.id, 'pit-display', 30, 'Frozen'))).toBe('locked');
    expect(await code(chair.addPenalty(ev.id, t2.id, 5, 'Frozen'))).toBe('locked');
    const penalty = (await chair.listPenalties(ev.id))[0];
    expect(await code(chair.removePenalty(penalty.id))).toBe('locked');
    expect(await code(chair.removeOverride(ev.id, t2.id, 'pit-display'))).toBe('locked');
    expect(await code(judge.setReleased(ev.id, false))).toBe('forbidden');

    // Withdraw, then the penalty can go; a new snapshot supersedes the old and the old one stays as the record.
    await chair.setReleased(ev.id, false);
    expect(await anon.latestSnapshot(ev.id)).toBeNull();
    expect(await code(judge.removePenalty(penalty.id))).toBe('forbidden');
    await chair.removePenalty(penalty.id);
    expect(await chair.listPenalties(ev.id)).toEqual([]);
    expect(await code(judge.removeOverride(ev.id, t2.id, 'pit-display'))).toBe('forbidden');
    await chair.removeOverride(ev.id, t2.id, 'pit-display');
    expect(await chair.listOverrides(ev.id)).toEqual([]);
    expect(await code(chair.removeOverride(ev.id, t2.id, 'pit-display'))).toBe('forbidden');
    expect(await code(chair.removePenalty(penalty.id))).toBe('forbidden');
    const second = await publish();
    expect(second.ranking.rows.find((r) => r.teamId === t1.id)!.total).toBe(27);
    expect(second.snap.id).not.toBe(first.snap.id);
    expect(second.hash).not.toBe(first.hash);
    await chair.setReleased(ev.id, true);
    expect((await anon.latestSnapshot(ev.id))?.id).toBe(second.snap.id);
    expect(await chair.getSnapshotInputs(first.snap.id)).toEqual(JSON.parse(JSON.stringify(first.inputs)));

    // Paging: a page size of 1 forces several requests per list; nothing may be lost or repeated.
    const paged = createSupabaseApi(URL_!, ANON!, clients[emails.chair], { pageSize: 1 });
    const whole = await chair.listCards(ev.id);
    const viaPages = await paged.listCards(ev.id);
    expect(whole.length).toBeGreaterThanOrEqual(2);
    expect(viaPages.map((c) => c.id).sort()).toEqual(whole.map((c) => c.id).sort());
    expect(new Set(viaPages.map((c) => c.id)).size).toBe(viaPages.length);
    expect((await paged.listTeams(ev.id)).map((t) => t.id).sort()).toEqual((await chair.listTeams(ev.id)).map((t) => t.id).sort());
    expect((await paged.listRoles(ev.id)).length).toBe((await chair.listRoles(ev.id)).length);

    // Sign-in link: Auth accepts the request (the message lands in the local mail catcher, not on the internet).
    await anon.signIn(emails.org);
    expect(await code(anon.signIn('not-an-email'))).toBe('invalid');
    // A signed-out client's refused write is 'unauthenticated', never 'forbidden': the offline queue must keep it.
    await judge.signOut();
    expect(await judge.getSession()).toBeNull();
    expect(await code(judge.saveScore(draft.id, 'team-contribution', 7))).toBe('unauthenticated');
  }, 60_000);
});
