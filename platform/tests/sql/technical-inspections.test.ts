import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { as, ids, makeDb, seedWorld, type World } from './harness';
import type { PGlite } from '@electric-sql/pglite';

let db: PGlite, w: World;

beforeAll(async () => { db = await makeDb(); });
beforeEach(async () => { w = await seedWorld(db); });
afterAll(async () => db.close());

describe('technical inspections SQL rules', () => {
  it('allows scrutineers and scrutineering judges to insert and update inspections', async () => {
    // Give judgeD the scrutineering panel role
    await db.query("insert into event_roles(event_id, user_id, role, panel) values ($1, $2, 'judge', 'scrutineering')", [w.eventId, ids.judgeD]);

    // JudgeD inserts Car A inspection
    const ins = await as(db, 'judgeD', (q) =>
      q(
        `insert into technical_inspections(event_id, team_id, car, ruleset_id, measurements)
         values ($1, $2, 'A', 'india-nationals-2026-technical', '{"T3.6": 52.0}')
         returning id, status, revision`,
        [w.eventId, w.team1],
      ),
    );
    expect(ins.rows).toHaveLength(1);
    const inspId = ins.rows[0].id;
    expect(ins.rows[0].status).toBe('in_progress');
    expect(ins.rows[0].revision).toBe(1);

    // JudgeD updates Car A inspection
    const upd = await as(db, 'judgeD', (q) =>
      q(
        `update technical_inspections
         set measurements = '{"T3.6": 53.0}'
         where id = $1
         returning measurements`,
        [inspId],
      ),
    );
    expect(upd.rows[0].measurements).toEqual({ 'T3.6': 53.0 });

    // Verbal judge cannot update judgeD's inspection
    await as(db, 'judgeV', (q) =>
      q(`update technical_inspections set measurements = '{"T3.6": 40.0}' where id = $1`, [inspId]),
    );
    const check = await db.query<any>('select measurements from technical_inspections where id = $1', [inspId]);
    expect(check.rows[0].measurements).toEqual({ 'T3.6': 53.0 }); // unchanged

    // Submit inspection via submit_inspection RPC
    await as(db, 'judgeD', (q) => q('select submit_inspection($1)', [inspId]));
    const submitted = await db.query<any>('select status, revision from technical_inspections where id = $1', [inspId]);
    expect(submitted.rows[0].status).toBe('submitted');
    expect(submitted.rows[0].revision).toBe(2);

    // Verify inspection_history recorded the previous state
    const hist = await db.query<any>('select previous_status, revision from inspection_history where inspection_id = $1', [inspId]);
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0].previous_status).toBe('in_progress');
    expect(hist.rows[0].revision).toBe(1);

    // Submitting again fails
    await expect(as(db, 'judgeD', (q) => q('select submit_inspection($1)', [inspId]))).rejects.toMatchObject({ code: '23505' });

    // Non-chair cannot reopen
    await expect(as(db, 'judgeD', (q) => q("select reopen_inspection($1, 'reopen')", [inspId]))).rejects.toMatchObject({ code: '42501' });

    // Chair reopens inspection
    await as(db, 'chair', (q) => q("select reopen_inspection($1, 'Correction to wing chord')", [inspId]));
    const reopened = await db.query<any>('select status, revision from technical_inspections where id = $1', [inspId]);
    expect(reopened.rows[0].status).toBe('reopened');
    expect(reopened.rows[0].revision).toBe(3);

    // History now has 2 entries
    const hist2 = await db.query<any>('select count(*) as c from inspection_history where inspection_id = $1', [inspId]);
    expect(Number(hist2.rows[0].c)).toBe(2);

    // Outsider cannot insert an inspection
    await expect(as(db, 'outsider', (q) =>
      q(`insert into technical_inspections(event_id, team_id, car, ruleset_id) values ($1, $2, 'B', 'x')`, [w.eventId, w.team1]),
    )).rejects.toMatchObject({ code: '42501' });

    // When event is released, updates match 0 rows and submissions are blocked
    await db.query('update events set results_released = true where id = $1', [w.eventId]);
    const blockedUpdate = await as(db, 'judgeD', (q) =>
      q(`update technical_inspections set measurements = '{}' where id = $1`, [inspId]),
    );
    expect(blockedUpdate.affectedRows).toBe(0);
    await expect(as(db, 'judgeD', (q) => q('select submit_inspection($1)', [inspId]))).rejects.toMatchObject({ code: '55000' });
  });

  it('enforces visibility: drafts visible only to author and staff; submitted visible to all judges; managers only after release for own team', async () => {
    await db.query("insert into event_roles(event_id, user_id, role, panel) values ($1, $2, 'judge', 'scrutineering')", [w.eventId, ids.judgeD]);

    // Insert draft inspection by judgeD
    const ins = await as(db, 'judgeD', (q) =>
      q(`insert into technical_inspections(event_id, team_id, car, ruleset_id, measurements)
         values ($1, $2, 'A', 'india-nationals-2026-technical', '{"T3.6": 51.0}')
         returning id`, [w.eventId, w.team1]),
    );
    const inspId = ins.rows[0].id;

    // judgeD sees own draft
    const seeAuthor = await as(db, 'judgeD', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeAuthor.rows).toHaveLength(1);

    // chair sees draft
    const seeChair = await as(db, 'chair', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeChair.rows).toHaveLength(1);

    // verbal judge cannot see draft
    const seeJudgeV = await as(db, 'judgeV', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeJudgeV.rows).toHaveLength(0);

    // team manager cannot see draft
    const seeMgr = await as(db, 'mgr1', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeMgr.rows).toHaveLength(0);

    // Submit the inspection
    await as(db, 'judgeD', (q) => q('select submit_inspection($1)', [inspId]));

    // Verbal judge CAN now see submitted specification inspection
    const seeJudgeVSubmitted = await as(db, 'judgeV', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeJudgeVSubmitted.rows).toHaveLength(1);

    // Team manager STILL cannot see before release
    const seeMgrPreRelease = await as(db, 'mgr1', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeMgrPreRelease.rows).toHaveLength(0);

    // Release results
    await db.query('update events set results_released = true where id = $1', [w.eventId]);

    // Team manager CAN see their own team's submitted inspection after release
    const seeMgrPostRelease = await as(db, 'mgr1', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeMgrPostRelease.rows).toHaveLength(1);

    // Other team's manager (mgr2) cannot see team 1's inspection
    const seeOtherMgr = await as(db, 'mgr2', (q) => q('select id from technical_inspections where id = $1', [inspId]));
    expect(seeOtherMgr.rows).toHaveLength(0);
  });
});
