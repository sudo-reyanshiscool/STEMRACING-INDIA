// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {world,makeCtx,EMAILS} from './helpers';
import {schedulingScreen,myScheduleScreen} from '../../src/ui/scheduling';
import {emptySchedule,allocateStreams,type Activity} from '../../src/scheduling';
const click=(root:HTMLElement,label:string)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label)!;expect(b).toBeTruthy();b.click();};
it('previews allocation before saving, persists exact teams, and keeps draft edits away from team schedules',async()=>{
 const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);const initial={...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}]};await api.saveSchedule(ev.id,0,initial);
 const {ctx}=makeCtx(api),root=await schedulingScreen(ctx,ev.id);click(root,'Generate Stream Allocation');expect(root.textContent).toContain('Allocation preview ready');expect((await api.schedulingState(ev.id)).draft.allocations).toEqual([]);
 click(root,'Save draft');await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());expect((await api.schedulingState(ev.id)).draft.allocations.map(a=>a.teamId).sort()).toEqual([t1.id,t2.id].sort());
 await api.signIn(EMAILS.mgr);expect((await api.mySchedule(ev.id)).publishedAt).toBeNull();await api.signIn(EMAILS.org);await api.publishSchedule(ev.id,2);await api.signIn(EMAILS.mgr);expect((await api.mySchedule(ev.id)).teams[0].stream).toBe('Stream A');
});
it('shows the manager only published relevant appointments and shared ceremonies',async()=>{
 const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);
 const doc={...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams([t1.id,t2.id])};
 const shared:Activity={id:'ceremony',title:'Opening Ceremony',kind:'ceremony',scope:'all',streamId:null,teamIds:[],panel:null,start:'2027-06-01T03:30:00Z',end:'2027-06-01T04:00:00Z',point:false,resourceIds:[],location:'Main hall'};
 doc.activities=[shared,{...shared,id:'race1',title:'Your racing slot',kind:'racing',scope:'teams',teamIds:[t1.id],start:'2027-06-01T05:07:00Z',end:null,point:true},{...shared,id:'race2',title:'Private other-team appointment',kind:'racing',scope:'teams',teamIds:[t2.id],start:'2027-06-01T05:07:00Z',end:null,point:true}];
 await api.saveSchedule(ev.id,0,doc);await api.publishSchedule(ev.id,1);await api.signIn(EMAILS.mgr);const root=await myScheduleScreen(makeCtx(api).ctx,ev.id);
 expect(root.textContent).toContain('Opening Ceremony');expect(root.textContent).toContain('Your racing slot');expect(root.textContent).not.toContain('Private other-team appointment');expect(root.textContent).toContain('10:37');expect(root.querySelector('form')).toBeNull();
});
it('requires explicit confirmation before regenerating saved stream allocations',async()=>{
 const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);await api.saveSchedule(ev.id,0,{...emptySchedule(),...allocateStreams([t1.id,t2.id])});const root=await schedulingScreen(makeCtx(api).ctx,ev.id);
 click(root,'Generate Stream Allocation');expect(root.textContent).toContain('Confirm regenerate allocations');expect(root.textContent).not.toContain('Allocation preview ready');click(root,'Cancel regeneration');expect(root.textContent).not.toContain('Confirm regenerate allocations');
});
