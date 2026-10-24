import { describe, expect, it } from 'vitest';
import { rank, validateScores, sha256Fallback, canonicalJson, type RankInputs } from '../../src/engine';
import { INDIA_TECHNICAL, summarise } from '../../src/technical';
import { competitionScores } from '../../src/racing/competition';
import { validateRace } from '../../src/racing';
import { buildShowcaseExamples } from '../../src/api/showcase-examples';
import { MemoryApi } from '../../src/api/memory';
import { loadShowcase, SHOWCASE_EVENT_ID } from '../../src/api/showcase';
import { readOnlySource, showcaseSeed } from '../fixtures/showcase';

describe('completed six-team showcase', () => {
  it('includes six teams and valid submitted scorecards with feedback for every panel', () => {
    const seed = buildShowcaseExamples(showcaseSeed().event);
    const areas = seed.event.ruleset.areas.filter(a => a.kind === 'scorecard');
    expect(seed.teams).toHaveLength(6);
    expect(seed.cards).toHaveLength(6 * areas.length);
    expect(new Set(seed.cards.map(c => c.panel)).size).toBe(5);
    for (const team of seed.teams) for (const area of areas) {
      const card = seed.cards.find(c => c.teamId === team.id && c.areaId === area.id)!;
      expect(card.status).toBe('submitted');
      expect(validateScores(area, card.scores, {complete:true})).toEqual([]);
      expect(seed.feedback.find(f => f.cardId === card.id)?.overall).toBeTruthy();
    }
    expect(seed.contacts.every(c => c.managerEmail === 'shubham@stempify.com')).toBe(true);
    expect(seed.teams.find(t => t.name === 'SUPERCHARGED')?.number).toBe('002');
  });

  it('completes all inspections, four reaction runs per team, knockout heats and racing points', () => {
    const seed = buildShowcaseExamples(showcaseSeed().event);
    expect(seed.inspections).toHaveLength(12);
    for (const inspection of seed.inspections) {
      expect(inspection.status).toBe('submitted');
      const summary = summarise(INDIA_TECHNICAL.rules, inspection.measurements);
      expect(summary.complete).toBe(true);
      expect(summary.perfFailures).toEqual([]);
      expect(summary.safetyFailures).toEqual([]);
    }
    expect(seed.races.filter(r => r.phase === 'reaction')).toHaveLength(12);
    expect(seed.races.filter(r => r.phase === 'knockout')).toHaveLength(5);
    for (const race of seed.races) {
      expect(validateRace(race)).toBeNull();
      expect(race.lane1.status).toBe('finished');
      expect(race.lane2.status).toBe('finished');
    }
    for (const team of seed.teams) expect(seed.races.filter(r => r.phase === 'reaction').flatMap(r => [r.lane1, r.lane2]).filter(l => l.teamId === team.id)).toHaveLength(4);
    const racing = competitionScores(seed.teams.map(t => t.id), seed.races, seed.inspections, seed.racingSetup);
    expect(racing.issues).toEqual([]);
    expect(racing.bracket.find(m => m.round === 6)?.resolved).toBe(true);
    for (const team of seed.teams) expect(Object.keys(racing.derived[team.id]).sort()).toEqual(['fastest-car', 'knockout', 'reaction']);
  });

  it('publishes complete, distinct calculated standings and can release the local copy', async () => {
    const seed = buildShowcaseExamples(showcaseSeed().event);
    const inputs = seed.snapshotInputs as Omit<RankInputs, 'ruleset'>;
    const ranking = rank({ruleset:seed.event.ruleset,...inputs});
    expect(ranking.provisional).toBe(false);
    expect(ranking.rows.every(r => r.judgedComplete && Object.values(r.areas).every(value => value !== null))).toBe(true);
    expect(ranking.rows).toEqual(seed.snapshot.rows);
    expect(new Set(ranking.rows.map(r => r.total)).size).toBe(6);
    expect(seed.snapshot.inputHash).toBe(sha256Fallback(canonicalJson({rulesetId:seed.event.ruleset.id,inputs,rows:ranking.rows})));
    const api = MemoryApi.forShowcase(seed);
    await api.setReleased(seed.event.id, true);
    expect((await api.publicStandings(seed.event.id))?.rows).toHaveLength(6);
    expect((await api.previewResultsPacket(seed.event.id, seed.teams[0].id)).cards).toHaveLength(seed.cards.length / 6);
  });

  it('offers the six-team mode only after the same event role and MFA checks', async () => {
    const {api:source,calls,reads} = readOnlySource();
    const copy = await loadShowcase(source, SHOWCASE_EVENT_ID, true);
    expect(await copy.listTeams(SHOWCASE_EVENT_ID)).toHaveLength(6);
    expect(calls).not.toContain('listCards');
    reads.myRoles = () => [];
    await expect(loadShowcase(source, SHOWCASE_EVENT_ID, true)).rejects.toMatchObject({code:'forbidden'});
  });
});
