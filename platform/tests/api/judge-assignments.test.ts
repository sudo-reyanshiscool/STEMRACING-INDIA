import {describe,expect,it} from 'vitest';
import {MemoryApi,blankReview} from '../../src/api';
const setup=async()=>{
 const api=new MemoryApi();api.setCreatorAllowlist(['org@x.test']);await api.signIn('org@x.test');const event=await api.createEvent({name:'Assignment event'});const team1=await api.createTeam(event.id,{number:'1',name:'One'});const team2=await api.createTeam(event.id,{number:'2',name:'Two'});
 for(const [email,role,panel] of [['v@x.test','judge','verbal'],['d@x.test','judge','design_engineering'],['race@x.test','race_official',undefined],['manager@x.test','team_manager',undefined]] as const)await api.invite(event.id,{email,name:email,role,panel,...(role==='team_manager'?{teamId:team1.id}:{})});
 for(const email of ['v@x.test','d@x.test','race@x.test','manager@x.test']){await api.signIn(email);await api.claimInvitations();}for(const [email,panel] of [['v@x.test','verbal'],['d@x.test','design_engineering']] as const){await api.signIn(email);const uid=(await api.getSession())!.userId;await api.signIn('org@x.test');await api.setJudgeAssignment(event.id,uid,panel,null);}return {api,event,team1,team2};
};
describe('memory assignment permissions mirror the database',()=>{
 it('scopes multiple panels independently and blocks old draft edits after reassignment',async()=>{
  const {api,event,team1,team2}=await setup();await api.signIn('v@x.test');const user=(await api.getSession())!.userId;const old=await api.openCard(event.id,team2.id,'verbal-technique');await api.signIn('org@x.test');
  await api.setJudgeAssignment(event.id,user,'verbal',[team1.id]);await api.setJudgeAssignment(event.id,user,'design_engineering',[team2.id]);await api.signIn('v@x.test');
  await expect(api.openCard(event.id,team2.id,'de-portfolio')).resolves.toBeTruthy();await expect(api.openCard(event.id,team1.id,'de-portfolio')).rejects.toMatchObject({code:'forbidden'});
  await expect(api.saveScore(old.id,'team-contribution',10)).rejects.toMatchObject({code:'forbidden'});await expect(api.saveReview(old.id,{...blankReview(),overall:'New'})).rejects.toMatchObject({code:'forbidden'});
 });
 it('keeps other judges’ submissions private, plus shares Specification with every event staff member',async()=>{
  const {api,event,team1,team2}=await setup();await api.signIn('d@x.test');const designId=(await api.getSession())!.userId;await api.signIn('org@x.test');await api.setJudgeAssignment(event.id,designId,'scrutineering',null);
  const fill=async(email:string,team:string,area:string,submit:boolean)=>{
   await api.signIn(email);const c=await api.openCard(event.id,team,area);for(const criterion of event.ruleset.areas.find(a=>a.id===area)!.criteria)await api.saveScore(c.id,criterion.id,criterion.max);
   await api.saveReview(c.id,{...blankReview(),overall:'Shared',internalNotes:'PRIVATE'});if(submit)await api.submitCard(c.id);return c;
  };
  const peer=await fill('d@x.test',team1.id,'de-portfolio',true);const elsewhere=await fill('d@x.test',team2.id,'de-portfolio',true);const spec=await fill('d@x.test',team2.id,'renders',true);await fill('d@x.test',team1.id,'renders',false);
  const own=await fill('v@x.test',team1.id,'verbal-technique',false);expect((await api.listCards(event.id)).map(c=>c.id).sort()).toEqual([own.id,spec.id].sort());
  await api.submitCard(own.id);expect((await api.listCards(event.id)).map(c=>c.id).sort()).toEqual([own.id,spec.id].sort());await expect(api.getReview(peer.id)).rejects.toMatchObject({code:'forbidden'});await expect(api.getReview(elsewhere.id)).rejects.toMatchObject({code:'forbidden'});
  await api.signIn('race@x.test');expect((await api.listCards(event.id)).map(c=>c.id)).toEqual([spec.id]);await api.signIn('manager@x.test');expect(await api.listCards(event.id)).toEqual([]);
 });
});

describe('memory judge exemptions',()=>{
 it('blocks every assigned panel on the exempt team, preserves other teams, and removes the block explicitly',async()=>{
  const {api,event,team1,team2}=await setup();await api.signIn('v@x.test');const user=(await api.getSession())!.userId;const draft=await api.openCard(event.id,team1.id,'verbal-technique');
  await api.signIn('org@x.test');await api.setJudgeAssignment(event.id,user,'design_engineering',null);await api.setJudgeExemption(event.id,user,team1.id,true,'Unavailable');await api.signIn('v@x.test');
  expect(await api.listJudgeExemptions(event.id)).toHaveLength(1);await expect(api.openCard(event.id,team1.id,'de-portfolio')).rejects.toMatchObject({code:'forbidden'});await expect(api.saveScore(draft.id,'team-contribution',10)).rejects.toMatchObject({code:'forbidden'});
  await expect(api.openCard(event.id,team2.id,'de-portfolio')).resolves.toBeTruthy();await api.signIn('org@x.test');await api.setJudgeExemption(event.id,user,team1.id,false);await api.signIn('v@x.test');await expect(api.openCard(event.id,team1.id,'de-portfolio')).resolves.toBeTruthy();
 });
});

it('removes exemption records when their team is deleted',async()=>{
 const {api,event,team1}=await setup();await api.signIn('v@x.test');const user=(await api.getSession())!.userId;
 await api.signIn('org@x.test');await api.setJudgeExemption(event.id,user,team1.id,true);await api.deleteTeam(event.id,team1.id,team1.number);
 expect(await api.listJudgeExemptions(event.id)).toEqual([]);
});
