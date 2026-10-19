import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseApi, type Api } from '../../src/api';
import { blankReview } from '../../src/api/review';
import { canonicalJson, rank, sha256Hex } from '../../src/engine';

// Opt-in only. Credentials stay in a private temporary file and are never part of the repository or client build.
const configPath = process.env.STEM_SHARED_CHECK_CONFIG;
const config: { projectRef: string; anonKey: string; serviceKey: string; schema: string } | null = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
const run = !!config && process.env.STEM_SHARED_CHECK_PROJECT === config.projectRef;

describe.skipIf(!run)('shared workspace across independent authenticated clients', () => {
  it('shares scores with staff, keeps judges and private notes isolated, and preserves the release workflow', async () => {
    const url = `https://${config!.projectRef}.supabase.co`;
    const admin = createClient(url, config!.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const stamp = crypto.randomUUID();
    const password = crypto.randomUUID() + 'aA9!';
    const accounts = ['organiser', 'chair', 'judge', 'otherjudge', 'manager'] as const;
    const users: string[] = [];
    const apis = {} as Record<typeof accounts[number], Api>;
    const clients: ReturnType<typeof createClient>[] = [];
    let event: Awaited<ReturnType<Api['createEvent']>> | undefined;
    const name = `System connectivity check ${stamp}`;
    try {
      for (const account of accounts) {
        const email = `stem-${account}-${stamp}@example.invalid`;
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw created.error;
        users.push(created.data.user.id);
        const client = createClient(url, config!.anonKey, { db: { schema: config!.schema }, auth: { persistSession: false, autoRefreshToken: false } });
        clients.push(client as ReturnType<typeof createClient>);
        const login = await client.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        apis[account] = createSupabaseApi(url, config!.anonKey, client, { schema: config!.schema });
      }
      const { organiser, chair, judge, otherjudge, manager } = apis;
      event = await organiser.createEvent({ name });
      const team = await organiser.createTeam(event.id, { number: '001', name: 'Connectivity test team' });
      for (const [account, role, panel] of [['chair', 'chair', undefined], ['judge', 'judge', 'verbal'], ['otherjudge', 'judge', 'verbal'], ['manager', 'team_manager', undefined]] as const) {
        await organiser.invite(event.id, { email: (await apis[account].getSession())!.email, role, panel, ...(role === 'team_manager' ? { teamId: team.id } : {}) });
        expect(await apis[account].claimInvitations()).toBe(1);
      }
      const card = await judge.openCard(event.id, team.id, 'verbal-technique');
      await judge.saveScore(card.id, 'engagement-presentation-dynamics', 17);
      await judge.saveScore(card.id, 'team-contribution', 18);
      await judge.saveReview(card.id, { ...blankReview(), overall: 'Shared feedback', internalNotes: 'Private judging discussion' });
      for (const viewer of [organiser, chair]) {
        const saved = (await viewer.listCards(event.id)).find((c) => c.id === card.id)!;
        expect(saved.scores).toEqual({ 'engagement-presentation-dynamics': 17, 'team-contribution': 18 });
        expect(saved.status).toBe('draft');
      }
      expect((await organiser.getReview(card.id)).internalNotes).toBe('');
      expect((await chair.getReview(card.id)).internalNotes).toBe('Private judging discussion');
      expect(await otherjudge.listCards(event.id)).toEqual([]);
      expect(await manager.listCards(event.id)).toEqual([]);
      await judge.submitCard(card.id);
      expect((await organiser.listCards(event.id))[0].status).toBe('submitted');
      await expect(organiser.reopenCard(card.id, 'Test correction')).rejects.toMatchObject({ code: 'forbidden' });
      await chair.reopenCard(card.id, 'Test correction');
      await judge.saveScore(card.id, 'team-contribution', 19); await judge.submitCard(card.id);
      expect((await organiser.listCards(event.id))[0].scores['team-contribution']).toBe(19);
      const teams = await chair.listTeams(event.id), cards = await chair.listCards(event.id);
      const inputs = { teams: teams.map(({id,number,name})=>({id,number,name})), cards: cards.map(({teamId,areaId,judgeId,scores})=>({teamId,areaId,judgeId,scores})), overrides: [], penalties: [] };
      const ranking = rank({ ruleset: event.ruleset, ...inputs });
      await chair.publishSnapshot(event.id, { rulesetId: event.ruleset.id, inputHash: await sha256Hex(canonicalJson(inputs)), inputs, rows: ranking.rows });
      await chair.setReleased(event.id, true);
      expect((await manager.listCards(event.id))[0].scores['team-contribution']).toBe(19);
      expect((await manager.getReview(card.id)).internalNotes).toBe('');
      expect((await manager.listFeedback(event.id))[0].overall).toBe('Shared feedback');
      expect((await manager.latestSnapshot(event.id))?.rows[0].total).toBe(36);
      await expect(judge.saveScore(card.id, 'team-contribution', 20)).rejects.toMatchObject({ code: 'locked' });
      await organiser.deleteEvent(event.id, name);
      expect(await judge.getEvent(event.id)).toBeNull();
    } finally {
      if (event) await apis.organiser.deleteEvent(event.id, name);
      for (const id of users) { const result = await admin.auth.admin.deleteUser(id); if (result.error) throw result.error; }
      await Promise.all(clients.map((client) => client.auth.signOut()));
    }
  }, 120_000);
});
