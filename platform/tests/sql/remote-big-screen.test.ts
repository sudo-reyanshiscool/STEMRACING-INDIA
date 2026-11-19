import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { as, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
beforeAll(async () => { w = await seedWorld(await makeDb()); });
beforeEach(async () => { w = await seedWorld(w.db); });
afterAll(async () => w.db.close());

const link = async (who: Who | null = 'organiser', event = w.eventId): Promise<{ key: string; n: number }> =>
  (await as(w.db, who, (q) => q('select show_screen_link($1) l', [event]))).rows[0].l;
const publish = (n: number, state: unknown, who: Who | null = 'organiser') =>
  as(w.db, who, (q) => q('select publish_show_screen($1,$2,$3::jsonb)', [w.eventId, n, JSON.stringify(state)]));
const read = async (key: string, after = 0, who: Who | null = null, event = w.eventId) =>
  (await as(w.db, who, (q) => q('select show_screen_state($1,$2,$3) s', [event, key, after]))).rows[0].s;
const picture = async (key: string, asset: string, team = w.team1, who: Who | null = null) =>
  (await as(w.db, who, (q) => q('select show_screen_picture($1,$2,$3,$4) p', [w.eventId, key, team, asset]))).rows[0].p;

it('gives the screen key to organisers and the Chair only, and the same key every time', async () => {
  const first = await link();
  expect(first.key).toMatch(/^[0-9a-f]{64}$/);
  expect(first.n).toBe(0);
  expect(await link('chair')).toEqual(first);
  for (const who of ['judgeV', 'leadV', 'mgr1', 'outsider', null] as const) await expect(link(who)).rejects.toMatchObject({ code: '42501' });
  const other = await seedWorld(w.db);
  expect((await link('organiser', other.eventId)).key).not.toBe(first.key);
});

it('lets only event staff publish, and a browser with the key read it without signing in', async () => {
  const { key } = await link();
  expect(await read(key)).toBeNull();   // nothing published yet
  for (const who of ['judgeV', 'mgr1', 'outsider', null] as const) await expect(publish(5, { src: 'hold' }, who)).rejects.toMatchObject({ code: '42501' });
  await publish(1000, { src: 'race', race: { t1: '1', t2: '2' } });
  expect(await read(key)).toEqual({ n: 1000, state: { src: 'race', race: { t1: '1', t2: '2' } } });
  expect(await read(key, 1000)).toBeNull();   // nothing newer than what the screen already has
  expect((await link('chair')).n).toBe(1000);
  for (const bad of [[0, { src: 'hold' }], [5, 'hold'], [5, [1]], [5, { big: 'x'.repeat(600000) }]] as const) await expect(publish(bad[0], bad[1])).rejects.toMatchObject({ code: '22023' });
});

it('numbers every state after the last, even from a laptop whose clock is behind', async () => {
  const { key } = await link();
  await publish(5000, { src: 'race' });
  await publish(1200, { src: 'hold' }, 'chair');
  expect(await read(key, 5000)).toEqual({ n: 5001, state: { src: 'hold' } });
});

it('refuses a wrong key, a key for another event and a deleted event', async () => {
  const { key } = await link();
  await publish(10, { src: 'hold' });
  const other = await seedWorld(w.db);
  const otherKey = (await link('organiser', other.eventId)).key;
  for (const bad of ['', 'nope', otherKey, key.slice(1)]) {
    await expect(read(bad)).rejects.toMatchObject({ code: '42501' });
    await expect(picture(bad, 'team_logo')).rejects.toMatchObject({ code: '42501' });
  }
  await expect(as(w.db, null, (q) => q('select show_screen_state($1,null,0)', [w.eventId]))).rejects.toMatchObject({ code: '42501' });
  await expect(as(w.db, null, (q) => q('select * from show_screens'))).rejects.toMatchObject({ code: '42501' });
  await expect(as(w.db, 'organiser', (q) => q('select * from show_screens'))).rejects.toMatchObject({ code: '42501' });
  await w.db.query('update events set deleted_at=now() where id=$1', [w.eventId]);
  await expect(read(key)).rejects.toMatchObject({ code: '42501' });
  await expect(picture(key, 'team_logo')).rejects.toMatchObject({ code: '42501' });
});

it('serves the pictures the graphics draw, the photograph only once approved, and nothing else', async () => {
  const { key } = await link();
  await as(w.db, 'mgr1', (q) => q('select upload_compulsory_asset($1,$2,$3,$4::jsonb,0)', [w.eventId, w.team1, 'team_logo', JSON.stringify({ name: 'logo.png', mime: 'image/png', base64: png })]));
  expect(await picture(key, 'team_logo')).toEqual({ mime: 'image/png', base64: png });
  await expect(picture(key, 'team_logo', w.team2)).rejects.toMatchObject({ code: '22023' });   // that team has none
  await expect(picture(key, 'school_logo')).rejects.toMatchObject({ code: '22023' });
  for (const asset of ['official_photo_original', 'car_model_3d', 'portrait:m1', 'design_portfolio']) await expect(picture(key, asset)).rejects.toMatchObject({ code: '22023' });

  await as(w.db, 'organiser', (q) => q('select upload_team_photo($1,$2,0,$3::jsonb)', [w.eventId, w.team1, JSON.stringify({ name: 'team.png', mime: 'image/png', base64: png, mediaConsent: true })]));
  await w.db.query("update team_photos set approved_content=decode($2,'base64'),approved_size=$3,approved_at=now(),approval_status='pending' where team_id=$1", [w.team1, png, Buffer.from(png, 'base64').length]);
  await expect(picture(key, 'official_photo_approved')).rejects.toMatchObject({ code: '22023' });
  await w.db.query("update team_photos set approval_status='approved' where team_id=$1", [w.team1]);
  expect(await picture(key, 'official_photo_approved')).toEqual({ mime: 'image/png', base64: png });
});
