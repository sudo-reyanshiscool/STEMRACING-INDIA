import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';
import { blankReview } from '../../src/api';
import { as, denied, ids, makeDb, seedWorld, type Who, type World } from './harness';
let w:World, db:Awaited<ReturnType<typeof makeDb>>;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});
const assign=(panel:string,teams:string[]|null,who:Who|null='organiser',user=ids.judgeV as string)=>as(db,who,q=>q('select set_judge_assignment($1,$2,$3,$4)',[w.eventId,user,panel,teams]));
const card=async(who:Who,team:string,area:string,submitted=false)=>{
 const id=(await as(db,who,q=>q('insert into scorecards(event_id,team_id,area_id) values($1,$2,$3) returning id',[w.eventId,team,area]))).rows[0].id as string;
 const def=INDIA_2026.areas.find(a=>a.id===area)!;
 for(const c of def.criteria)await as(db,who,q=>q('insert into scorecard_scores(scorecard_id,criterion_id,score) values($1,$2,$3)',[id,c.id,c.max]));
 await as(db,who,q=>q('select save_card_review($1,$2)',[id,{...blankReview(),overall:'Shared feedback',internalNotes:'PRIVATE',criterionNotes:{[def.criteria[0].id]:'PRIVATE criterion'}}]));
 if(submitted)await as(db,who,q=>q("update scorecards set status='submitted' where id=$1",[id]));return id;
};
const visible=(who:Who)=>as(db,who,async q=>(await q('select id from scorecards where event_id=$1 order by id',[w.eventId])).rows.map(r=>r.id as string));

describe('multiple team and panel assignments',()=>{
 it('replaces only one panel scope, keeps other panels, and enforces the scope on direct inserts',async()=>{
  await assign('verbal',[w.team1]);await assign('design_engineering',[w.team1,w.team2]);
  const roles=(await as(db,'judgeV',q=>q("select panel,team_id from event_roles where event_id=$1 and user_id=$2 and role='judge'",[w.eventId,ids.judgeV]))).rows;
  expect(roles).toHaveLength(3);await card('judgeV',w.team1,'verbal-technique');await card('judgeV',w.team2,'de-portfolio');
  await expect(card('judgeV',w.team2,'verbal-technique')).rejects.toThrow(/row-level security/);
  await assign('verbal',null);await card('judgeV',w.team2,'verbal-technique');
 });
 it('rejects cross-event teams atomically, unverified/nonmembers, anonymous and non-staff callers',async()=>{
  await assign('verbal',[w.team1]);const foreign=await seedWorld(db);
  await expect(assign('verbal',[w.team2,foreign.team1])).rejects.toThrow(/belonging/);
  expect((await as(db,'judgeV',q=>q("select team_id from event_roles where event_id=$1 and user_id=$2 and role='judge'",[w.eventId,ids.judgeV]))).rows).toEqual([{team_id:w.team1}]);
  for(const who of ['judgeV','leadV','mgr1','outsider',null] as const)await expect(assign('verbal',null,who)).rejects.toThrow();
  await expect(assign('verbal',null,'organiser',ids.outsider)).rejects.toThrow(/invite/);
  await expect(assign('verbal',[])).rejects.toThrow(/choose teams/);
 });
 it('blocks further scoring, feedback edits, submission and deletion after an assignment changes',async()=>{
  const own=await card('judgeV',w.team2,'verbal-technique');await assign('verbal',[w.team1]);
  expect(await visible('judgeV')).toContain(own);
  await expect(as(db,'judgeV',q=>q("insert into scorecard_scores(scorecard_id,criterion_id,score) values($1,'team-contribution',10) on conflict(scorecard_id,criterion_id) do update set score=10",[own]))).rejects.toThrow();
  await denied(as(db,'judgeV',q=>q('delete from scorecard_scores where scorecard_id=$1 returning criterion_id',[own])));
  await expect(as(db,'judgeV',q=>q('select save_card_review($1,$2)',[own,{...blankReview(),overall:'New'}]))).rejects.toThrow(/cannot edit/);
  await expect(as(db,'judgeV',q=>q("update scorecards set status='submitted' where id=$1",[own]))).rejects.toThrow(/row-level security/);
  await denied(as(db,'judgeV',q=>q('delete from scorecards where id=$1 returning id',[own])));
 });
 it('claims a team-scoped invitation and refuses a selected team with a declared conflict',async()=>{
  await as(db,'organiser',q=>q("insert into invitations(event_id,email,role,panel,team_id) values($1,'new.judge@x.test','judge','verbal',$2)",[w.eventId,w.team1]));
  await as(db,'invitee',q=>q('select claim_invitations()'));await card('invitee',w.team1,'verbal-technique');await expect(card('invitee',w.team2,'verbal-technique')).rejects.toThrow();
  await as(db,'judgeV',q=>q('insert into judge_conflicts(event_id,team_id) values($1,$2)',[w.eventId,w.team2]));
  await expect(assign('verbal',[w.team2])).rejects.toThrow(/declared conflict/);
 });
});

describe('judged-team visibility and Specification exception',()=>{
 const prepare=async()=>{
  await assign('scrutineering',null,'organiser',ids.judgeD);
  await db.query("insert into event_roles(event_id,user_id,role,email) values($1,$2,'race_official','new.judge@x.test')",[w.eventId,ids.invitee]);
  const own=await card('judgeV',w.team1,'verbal-technique');const peer=await card('judgeD',w.team1,'de-portfolio',true);
  const elsewhere=await card('judgeD',w.team2,'de-portfolio',true);const spec=await card('judgeD',w.team2,'renders',true);const draft=await card('judgeD',w.team1,'renders');
  return {own,peer,elsewhere,spec,draft};
 };
 it('keeps peer submissions hidden even after judging, and never exposes private notes',async()=>{
  const c=await prepare();expect((await visible('judgeV')).sort()).toEqual([c.own,c.spec].sort());
  await as(db,'judgeV',q=>q("update scorecards set status='submitted' where id=$1",[c.own]));
  expect((await visible('judgeV')).sort()).toEqual([c.own,c.spec].sort());
  expect((await as(db,'judgeV',q=>q('select scorecard_id from scorecard_feedback where scorecard_id=$1',[c.peer]))).rows).toHaveLength(0);
  expect((await as(db,'judgeV',q=>q('select internal_notes from scorecard_private_reviews where scorecard_id=$1',[c.peer]))).rows).toEqual([]);
  await denied(as(db,'judgeV',q=>q('update scorecard_scores set score=1 where scorecard_id=$1 returning criterion_id',[c.peer])));
  expect((await as(db,'judgeV',q=>q('select criterion_id from scorecard_scores where scorecard_id=$1',[c.elsewhere]))).rows).toEqual([]);
 });
 it('shares submitted Specification with event staff, while retaining manager and outsider restrictions',async()=>{
  const c=await prepare();expect(await visible('invitee')).toEqual([c.spec]);expect(await visible('mgr1')).toEqual([]);expect(await visible('outsider')).toEqual([]);
  expect(await visible('organiser')).toHaveLength(5);expect(await visible('chair')).toHaveLength(5);
  await expect(as(db,null,q=>q('select id from scorecards'))).rejects.toThrow(/permission/);
  await db.query('update events set deleted_at=now() where id=$1',[w.eventId]);expect(await visible('invitee')).toEqual([]);
 });
});

describe('judge exemptions',()=>{
 const exempt=(team=w.team1,value=true,who:Who|null='organiser')=>as(db,who,q=>q('select set_judge_exemption($1,$2,$3,$4,$5)',[w.eventId,ids.judgeV,team,value,'Scheduling exemption']));
 it('overrides every panel assignment, blocks draft edits, and can be removed without losing assignments',async()=>{
  await assign('design_engineering',null);const draft=await card('judgeV',w.team1,'verbal-technique');await exempt();
  await expect(card('judgeV',w.team1,'de-portfolio')).rejects.toThrow(/row-level security/);
  await expect(as(db,'judgeV',q=>q('update scorecard_scores set score=1 where scorecard_id=$1',[draft]))).rejects.toThrow(/row-level security/);
  await expect(as(db,'judgeV',q=>q('select save_card_review($1,$2)',[draft,{...blankReview(),overall:'New'}]))).rejects.toThrow(/cannot edit/);
  await card('judgeV',w.team2,'de-portfolio');await exempt(w.team1,false);await card('judgeV',w.team1,'de-portfolio');
 });
 it('requires Chair/Organiser, checks event membership/team, and protects submitted evidence',async()=>{
  for(const who of ['judgeV','leadV','mgr1','outsider',null] as const)await expect(exempt(w.team1,true,who)).rejects.toThrow();
  await card('judgeV',w.team1,'verbal-technique',true);await expect(exempt()).rejects.toThrow(/reopen submitted/);
  const foreign=await seedWorld(db);await expect(exempt(foreign.team1)).rejects.toThrow(/event member and team/);
 });
 it('shows exemptions only to staff and the exempt judge, and writes an audit record',async()=>{
  await exempt();expect((await as(db,'judgeV',q=>q('select reason from judge_exemptions where event_id=$1',[w.eventId]))).rows).toEqual([{reason:'Scheduling exemption'}]);
  expect((await as(db,'judgeD',q=>q('select reason from judge_exemptions where event_id=$1',[w.eventId]))).rows).toEqual([]);
  await expect(as(db,'organiser',q=>q('delete from judge_exemptions where event_id=$1',[w.eventId]))).rejects.toThrow(/permission/);
  expect((await db.query("select id from audit_log where event_id=$1 and entity='judge_exemptions'",[w.eventId])).rows).toHaveLength(1);
 });
});
