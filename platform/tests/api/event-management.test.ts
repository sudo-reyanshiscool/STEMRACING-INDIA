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
