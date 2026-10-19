import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, ids, makeDb, seedWorld, type Who, type World } from './harness';

let db: PGlite, w: World;
beforeAll(async () => { db = await makeDb(); });
beforeEach(async () => {
  w = await seedWorld(db);
  await as(db, 'chair', q => q(`insert into ranking_snapshots(event_id,ruleset_id,input_hash,inputs,rows)
    values($1,'india-national-finals-2026',$2,$3::jsonb,$4::jsonb)`, [w.eventId, 'b'.repeat(64),
    JSON.stringify({ secret: 'Private judge inputs' }),
    JSON.stringify([{ rank: 1, teamId: w.team1, number: '1', name: 'One', total: 10, tied: false, areas: { 'verbal-technique': 10 }, categories: { verbal: 10 }, penalties: 0 }, { rank: 2, teamId: w.team2, number: '2', name: 'Two', total: 5, tied: false, areas: { 'verbal-technique': 7 }, categories: { verbal: 7 }, penalties: 2 }]) ]));
});
afterAll(async () => { await db.close(); });
const released = (on: boolean) => db.query('update events set results_released=$2 where id=$1', [w.eventId, on]);
const read = (who: Who | null) => as(db, who, async q => (await q('select released_results($1) as result', [w.eventId])).rows[0].result);

describe('private released results', () => {
  it('publishes only final totals and team identity to anonymous and signed-in viewers after release', async () => {
    const standings = (who: Who | null) => as(db, who, async q => (await q('select public_standings($1) as result', [w.eventId])).rows[0].result);
    expect(await standings(null)).toBeNull();
    await released(true);
    for (const who of [null, 'outsider', 'judgeV', 'mgr1'] as const) {
      const value = await standings(who);
      expect(value.rows).toEqual([
        {rank:1,teamId:w.team1,number:'1',name:'One',total:10,tied:false},
        {rank:2,teamId:w.team2,number:'2',name:'Two',total:5,tied:false},
      ]);
      expect(Object.keys(value).sort()).toEqual(['createdAt','rows']);
      expect(JSON.stringify(value)).not.toMatch(/areas|categories|penalties|inputs|Private judge inputs/);
    }
    await released(false);
    expect(await standings(null)).toBeNull();
    await released(true);
    await as(db, 'organiser', q => q('select delete_event($1,$2)', [w.eventId, 'Test event']));
    expect(await standings(null)).toBeNull();
  });

  it('filters snapshot rows on the server to the manager’s teams and never includes private inputs', async () => {
    await released(true);
    const first = await read('mgr1');
    const second = await read('mgr2');
    expect(first.rows).toEqual([{ rank: 1, teamId: w.team1, number: '1', name: 'One', total: 10, tied: false, areas: { 'verbal-technique': 10 }, categories: { verbal: 10 }, penalties: 0 }]);
    expect(second.rows).toEqual([{ rank: 2, teamId: w.team2, number: '2', name: 'Two', total: 5, tied: false, areas: { 'verbal-technique': 7 }, categories: { verbal: 7 }, penalties: 2 }]);
    expect(JSON.stringify(first)).not.toContain(w.team2);
    expect(JSON.stringify(first)).not.toContain('Private judge inputs');
    expect(first).not.toHaveProperty('inputs');
    expect(first).not.toHaveProperty('created_by');
    expect(first.event_id).toBe(w.eventId);
  });

  it('hides results before release, after withdrawal and when an event is deleted', async () => {
    expect(await read('mgr1')).toBeNull();
    await released(true);
    expect(await read('mgr1')).not.toBeNull();
    await released(false);
    expect(await read('mgr1')).toBeNull();
    await released(true);
    await as(db, 'organiser', q => q('select delete_event($1,$2)', [w.eventId, 'Test event']));
    expect(await read('mgr1')).toBeNull();
  });

  it('rejects anonymous access and does not grant unrelated accounts or judges manager access', async () => {
    await released(true);
    await expect(read(null)).rejects.toThrow(/permission denied/);
    await expect(as(db, null, q => q('select rows from ranking_snapshots where event_id=$1', [w.eventId]))).rejects.toThrow(/permission denied/);
    for (const who of ['judgeV', 'leadV', 'outsider'] as const) expect(await read(who)).toBeNull();
    for (const who of ['mgr1', 'mgr2', 'judgeV', 'outsider'] as const) {
      expect((await as(db, who, q => q('select rows from ranking_snapshots where event_id=$1', [w.eventId]))).rows).toEqual([]);
    }
    const staff = await as(db, 'organiser', q => q('select rows from ranking_snapshots where event_id=$1', [w.eventId]));
    expect(staff.rows[0].rows).toHaveLength(2);
  });

  it('supports managers with multiple teams without exposing another event', async () => {
    await db.query(`insert into event_roles(event_id,user_id,email,role,team_id) values($1,$2,'mgr1@x.test','team_manager',$3)`, [w.eventId, ids.mgr1, w.team2]);
    await released(true);
    expect((await read('mgr1')).rows.map((r: { teamId: string }) => r.teamId)).toEqual([w.team1, w.team2]);
    const other = await seedWorld(db);
    await db.query('update events set results_released=true where id=$1', [other.eventId]);
    expect((await read('mgr1')).rows.map((r: { teamId: string }) => r.teamId)).toEqual([w.team1, w.team2]);
  });
});
