import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,ids,makeDb,seedWorld,type World} from './harness';
let db:PGlite,w:World,snapshot:string;
beforeAll(async()=>{
 db=await makeDb();w=await seedWorld(db);
 for(const [team,text] of [[w.team1,'OWN TEAM FEEDBACK'],[w.team2,'OTHER TEAM FEEDBACK']]){
  const c=(await db.query<{id:string}>("insert into scorecards(event_id,team_id,area_id,panel,judge_id) values($1,$2,'verbal-technique','verbal',$3) returning id",[w.eventId,team,ids.judgeV])).rows[0].id;
  await db.query("insert into scorecard_scores(scorecard_id,criterion_id,score,comment) values($1,'team-contribution',12,'SECRET CRITERION NOTE'),($1,'engagement-presentation-dynamics',14,'SECRET')",[c]);
  await as(db,'judgeV',q=>q('select save_card_review($1,$2)',[c,{overall:text,strengths:'Team strengths',improvements:'Team improvements',internalNotes:'SECRET PRIVATE REVIEW',criterionNotes:{},nominations:[]} ]));
  await as(db,'judgeV',q=>q("update scorecards set status='submitted' where id=$1",[c]));
 }
 const rows=[{teamId:w.team1,number:'1',name:'Team One',rank:1,total:26,subtotal:26,penalties:0,areas:{'verbal-technique':26}},{teamId:w.team2,number:'2',name:'Team Two',rank:2,total:25,subtotal:25,penalties:0,areas:{'verbal-technique':25}}];
 snapshot=(await as(db,'chair',q=>q("insert into ranking_snapshots(event_id,ruleset_id,input_hash,inputs,rows) values($1,'india-national-finals-2026',$2,'{}',$3) returning id",[w.eventId,'b'.repeat(64),rows]))).rows[0].id;
});
afterAll(async()=>{await db.close();});
describe('manager contacts and private result delivery',()=>{
 it('imports manager emails atomically, stores them privately and creates verified manager invitations',async()=>{
  const t=(await as(db,'organiser',q=>q('select * from import_teams($1,$2)',[w.eventId,[{number:'003',name:'Third',managerEmail:' New.Judge@X.Test '}]]))).rows[0];
  expect(t.manager_email).toBeUndefined();
  const c=(await as(db,'organiser',q=>q('select manager_email from team_contacts where team_id=$1',[t.id]))).rows[0];expect(c.manager_email).toBe('new.judge@x.test');
  await as(db,'invitee',q=>q('select claim_invitations()'));
  expect((await as(db,'invitee',q=>q("select team_id from event_roles where event_id=$1 and role='team_manager'",[w.eventId]))).rows[0].team_id).toBe(t.id);
  await expect(as(db,'organiser',q=>q('select * from import_teams($1,$2)',[w.eventId,[{number:'004',name:'Fourth',managerEmail:'ok@example.com'},{number:'005',name:'Fifth',managerEmail:'bad-address'}]]))).rejects.toThrow();
  expect((await db.query("select id from teams where event_id=$1 and number in ('004','005')",[w.eventId])).rows).toHaveLength(0);
  expect((await as(db,'judgeV',q=>q('select * from team_contacts'))).rows).toHaveLength(0);
  expect((await as(db,'mgr1',q=>q('select * from team_contacts'))).rows).toHaveLength(0);
  await expect(as(db,null,q=>q('select * from team_contacts'))).rejects.toThrow(/permission denied/);
 });
 it('keeps packets scoped to one team and excludes private notes and other teams’ feedback',async()=>{
  const packet=(await as(db,'organiser',q=>q('select team_results_packet($1,$2) as packet',[w.eventId,w.team1]))).rows[0].packet;
  expect(packet.cards).toHaveLength(1);expect(packet.standings).toHaveLength(2);expect(packet.standings[1].areas).toBeUndefined();
  expect(packet.benchmarks.__total).toEqual({low:25,median:25.5,high:26});
  expect(packet.benchmarks['verbal-technique']).toEqual({low:25,median:25.5,high:26});
  expect(JSON.stringify(packet)).toContain('OWN TEAM FEEDBACK');expect(JSON.stringify(packet)).not.toContain('OTHER TEAM FEEDBACK');expect(JSON.stringify(packet)).not.toContain('SECRET');
  await expect(as(db,'mgr1',q=>q('select team_results_packet($1,$2)',[w.eventId,w.team2]))).rejects.toThrow(/only event staff/);
 });
 it('includes only the selected team lane and excludes pending runs and opponent timing',async()=>{
  await db.query("insert into race_heats(id,event_id,heat_number,label,phase,lane1_team,lane2_team,lane1_car,lane2_car,lane1_status,lane2_status,lane1_total_ms,lane1_reaction_ms,lane2_total_ms,lane2_reaction_ms,source) values(gen_random_uuid(),$1,1,'Final run','reaction',$2,$3,'A','B','finished','finished',1400,180,1999,555,'manual'),(gen_random_uuid(),$1,2,'Pending run','reaction',$2,$3,'B','A','pending','pending',null,null,null,null,'manual')",[w.eventId,w.team1,w.team2]);
  const packet=(await as(db,'organiser',q=>q('select team_results_packet($1,$2) as packet',[w.eventId,w.team1]))).rows[0].packet;
  expect(packet.races).toEqual([{number:1,label:'Final run',phase:'reaction',lane:1,car:'A',status:'finished',totalMs:1400,reactionMs:180}]);
  expect(JSON.stringify(packet.races)).not.toContain('1999');
 });
 it('requires both released results and organiser/Chair-confirmed awards',async()=>{
  await as(db,'organiser',q=>q('select set_team_contact($1,$2,$3)',[w.eventId,w.team1,'manager@example.com']));
  await expect(as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,(select id from ranking_snapshots where event_id=$1 order by created_at desc,id desc limit 1),(select awards_version from result_mail_settings where event_id=$1),(select manager_email from team_contacts where event_id=$1 and team_id=$2))',[w.eventId,w.team1]))).rejects.toThrow(/release final/);
  const version=(await db.query<{v:string}>("select racing_version($1) as v",[w.eventId])).rows[0].v;
  snapshot=(await as(db,'chair',q=>q("insert into ranking_snapshots(event_id,ruleset_id,input_hash,inputs,rows) select event_id,ruleset_id,input_hash,$2::jsonb,rows from ranking_snapshots where id=$1 returning id",[snapshot,{racingVersion:version}]))).rows[0].id;
  await db.query('update events set results_released=true where id=$1',[w.eventId]);
  await expect(as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,(select id from ranking_snapshots where event_id=$1 order by created_at desc,id desc limit 1),(select awards_version from result_mail_settings where event_id=$1),(select manager_email from team_contacts where event_id=$1 and team_id=$2))',[w.eventId,w.team1]))).rejects.toThrow(/confirm awards/);
  await expect(as(db,'judgeV',q=>q('select confirm_event_awards($1)',[w.eventId]))).rejects.toThrow(/only the Organiser/);
  await as(db,'chair',q=>q('select save_event_award($1,$2,$3)',[w.eventId,'Overall Champion',w.team1]));
  await as(db,'organiser',q=>q('select confirm_event_awards($1)',[w.eventId]));
 });
 it('uses the saved recipient, deduplicates sends and protects delivery completion',async()=>{
  const job=(await as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,(select id from ranking_snapshots where event_id=$1 order by created_at desc,id desc limit 1),(select awards_version from result_mail_settings where event_id=$1),(select manager_email from team_contacts where event_id=$1 and team_id=$2)) as j',[w.eventId,w.team1]))).rows[0].j;
  expect(job).toMatchObject({status:'reserved',email:'manager@example.com'});expect(job.packet.snapshotId).toBe(snapshot);
  expect(job.packet.awards).toEqual([{title:'Overall Champion',teamNumber:'1',teamName:'Team One',teamSchool:''}]);
  expect((await as(db,'chair',q=>q('select reserve_team_results_email($1,$2,(select id from ranking_snapshots where event_id=$1 order by created_at desc,id desc limit 1),(select awards_version from result_mail_settings where event_id=$1),(select manager_email from team_contacts where event_id=$1 and team_id=$2)) as j',[w.eventId,w.team1]))).rows[0].j.status).toBe('busy');
  await expect(as(db,'organiser',q=>q("select complete_team_results_email($1,$2,'sent',null)",[job.jobId,job.attempt]))).rejects.toThrow(/permission denied/);
  await db.exec('set role service_role');
  try {expect((await db.query<{ok:boolean}>("select complete_team_results_email($1,$2,'sent',null) as ok",[job.jobId,job.attempt])).rows[0].ok).toBe(true);}finally{await db.exec('reset role');}
  expect((await as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,(select id from ranking_snapshots where event_id=$1 order by created_at desc,id desc limit 1),(select awards_version from result_mail_settings where event_id=$1),(select manager_email from team_contacts where event_id=$1 and team_id=$2)) as j',[w.eventId,w.team1]))).rows[0].j.status).toBe('already_sent');
  expect((await as(db,'organiser',q=>q('select result_mail_state($1) as s',[w.eventId]))).rows[0].s.deliveries[0].status).toBe('sent');
 });
 it('requires reconfirmation after award changes and creates a new delivery version',async()=>{
  const before=(await as(db,'organiser',q=>q('select result_mail_state($1) as s',[w.eventId]))).rows[0].s;
  await as(db,'chair',q=>q('select save_event_award($1,$2,$3)',[w.eventId,'Team Identity',w.team2]));
  expect((await as(db,'organiser',q=>q('select result_mail_state($1) as s',[w.eventId]))).rows[0].s.confirmed).toBe(false);
  await as(db,'chair',q=>q('select confirm_event_awards($1)',[w.eventId]));
  const after=(await as(db,'organiser',q=>q('select result_mail_state($1) as s',[w.eventId]))).rows[0].s;
  expect(after.version).not.toBe(before.version);expect(after.deliveries).toHaveLength(0);
 });
});

it('refuses stale reviewed rankings, award versions and changed recipients',async()=>{
 for(const [snap,ver,email] of [[snapshot,'00000000-0000-4000-8000-000000000099','manager@example.com'],[snapshot,null,'wrong@example.com'],['00000000-0000-4000-8000-000000000099',null,'manager@example.com']] as const){
  const version=ver??(await db.query<{v:string}>('select awards_version as v from result_mail_settings where event_id=$1',[w.eventId])).rows[0].v;
  await expect(as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,$3,$4,$5)',[w.eventId,w.team1,snap,version,email]))).rejects.toThrow(/changed/);
 }
});

it('does not retry an uncertain delivery until staff explicitly acknowledge the inbox check',async()=>{
 const version=(await db.query<{v:string}>('select awards_version as v from result_mail_settings where event_id=$1',[w.eventId])).rows[0].v;
 const reserve=()=>as(db,'organiser',q=>q('select reserve_team_results_email($1,$2,$3,$4,$5) as j',[w.eventId,w.team1,snapshot,version,'manager@example.com']));
 const job=(await reserve()).rows[0].j;
 await db.exec('set role service_role');
 try{await db.query("select complete_team_results_email($1,$2,'uncertain','unconfirmed')",[job.jobId,job.attempt]);}finally{await db.exec('reset role');}
 await expect(reserve()).rejects.toThrow(/unconfirmed/);
 await as(db,'chair',q=>q('select acknowledge_result_email_retry($1,$2,$3,$4,$5)',[w.eventId,w.team1,snapshot,version,'manager@example.com']));
 expect((await reserve()).rows[0].j.status).toBe('reserved');
});
