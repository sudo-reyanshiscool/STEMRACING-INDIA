import { beforeAll, afterAll, it, expect } from 'vitest';
import { as, makeDb, seedWorld, ids, type World } from './harness';
let w: World;
beforeAll(async () => { w = await seedWorld(await makeDb()); });
afterAll(async () => w.db.close());

it('lets only the owner switch hide mode, and reports it off for everyone else', async () => {
  expect((await as(w.db, 'admin', q => q('select owner_hide_mode() as on'))).rows[0].on).toBe(false);
  await as(w.db, 'admin', q => q('select set_owner_hide_mode(true)'));
  expect((await as(w.db, 'admin', q => q('select owner_hide_mode() as on'))).rows[0].on).toBe(true);
  await expect(as(w.db, 'organiser', q => q('select set_owner_hide_mode(true)'))).rejects.toThrow(/only the platform owner/);
  expect((await as(w.db, 'organiser', q => q('select owner_hide_mode() as on'))).rows[0].on).toBe(false);
  await expect(as(w.db, 'admin', q => q('select * from owner_preferences'))).rejects.toThrow();
  await as(w.db, 'admin', q => q('select set_owner_hide_mode(false)'));
  expect((await as(w.db, 'admin', q => q('select owner_hide_mode() as on'))).rows[0].on).toBe(false);
});

it('never shows who created an event, while every other event column stays readable', async () => {
  await w.db.query('update events set created_by=$1 where id=$2', [ids.admin, w.eventId]);
  for (const who of ['organiser', 'chair', 'mgr1'] as const) {
    await expect(as(w.db, who, q => q('select created_by from events where id=$1', [w.eventId]))).rejects.toThrow();
    await expect(as(w.db, who, q => q('select * from events where id=$1', [w.eventId]))).rejects.toThrow();
    const row = await as(w.db, who, q => q('select id,name,starts_on,ruleset,results_released,competition_level,city,event_year,regional_number,custom_name,season,created_at from events where id=$1', [w.eventId]));
    expect(row.rows).toHaveLength(1);
    expect(JSON.stringify(row.rows)).not.toContain(ids.admin);
  }
  await expect(as(w.db, 'outsider', q => q('select created_by from events'))).rejects.toThrow();
});
