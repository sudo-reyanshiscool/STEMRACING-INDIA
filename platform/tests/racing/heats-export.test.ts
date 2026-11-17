import { describe, expect, it } from 'vitest';
import { heatsExport, heatMatchupsExport, heatsJsonFileName } from '../../src/racing/heats-export';
import { reactionPairings } from '../../src/racing/competition';
import type { RaceHeat, RaceLane } from '../../src/racing';

const teams = [
  { id: 't1', eventId: 'e', number: '101', name: 'Lightning Bolts', school: 'School A' },
  { id: 't2', eventId: 'e', number: '102', name: 'Solar Flare', school: '' },
  { id: 't3', eventId: 'e', number: '103', name: 'Vortex Racing', school: 'School C' },
  { id: 't4', eventId: 'e', number: '104', name: 'Apex', school: 'School D' },
];
const event = { id: 'e', name: 'West Regional Finals 2026', startsOn: '2026-11-01' };
const lane = (teamId: string, car: 'A' | 'B' = 'A', totalMs: number | null = null, status: RaceLane['status'] = totalMs === null ? 'pending' : 'finished'): RaceLane =>
  ({ teamId, car, status, totalMs, reactionMs: totalMs === null ? null : 150 });
const heat = (number: number, phase: RaceHeat['phase'], lane1: RaceLane, lane2: RaceLane, extra: Partial<RaceHeat> = {}): RaceHeat =>
  ({ id: `r${number}`, eventId: 'e', number, label: `Heat ${number}`, phase, lane1, lane2, note: '', source: 'manual', sourceRunId: null, revision: 1, updatedAt: '', ...extra });
const input = (races: RaceHeat[]) => ({ event, teams, races, generatedAt: '2026-11-01T00:00:00.000Z' });

describe('heats JSON export', () => {
  it('lists every heat with lanes, cars, statuses, times and the winner', () => {
    const out = heatsExport(input([
      heat(2, 'reaction', lane('t2', 'B', 1300), lane('t1', 'B', 1250), { followupKind: 'swap', parentHeat: 'r1' }),
      heat(1, 'reaction', lane('t1', 'A', 1250), lane('t2', 'A', 1310)),
      heat(3, 'knockout', lane('t1'), lane('t3'), { bracket: { round: 1, slot: 2 }, note: 'Semi' }),
      heat(4, 'reaction', lane('t3', 'A', 1200), lane('t4', 'A', 1200)),
      heat(5, 'reaction', lane('t3', 'A', null, 'dnf'), lane('gone', 'A', 1400)),
    ]));
    expect(out).toMatchObject({ schemaVersion: 1, kind: 'heats', generatedAt: '2026-11-01T00:00:00.000Z', event });
    expect(out.heats.map((h) => [h.number, h.code, h.winnerTeamId])).toEqual([[1, 'RR-H01', 't1'], [2, 'RR-H02', 't1'], [3, 'KR-H02', null], [4, 'RR-H03', null], [5, 'RR-H04', 'gone']]);
    expect(out.heats[0].lanes).toEqual([
      { lane: 1, team: { id: 't1', number: '101', name: 'Lightning Bolts', school: 'School A' }, car: 'A', status: 'finished', totalMs: 1250, reactionMs: 150 },
      { lane: 2, team: { id: 't2', number: '102', name: 'Solar Flare', school: null }, car: 'A', status: 'finished', totalMs: 1310, reactionMs: 150 },
    ]);
    expect(out.heats[1]).toMatchObject({ followup: 'swap', followupOf: 'r1' });
    expect(out.heats[2]).toMatchObject({ phase: 'knockout', round: 1, match: 2, note: 'Semi' });
    expect(out.heats[4].lanes[1].team).toEqual({ id: 'gone', number: null, name: null, school: null });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('collapses the generated reaction schedule to one entry per pair of teams', () => {
    const races = reactionPairings(['t1', 't2', 't3', 't4']).map((r, i) => ({ ...r, id: `r${i + 1}`, eventId: 'e', number: i + 1, revision: 1, updatedAt: '' }));
    expect(races.length).toBeGreaterThan(2);
    const out = heatMatchupsExport(input(races));
    expect(out.kind).toBe('heat-matchups');
    expect(out.matchups.map((m) => [m.order, m.teamA.id, m.teamB?.id])).toEqual([[1, 't1', 't2'], [2, 't3', 't4']]);
    expect(out.matchups.flatMap((m) => m.heatNumbers)).toHaveLength(races.length);
    expect(JSON.stringify(out)).not.toMatch(/"car"|"lane"|totalMs/);
  });

  it('merges cars, lane swaps and reruns, and keeps phases and bracket matches apart', () => {
    const out = heatMatchupsExport(input([
      heat(1, 'reaction', lane('t1', 'A'), lane('t2', 'A')),
      heat(2, 'reaction', lane('t2', 'B'), lane('t1', 'B')),
      heat(3, 'reaction', lane('t1', 'A'), lane('t3', 'A')),
      heat(4, 'reaction', lane('t1', 'B'), lane('t2', 'A'), { followupKind: 'rerun', parentHeat: 'r1' }),
      heat(5, 'knockout', lane('t1'), lane('t2'), { bracket: { round: 1, slot: 1 } }),
      heat(6, 'knockout', lane('t2'), lane('t1'), { bracket: { round: 1, slot: 1 }, followupKind: 'swap', parentHeat: 'r5' }),
      heat(7, 'knockout', lane('t1'), lane('t2'), { bracket: { round: 2, slot: 1 } }),
    ]));
    expect(out.matchups).toEqual([
      { order: 1, phase: 'reaction', round: null, match: null, teamA: expect.objectContaining({ id: 't1', name: 'Lightning Bolts' }), teamB: expect.objectContaining({ id: 't2' }), heatNumbers: [1, 2, 4], heats: ['RR-H01', 'RR-H02', 'RR-H04'] },
      { order: 2, phase: 'reaction', round: null, match: null, teamA: expect.objectContaining({ id: 't1' }), teamB: expect.objectContaining({ id: 't3' }), heatNumbers: [3], heats: ['RR-H03'] },
      { order: 3, phase: 'knockout', round: 1, match: 1, teamA: expect.objectContaining({ id: 't1' }), teamB: expect.objectContaining({ id: 't2' }), heatNumbers: [5, 6], heats: ['KR-H01'] },
      { order: 4, phase: 'knockout', round: 2, match: 1, teamA: expect.objectContaining({ id: 't1' }), teamB: expect.objectContaining({ id: 't2' }), heatNumbers: [7], heats: ['KR-H01'] },
    ]);
  });

  it('shows a team running its own two cars as a single-team entry', () => {
    const races = reactionPairings(['t1']).map((r, i) => ({ ...r, id: `r${i + 1}`, eventId: 'e', number: i + 1, revision: 1, updatedAt: '' }));
    const out = heatMatchupsExport(input(races));
    expect(out.matchups).toHaveLength(1);
    expect(out.matchups[0]).toMatchObject({ teamA: { id: 't1' }, teamB: null, heats: ['RR-H01', 'RR-H02'] });
  });

  it('handles an empty schedule and names files cleanly', () => {
    expect(heatsExport(input([])).heats).toEqual([]);
    expect(heatMatchupsExport(input([])).matchups).toEqual([]);
    expect(heatsJsonFileName('West Regional Finals 2026', 'heats')).toBe('STEM-Racing_West-Regional-Finals-2026_Heats.json');
    expect(heatsJsonFileName('Special / Event #1', 'graphics')).toBe('STEM-Racing_Special-Event-1_Heats-Graphics.json');
  });
});
