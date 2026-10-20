// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest';
import {drawLotsScreen} from '../../src/ui/draw-lots';
import {EMAILS,makeCtx,text,world} from './helpers';
const button=(el:HTMLElement,label:string)=>[...el.querySelectorAll('button')].find(b=>text(b)===label)!;
describe('reviewable setup draws',()=>{
 it('only changes numbers after applying the preview, including the pinned number',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.org);const pinned=await api.createTeam(ev.id,{number:'88',name:'SUPERCHARGED'});
  const apply=vi.spyOn(api,'applyTeamNumberDraw'),send=vi.spyOn(api,'sendTeamResults');
  const el=await drawLotsScreen(makeCtx(api).ctx,ev.id);button(el,'Preview number draw').click();
  expect(apply).not.toHaveBeenCalled();expect((await api.listTeams(ev.id)).find(t=>t.id===pinned.id)!.number).toBe('88');
  expect(text(el)).toContain('Current team numbers have not changed');
  button(el,'Apply these team numbers').click();await vi.waitFor(()=>expect(text(el)).toContain('Team numbers applied.'));
  expect((await api.listTeams(ev.id)).find(t=>t.id===pinned.id)!.number).toBe('001');expect(send).not.toHaveBeenCalled();
 });
 it('previews balanced judge allocations and changes only selected scopes after applying',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.lead);const other=(await api.getSession())!.userId;await api.signIn(EMAILS.org);await api.setJudgeAssignment(ev.id,other,'verbal',null);
  const apply=vi.spyOn(api,'applyJudgeDraw');const el=await drawLotsScreen(makeCtx(api).ctx,ev.id);
  const panel=el.querySelector<HTMLSelectElement>('[aria-label="Panel for judge draw"]')!;panel.value='verbal';panel.dispatchEvent(new Event('change'));
  button(el,'Preview judge draw').click();expect(text(el)).toContain('No assignments have changed');expect(apply).not.toHaveBeenCalled();
  button(el,'Apply these judge assignments').click();await vi.waitFor(()=>expect(text(el)).toContain('Judge assignments applied.'));
  const assignments=(await api.listRoles(ev.id)).filter(r=>r.role==='judge'&&r.panel==='verbal');expect(assignments).toHaveLength(2);expect(assignments.every(r=>r.teamId!==null)).toBe(true);
 });
 it('rejects non-staff and disables draws after scoring starts',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.judge);expect(text(await drawLotsScreen(makeCtx(api).ctx,ev.id))).toContain('Only the organiser or chair');
  await api.openCard(ev.id,t1.id,'verbal-technique');await api.signIn(EMAILS.org);
  const el=await drawLotsScreen(makeCtx(api).ctx,ev.id);expect(button(el,'Preview number draw').disabled).toBe(true);
  const panel=el.querySelector<HTMLSelectElement>('[aria-label="Panel for judge draw"]')!;panel.value='verbal';panel.dispatchEvent(new Event('change'));
  expect(button(el,'Preview judge draw').disabled).toBe(true);
 });
});
