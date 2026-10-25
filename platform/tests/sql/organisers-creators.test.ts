import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, makeDb, seedWorld, type World, EMAIL, ids } from './harness';
import { INDIA_2026 } from '../../src/rulesets';

let db: PGlite, w: World;
beforeAll(async () => { db = await makeDb(); });
beforeEach(async () => { w = await seedWorld(db); });
afterAll(async () => { await db.close(); });

describe('event creation authorization and multiple organisers', () => {
  it('allows active organisers to create new events, but blocks judges and outsiders', async () => {
    // Organiser can check can_create_event and create event
    expect((await as(db, 'organiser', (q) => q('select can_create_event() as ok'))).rows[0].ok).toBe(true);
    const newEv = (await as(db, 'organiser', (q) => q('select * from create_event($1, null, $2::jsonb)', ['Second Event', JSON.stringify(INDIA_2026)]))).rows[0];
    expect(newEv.name).toBe('Second Event');

    // Judge cannot create event
    expect((await as(db, 'judgeV', (q) => q('select can_create_event() as ok'))).rows[0].ok).toBe(false);
    await expect(as(db, 'judgeV', (q) => q('select * from create_event($1, null, $2::jsonb)', ['Blocked Event', JSON.stringify(INDIA_2026)]))).rejects.toThrow(/only organisers can create events/);

    // Outsider cannot create event
    expect((await as(db, 'outsider', (q) => q('select can_create_event() as ok'))).rows[0].ok).toBe(false);
    await expect(as(db, 'outsider', (q) => q('select * from create_event($1, null, $2::jsonb)', ['Blocked Event', JSON.stringify(INDIA_2026)]))).rejects.toThrow(/only organisers can create events/);
  });

  it('allows invited Competition Organisers to create events', async () => {
    await as(db,'admin',q=>q("select invite_organiser($1,'competition')",[EMAIL.outsider]));
    await as(db,'outsider',q=>q('select claim_invitations()'));
    expect((await as(db, 'outsider', (q) => q('select can_create_event() as ok'))).rows[0].ok).toBe(true);
    const ev = (await as(db, 'outsider', (q) => q('select * from create_event($1, null, $2::jsonb)', ['From Allowlist', JSON.stringify(INDIA_2026)]))).rows[0];
    expect(ev.name).toBe('From Allowlist');
  });

  it('allows only organisers to invite other organisers and blocks chairs', async () => {
    // Chair cannot invite an organiser
    await expect(as(db, 'chair', (q) => q("insert into invitations(event_id, email, role) values ($1, 'org2@x.test', 'organiser')", [w.eventId]))).rejects.toThrow(/only organisers can invite organisers/);

    // Organiser can invite another organiser
    await as(db, 'organiser', (q) => q("insert into invitations(event_id, email, role) values ($1, 'org2@x.test', 'organiser')", [w.eventId]));
    expect((await as(db, 'organiser', (q) => q("select email from list_event_invitations($1) where event_id = $1 and role = 'organiser'", [w.eventId]))).rows).toHaveLength(1);
  });

  it('allows removing an organiser when multiple exist, but prevents removing the last organiser', async () => {
    // Add second organiser directly
    const org2Id = '00000000-0000-4000-8000-000000000099';
    await db.query("insert into auth.users(id, email, email_confirmed_at) values ($1, 'org2@x.test', now()) on conflict do nothing", [org2Id]);
    await db.query("insert into event_roles(event_id, user_id, role, email) values ($1, $2, 'organiser', 'org2@x.test')", [w.eventId, org2Id]);

    // Chair cannot remove organiser
    await expect(as(db, 'chair', (q) => q("delete from event_roles where event_id = $1 and user_id = $2", [w.eventId, org2Id]))).rejects.toThrow(/only organisers can remove organisers/);

    // Organiser 1 can remove organiser 2
    await as(db, 'organiser', (q) => q("delete from event_roles where event_id = $1 and user_id = $2", [w.eventId, org2Id]));
    expect((await db.query("select 1 from event_roles where event_id = $1 and role = 'organiser'", [w.eventId])).rows).toHaveLength(1);

    // Now cannot delete the last organiser
    await expect(as(db, 'organiser', (q) => q("delete from event_roles where event_id = $1 and user_id = $2", [w.eventId, ids.organiser]))).rejects.toThrow(/an event must have at least one organiser/);
  });
});
