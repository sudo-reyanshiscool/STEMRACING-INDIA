import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';
import { rank } from '../../src/engine';
import { DEMO_PANEL_JUDGES, DEMO_PERSONAS, DEMO_TEAMS, seedDemo, seededRandom } from '../../src/ui/demo';

async function seeded() {
  const api = new MemoryApi();
  await seedDemo(api);
  return api;
}

describe('demo data', () => {
  it('leaves the original three-team event empty for the persona walkthrough', async () => {
    const api = await seeded();
    const events = await api.listEvents();
    const sample = events.find((e) => e.name.startsWith('Sample event'))!;
    expect((await api.listTeams(sample.id)).map((t) => t.name)).toEqual(['Sample team 1', 'Sample team 2', 'Sample team 3']);
    await api.signIn('chair@demo.test');
    expect(await api.listCards(sample.id)).toEqual([]);
    await api.signIn('judge-verbal@demo.test');
    expect((await api.myRoles(sample.id)).map((r) => [r.role, r.panel])).toEqual([['judge', 'verbal']]);
  });

  it('adds a 12-team event whose every card is submitted, two judges per panel', async () => {
    const api = await seeded();
    const big = (await api.listEvents()).find((e) => e.name.startsWith('National Finals rehearsal'))!;
    await api.signIn('chair@demo.test');
    const teams = await api.listTeams(big.id);
    expect(teams).toHaveLength(12);
    expect(teams.map((t) => t.name)).toEqual(DEMO_TEAMS.map((t) => t.name));
    const cards = await api.listCards(big.id);
    const scorecardAreas = big.ruleset.areas.filter((a) => a.kind === 'scorecard');
    expect(cards).toHaveLength(12 * scorecardAreas.length * 2);
    expect(cards.every((c) => c.status === 'submitted')).toBe(true);
    for (const panel of Object.keys(DEMO_PANEL_JUDGES) as Array<keyof typeof DEMO_PANEL_JUDGES>) {
      expect(new Set(cards.filter((c) => c.panel === panel).map((c) => c.judgeId)).size).toBe(2);
    }
    expect(await api.latestSnapshot(big.id)).toBeNull();
    expect(big.resultsReleased).toBe(false);
  });

  it('ranks all twelve teams with a spread of totals', async () => {
    const api = await seeded();
    const big = (await api.listEvents()).find((e) => e.name.startsWith('National Finals rehearsal'))!;
    await api.signIn('chair@demo.test');
    const [teams, cards] = await Promise.all([api.listTeams(big.id), api.listCards(big.id)]);
    const ranking = rank({
      ruleset: big.ruleset,
      teams: teams.map((t) => ({ id: t.id, number: t.number, name: t.name })),
      cards: cards.map((c) => ({ teamId: c.teamId, areaId: c.areaId, judgeId: c.judgeId, scores: c.scores })),
      overrides: [],
      penalties: [],
    });
    expect(ranking.rows).toHaveLength(12);
    expect(ranking.rows.every((r) => r.judgedComplete)).toBe(true);
    const totals = ranking.rows.map((r) => r.total);
    expect(Math.max(...totals) - Math.min(...totals)).toBeGreaterThan(30);
    expect(totals.every((t) => t > 0)).toBe(true);
  });

  it('is deterministic', async () => {
    const [a, b] = [await seeded(), await seeded()];
    const scoresOf = async (api: MemoryApi) => {
      const ev = (await api.listEvents()).find((e) => e.name.startsWith('National Finals rehearsal'))!;
      await api.signIn('chair@demo.test');
      const teams = new Map((await api.listTeams(ev.id)).map((t) => [t.id, t.number]));
      return (await api.listCards(ev.id)).map((c) => [teams.get(c.teamId), c.areaId, c.panel, c.scores]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    };
    expect(await scoresOf(a)).toEqual(await scoresOf(b));
    expect(seededRandom(1)()).toBe(seededRandom(1)());
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });

  it('every persona can sign in and sees at least one event', async () => {
    const api = await seeded();
    for (const p of DEMO_PERSONAS) {
      await api.signIn(p.email);
      expect((await api.listEvents()).length).toBeGreaterThan(0);
    }
  });
});
