// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { teamsScreen } from '../../src/ui/teams';
import { EMAILS, makeCtx, text, world } from './helpers';
const button=(el:HTMLElement,name:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent===name)!;
async function setup() {
  const w=await world();await w.api.signIn(EMAILS.org);const {ctx}=makeCtx(w.api);
  const el=await teamsScreen(ctx,w.ev.id);const row=el.querySelector<HTMLElement>('.list li')!;
  button(row,'Delete team').click();const input=row.querySelector<HTMLInputElement>('input')!;
  return {...w,ctx,el,row,input};
}
function type(input:HTMLInputElement,value:string) {input.value=value;input.dispatchEvent(new Event('input'));}
describe('team deletion controls',()=>{
  it('requires exact number, supports Cancel, and refreshes after deletion',async()=>{
    const {api,ev,el,row,input}=await setup();
    expect(button(row,'Confirm delete team').disabled).toBe(true);type(input,'01');expect(button(row,'Confirm delete team').disabled).toBe(true);
    type(input,'1');button(row,'Cancel').click();expect(input.value).toBe('');
    button(row,'Delete team').click();type(input,'1');button(row,'Confirm delete team').click();
    await vi.waitFor(()=>expect(el.querySelectorAll('.list li')).toHaveLength(1));
    expect((await api.listTeams(ev.id)).map(t=>t.number)).toEqual(['2']);expect(text(el)).not.toContain('Team 1 · One');
  });
  it('guards double clicks and presents locked errors without raw server text',async()=>{
    const {api,row,input}=await setup();let reject!:(e:unknown)=>void;
    const spy=vi.spyOn(api,'deleteTeam').mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
    type(input,'1');button(row,'Confirm delete team').click();button(row,'Confirm delete team').click();
    expect(spy).toHaveBeenCalledTimes(1);expect(input.disabled).toBe(true);expect(button(row,'Cancel').disabled).toBe(true);
    reject(new ApiError('locked','raw backend'));await vi.waitFor(()=>expect(input.disabled).toBe(false));
    expect(text(row)).toContain('Ask the Chair');expect(text(row)).not.toContain('raw backend');expect(button(row,'Confirm delete team').disabled).toBe(false);
  });
  it('does not offer a destructive retry when deletion succeeds but list refresh fails',async()=>{
    const {api,row,input}=await setup();vi.spyOn(api,'listTeams').mockRejectedValueOnce(new Error('offline'));
    type(input,'1');button(row,'Confirm delete team').click();
    await vi.waitFor(()=>expect(text(row)).toContain('The team was deleted. Reload'));
    expect(row.querySelector('input')).toBeNull();expect([...row.querySelectorAll('button')].filter(b=>!b.hidden)).toHaveLength(0);
  });
  it('hides deletion from judges and team managers',async()=>{
    const {api,ev,ctx}=await setup();
    for(const who of [EMAILS.judge,EMAILS.mgr]) {await api.signIn(who);expect(text(await teamsScreen(ctx,ev.id))).not.toContain('Delete team');}
  });
});
