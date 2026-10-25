// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {MemoryApi,PORTFOLIOS,submissionRow} from '../../src/api';
import {submissionsScreen} from '../../src/ui/submissions';
import {makeCtx} from './helpers';
afterEach(()=>{vi.useRealTimers();document.body.replaceChildren();});
it('rounds only positive lateness up to started hours',()=>{
 const deadline='2026-10-25T10:00:00Z',rule={kind:'design_portfolio' as const,deadline,pointsPerHour:5},at=Date.parse(deadline);
 expect(submissionRow('team',rule,deadline,at).points).toBe(0);
 expect(submissionRow('team',rule,null,at+1).points).toBe(5);
 expect(submissionRow('team',rule,null,at+3600000).points).toBe(5);
 expect(submissionRow('team',rule,null,at+3600001).points).toBe(10);
});
it('saves organiser deadlines, shows team penalties and prevents team rule changes',async()=>{
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const event=await api.createEvent({name:'Nationals'});const team=await api.createTeam(event.id,{number:'001',name:'Apex',managerEmail:'manager@x.test'});
 const {ctx}=makeCtx(api);const screen=await submissionsScreen(ctx,event.id);document.body.append(screen);
 expect(screen.textContent).toContain('Submission deadlines and penalties');
 expect(screen.querySelector<HTMLInputElement>('input[type=file]')?.accept).toBe('.pdf');
 const deadlines=screen.querySelectorAll<HTMLInputElement>('input[type=datetime-local]');deadlines[0].value='2026-10-25T15:30';
 const save=[...screen.querySelectorAll('button')].find(b=>b.textContent==='Save submission deadlines')!;save.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());expect((await api.submissionState(event.id)).rules[0].deadline).toBe('2026-10-25T10:00:00.000Z');
 await api.saveSubmissionRules(event.id,1,PORTFOLIOS.map(kind=>({kind,deadline:kind==='design_portfolio'?new Date(Date.now()-65*60000).toISOString():null,pointsPerHour:5})));
 await api.signIn('manager@x.test');await api.claimInvitations();
 const root=await submissionsScreen(ctx,event.id);expect(root.textContent).toContain('Late penalty: 10 points');expect(root.textContent).not.toContain('Save submission deadlines');
 expect((await api.listPenalties(event.id))[0]).toMatchObject({teamId:team.id,points:10});
 await expect(api.saveSubmissionRules(event.id,2,[])).rejects.toMatchObject({code:'forbidden'});
});
