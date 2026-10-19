import { describe, expect, it } from 'vitest';
import { blankReview, type NewTeam } from '../../src/api';
import { EMAILS, world, releaseResults } from '../ui/helpers';

describe('event management API', () => {
  it('requires an organiser and an exact event name, and supports restoring all data', async () => {
    const {api,ev,t1}=await world();
    await expect(api.deleteEvent(ev.id,ev.name)).rejects.toMatchObject({code:'forbidden'});
    await api.signIn(EMAILS.chair);await expect(api.deleteEvent(ev.id,ev.name)).rejects.toMatchObject({code:'forbidden'});
    await api.signIn(EMAILS.judge);
    const card=await api.openCard(ev.id,t1.id,'verbal-technique');
    await api.saveScore(card.id,'team-contribution',14);await api.saveReview(card.id,{...blankReview(),internalNotes:'Preserve me'});
    await api.signIn(EMAILS.org);await expect(api.deleteEvent(ev.id,'wrong')).rejects.toMatchObject({code:'invalid'});
    await api.deleteEvent(ev.id,ev.name);expect(await api.listEvents()).toEqual([]);expect(await api.getEvent(ev.id)).toBeNull();
    expect((await api.listDeletedEvents()).map((e)=>e.id)).toEqual([ev.id]);expect(await api.myRoles(ev.id)).toEqual([]);
    await api.signIn(EMAILS.judge);expect(await api.listCards(ev.id)).toEqual([]);expect(await api.myConflicts(ev.id)).toEqual([]);
    await expect(api.saveScore(card.id,'team-contribution',15)).rejects.toBeDefined();expect(await api.listDeletedEvents()).toEqual([]);
    await expect(api.restoreEvent(ev.id)).rejects.toMatchObject({code:'forbidden'});
    await api.signIn(EMAILS.org);await api.restoreEvent(ev.id);expect(await api.listDeletedEvents()).toEqual([]);
    expect(await api.listTeams(ev.id)).toHaveLength(2);await api.signIn(EMAILS.judge);
    expect((await api.listCards(ev.id))[0].scores['team-contribution']).toBe(14);expect((await api.getReview(card.id)).internalNotes).toBe('Preserve me');
  });
  it('hides released results from the public until the event is restored', async()=>{
    const {api,ev}=await world();await releaseResults(api,ev.id);await api.signIn(EMAILS.org);await api.deleteEvent(ev.id,ev.name);
    await api.signOut();expect(await api.listEvents()).toEqual([]);expect(await api.latestSnapshot(ev.id)).toBeNull();expect(await api.listTeams(ev.id)).toEqual([]);
    await api.signIn(EMAILS.org);await api.restoreEvent(ev.id);await api.signOut();expect((await api.getEvent(ev.id))?.resultsReleased).toBe(true);
  });
  it('imports a whole validated batch, preserves strings and refuses a batch with any error',async()=>{
    const {api,ev}=await world();await api.signIn(EMAILS.org);
    expect((await api.importTeams(ev.id,[{number:'001',name:' One ',school:' School '},{number:'A1',name:'Alpha'}])).map((t)=>[t.number,t.name,t.school]))
      .toEqual([['001','One','School'],['A1','Alpha','']]);
    for(const batch of [[{number:'9',name:'Nine'},{number:'a1',name:'Existing'}],[{number:'9',name:'Nine'},{number:'10',name:''}],
      [{number:'9',name:'Nine'},{number:' 9 ',name:'Again'}],[],[{number:1,name:'Wrong type'}] as unknown as NewTeam[]]) {
      await expect(api.importTeams(ev.id,batch)).rejects.toBeDefined();expect((await api.listTeams(ev.id)).some((t)=>t.number==='9')).toBe(false);
    }
    await api.signIn(EMAILS.judge);await expect(api.importTeams(ev.id,[{number:'9',name:'Nine'}])).rejects.toMatchObject({code:'forbidden'});
    await api.signIn(EMAILS.chair);expect(await api.importTeams(ev.id,[{number:'9',name:'Nine'}])).toHaveLength(1);
  });
});


describe('team deletion API', () => {
  it('requires staff, the correct event and the exact number', async () => {
    const {api,ev,t1}=await world();
    for (const who of [EMAILS.mgr,EMAILS.judge,EMAILS.lead]) {
      await api.signIn(who); await expect(api.deleteTeam(ev.id,t1.id,'1')).rejects.toMatchObject({code:'forbidden'});
    }
    await api.signIn(EMAILS.org);
    await expect(api.deleteTeam(ev.id,t1.id,'wrong')).rejects.toMatchObject({code:'invalid'});
    const other=await api.createEvent({name:'Other'});
    await expect(api.deleteTeam(other.id,t1.id,'1')).rejects.toMatchObject({code:'not-found'});
    expect(await api.listTeams(ev.id)).toHaveLength(2);
    await api.signIn(EMAILS.chair);await api.deleteTeam(ev.id,t1.id,'1');
    expect((await api.listTeams(ev.id)).map(t=>t.number)).toEqual(['2']);
    await api.signIn(EMAILS.mgr);expect(await api.listTeams(ev.id)).toEqual([]);
  });
  it('atomically removes drafts and all team dependencies and frees the number', async () => {
    const {api,ev,t1}=await world();await api.signIn(EMAILS.judge);
    const card=await api.openCard(ev.id,t1.id,'verbal-technique');
    await api.saveScore(card.id,'team-contribution',14);await api.saveReview(card.id,{...blankReview(),internalNotes:'Remove'});
    await api.declareConflict(ev.id,t1.id);
    await api.signIn(EMAILS.chair);await api.setOverride(ev.id,t1.id,'verbal-technique',20,'Reason');await api.addPenalty(ev.id,t1.id,2,'Reason');
    await api.invite(ev.id,{email:'new@x.test',role:'team_manager',teamId:t1.id});
    await api.deleteTeam(ev.id,t1.id,'1');
    expect(await api.listCards(ev.id)).toEqual([]);expect(await api.listOverrides(ev.id)).toEqual([]);expect(await api.listPenalties(ev.id)).toEqual([]);
    expect(await api.listConflicts(ev.id)).toEqual([]);expect(await api.listInvitations(ev.id)).toEqual([]);
    expect((await api.listRoles(ev.id)).some(r=>r.teamId===t1.id)).toBe(false);
    expect((await api.createTeam(ev.id,{number:'1',name:'Replacement'})).id).not.toBe(t1.id);
    await api.signIn(EMAILS.judge);await expect(api.saveScore(card.id,'team-contribution',15)).rejects.toBeDefined();
  });
  it('protects submitted evidence and released results without partial changes', async () => {
    const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.judge);
    const card=await api.openCard(ev.id,t1.id,'verbal-technique');
    await api.saveScore(card.id,'team-contribution',14);await api.saveScore(card.id,'engagement-presentation-dynamics',14);await api.submitCard(card.id);
    await api.signIn(EMAILS.org);await expect(api.deleteTeam(ev.id,t1.id,'1')).rejects.toMatchObject({code:'locked'});
    expect(await api.listTeams(ev.id)).toHaveLength(2);
    await releaseResults(api,ev.id);await expect(api.deleteTeam(ev.id,t2.id,'2')).rejects.toMatchObject({code:'locked'});
    await api.signIn(EMAILS.chair);await api.setReleased(ev.id,false);await api.reopenCard(card.id,'Delete duplicate team');
    await api.deleteTeam(ev.id,t1.id,'1');await expect(api.setReleased(ev.id,true)).rejects.toMatchObject({code:'locked'});
  });
});
