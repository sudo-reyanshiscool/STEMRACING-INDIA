// @vitest-environment jsdom
import { describe,expect,it,vi } from 'vitest';
import { peopleScreen } from '../../src/ui/people';
import { scoringScreen } from '../../src/ui/scoring';
import { scorecardScreen } from '../../src/ui/scorecard';
import { EMAILS,makeCtx,text,world } from './helpers';
const wait=()=>new Promise(r=>setTimeout(r,0));
const change=(el:Element,name:string,value:string)=>{const input=el.querySelector<HTMLSelectElement>(`[name="${name}"]`)!;input.value=value;input.dispatchEvent(new Event('change'));};
describe('judge assignment editor',()=>{
 it('assigns an existing person to another panel and selected teams without another invitation',async()=>{
  const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.judge);const user=(await api.getSession())!.userId;await api.signIn(EMAILS.org);
  const {ctx}=makeCtx(api);const el=await peopleScreen(ctx,ev.id);const form=el.querySelector('[aria-label="Judge assignments"]')!;
  change(form,'assignment-person',user);change(form,'assignment-panel','design_engineering');change(form,'assignment-scope','selected');
  (form.querySelector(`input[value="${t2.id}"]`) as HTMLInputElement).checked=true;
  const spy=vi.spyOn(api,'invite');form.dispatchEvent(new Event('submit',{cancelable:true}));await wait();expect(spy).not.toHaveBeenCalled();expect(text(el)).toContain('Judge assignment saved');
  await api.signIn(EMAILS.judge);const roles=await api.myRoles(ev.id);expect(roles.filter(r=>r.role==='judge')).toHaveLength(2);
  const tasks=await scoringScreen(ctx,ev.id);expect(tasks.querySelector(`a[href$="/${t1.id}/verbal-technique"]`)).not.toBeNull();expect(tasks.querySelector(`a[href$="/${t2.id}/de-portfolio"]`)).not.toBeNull();expect(tasks.querySelector(`a[href$="/${t1.id}/de-portfolio"]`)).toBeNull();
  expect(text(await scorecardScreen(ctx,ev.id,t1.id,'de-portfolio'))).toContain('not assigned to you');
 });
 it('loads an existing panel scope and requires an explicit team selection before saving',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.judge);const user=(await api.getSession())!.userId;await api.signIn(EMAILS.org);await api.setJudgeAssignment(ev.id,user,'verbal',[t1.id]);
  const {ctx}=makeCtx(api);const el=await peopleScreen(ctx,ev.id);const form=el.querySelector('[aria-label="Judge assignments"]')!;
  change(form,'assignment-person',user);change(form,'assignment-panel','verbal');
  expect((form.querySelector('[name="assignment-scope"]') as HTMLSelectElement).value).toBe('selected');const checkbox=form.querySelector<HTMLInputElement>(`input[value="${t1.id}"]`)!;expect(checkbox.checked).toBe(true);checkbox.checked=false;
  const spy=vi.spyOn(api,'setJudgeAssignment');form.dispatchEvent(new Event('submit',{cancelable:true}));expect(text(form)).toContain('Select at least one team');expect(spy).not.toHaveBeenCalled();
 });
});

describe('judge exemption editor',()=>{
 it('exempts and restores a team across a judge’s panels',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.judge);const user=(await api.getSession())!.userId;await api.signIn(EMAILS.org);const {ctx}=makeCtx(api);const el=await peopleScreen(ctx,ev.id);
  const form=el.querySelector('[aria-label="Judge exemptions"]')!;change(form,'exemption-person',user);change(form,'exemption-team',t1.id);form.dispatchEvent(new Event('submit',{cancelable:true}));await wait();expect(text(el)).toContain('Judge exempted from this team');
  await api.signIn(EMAILS.judge);const tasks=await scoringScreen(ctx,ev.id);expect(text(tasks)).toContain('Exempt from judging this team');expect(tasks.querySelector(`a[href$="/${t1.id}/verbal-technique"]`)).toBeNull();
  expect(text(await scorecardScreen(ctx,ev.id,t1.id,'verbal-technique'))).toContain('exempt');await api.signIn(EMAILS.org);
  const button=el.querySelector('[aria-label^="Remove exemption for"]') as HTMLButtonElement;button.click();await wait();expect(await api.listJudgeExemptions(ev.id)).toHaveLength(0);
 });
});
