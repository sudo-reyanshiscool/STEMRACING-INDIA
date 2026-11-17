import { describe, expect, it } from 'vitest';
import { awardsExport, nominationsExport, resultsExport } from '../../src/api/results-export';
import type { SnapshotRow } from '../../src/api/types';
import { INDIA_2026 } from '../../src/rulesets';
import { jsonFileName } from '../../src/racing/heats-export';

const event = { id: 'e', name: 'Nationals 2026', startsOn: '2026-11-01' };
const teams = [{ id: 'a', number: '1', name: 'One', school: 'First School' }, { id: 'b', number: '2', name: 'Two', school: '' }];
const at = '2026-11-01T10:00:00.000Z';
const rank = (over: Partial<SnapshotRow['rows'][number]>) => ({
  rank: 1, teamId: 'a', number: '1', name: 'One', areas: { verbal: 20 }, categories: { verbal: 20 }, subtotal: 20, penalties: 0, total: 20, judgedComplete: true, tied: false, ...over,
});

describe('results, awards and nominations exports', () => {
  it('lists the snapshot in rank order with scores, and keeps a removed team by its snapshot name', () => {
    const snapshot: SnapshotRow = { id: 's', eventId: 'e', createdAt: at, rulesetId: INDIA_2026.id, inputHash: 'h'.repeat(64), released: true,
      rows: [rank({ rank: 2, teamId: 'gone', number: '9', name: 'Nine', total: 12, subtotal: 15, penalties: 3 }), rank({})] };
    const out = resultsExport({ event, released: false, ruleset: INDIA_2026, snapshot, teams, generatedAt: at });
    expect(out).toMatchObject({ schemaVersion: 1, kind: 'results', generatedAt: at, event, released: false, snapshot: { id: 's' } });
    expect(out.standings.map((r) => [r.rank, r.team, r.total, r.penalties])).toEqual([
      [1, { id: 'a', number: '1', name: 'One', school: 'First School' }, 20, 0],
      [2, { id: 'gone', number: '9', name: 'Nine', school: null }, 12, 3],
    ]);
    expect(out.standings[0]!.areas).toEqual({ verbal: 20 });
    expect(out.areas.length).toBe(INDIA_2026.areas.length);
    // The snapshot's private inputs and hash stay out of a file that is passed around.
    expect(JSON.stringify(out)).not.toContain('h'.repeat(64));
  });

  it('lists award winners by title and says whether they are confirmed', () => {
    const out = awardsExport({ event, confirmed: false, teams, generatedAt: at,
      awards: [{ id: '2', title: 'Fastest Car', teamId: 'b' }, { id: '1', title: 'Best Engineered', teamId: 'a' }] });
    expect(out).toMatchObject({ kind: 'awards', confirmed: false });
    expect(out.awards).toEqual([
      { id: '1', title: 'Best Engineered', team: { id: 'a', number: '1', name: 'One', school: 'First School' } },
      { id: '2', title: 'Fastest Car', team: { id: 'b', number: '2', name: 'Two', school: null } },
    ]);
  });

  it('counts a judge once per award, team and panel, and never names the judge', () => {
    const out = nominationsExport({ event, teams, generatedAt: at, rows: [
      { cardId: 'c1', teamId: 'a', panel: 'verbal', judgeId: 'judge-1', nominations: ['team-identity'] },
      { cardId: 'c2', teamId: 'a', panel: 'verbal', judgeId: 'judge-1', nominations: ['team-identity', 'sustainability'] },
      { cardId: 'c3', teamId: 'a', panel: 'enterprise', judgeId: 'judge-2', nominations: ['team-identity'] },
      { cardId: 'c4', teamId: 'b', panel: 'verbal', judgeId: 'judge-1', nominations: ['team-identity'] },
    ] });
    const identity = out.awards.find((a) => a.id === 'team-identity')!;
    expect(identity.name).toBe('Team Identity Award');
    expect(identity.nominees).toEqual([
      { team: { id: 'a', number: '1', name: 'One', school: 'First School' }, nominations: 2, panels: ['enterprise', 'verbal'] },
      { team: { id: 'b', number: '2', name: 'Two', school: null }, nominations: 1, panels: ['verbal'] },
    ]);
    expect(out.awards.find((a) => a.id === 'sustainability')!.nominees).toHaveLength(1);
    expect(out.awards.find((a) => a.id === 'verbal-presentation')!.nominees).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('judge-1');
  });

  it('names every file the same way', () => {
    expect(jsonFileName('Nationals 2026 / Finals', 'Results')).toBe('STEM-Racing_Nationals-2026-Finals_Results.json');
  });
});
