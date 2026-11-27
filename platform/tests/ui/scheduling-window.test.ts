// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{document.body.replaceChildren();});
import {world,makeCtx,EMAILS} from './helpers';
import {schedulingScreen} from '../../src/ui/scheduling';
import {emptySchedule,allocateStreams,localScheduleTime} from '../../src/scheduling';
const buttonNamed=(root:HTMLElement,label:string|RegExp)=>{const b=[...root.querySelectorAll('button')].find(b=>typeof label==='string'?b.textContent===label:label.test(b.textContent??''))!;expect(b,String(label)).toBeTruthy();return b;};
const click=(root:HTMLElement,label:string|RegExp)=>buttonNamed(root,label).click();
const set=(root:HTMLElement,label:string,value:string)=>{const el=root.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;expect(el,label).toBeTruthy();el.value=value;el.dispatchEvent(new Event('change'));};
const windowForm=(root:HTMLElement)=>root.querySelector<HTMLFormElement>('form[aria-label="Generate slots from a time window"]')!;
async function setup(teamCount:number){
 const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);const ids=[t1.id,t2.id];
 for(let i=3;i<=teamCount;i++)ids.push((await api.createTeam(ev.id,{number:String(i),name:`Team ${i}`})).id);
 await api.saveSchedule(ev.id,0,{...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams(ids)});
 const {ctx}=makeCtx(api),root=await schedulingScreen(ctx,ev.id);document.body.append(root);click(root,'Master schedule');
 return {api,ev,ctx,root};
}
it('warns how many teams fit before anything reaches the draft, then adds one parallel slot per team and saves it',async()=>{
 const {api,ev,ctx,root}=await setup(25);
 expect(windowForm(root)).toBeTruthy();set(root,'Window date','2027-06-01');set(root,'Window from','12:00');set(root,'Window to','13:00');set(root,'Slot length minutes','20');
 click(root,'Preview slots');
 const alert=windowForm(root).querySelector('[role="alert"]')!;expect(alert.textContent).toContain('9 of 25 teams fit. 16 left over.');expect(alert.textContent).toMatch(/end at 0?3:00\s?pm/i);
 expect(buttonNamed(root,'Add 9 slots to draft')).toBeTruthy();expect(root.querySelector('.schedule-toolbar')!.textContent).toContain('Saved draft · revision 1');
 set(root,'Window to','15:00');click(root,'Preview slots');
 expect(windowForm(root).textContent).toContain('All 25 teams fit.');expect(windowForm(root).textContent).toContain('9 slot times × 3 streams in parallel = 27 places');
 const grid=windowForm(root).querySelector('table')!;expect(grid.querySelectorAll('tbody tr')).toHaveLength(9);expect(grid.querySelectorAll('thead th')).toHaveLength(4);
 click(root,'Add 25 slots to draft');expect(root.textContent).toContain('Added 25 Verbal Presentation slots to the draft');
 // The panel stays open with the organiser's settings, and each slot can be adjusted like any appointment.
 expect(root.querySelector<HTMLDetailsElement>('details:has(form[aria-label="Generate slots from a time window"])')!.open).toBe(true);
 expect(root.querySelector<HTMLInputElement>('[aria-label="Window to"]')!.value).toBe('15:00');
 expect([...root.querySelectorAll('button')].filter(b=>b.textContent==='Edit appointment')).toHaveLength(25);
 expect((await api.schedulingState(ev.id)).draft.activities).toHaveLength(0);
 click(root,'Save draft');await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
 const state=await api.schedulingState(ev.id);expect(state.draft.activities).toHaveLength(25);expect(state.issues.filter(i=>i.severity==='error')).toEqual([]);
 const starts=state.draft.activities.map(a=>localScheduleTime(a.start,'Asia/Kolkata').slice(11));expect(starts.filter(s=>s==='12:00')).toHaveLength(3);expect(starts.every(s=>s>='12:00'&&s<='14:40')).toBe(true);
});
it('schedules racing around judging in the same window without double-booking anyone, and replaces on regeneration',async()=>{
 const {api,ev,ctx,root}=await setup(12);
 set(root,'Window date','2027-06-01');set(root,'Window from','12:00');set(root,'Window to','15:00');set(root,'Slot length minutes','20');click(root,'Preview slots');click(root,'Add 12 slots to draft');
 set(root,'Window activity type','racing');expect(root.querySelector<HTMLInputElement>('[aria-label="Area name"]')!.value).toBe('Racing');expect(root.querySelector<HTMLSelectElement>('[aria-label="Window judging category"]')!.disabled).toBe(true);
 set(root,'Teams at the same time','single');set(root,'Slot length minutes','10');click(root,'Preview slots');expect(windowForm(root).textContent).toContain('All 12 teams fit.');click(root,'Add 12 slots to draft');
 // Regenerating the same area replaces it rather than doubling up.
 set(root,'Slot length minutes','12');click(root,'Preview slots');expect(windowForm(root).textContent).toContain('Replaces 12 earlier Racing slots.');click(root,'Add 12 slots to draft');expect(root.textContent).toContain('replacing 12 earlier ones');
 click(root,'Save draft');await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
 const state=await api.schedulingState(ev.id);expect(state.draft.activities).toHaveLength(24);expect(state.issues.filter(i=>i.code==='overlap')).toEqual([]);
 const racing=state.draft.activities.filter(a=>a.kind==='racing');expect(new Set(racing.map(a=>a.start)).size).toBe(12);expect(racing.every(a=>Date.parse(a.end!)-Date.parse(a.start)===12*60000)).toBe(true);
});
it('explains a window that cannot be generated instead of failing silently',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);await api.saveSchedule(ev.id,0,{...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}]});
 const root=await schedulingScreen(makeCtx(api).ctx,ev.id);document.body.append(root);click(root,'Master schedule');set(root,'Window date','2027-06-01');click(root,'Preview slots');
 expect(windowForm(root).querySelector('[role="alert"]')!.textContent).toContain('Generate the stream allocation first');
});
