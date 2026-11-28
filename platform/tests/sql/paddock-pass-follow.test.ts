import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { as, ids, makeDb, seedWorld, type Who, type World } from './harness';

// Migration 0060: passes follow the team as it changes, with nobody having to open the Paddock Passes page first.

let w: World;
beforeAll(async () => { w = await seedWorld(await makeDb()); });
beforeEach(async () => { w = await seedWorld(w.db); });
afterAll(async () => w.db.close());

const DENIED = { code: '42501' };
const photo = (seed: string) => Buffer.from(`portrait-${seed}`).toString('base64');
const member = (id: string, name: string, role = 'Design Engineer', pic = id) => ({ id, name, role, fileName: `${id}.jpg`, photoMime: 'image/jpeg', photoBase64: photo(pic) });
const setMembers = (list: unknown[], team = w.team1, event = w.eventId) => w.db.query(
  'insert into team_media_details(event_id,team_id,members) values($1,$2,$3::jsonb) on conflict(event_id,team_id) do update set members=excluded.members', [event, team, JSON.stringify(list)]);
const call = async <T = any>(who: Who | null, sql: string, params: unknown[] = []): Promise<T> => (await as(w.db, who, (q) => q(`select ${sql} r`, params))).rows[0].r;
const teamPasses = (who: Who | null = 'mgr1', team = w.team1, event = w.eventId) => call(who, 'team_passes($1,$2)', [event, team]);
const student = async (name: string, who: Who = 'mgr1') => (await teamPasses(who)).passes.find((p: any) => p.name === name);
const stepNow = () => Math.floor(Date.now() / 30000);
const mac = (secret: string, pass: string, step: number) => createHmac('sha256', Buffer.from(secret, 'hex')).update(`SRI1|${pass}|${step}`).digest('hex').slice(0, 16).toUpperCase();
const code = (secret: string, pass: string, step = stepNow()) => `SRI1.${pass.replace(/-/g, '').toUpperCase()}.${step}.${mac(secret, pass, step)}`;
const check = (c: string, device = 'phone-a') => call('organiser', 'check_pass($1,$2,$3,$4,$5)', [w.eventId, c, 'Main gate', null, device]);
async function claimed(name = 'Asha Rao'): Promise<{ id: string; secret: string }> {
  const p = await student(name);
  const got = await call(null, 'claim_pass($1,$2)', [p.id, await call<string>('mgr1', 'pass_link($1)', [p.id])]);
  return { id: p.id, secret: got.secret };
}
const listed = async (id: string) => (await call('organiser', 'door_list($1)', [w.eventId])).passes.some((p: any) => p.id === id);
beforeEach(async () => { await setMembers([member('m1', 'Asha Rao'), member('m2', 'Dev Shah', 'Team Principal')]); });

it('keeps a corrected member\'s pass working at the door with nobody opening the Paddock Passes page', async () => {
  const asha = await claimed();
  // The submission page saves the removal and then the corrected member under a new id.
  await setMembers([member('m2', 'Dev Shah', 'Team Principal')]);
  await setMembers([member('m2', 'Dev Shah', 'Team Principal'), member('m9', 'Asha Rao-Iyer', 'Design Engineer', 'm1')]);
  expect(await check(code(asha.secret, asha.id))).toMatchObject({ result: 'genuine', holder: { name: 'Asha Rao-Iyer' } });
  expect((await call(null, 'pass_card($1,$2,$3)', [asha.id, stepNow(), mac(asha.secret, asha.id, stepNow())])).name).toBe('Asha Rao-Iyer');
  expect(await listed(asha.id)).toBe(true);
});

it('does not throw a pass away when the page is opened between the removal and the correction', async () => {
  const asha = await claimed();
  await setMembers([member('m2', 'Dev Shah', 'Team Principal')]);
  // Someone looks at the team's passes while the member is missing: the pass is not shown, and not at the door either.
  expect((await teamPasses('organiser')).passes.some((p: any) => p.id === asha.id)).toBe(false);
  expect(await check(code(asha.secret, asha.id))).toEqual({ result: 'invalid' });
  expect(await listed(asha.id)).toBe(false);
  await setMembers([member('m2', 'Dev Shah', 'Team Principal'), member('m9', 'Asha Rao', 'Design Engineer', 'retaken')]);
  expect((await check(code(asha.secret, asha.id))).result).toBe('genuine');
  expect(await student('Asha Rao')).toMatchObject({ id: asha.id, memberId: 'm9', status: 'claimed' });
});

it('clears away the pass of a member who left, once it is clear they are not coming back', async () => {
  const asha = await claimed(), dev = await student('Dev Shah');
  await setMembers([]);
  const rows = async () => (await w.db.query('select id from passes where team_id=$1 and kind=\'student\' order by id', [w.team1])).rows.map((r: any) => r.id);
  // A pass nobody was sent goes at once; one on a phone is kept for a week in case the member is being corrected.
  expect(await rows()).toEqual([asha.id]);
  expect(dev.id).not.toBe(asha.id);
  await w.db.query('update passes set orphaned_at=orphaned_at-interval \'8 days\' where id=$1', [asha.id]);
  await teamPasses();
  expect(await rows()).toEqual([]);
});

it('stops a removed team manager\'s pass at once, and the passes they were showing', async () => {
  const asha = await claimed(), own = (await teamPasses()).passes[0];
  await call('mgr1', 'set_manager_pass_name($1,$2)', [own.id, 'Meera Nair']);
  const mine = await call<string>('mgr1', 'present_pass($1)', [own.id]), shown = await call<string>('mgr1', 'present_pass($1)', [asha.id]);
  expect((await check(code(mine, own.id))).result).toBe('genuine');
  expect(await listed(own.id)).toBe(true);
  await w.db.query('delete from event_roles where event_id=$1 and user_id=$2 and role=\'team_manager\'', [w.eventId, ids.mgr1]);
  expect(await check(code(mine, own.id), 'phone-b')).toEqual({ result: 'invalid' });
  expect(await check(code(shown, asha.id), 'phone-b')).toEqual({ result: 'invalid' });
  expect(await listed(own.id)).toBe(false);
  expect((await call('organiser', 'pass_arrivals($1)', [w.eventId])).total).toBe(2);
  // The student's own phone is untouched.
  expect((await check(code(asha.secret, asha.id), 'phone-b')).result).toBe('genuine');
});

it('lets several people show the same pass without stopping each other', async () => {
  const asha = await claimed();
  const first = await call<string>('mgr1', 'present_pass($1)', [asha.id]);
  // The manager reloads the page, and an organiser at the help desk shows the same pass.
  expect(await call<string>('mgr1', 'present_pass($1)', [asha.id])).toBe(first);
  expect(await call<string>('organiser', 'present_pass($1)', [asha.id])).toBe(first);
  expect(await check(code(first, asha.id))).toMatchObject({ result: 'genuine', presenter: true });
  await call('mgr1', 'reset_pass($1)', [asha.id]);
  expect(await check(code(first, asha.id), 'phone-b')).toEqual({ result: 'invalid' });
  expect(await call<string>('mgr1', 'present_pass($1)', [asha.id])).not.toBe(first);
});

it('lets a team manager put their own pass on their phone, so it works without signal', async () => {
  const own = (await teamPasses()).passes[0];
  await call('mgr1', 'set_manager_pass_name($1,$2)', [own.id, 'Meera Nair']);
  // A second manager of the same team cannot take over this one's pass; an organiser can help.
  await w.db.query('insert into event_roles(event_id,user_id,role,team_id,email) values($1,$2,\'team_manager\',$3,\'outsider@x.test\')', [w.eventId, ids.outsider, w.team1]);
  await expect(call('outsider', 'pass_link($1)', [own.id])).rejects.toMatchObject(DENIED);
  expect(await call<string>('organiser', 'pass_link($1)', [own.id])).toMatch(/^[0-9a-f]{64}$/);
  const token = await call<string>('mgr1', 'pass_link($1)', [own.id]);
  expect((await teamPasses()).passes[0]).toMatchObject({ kind: 'manager', status: 'sent' });
  const phone = await call(null, 'claim_pass($1,$2)', [own.id, token]);
  expect(phone.card).toMatchObject({ kind: 'manager', name: 'Meera Nair', role: 'Team Manager' });
  expect((await teamPasses()).passes[0]).toMatchObject({ status: 'claimed' });
  expect(await check(code(phone.secret, own.id))).toMatchObject({ result: 'genuine', presenter: false, holder: { name: 'Meera Nair', kind: 'manager' } });
});

it('reads each team\'s members once for the door list and arrivals, however many passes there are', async () => {
  // Twelve members with realistic portraits: about 5 MB of member data on one team.
  const big = 'A'.repeat(400_000);
  await setMembers(Array.from({ length: 12 }, (_, i) => ({ ...member(`b${i}`, `Member ${i}`), photoBase64: big + i })));
  await teamPasses();
  const time = async (run: () => Promise<unknown>) => { let best = Infinity; for (let i = 0; i < 3; i++) { const t = performance.now(); await run(); best = Math.min(best, performance.now() - t); } return best; };
  const once = await time(() => w.db.query('select count(*) from team_media_details d, jsonb_array_elements(d.members) m where d.event_id=$1 and m->>\'id\' is not null', [w.eventId]));
  const list = await time(() => call('organiser', 'door_list($1)', [w.eventId]));
  const arrivals = await time(() => call('organiser', 'pass_arrivals($1)', [w.eventId]));
  expect((await call('organiser', 'door_list($1)', [w.eventId])).passes).toHaveLength(13);
  expect(list).toBeLessThan(once * 5 + 40);
  expect(arrivals).toBeLessThan(once * 5 + 40);
});
