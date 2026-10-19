// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest';
import {resultDelivery} from '../../src/ui/result-delivery';
import {makeCtx,world,EMAILS,text} from './helpers';
import {rank} from '../../src/engine';
const wait=()=>new Promise(r=>setTimeout(r,0));
async function setup(){const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);await api.setTeamContact(ev.id,t1.id,'manager@x.test');const rows=rank({ruleset:ev.ruleset,teams:[t1,t2],cards:[],overrides:[],penalties:[]}).rows;await api.publishSnapshot(ev.id,{rulesetId:ev.ruleset.id,inputHash:'a'.repeat(64),inputs:{},rows});return {api,ev,t1,t2};}
const button=(el:HTMLElement,label:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent===label)!;
describe('results delivery controls',()=>{
 it('requires released results and awards confirmed by event staff before sending',async()=>{
  const {api,ev}=await setup();const el=await resultDelivery(makeCtx(api).ctx,ev);
  expect(button(el,'Email results to managers').disabled).toBe(true);
  button(el,'Confirm award winners').click();await wait();expect((await api.resultMailState(ev.id)).confirmed).toBe(true);
  expect(button(el,'Email results to managers').disabled).toBe(true);
 });
 it('reviews saved recipients, sends only after confirmation, and skips successful deliveries',async()=>{
  const {api,ev}=await setup();await api.confirmAwards(ev.id);await api.setReleased(ev.id,true);const released=(await api.getEvent(ev.id))!;
  const send=vi.spyOn(api,'sendTeamResults');const el=await resultDelivery(makeCtx(api).ctx,released);
  button(el,'Email results to managers').click();expect(text(el)).toContain('manager@x.test');expect(send).not.toHaveBeenCalled();
  button(el,'Send 1 results email').click();await vi.waitFor(()=>expect(send).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(button(el,'Email results to managers').disabled).toBe(true));
  await vi.waitFor(()=>expect(text(el)).toContain('Email sent'));expect(text(el)).toContain('Add email in Teams');
 });
 it('saves manually selected awards and requires confirmation again after changes',async()=>{
  const {api,ev,t1}=await setup();const el=await resultDelivery(makeCtx(api).ctx,ev);
  (el.querySelector('[name=awardTitle]') as HTMLInputElement).value='Team Identity';(el.querySelector('[name=awardTeam]') as HTMLSelectElement).value=t1.id;
  el.querySelector<HTMLFormElement>('form[aria-label="Award winners"]')!.dispatchEvent(new Event('submit',{cancelable:true}));await wait();
  expect((await api.resultMailState(ev.id)).awards).toMatchObject([{title:'Team Identity',teamId:t1.id}]);expect((await api.resultMailState(ev.id)).confirmed).toBe(false);
  button(el,'Confirm award winners').click();await wait();expect((await api.resultMailState(ev.id)).confirmed).toBe(true);
 });
});
