import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';

describe('team concern memory backend',()=>{
 it('scopes submissions and responses to the correct roles and teams',async()=>{
  const api=new MemoryApi();api.setCreatorAllowlist(['org@x.test']);await api.signIn('org@x.test');
  const event=await api.createEvent({name:'Nationals'});
  const one=await api.createTeam(event.id,{number:'1',name:'One'});
  const two=await api.createTeam(event.id,{number:'2',name:'Two'});
  await api.invite(event.id,{email:'mgr@x.test',role:'team_manager',teamId:one.id});
  await api.signIn('mgr@x.test');await api.claimInvitations();
  await expect(api.submitTeamConcern(event.id,two.id,'verbal','Concern')).rejects.toMatchObject({code:'forbidden'});
  await expect(api.submitTeamConcern(event.id,one.id,'verbal',' ')).rejects.toMatchObject({code:'invalid'});
  await api.submitTeamConcern(event.id,one.id,'verbal','Presentation interrupted');
  const [concern]=await api.listTeamConcerns(event.id);
  await expect(api.resolveTeamConcern(event.id,concern.id,'Reply')).rejects.toMatchObject({code:'forbidden'});
  await api.signIn('outsider@x.test');
  await expect(api.listTeamConcerns(event.id)).rejects.toMatchObject({code:'forbidden'});
  await api.signIn('org@x.test');
  await api.resolveTeamConcern(event.id,concern.id,'Reviewed with panel');
  await expect(api.resolveTeamConcern(event.id,concern.id,'Replace')).rejects.toMatchObject({code:'locked'});
  await api.signIn('mgr@x.test');
  expect(await api.listTeamConcerns(event.id)).toMatchObject([{status:'resolved',response:'Reviewed with panel'}]);
 });
});
