import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { as, makeDb, seedWorld, type Who, type World } from './harness';

// Migration 0061: the smaller findings from the Paddock Pass review.

let w: World;
beforeAll(async () => { w = await seedWorld(await makeDb()); });
beforeEach(async () => { w = await seedWorld(w.db); });
afterAll(async () => w.db.close());

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]).toString('base64');
const photo = (seed: string) => Buffer.from(`portrait-${seed}`).toString('base64');
const member = (id: string, name: string, role = 'Design Engineer', pic = id) => ({ id, name, role, fileName: `${id}.jpg`, photoMime: 'image/jpeg', photoBase64: photo(pic) });
const setMembers = (list: unknown[]) => w.db.query(
  'insert into team_media_details(event_id,team_id,members) values($1,$2,$3::jsonb) on conflict(event_id,team_id) do update set members=excluded.members', [w.eventId, w.team1, JSON.stringify(list)]);
const call = async <T = any>(who: Who | null, sql: string, params: unknown[] = []): Promise<T> => (await as(w.db, who, (q) => q(`select ${sql} r`, params))).rows[0].r;
const teamPasses = (who: Who | null = 'mgr1') => call(who, 'team_passes($1,$2)', [w.eventId, w.team1]);
const student = async (name: string) => (await teamPasses()).passes.find((p: any) => p.name === name);
const stepNow = () => Math.floor(Date.now() / 30000);
const mac = (secret: string, pass: string, step: number) => createHmac('sha256', Buffer.from(secret, 'hex')).update(`SRI1|${pass}|${step}`).digest('hex').slice(0, 16).toUpperCase();
const code = (secret: string, pass: string, step = stepNow()) => `SRI1.${pass.replace(/-/g, '').toUpperCase()}.${step}.${mac(secret, pass, step)}`;
beforeEach(async () => { await setMembers([member('m1', 'Asha Rao'), member('m2', 'Dev Shah', 'Team Principal')]); });

it('takes the good checks from an upload when another row in it is nonsense', async () => {
  const asha = await student('Asha Rao'), dev = await student('Dev Shah');
  const row = (n: number, passId: string, more: Record<string, unknown> = {}) =>
    ({ id: `00000000-0000-4000-9000-00000000000${n}`, passId, step: stepNow(), result: 'genuine', presenter: false, gate: '', device: 'x', scannedAt: new Date().toISOString(), ...more });
  const batch = [row(1, asha.id), row(2, asha.id, { scannedAt: '2026-13-45T99:99:99Z' }), row(3, dev.id, { presenter: 'maybe' }), row(4, dev.id, { scannedAt: null }), row(5, dev.id, { step: '12', presenter: 'true' })];
  // Before, the one impossible date failed the whole batch, and it failed again on every retry.
  expect(await call('organiser', 'record_pass_checks($1,$2::jsonb)', [w.eventId, JSON.stringify(batch)])).toBe(3);
  const kept = (await w.db.query('select id::text, presenter from pass_checks where event_id=$1 order by id', [w.eventId])).rows;
  expect(kept).toEqual([{ id: batch[0].id, presenter: false }, { id: batch[2].id, presenter: false }, { id: batch[4].id, presenter: true }]);
});

it('checks one pass one scan at a time, so two scanners cannot both be first', async () => {
  // Two connections cannot be opened on this test database, so the race itself cannot be run here.
  // What can be checked is that every check of a pass queues behind the one before it.
  const body = ((await w.db.query("select prosrc from pg_proc where proname='check_pass'")).rows[0] as { prosrc: string }).prosrc;
  expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\('stem_racing_pass_check:'\|\|p\.id::text\)\)/);
  // And that a check still works with it in place.
  const asha = await student('Asha Rao');
  const got = await call(null, 'claim_pass($1,$2)', [asha.id, await call<string>('mgr1', 'pass_link($1)', [asha.id])]);
  expect((await call('organiser', 'check_pass($1,$2,$3,$4,$5)', [w.eventId, code(got.secret, asha.id), '', null, 'a'])).result).toBe('genuine');
});

it('does not call a small portrait up to date when the member\'s picture changed while it was being made', async () => {
  const before = await student('Asha Rao');
  expect(before.sourceHash).toMatch(/^[0-9a-f]{32}$/);
  // The page read the passes, then the member's portrait was replaced, then the page uploaded the copy it had made.
  await setMembers([member('m1', 'Asha Rao', 'Design Engineer', 'retaken'), member('m2', 'Dev Shah', 'Team Principal')]);
  await call('mgr1', 'set_pass_portrait($1,$2,$3)', [before.id, jpeg, before.sourceHash]);
  expect(await student('Asha Rao')).toMatchObject({ portrait: jpeg, portraitStale: true });
  // Made from the picture as it is now, it is up to date.
  const now = await student('Asha Rao');
  await call('mgr1', 'set_pass_portrait($1,$2,$3)', [now.id, jpeg, now.sourceHash]);
  expect(await student('Asha Rao')).toMatchObject({ portraitStale: false });
  // The earlier way of calling it still works, for a page that was open before the update.
  await call('mgr1', 'set_pass_portrait($1,$2)', [now.id, jpeg]);
  expect(await student('Asha Rao')).toMatchObject({ portraitStale: false });
  await expect(call('mgr2', 'set_pass_portrait($1,$2,$3)', [now.id, jpeg, now.sourceHash])).rejects.toMatchObject({ code: '42501' });
});

it('gives a team manager no pass to show or send until it has their name on it', async () => {
  const own = (await teamPasses()).passes[0];
  expect(own).toMatchObject({ kind: 'manager', name: '' });
  for (const who of ['mgr1', 'organiser'] as const) {
    await expect(call(who, 'present_pass($1)', [own.id])).rejects.toMatchObject({ code: '22023' });
    await expect(call(who, 'pass_link($1)', [own.id])).rejects.toMatchObject({ code: '22023' });
  }
  await call('mgr1', 'set_manager_pass_name($1,$2)', [own.id, 'Meera Nair']);
  expect(await call<string>('mgr1', 'present_pass($1)', [own.id])).toMatch(/^[0-9a-f]{64}$/);
  expect(await call<string>('mgr1', 'pass_link($1)', [own.id])).toMatch(/^[0-9a-f]{64}$/);
  // A student's pass always has a name, from the team's member list.
  expect(await call<string>('mgr1', 'present_pass($1)', [(await student('Asha Rao')).id])).toMatch(/^[0-9a-f]{64}$/);
});
