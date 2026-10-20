import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {as,ids,makeDb,seedWorld,type Who,type World} from './harness';
let db:Awaited<ReturnType<typeof makeDb>>,w:World;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(()=>db.close());
const state=async(who:Who='organiser')=>(await as(db,who,q=>q('select draw_lots_state($1) s',[w.eventId]))).rows[0].s;
const numbers=async(rows:unknown,version?:string,who:Who|null='organiser')=>as(db,who,async q=>q('select apply_team_number_draw($1,$2,$3)',[w.eventId,version??(await q('select draw_lots_state($1) s',[w.eventId])).rows[0].s.version,rows]));
const judges=async(rows:unknown,version?:string,who:Who|null='organiser',panel='verbal')=>as(db,who,async q=>q('select apply_judge_draw($1,$2,$3,$4)',[w.eventId,version??(await q('select draw_lots_state($1) s',[w.eventId])).rows[0].s.version,panel,rows]));
const numberRows=()=>[{teamId:w.team1,number:'002'},{teamId:w.team2,number:'001'}];
const judgeRows=()=>[{judgeId:ids.judgeV,teamIds:[w.team1]},{judgeId:ids.judgeD,teamIds:[w.team2]}];
const addSecondJudge=()=>db.query("insert into event_roles(event_id,user_id,role,panel,email,display_name) values($1,$2,'judge','verbal','judged@x.test','Judge Two')",[w.eventId,ids.judgeD]);

describe('number draw transactions',()=>{
 it('swaps existing unique numbers atomically, preserving IDs, names and manager contacts',async()=>{
  await db.query("update teams set number=case when id=$2 then '001' else '002' end where event_id=$1",[w.eventId,w.team1]);
  await as(db,'organiser',q=>q('select set_team_contact($1,$2,$3)',[w.eventId,w.team1,'manager@x.test']));
  await numbers(numberRows());
  expect((await db.query('select id,number,name from teams where event_id=$1 order by number',[w.eventId])).rows).toEqual([{id:w.team2,number:'001',name:'Team Two'},{id:w.team1,number:'002',name:'Team One'}]);
  expect((await db.query('select manager_email from team_contacts where team_id=$1',[w.team1])).rows).toEqual([{manager_email:'manager@x.test'}]);
  expect((await db.query("select action from audit_log where event_id=$1 and action='number_draw'",[w.eventId])).rows).toHaveLength(1);
 });
 it('rejects stale previews, duplicates, foreign teams and breaking the SUPERCHARGED reservation without partial changes',async()=>{
  const old=await state();await db.query("update teams set name='SUPERCHARGED' where id=$1",[w.team1]);
  await expect(numbers(numberRows(),old.version)).rejects.toMatchObject({code:'40001'});
  await expect(numbers(numberRows())).rejects.toMatchObject({code:'22023'});
  await expect(numbers([{teamId:w.team1,number:'001'},{teamId:w.team2,number:'001'}])).rejects.toMatchObject({code:'22023'});
  const foreign=await seedWorld(db);await expect(numbers([{teamId:w.team1,number:'001'},{teamId:foreign.team1,number:'002'}])).rejects.toMatchObject({code:'22023'});
  expect((await db.query('select number from teams where event_id=$1 order by number',[w.eventId])).rows).toEqual([{number:'1'},{number:'2'}]);
 });
 it('is staff-only and locks numbering once progress or published results exist',async()=>{
  for(const who of ['judgeV','leadV','mgr1','outsider',null] as const)await expect(numbers(numberRows(),'x',who)).rejects.toThrow();
  await as(db,'judgeV',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique')",[w.eventId,w.team1]));
  expect((await state()).numberingLocked).toBe(true);
  await expect(numbers(numberRows())).rejects.toMatchObject({code:'55000'});
 });
});

describe('judge draw transactions',()=>{
 it('replaces selected panel scopes together, preserves other panels, and exposes the assignments to judges',async()=>{
  await addSecondJudge();const s=await state();await judges(judgeRows(),s.version);
  expect((await as(db,'judgeV',q=>q("select team_id from event_roles where event_id=$1 and user_id=$2 and role='judge' and panel='verbal'",[w.eventId,ids.judgeV]))).rows).toEqual([{team_id:w.team1}]);
  expect((await db.query("select panel,team_id,display_name from event_roles where event_id=$1 and user_id=$2 order by panel",[w.eventId,ids.judgeD])).rows).toEqual([{panel:'design_engineering',team_id:null,display_name:''},{panel:'verbal',team_id:w.team2,display_name:'Judge Two'}]);
  await expect(judges(judgeRows(),s.version)).rejects.toMatchObject({code:'40001'});
  expect((await db.query("select action from audit_log where event_id=$1 and action='judge_draw'",[w.eventId])).rows).toHaveLength(1);
 });
 it('refuses conflicting, exempt, duplicated or non-panel allocations with no partial reassignment',async()=>{
  await addSecondJudge();
  await as(db,'judgeV',q=>q('insert into judge_conflicts(event_id,team_id) values($1,$2)',[w.eventId,w.team1]));
  await expect(judges(judgeRows())).rejects.toMatchObject({code:'22023'});
  await expect(judges([{judgeId:ids.judgeV,teamIds:[w.team2]},{judgeId:ids.judgeD,teamIds:[w.team2]}])).rejects.toMatchObject({code:'22023'});
  await expect(judges([{judgeId:ids.organiser,teamIds:[w.team1,w.team2]}])).rejects.toMatchObject({code:'22023'});
  await as(db,'organiser',q=>q('select set_judge_exemption($1,$2,$3,true,$4)',[w.eventId,ids.judgeD,w.team1,'Unavailable']));
  await expect(judges([{judgeId:ids.judgeV,teamIds:[w.team2]},{judgeId:ids.judgeD,teamIds:[w.team1]}])).rejects.toMatchObject({code:'22023'});
  expect((await db.query("select team_id from event_roles where event_id=$1 and role='judge' and panel='verbal'",[w.eventId])).rows).toEqual([{team_id:null},{team_id:null}]);
 });
 it('locks a started panel while leaving other panels available, and rejects judges, managers and outsiders',async()=>{
  await addSecondJudge();for(const who of ['judgeV','leadV','mgr1','outsider',null] as const)await expect(judges(judgeRows(),'x',who)).rejects.toThrow();
  await as(db,'judgeV',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique')",[w.eventId,w.team1]));
  await expect(judges(judgeRows())).rejects.toMatchObject({code:'55000'});
  await judges([{judgeId:ids.judgeD,teamIds:[w.team1,w.team2]}],undefined,'chair','design_engineering');
  await db.query('update events set results_released=true where id=$1',[w.eventId]);
  await expect(judges([{judgeId:ids.judgeD,teamIds:[w.team1,w.team2]}],undefined,'chair','design_engineering')).rejects.toMatchObject({code:'55000'});
 });
});
