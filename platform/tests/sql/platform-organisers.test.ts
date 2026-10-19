import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,denied,EMAIL,ids,makeDb,seedWorld,type Who,type World} from './harness';
import {INDIA_2026} from '../../src/rulesets';
let db:PGlite,w:World;
beforeEach(async()=>{db=await makeDb();w=await seedWorld(db);});
afterEach(async()=>{await db.close();});
const grant=async(who:Who,scope:string)=>{
 const id=(await as(db,'admin',q=>q('select invite_organiser($1,$2) as id',[EMAIL[who],scope]))).rows[0].id;
 await as(db,who,q=>q('select claim_invitations()'));
 return id;
};
const create=async(who:Who,name='New event')=>(await as(db,who,q=>q('select * from create_event($1,null,$2)',[name,INDIA_2026]))).rows[0];
describe('permanent administrator and scoped organisers',()=>{
 it('gives the pinned owner every event’s organiser and Chair powers without copying assignments',async()=>{
  expect((await as(db,'admin',q=>q('select role from effective_event_roles($1) order by role',[w.eventId]))).rows.map(r=>r.role)).toEqual(['organiser','chair']);
  expect((await as(db,'admin',q=>q('select id from teams where event_id=$1',[w.eventId]))).rows).toHaveLength(2);
  await as(db,'admin',q=>q("insert into score_overrides(event_id,team_id,area_id,value,reason) values($1,$2,'de-portfolio',100,'Owner moderation')",[w.eventId,w.team1]));
  expect((await db.query('select * from event_roles where event_id=$1 and user_id=$2',[w.eventId,ids.admin])).rows).toHaveLength(0);
 });
 it('lets Platform Organisers manage all existing and future events and restore deleted events',async()=>{
  await grant('outsider','platform');const later=await create('admin');
  expect((await as(db,'outsider',q=>q('select id from events where id=any($1)',[[w.eventId,later.id]]))).rows).toHaveLength(2);
  await as(db,'outsider',q=>q("insert into teams(event_id,number,name) values($1,'99','Global team')",[later.id]));
  await as(db,'outsider',q=>q('select delete_event($1,$2)',[w.eventId,'Test event']));
  expect((await as(db,'outsider',q=>q('select id from list_deleted_events()'))).rows.map(r=>r.id)).toContain(w.eventId);
  expect((await as(db,'outsider',q=>q("select has_role($1,'chair') as ok",[w.eventId]))).rows[0].ok).toBe(false);
  await as(db,'outsider',q=>q('select restore_event($1)',[w.eventId]));
  expect((await as(db,'outsider',q=>q("select has_role($1,'chair') as ok",[w.eventId]))).rows[0].ok).toBe(true);
  await create('outsider','Platform-created event');
 });
 it('lets Competition Organisers create events, but manage only created or assigned events',async()=>{
  await grant('outsider','competition');const mine=await create('outsider');
  expect((await as(db,'outsider',q=>q('select id from events'))).rows.map(r=>r.id)).toEqual([mine.id]);
  await denied(as(db,'outsider',q=>q("insert into teams(event_id,number,name) values($1,'99','Wrong event')",[w.eventId])));
  await expect(as(db,'outsider',q=>q('select delete_event($1,$2)',[w.eventId,'Test event']))).rejects.toThrow(/only organisers/);
  await expect(as(db,'outsider',q=>q("select invite_organiser('friend@x.test','platform')"))).rejects.toThrow(/only platform organisers/);
  await as(db,'admin',q=>q("insert into invitations(event_id,email,role) values($1,$2,'organiser')",[w.eventId,EMAIL.outsider]));
  await as(db,'outsider',q=>q('select claim_invitations()'));
  expect((await as(db,'outsider',q=>q('select id from events'))).rows).toHaveLength(2);
  await as(db,'outsider',q=>q("insert into score_overrides(event_id,team_id,area_id,value,reason) values($1,$2,'de-portfolio',90,'Competition moderation')",[w.eventId,w.team1]));
 });
 it('does not bootstrap strangers when there are no active events and retires the writable email allowlist',async()=>{
  await db.query('update events set deleted_at=now()');
  expect((await as(db,'outsider',q=>q('select can_create_event() as ok'))).rows[0].ok).toBe(false);
  await expect(create('outsider')).rejects.toThrow(/only organisers/);
  expect((await as(db,'admin',q=>q('select can_create_event() as ok'))).rows[0].ok).toBe(true);
  await expect(as(db,'organiser',q=>q("insert into event_creators(email) values('stranger@x.test')"))).rejects.toThrow(/permission denied/);
 });
 it('cannot remove, demote or overwrite the permanent owner, even as another Platform Organiser',async()=>{
  await grant('outsider','platform');const event=await create('admin');
  for(const actor of ['admin','outsider'] as const){
   await expect(as(db,actor,q=>q('select remove_organiser($1)',[ids.admin]))).rejects.toThrow(/permanent/);
   await expect(as(db,actor,q=>q("select invite_organiser($1,'competition')",[EMAIL.admin]))).rejects.toThrow(/permanent/);
   await expect(as(db,actor,q=>q('delete from platform_owner'))).rejects.toThrow(/permission denied/);
   await expect(as(db,actor,q=>q("delete from event_roles where event_id=$1 and user_id=$2 and role='organiser'",[event.id,ids.admin]))).rejects.toThrow(/permanent/);
   await expect(as(db,actor,q=>q("update event_roles set role='chair' where event_id=$1 and user_id=$2",[event.id,ids.admin]))).rejects.toThrow(/permanent/);
  }
  await expect(db.exec('delete from platform_owner')).rejects.toThrow(/permanent/);
 });
 it('blocks Chairs from direct-table organiser promotion and protects existing organiser roles',async()=>{
  await denied(as(db,'chair',q=>q("insert into event_roles(event_id,user_id,role,email) values($1,$2,'organiser',$3)",[w.eventId,ids.chair,EMAIL.chair])));
  await denied(as(db,'chair',q=>q("update event_roles set role='organiser' where event_id=$1 and user_id=$2",[w.eventId,ids.chair])));
  await denied(as(db,'chair',q=>q("update event_roles set user_id=$2 where event_id=$1 and role='organiser'",[w.eventId,ids.chair])));
  await expect(as(db,'chair',q=>q("select invite_organiser($1,'platform')",[EMAIL.chair]))).rejects.toThrow(/only platform/);
 });
 it('claims only confirmed Auth addresses, ignores forged JWT email, and keeps the owner pinned after an email change',async()=>{
  await as(db,'admin',q=>q("select invite_organiser($1,'platform')",[EMAIL.unverified]));
  expect((await as(db,'unverified',q=>q('select claim_invitations() as n'))).rows[0].n).toBe(0);
  await as(db,'outsider',async q=>{
   await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.outsider,email:EMAIL.admin})]);
   expect((await q('select platform_manager() as ok')).rows[0].ok).toBe(false);
   expect((await q('select claim_invitations() as n')).rows[0].n).toBe(0);
  });
  await db.query("update auth.users set email='owner-renamed@x.test' where id=$1",[ids.admin]);
  expect((await as(db,'admin',q=>q('select platform_manager() as ok'))).rows[0].ok).toBe(true);
 });
 it('revokes global powers immediately, preserving separately granted event roles',async()=>{
  await grant('outsider','platform');
  await as(db,'admin',q=>q('select remove_organiser($1)',[ids.outsider]));
  expect((await as(db,'outsider',q=>q('select id from events'))).rows).toHaveLength(0);
  expect((await as(db,'outsider',q=>q('select can_create_event() as ok'))).rows[0].ok).toBe(false);
  expect((await as(db,'admin',q=>q('select id from events where id=$1',[w.eventId]))).rows).toHaveLength(1);
 });
 it('sends organiser invitations through the same protected delivery reservation and cooldown',async()=>{
  const id=(await as(db,'admin',q=>q("select invite_organiser('delivery@x.test','platform') as id"))).rows[0].id;
  await expect(as(db,'organiser',q=>q('select reserve_invitation_email($1)',[id]))).rejects.toThrow(/not available/);
  const ticket=(await as(db,'admin',q=>q('select reserve_invitation_email($1) as r',[id]))).rows[0].r;
  expect(ticket).toMatchObject({email:'delivery@x.test',status:'reserved'});
  expect((await as(db,'admin',q=>q('select reserve_invitation_email($1) as r',[id]))).rows[0].r.status).toBe('cooldown');
  await db.exec('set role service_role');
  try {expect((await db.query<{ok:boolean}>("select complete_invitation_email($1,$2,'sent',null) as ok",[id,ticket.attempt])).rows[0].ok).toBe(true);}
  finally {await db.exec('reset role');}
  await expect(as(db,'admin',q=>q("select complete_invitation_email($1,$2,'sent',null)",[id,ticket.attempt]))).rejects.toThrow(/permission denied/);
  await expect(as(db,'admin',q=>q('select claim_event_invitations()'))).rejects.toThrow(/permission denied/);
  const access=(await as(db,'admin',q=>q('select platform_access() as a'))).rows[0].a;
  expect(access.invitations[0].emailStatus).toBe('sent');
  await as(db,'admin',q=>q('select withdraw_organiser_invitation($1)',[id]));
 });
});
