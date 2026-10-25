import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,ids,makeDb,seedWorld,type World} from './harness';
let db:PGlite,w:World;beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>db.close());
it('treats a null team role as unassigned and snapshots All current teams explicitly',async()=>{
 await db.query("delete from event_roles where event_id=$1 and user_id=$2 and role='judge'",[w.eventId,ids.judgeV]);
 await db.query("insert into event_roles(event_id,user_id,role,panel,email) values($1,$2,'judge','verbal','judgev@x.test')",[w.eventId,ids.judgeV]);
 const open=(team:string)=>as(db,'judgeV',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique') returning id",[w.eventId,team]));
 await expect(open(w.team1)).rejects.toMatchObject({code:'42501'});
 await as(db,'organiser',q=>q("select set_judge_assignment($1,$2,'verbal',null)",[w.eventId,ids.judgeV]));await open(w.team1);
 const newTeam=(await db.query<{id:string}>("insert into teams(event_id,number,name) values($1,'NEW','Late registration') returning id",[w.eventId])).rows[0].id;
 await expect(open(newTeam)).rejects.toMatchObject({code:'42501'});
});
it('allows panel leads to reopen only their own panel, with reasons, while preserving release locks and audit',async()=>{
 const verbal=(await as(db,'judgeV',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique') returning id",[w.eventId,w.team1]))).rows[0].id;
 const design=(await as(db,'judgeD',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'de-portfolio') returning id",[w.eventId,w.team1]))).rows[0].id;
 // Fixture sets submitted directly as database owner so this test isolates reopening permissions.
 await db.exec('alter table scorecards disable trigger scorecards_guard');try{await db.query("update scorecards set status='submitted' where id=any($1::uuid[])",[[verbal,design]]);}finally{await db.exec('alter table scorecards enable trigger scorecards_guard');}
 await expect(as(db,'leadV',q=>q("select reopen_scorecard($1,'Too short')",[design]))).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'leadV',q=>q("select reopen_scorecard($1,'x')",[verbal]))).rejects.toMatchObject({code:'22023'});
 await as(db,'leadV',q=>q("select reopen_scorecard($1,'Panel requested a correction')",[verbal]));
 expect((await db.query<{status:string;reopened_count:number}>('select status,reopened_count from scorecards where id=$1',[verbal])).rows[0]).toEqual({status:'draft',reopened_count:1});
 expect((await db.query('select actor from audit_log where event_id=$1 and action=$2',[w.eventId,'reopen'])).rows).toHaveLength(1);
});
it('also restricts scrutineering judges and blocks existing inspection edits after reassignment',async()=>{
 await db.query("insert into event_roles(event_id,user_id,role,panel,email) values($1,$2,'judge','scrutineering','judged@x.test')",[w.eventId,ids.judgeD]);
 const insert=()=>as(db,'judgeD',q=>q("insert into technical_inspections(event_id,team_id,car,ruleset_id) values($1,$2,'A','technical') returning id",[w.eventId,w.team1]));
 await expect(insert()).rejects.toMatchObject({code:'42501'});
 await as(db,'organiser',q=>q("select set_judge_assignment($1,$2,'scrutineering',array[$3::uuid])",[w.eventId,ids.judgeD,w.team1]));const id=(await insert()).rows[0].id;
 await as(db,'organiser',q=>q("select set_judge_assignment($1,$2,'scrutineering',array[$3::uuid])",[w.eventId,ids.judgeD,w.team2]));
 await expect(as(db,'judgeD',q=>q("update technical_inspections set measurements='{}' where id=$1 returning id",[id]))).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'judgeD',q=>q('select submit_inspection($1)',[id]))).rejects.toMatchObject({code:'42501'});
});
