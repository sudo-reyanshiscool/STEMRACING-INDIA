import { beforeAll, describe, expect, it } from 'vitest';
import { as, makeDb, seedWorld, type Who, type World } from './harness';
let w:World;
beforeAll(async()=>{w=await seedWorld(await makeDb());});
let counter=0;
const invite=async()=> (await as(w.db,'organiser',q=>q("insert into invitations(event_id,email,role) values ($1,$2,'race_official') returning id",[w.eventId,`recipient${++counter}@x.test`]))).rows[0].id as string;
const reserve=(id:string,who:Who|null='organiser')=>as(w.db,who,async q=>(await q('select reserve_invitation_email($1) as job',[id])).rows[0].job);
const state=async(id:string)=>(await w.db.query<{email_status:string;email_sent_at:string|null;email_failure:string|null}>('select email_status,email_sent_at,email_failure from invitations where id=$1',[id])).rows[0];
const complete=async(id:string,ticket:string,status:string,failure:string|null=null)=>{
 await w.db.exec('set role service_role');
 try{return (await w.db.query<{done:boolean}>('select complete_invitation_email($1,$2,$3,$4) as done',[id,ticket,status,failure])).rows[0].done;}finally{await w.db.exec('reset role');}
};
describe('invitation email access and delivery',()=>{
 it('records organiser invitation delivery without a human session while retaining role protection',async()=>{
  const id=(await as(w.db,'organiser',q=>q("insert into invitations(event_id,email,role) values ($1,'organiser-delivery@x.test','organiser') returning id",[w.eventId]))).rows[0].id;
  const job=await reserve(id);
  await expect(as(w.db,'chair',q=>q("update invitations set email='changed@x.test' where id=$1",[id]))).rejects.toThrow();
  await w.db.exec("set request.jwt.claims='{}'");
  expect(await complete(id,job.attempt,'sent')).toBe(true);
  expect(await state(id)).toMatchObject({email_status:'sent',email_failure:null});
  await expect(as(w.db,'chair',q=>q("insert into invitations(event_id,email,role) values ($1,'forged@x.test','organiser')",[w.eventId]))).rejects.toThrow();
 });
 it('starts unsent and restricts reservation to the event organiser or Chair',async()=>{
  const id=await invite();expect((await state(id)).email_status).toBe('not_sent');
  for(const who of ['judgeV','leadV','mgr1','outsider',null] as const)await expect(reserve(id,who)).rejects.toThrow();
  const job=await reserve(id,'chair');expect(job).toMatchObject({status:'reserved',email:'recipient1@x.test'});expect(job.attempt).toMatch(/^[0-9a-f-]{36}$/);
 });
 it('does not allow API callers to forge delivery metadata',async()=>{
  const id=await invite();
  for(const who of ['organiser','chair'] as const){
   await expect(as(w.db,who,q=>q("update invitations set email_status='sent' where id=$1",[id]))).rejects.toThrow(/permission/);
   await expect(as(w.db,who,q=>q("insert into invitations(event_id,email,role,email_status) values ($1,'fake@x.test','chair','sent')",[w.eventId]))).rejects.toThrow(/permission/);
   await expect(as(w.db,who,q=>q("select complete_invitation_email($1,gen_random_uuid(),'sent',null)",[id]))).rejects.toThrow(/permission/);
  }
 });
 it('throttles duplicate clicks and only completes the matching current reservation',async()=>{
  const id=await invite();const job=await reserve(id);
  expect(await reserve(id)).toMatchObject({status:'cooldown'});
  expect(await complete(id,'00000000-0000-4000-8000-000000000001','sent')).toBe(false);
  expect((await state(id)).email_status).toBe('sending');
  expect(await complete(id,job.attempt,'sent')).toBe(true);expect(await state(id)).toMatchObject({email_status:'sent',email_failure:null});expect((await state(id)).email_sent_at).not.toBeNull();
  expect(await complete(id,job.attempt,'failed','provider')).toBe(false);
 });
 it('keeps failed invitations available for retry and rejects stale completions',async()=>{
  const id=await invite();const first=await reserve(id);await complete(id,first.attempt,'failed','rate_limit');
  expect(await state(id)).toMatchObject({email_status:'failed',email_failure:'rate_limit',email_sent_at:null});
  await w.db.query("update invitations set email_attempt_at=now()-interval '2 minutes' where id=$1",[id]);
  const retry=await reserve(id);expect(retry.attempt).not.toBe(first.attempt);
  expect(await complete(id,first.attempt,'sent')).toBe(false);expect(await complete(id,retry.attempt,'sent')).toBe(true);
 });
 it('cannot reserve another event invitation or one from a deleted event',async()=>{
  const id=await invite();await w.db.query('delete from event_roles where event_id=$1 and user_id=$2',[w.eventId,'00000000-0000-4000-8000-000000000002']);
  await expect(reserve(id,'chair')).rejects.toThrow(/not available/);
  await as(w.db,'organiser',q=>q("select delete_event($1,'Test event')",[w.eventId]));
  await expect(reserve(id)).rejects.toThrow(/not available/);
 });
});
