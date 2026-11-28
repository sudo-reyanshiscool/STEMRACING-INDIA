import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { as, ids, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
beforeAll(async () => { w = await seedWorld(await makeDb()); });
beforeEach(async () => { w = await seedWorld(w.db); });
afterAll(async () => w.db.close());

const DENIED = { code: '42501' };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]).toString('base64');
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
const check = (c: string, opts: { who?: Who | null; device?: string; event?: string; id?: string } = {}) =>
  call(opts.who === undefined ? 'organiser' : opts.who, 'check_pass($1,$2,$3,$4,$5)', [opts.event ?? w.eventId, c, 'Main gate', opts.id ?? null, opts.device ?? 'phone-a']);
/** A student pass that is already on a phone: returns its id and the phone's secret. */
async function claimed(name = 'Asha Rao'): Promise<{ id: string; secret: string; card: any }> {
  const p = await student(name);
  const token = await call<string>('mgr1', 'pass_link($1)', [p.id]);
  const got = await call(null, 'claim_pass($1,$2)', [p.id, token]);
  return { id: p.id, secret: got.secret, card: got.card };
}
beforeEach(async () => { await setMembers([member('m1', 'Asha Rao'), member('m2', 'Dev Shah', 'Team Principal')]); });

it('computes HMAC-SHA256 exactly as RFC 4231 does', async () => {
  const cases: Array<[Buffer, Buffer]> = [[Buffer.alloc(20, 0x0b), Buffer.from('Hi There')], [Buffer.from('Jefe'), Buffer.from('what do ya want for nothing?')],
    [Buffer.alloc(131, 0xaa), Buffer.from('Test Using Larger Than Block-Size Key - Hash Key First')]];
  for (const [k, m] of cases) {
    const got = (await w.db.query("select encode(hmac_sha256($1,$2),'hex') h", [k, m])).rows[0] as { h: string };
    expect(got.h).toBe(createHmac('sha256', k).update(m).digest('hex'));
  }
  expect((await w.db.query("select encode(hmac_sha256(decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f','hex'),convert_to('SRI1|11111111-2222-4333-8444-555555555555|58000000','utf8')),'hex') h")).rows[0])
    .toEqual({ h: createHmac('sha256', Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')).update('SRI1|11111111-2222-4333-8444-555555555555|58000000').digest('hex') });
  await expect(call('organiser', "hmac_sha256('a'::bytea,'b'::bytea)")).rejects.toMatchObject(DENIED);
});

it('makes a pass for every member and for the manager, for the team and event staff only', async () => {
  const mine = await teamPasses('mgr1');
  expect(mine.team).toMatchObject({ number: '1', name: 'Team One' });
  expect(mine.event).toMatchObject({ id: w.eventId, name: 'Test event' });
  expect(mine.pulseKey).toMatch(/^[0-9a-f]{64}$/);
  expect(mine.passes.map((p: any) => [p.kind, p.name, p.role, p.status, p.mine])).toEqual([
    ['manager', '', 'Team Manager', 'new', true], ['student', 'Asha Rao', 'Design Engineer', 'new', false], ['student', 'Dev Shah', 'Team Principal', 'new', false]]);
  // Opening the page again makes nothing new, and staff see the same passes.
  const again = await teamPasses('organiser');
  expect(again.passes.map((p: any) => p.id)).toEqual(mine.passes.map((p: any) => p.id));
  expect(again.passes[0].mine).toBe(false);
  expect((await teamPasses('chair')).passes).toHaveLength(3);
  for (const who of ['mgr2', 'judgeV', 'leadV', 'outsider', null] as const) await expect(teamPasses(who)).rejects.toMatchObject(DENIED);
  await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by) values ($1,'spectator@x.test','spectator',$2)", [ids.outsider, ids.admin]);
  await expect(teamPasses('outsider')).rejects.toMatchObject(DENIED);
});

it('keeps a pass when a member is corrected, and drops it when the member leaves', async () => {
  const asha = await claimed('Asha Rao');
  // A typo fix on the submission page removes and re-adds the member: new id, same portrait.
  await setMembers([member('m9', 'Asha Rao-Iyer', 'Design Engineer', 'm1'), member('m2', 'Dev Shah')]);
  expect((await student('Asha Rao-Iyer')).id).toBe(asha.id);
  expect((await check(code(asha.secret, asha.id))).holder.name).toBe('Asha Rao-Iyer');
  // A new portrait with the same name, however it is spaced or cased, is the same person too.
  await setMembers([member('m10', '  asha   RAO-iyer ', 'Design Engineer', 'new-picture'), member('m2', 'Dev Shah')]);
  const relinked = (await teamPasses()).passes.find((p: any) => p.id === asha.id);
  expect(relinked).toMatchObject({ memberId: 'm10', status: 'claimed', portraitStale: true });
  // Both changed: a different person, who needs their own link. The old pass is off the list and refused at the door.
  await setMembers([member('m11', 'Someone Else', 'Design Engineer', 'other'), member('m2', 'Dev Shah')]);
  const now = await teamPasses();
  expect(now.passes.find((p: any) => p.id === asha.id)).toBeUndefined();
  expect(now.passes.find((p: any) => p.name === 'Someone Else')).toMatchObject({ status: 'new' });
  expect(await check(code(asha.secret, asha.id))).toEqual({ result: 'invalid' });
});

it('hands a pass to the first phone that opens the link, once', async () => {
  const p = await student('Asha Rao');
  for (const who of ['mgr2', 'judgeV', 'outsider', null] as const) await expect(call(who, 'pass_link($1)', [p.id])).rejects.toMatchObject(DENIED);
  const token = await call<string>('mgr1', 'pass_link($1)', [p.id]);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(await student('Asha Rao')).toMatchObject({ status: 'sent' });
  for (const bad of ['', 'nope', token.slice(1), token.toUpperCase()]) await expect(call(null, 'claim_pass($1,$2)', [p.id, bad])).rejects.toMatchObject(DENIED);
  const got = await call(null, 'claim_pass($1,$2)', [p.id, token]);
  expect(got.secret).toMatch(/^[0-9a-f]{64}$/);
  expect(got.card).toMatchObject({ passId: p.id, kind: 'student', name: 'Asha Rao', role: 'Design Engineer', team: { number: '1', name: 'Team One' }, stream: null, activities: [] });
  expect(got.card.pulseKey).toMatch(/^[0-9a-f]{64}$/);
  expect(Math.abs(got.card.now - Date.now())).toBeLessThan(60_000);
  await expect(call(null, 'claim_pass($1,$2)', [p.id, token])).rejects.toMatchObject(DENIED);
  expect(await student('Asha Rao')).toMatchObject({ status: 'claimed' });
  // The token is kept only as a hash, and the secret never leaves through the team's list.
  const stored = (await w.db.query('select claim_hash, encode(holder_secret,\'hex\') s from passes where id=$1', [p.id])).rows[0] as { claim_hash: unknown; s: string };
  expect(stored.claim_hash).toBeNull();
  expect(JSON.stringify(await teamPasses())).not.toContain(stored.s);
});

it('cancels the old link and the old phone when a new link is made or the pass is reset', async () => {
  const p = await student('Asha Rao');
  const first = await call<string>('mgr1', 'pass_link($1)', [p.id]);
  const second = await call<string>('organiser', 'pass_link($1)', [p.id]);
  await expect(call(null, 'claim_pass($1,$2)', [p.id, first])).rejects.toMatchObject(DENIED);
  const phone = await call(null, 'claim_pass($1,$2)', [p.id, second]);
  expect((await check(code(phone.secret, p.id))).result).toBe('genuine');
  const third = await call<string>('mgr1', 'pass_link($1)', [p.id]);
  expect((await check(code(phone.secret, p.id))).result).toBe('invalid');
  const next = await call(null, 'claim_pass($1,$2)', [p.id, third]);
  await call('mgr1', 'reset_pass($1)', [p.id]);
  expect((await check(code(next.secret, p.id))).result).toBe('invalid');
  expect(await student('Asha Rao')).toMatchObject({ status: 'new' });
  await expect(call('mgr2', 'reset_pass($1)', [p.id])).rejects.toMatchObject(DENIED);
});

it('lets the manager show a pass without taking it off the student\'s phone', async () => {
  const asha = await claimed();
  await expect(call('mgr2', 'present_pass($1)', [asha.id])).rejects.toMatchObject(DENIED);
  const shown = await call<string>('mgr1', 'present_pass($1)', [asha.id]);
  expect(shown).toMatch(/^[0-9a-f]{64}$/);
  expect(await check(code(asha.secret, asha.id))).toMatchObject({ result: 'genuine', presenter: false });
  expect(await check(code(shown, asha.id), { device: 'phone-b' })).toMatchObject({ result: 'genuine', presenter: true });
  // The manager's own pass can be shown from the phone they are signed in on.
  const own = (await teamPasses()).passes[0];
  await call('mgr1', 'set_manager_pass_name($1,$2)', [own.id, '  Meera Nair ']);
  for (const bad of ['', '   ', 'x'.repeat(101)]) await expect(call('mgr1', 'set_manager_pass_name($1,$2)', [own.id, bad])).rejects.toMatchObject({ code: '22023' });
  await expect(call('mgr1', 'set_manager_pass_name($1,$2)', [asha.id, 'Nope'])).rejects.toMatchObject({ code: '22023' });
  const key = await call<string>('mgr1', 'present_pass($1)', [own.id]);
  expect(await check(code(key, own.id))).toMatchObject({ result: 'genuine', presenter: false, holder: { name: 'Meera Nair', role: 'Team Manager', kind: 'manager' } });
});

it('stores a small JPEG portrait and nothing else', async () => {
  const p = await student('Asha Rao');
  expect(p).toMatchObject({ portrait: null, portraitStale: true });
  await call('mgr1', 'set_pass_portrait($1,$2)', [p.id, jpeg]);
  expect(await student('Asha Rao')).toMatchObject({ portrait: jpeg, portraitStale: false });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(65536, 1)]).toString('base64');
  for (const bad of [png, big, '', 'not base64!']) await expect(call('mgr1', 'set_pass_portrait($1,$2)', [p.id, bad])).rejects.toMatchObject({ code: '22023' });
  for (const who of ['mgr2', 'judgeV', null] as const) await expect(call(who, 'set_pass_portrait($1,$2)', [p.id, jpeg])).rejects.toMatchObject(DENIED);
});

it('refreshes a card only for the phone that holds the pass', async () => {
  const asha = await claimed();
  const step = stepNow();
  const card = await call(null, 'pass_card($1,$2,$3)', [asha.id, step, mac(asha.secret, asha.id, step)]);
  expect(card).toMatchObject({ passId: asha.id, name: 'Asha Rao' });
  await expect(call(null, 'pass_card($1,$2,$3)', [asha.id, step, '0'.repeat(16)])).rejects.toMatchObject(DENIED);
  await expect(call(null, 'pass_card($1,$2,$3)', [asha.id, step - 10, mac(asha.secret, asha.id, step - 10)])).rejects.toMatchObject(DENIED);
  await call('mgr1', 'reset_pass($1)', [asha.id]);
  await expect(call(null, 'pass_card($1,$2,$3)', [asha.id, step, mac(asha.secret, asha.id, step)])).rejects.toMatchObject(DENIED);
});

it('puts the stream and the team\'s activities on the card once a schedule is published', async () => {
  const doc = { timezone: 'Asia/Kolkata', days: [{ date: '2026-12-12', opens: '08:00', closes: '18:00' }, { date: '2026-12-13', opens: '08:00', closes: '17:00' }],
    streams: [{ id: 's1', name: 'Stream A' }, { id: 's2', name: 'Stream B' }], allocations: [{ teamId: w.team1, streamId: 's2' }, { teamId: w.team2, streamId: 's1' }], exemptions: [], resources: [],
    activities: [
      { id: 'a2', title: 'Racing', kind: 'racing', scope: 'stream', streamId: 's2', teamIds: [], panel: null, start: '2026-12-12T05:45:00.000Z', end: '2026-12-12T06:15:00.000Z', point: false, resourceIds: [], location: 'Track 1' },
      { id: 'a1', title: 'Judging — Team 1', kind: 'judging', scope: 'teams', streamId: 's2', teamIds: [w.team1], panel: 'verbal', start: '2026-12-12T04:10:00.000Z', end: '2026-12-12T04:30:00.000Z', point: false, resourceIds: [], location: 'Room 2' },
      { id: 'a3', title: 'Other stream', kind: 'racing', scope: 'stream', streamId: 's1', teamIds: [], panel: null, start: '2026-12-12T07:00:00.000Z', end: null, point: true, resourceIds: [], location: '' }] };
  await w.db.query('insert into event_schedules(event_id,revision,draft,published,published_at) values($1,1,$2::jsonb,$2::jsonb,now())', [w.eventId, JSON.stringify(doc)]);
  const { card } = await claimed();
  expect(card.stream).toEqual({ name: 'Stream B', index: 1 });
  expect(card.timezone).toBe('Asia/Kolkata');
  expect(card.event.days).toEqual(['2026-12-12', '2026-12-13']);
  expect(card.activities).toEqual([
    { title: 'Judging — Team 1', kind: 'judging', start: '2026-12-12T04:10:00.000Z', end: '2026-12-12T04:30:00.000Z', location: 'Room 2' },
    { title: 'Racing', kind: 'racing', start: '2026-12-12T05:45:00.000Z', end: '2026-12-12T06:15:00.000Z', location: 'Track 1' }]);
});

it('tells a genuine code from an old, forged, foreign or meaningless one', async () => {
  const asha = await claimed();
  for (const who of ['mgr1', 'judgeV', 'leadV', 'outsider', null] as const) await expect(check(code(asha.secret, asha.id), { who })).rejects.toMatchObject(DENIED);
  const ok = await check(code(asha.secret, asha.id));
  expect(ok).toMatchObject({ result: 'genuine', presenter: false, firstSeenToday: null, holder: { name: 'Asha Rao', role: 'Design Engineer', kind: 'student', team: { number: '1', name: 'Team One' }, stream: null } });
  expect((await check(code(asha.secret, asha.id, stepNow() - 1), { device: 'phone-b' })).result).toBe('genuine');   // a clock a little behind
  expect((await check(code(asha.secret, asha.id, stepNow() + 1), { device: 'phone-c' })).result).toBe('genuine');   // or a little ahead
  // A screenshot from five minutes ago: really this pass, but too old. The holder is not shown.
  expect(await check(code(asha.secret, asha.id, stepNow() - 10))).toEqual({ result: 'expired' });
  const forged = `SRI1.${asha.id.replace(/-/g, '').toUpperCase()}.${stepNow()}.0123456789ABCDEF`;
  expect(await check(forged)).toEqual({ result: 'invalid' });
  for (const junk of ['', 'hello', 'SRI1.x.y.z', `SRI2.${asha.id.replace(/-/g, '')}.1.AA`, 'https://example.test/', `SRI1.${'0'.repeat(32)}.${stepNow()}.${'0'.repeat(16)}`])
    expect(await check(junk)).toEqual({ result: 'unknown' });
  const other = await seedWorld(w.db);
  expect(await check(code(asha.secret, asha.id), { event: other.eventId })).toEqual({ result: 'wrong_event' });
  // Lower case, as some scanners deliver it, is the same code.
  expect((await check(code(asha.secret, asha.id).toLowerCase())).result).not.toBe('unknown');
});

it('flags the same code scanned again, but not a double read by one scanner', async () => {
  const asha = await claimed();
  const c = code(asha.secret, asha.id);
  expect((await check(c, { device: 'phone-a' })).result).toBe('genuine');
  expect((await check(c, { device: 'phone-a' })).result).toBe('genuine');            // the camera read it twice
  expect((await w.db.query('select count(*)::int n from pass_checks where pass_id=$1', [asha.id])).rows[0]).toEqual({ n: 1 });
  expect((await check(c, { device: 'phone-b' })).result).toBe('replay');             // another door, same code
  await w.db.query("update pass_checks set scanned_at=scanned_at-interval '20 seconds' where pass_id=$1", [asha.id]);
  expect((await check(c, { device: 'phone-a' })).result).toBe('replay');             // same door, but well after the first read
  // A later, fresh code is simply genuine, and says when the person was first seen today.
  await w.db.query("update pass_checks set step=step-5, scanned_at=scanned_at-interval '3 minutes' where pass_id=$1", [asha.id]);
  const later = await check(c, { device: 'phone-b' });
  expect(later.result).toBe('genuine');
  expect(typeof later.firstSeenToday).toBe('string');
});

it('gives door staff the whole list, takes their offline checks once, and counts arrivals', async () => {
  const asha = await claimed();
  await call('mgr1', 'set_pass_portrait($1,$2)', [asha.id, jpeg]);
  for (const who of ['mgr1', 'judgeV', 'outsider', null] as const) {
    await expect(call(who, 'door_list($1)', [w.eventId])).rejects.toMatchObject(DENIED);
    await expect(call(who, 'door_portraits($1,null,40)', [w.eventId])).rejects.toMatchObject(DENIED);
    await expect(call(who, 'record_pass_checks($1,$2::jsonb)', [w.eventId, '[]'])).rejects.toMatchObject(DENIED);
    await expect(call(who, 'pass_arrivals($1)', [w.eventId])).rejects.toMatchObject(DENIED);
  }
  const list = await call('organiser', 'door_list($1)', [w.eventId]);
  expect(list.pulseKey).toMatch(/^[0-9a-f]{64}$/);
  expect(list.passes).toHaveLength(3);
  expect(list.passes.find((p: any) => p.id === asha.id)).toMatchObject({ kind: 'student', name: 'Asha Rao', role: 'Design Engineer', team: { number: '1', name: 'Team One' }, stream: null, holder: asha.secret, presenter: null, hasPortrait: true });
  expect(await call('chair', 'door_portraits($1,null,40)', [w.eventId])).toEqual([{ id: asha.id, portrait: jpeg }]);
  expect(await call('chair', 'door_portraits($1,$2,40)', [w.eventId, asha.id])).toEqual([]);

  const other = await seedWorld(w.db);
  const queued = [
    { id: '00000000-0000-4000-9000-000000000001', passId: asha.id, step: stepNow(), result: 'genuine', presenter: false, gate: 'Gate 2', device: 'phone-z', scannedAt: new Date(Date.now() - 60_000).toISOString() },
    { id: '00000000-0000-4000-9000-000000000002', passId: (await teamPasses('mgr1', other.team1, other.eventId)).passes[0].id, step: 1, result: 'genuine', presenter: false, gate: '', device: 'x', scannedAt: new Date().toISOString() },
    { id: '00000000-0000-4000-9000-000000000003', passId: asha.id, step: 1, result: 'nonsense', presenter: false, gate: '', device: 'x', scannedAt: new Date().toISOString() }];
  expect(await call('organiser', 'record_pass_checks($1,$2::jsonb)', [w.eventId, JSON.stringify(queued)])).toBe(1);   // the other event's pass and the bad row are dropped
  expect(await call('organiser', 'record_pass_checks($1,$2::jsonb)', [w.eventId, JSON.stringify(queued)])).toBe(0);   // a retried upload adds nothing
  await expect(call('organiser', 'record_pass_checks($1,$2::jsonb)', [w.eventId, '{}'])).rejects.toMatchObject({ code: '22023' });

  const arrivals = await call('organiser', 'pass_arrivals($1)', [w.eventId]);
  expect(arrivals.total).toBe(3);
  expect(arrivals.arrived).toHaveLength(1);
  expect(arrivals.arrived[0]).toMatchObject({ passId: asha.id, name: 'Asha Rao', kind: 'student', teamNumber: '1', teamName: 'Team One', gate: 'Gate 2' });
  // Nothing staff can read says who did the scanning.
  const everything = JSON.stringify([list, arrivals, await check(code(asha.secret, asha.id))]);
  for (const hidden of [ids.organiser, ids.chair, ids.admin, 'organiser@x.test', 'owner@x.test', 'phone-z']) expect(everything).not.toContain(hidden);
});

it('gives the sync pulse key to event staff, not to teams or outsiders', async () => {
  const key = await call<string>('organiser', 'pass_pulse_key($1)', [w.eventId]);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  for (const who of ['chair', 'judgeV', 'leadV'] as const) expect(await call(who, 'pass_pulse_key($1)', [w.eventId])).toBe(key);
  for (const who of ['mgr1', 'outsider', null] as const) await expect(call(who, 'pass_pulse_key($1)', [w.eventId])).rejects.toMatchObject(DENIED);
  expect((await teamPasses()).pulseKey).toBe(key);
  const other = await seedWorld(w.db);
  expect(await call('organiser', 'pass_pulse_key($1)', [other.eventId])).not.toBe(key);
});

it('keeps the tables closed and stops everything once the event is deleted', async () => {
  const asha = await claimed();
  for (const who of ['organiser', 'mgr1', null] as const) for (const table of ['passes', 'pass_checks', 'event_pass_keys'])
    await expect(as(w.db, who, (q) => q(`select * from ${table}`))).rejects.toMatchObject(DENIED);
  const p = await student('Dev Shah');
  const token = await call<string>('mgr1', 'pass_link($1)', [p.id]);
  await w.db.query('update events set deleted_at=now() where id=$1', [w.eventId]);
  await expect(teamPasses()).rejects.toMatchObject(DENIED);
  await expect(call(null, 'claim_pass($1,$2)', [p.id, token])).rejects.toMatchObject(DENIED);
  await expect(call(null, 'pass_card($1,$2,$3)', [asha.id, stepNow(), mac(asha.secret, asha.id, stepNow())])).rejects.toMatchObject(DENIED);
  await expect(check(code(asha.secret, asha.id))).rejects.toMatchObject(DENIED);
  await expect(call('organiser', 'door_list($1)', [w.eventId])).rejects.toMatchObject(DENIED);
});

it('tells any phone the time, so one with a wrong clock can still make codes the door accepts', async () => {
  for (const who of [null, 'mgr1', 'judge'] as Array<Who | null>) {
    const now = await call<number>(who, 'pass_now()');
    expect(Math.abs(Number(now) - Date.now())).toBeLessThan(5000);
  }
});
