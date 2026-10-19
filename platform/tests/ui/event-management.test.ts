// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { eventHomeScreen } from '../../src/ui/event-home';
import { eventsScreen } from '../../src/ui/events';
import { teamsScreen } from '../../src/ui/teams';
import { EMAILS, makeCtx, text, world } from './helpers';
const button=(el:HTMLElement,name:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent===name)!;
const type=(el:HTMLInputElement,value:string)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
let leaves:Array<()=>void>=[];
afterEach(()=>{leaves.forEach(f=>f());leaves=[];document.body.replaceChildren();vi.restoreAllMocks();});
async function open() { const w=await world();await w.api.signIn(EMAILS.org);const c=makeCtx(w.api);leaves.push(()=>c.leaves.forEach(f=>f()));return {...w,...c}; }
function file(el:HTMLElement,text:string) {
  const input=el.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input,'files',{value:[new File([text],'teams.csv',{type:'text/csv'})],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return input;
}

describe('event deletion controls',()=>{
  it('requires exact confirmation, supports cancelling and moves deleted events to the restore list',async()=>{
    const {api,ev,ctx}=await open();const el=await eventHomeScreen(ctx,ev.id);document.body.append(el);
    button(el,'Delete event').click();const name=el.querySelector<HTMLInputElement>('[aria-label="Event name to confirm deletion"]')!;
    type(name,'Wrong');expect(button(el,'Confirm delete event').disabled).toBe(true);
    button(el,'Cancel').click();expect(name.value).toBe('');expect(el.querySelector('form')!.hidden).toBe(true);
    button(el,'Delete event').click();type(name,ev.name);expect(button(el,'Confirm delete event').disabled).toBe(false);
    button(el,'Confirm delete event').click();await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
    expect(await api.getEvent(ev.id)).toBeNull();expect(location.hash).toBe('#/');
    const list=await eventsScreen(ctx);expect(text(list)).toContain('Deleted events (1)');
    expect(list.querySelector(`a[href="#/event/${ev.id}"]`)).toBeNull();
    button(list,'Restore event').click();await vi.waitFor(async()=>expect(await api.getEvent(ev.id)).not.toBeNull());
  });
  it('hides deletion from judges, the Chair and managers',async()=>{
    const {api,ev,ctx}=await open();for(const who of [EMAILS.judge,EMAILS.chair,EMAILS.mgr]) {
      await api.signIn(who);expect(button(await eventHomeScreen(ctx,ev.id),'Delete event')).toBeUndefined();
    }
  });
  it('prevents double deletion while in flight and recovers with readable errors',async()=>{
    const {api,ev,ctx}=await open();let reject!:(e:unknown)=>void;
    const spy=vi.spyOn(api,'deleteEvent').mockImplementationOnce(()=>new Promise<void>((_,r)=>{reject=r;}));
    const el=await eventHomeScreen(ctx,ev.id);button(el,'Delete event').click();type(el.querySelector('input')!,ev.name);
    const form=el.querySelector('form')!;form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));
    expect(spy).toHaveBeenCalledTimes(1);expect(button(el,'Cancel').disabled).toBe(true);reject(new ApiError('network','raw server details'));
    await vi.waitFor(()=>expect(button(el,'Cancel').disabled).toBe(false));expect(text(el)).not.toContain('raw server details');expect(text(el)).toContain('Could not reach');
  });
});

describe('team CSV import controls',()=>{
  it('previews quoted CSV, preserves numbers, and imports only after confirmation',async()=>{
    const {api,ev,ctx}=await open();const el=await teamsScreen(ctx,ev.id);
    file(el,'Team Number,Team Name,School\n001,"Nitro, Racing","School, Delhi"\n003,Supercharge,School');
    await vi.waitFor(()=>expect(text(el)).toContain('2 teams ready to import'));
    expect(await api.listTeams(ev.id)).toHaveLength(2);expect(text(el)).toContain('Nitro, Racing');
    button(el,'Import 2 teams').click();await vi.waitFor(()=>expect(text(el)).toContain('Imported 2 teams.'));
    expect((await api.listTeams(ev.id)).map(t=>t.number)).toEqual(['1','2','001','003']);
    expect(text(el)).toContain('Team 001 · Nitro, Racing');
  });
  it('shows row errors and blocks the whole import, then accepts a corrected file',async()=>{
    const {api,ev,ctx}=await open();const el=await teamsScreen(ctx,ev.id);
    file(el,'number,name\n1,Duplicate\n4,Four');await vi.waitFor(()=>expect(text(el)).toContain('already exists'));
    expect(button(el,'Import 1 team').disabled).toBe(true);expect(await api.listTeams(ev.id)).toHaveLength(2);
    file(el,'number,name\n3,Three\n4,Four');await vi.waitFor(()=>expect(button(el,'Import 2 teams').disabled).toBe(false));
    button(el,'Import 2 teams').click();await vi.waitFor(()=>expect(text(el)).toContain('Imported 2 teams.'));
  });
  it('rechecks duplicates when a new team was added after the preview',async()=>{
    const {api,ev,ctx}=await open();const el=await teamsScreen(ctx,ev.id);file(el,'number,name\n3,Three');
    await vi.waitFor(()=>expect(button(el,'Import 1 team').disabled).toBe(false));await api.createTeam(ev.id,{number:'3',name:'Elsewhere'});
    const spy=vi.spyOn(api,'importTeams');button(el,'Import 1 team').click();await vi.waitFor(()=>expect(text(el)).toContain('already exists'));
    expect(spy).not.toHaveBeenCalled();expect(await api.listTeams(ev.id)).toHaveLength(3);
  });
  it('keeps a failed import retryable without leaking server text and hides the control from judges',async()=>{
    const {api,ev,ctx}=await open();const el=await teamsScreen(ctx,ev.id);file(el,'number,name\n3,Three');
    await vi.waitFor(()=>expect(button(el,'Import 1 team').disabled).toBe(false));
    vi.spyOn(api,'importTeams').mockRejectedValueOnce(new ApiError('network','raw backend constraint'));
    button(el,'Import 1 team').click();await vi.waitFor(()=>expect(text(el)).toContain('Could not reach'));
    expect(button(el,'Import 1 team').disabled).toBe(false);expect(text(el)).not.toContain('raw backend constraint');
    await api.signIn(EMAILS.judge);expect((await teamsScreen(ctx,ev.id)).querySelector('input[type=file]')).toBeNull();
  });
});
