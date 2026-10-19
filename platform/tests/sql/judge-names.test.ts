import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,ids,makeDb,seedWorld,type World} from './harness';
let db:PGlite,w:World;
beforeAll(async()=>{db=await makeDb();w=await seedWorld(db);});
afterAll(async()=>{await db.close();});
describe('judge names',()=>{
 it('requires a non-blank name for new judges and panel leads, including direct API inserts',async()=>{
  for(const role of ['judge','lead_judge']) {
   await expect(as(db,'organiser',q=>q("insert into invitations(event_id,email,role,panel) values($1,'nameless@x.test',$2,'verbal')",[w.eventId,role]))).rejects.toThrow(/judge name/);
   await expect(as(db,'organiser',q=>q("insert into invitations(event_id,email,role,panel,display_name) values($1,'blank@x.test',$2,'verbal','  ')",[w.eventId,role]))).rejects.toThrow(/judge name/);
  }
 });
 it('copies and retains the name after verified acceptance and subsequent team or panel assignments',async()=>{
  await as(db,'organiser',q=>q("insert into invitations(event_id,email,role,panel,display_name) values($1,'new.judge@x.test','judge','verbal','  Asha Patel  ')",[w.eventId]));
  await as(db,'invitee',q=>q('select claim_invitations()'));
  const name=async()=>(await as(db,'organiser',q=>q('select display_name from event_roles where event_id=$1 and user_id=$2',[w.eventId,ids.invitee]))).rows.map(r=>r.display_name);
  expect(await name()).toEqual(['Asha Patel']);
  await as(db,'organiser',q=>q("select set_judge_assignment($1,$2,'design_engineering',null)",[w.eventId,ids.invitee]));
  expect(await name()).toEqual(['Asha Patel','Asha Patel']);
  await as(db,'organiser',q=>q("select set_judge_assignment($1,$2,'verbal',array[$3::uuid])",[w.eventId,ids.invitee,w.team1]));
  expect(await name()).toEqual(['Asha Patel','Asha Patel']);
  await as(db,'organiser',q=>q("select set_judge_name($1,$2,'Asha P.')",[w.eventId,ids.invitee]));
  expect(await name()).toEqual(['Asha P.','Asha P.']);
 });
 it('refuses renaming by ordinary judges and prevents blank or overlong names',async()=>{
  await expect(as(db,'judgeV',q=>q("select set_judge_name($1,$2,'Forged')",[w.eventId,ids.judgeD]))).rejects.toThrow(/only the Chair/);
  for(const value of ['', '   ','x'.repeat(101)])await expect(as(db,'organiser',q=>q('select set_judge_name($1,$2,$3)',[w.eventId,ids.judgeD,value]))).rejects.toThrow(/judge name/);
 });
});

it('keeps legacy unnamed invitations claimable and permits delivery metadata updates',async()=>{
 await db.exec('alter table invitations disable trigger invitation_name_guard');
 let id:string;
 try {id=(await db.query<{id:string}>("insert into invitations(event_id,email,role,panel) values($1,'new.judge@x.test','judge','enterprise') returning id",[w.eventId])).rows[0].id;}
 finally {await db.exec('alter table invitations enable trigger invitation_name_guard');}
 const reserved=(await as(db,'organiser',q=>q('select reserve_invitation_email($1) as result',[id!]))).rows[0].result;
 expect(reserved.status).toBe('reserved');
 await as(db,'invitee',q=>q('select claim_invitations()'));
 expect((await db.query('select id from invitations where id=$1',[id!])).rows).toHaveLength(0);
});
