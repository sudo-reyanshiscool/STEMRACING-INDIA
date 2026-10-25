import {watchGuide} from '../guide-helper';
// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {eventHomeScreen} from '../../src/ui/event-home';
import {submissionsScreen} from '../../src/ui/submissions';
import {world,makeCtx,EMAILS} from './helpers';
it('shows actual team submission progress and excludes other teams from the garage',async()=>{
 const {api,ev,t1}=await world();
 await watchGuide(api,ev.id);
 await api.uploadTeamFile(ev.id,t1.id,0,{kind:'design_portfolio',name:'design.pdf',mime:'application/pdf',base64:btoa('%PDF-1.4\n%%EOF')});
 const {ctx}=makeCtx(api),root=await eventHomeScreen(ctx,ev.id);
 expect(root.querySelector('.garage-bib')?.textContent).toContain('1');expect(root.querySelector('h1')?.textContent).toBe('One');
 expect(root.querySelector('progress')?.value).toBe(1);expect(root.querySelector('progress')?.max).toBe(3);
 expect(root.textContent).not.toContain('Two');expect(root.querySelector('a[href$="/submissions"]')).not.toBeNull();
 const submissions=await submissionsScreen(ctx,ev.id);expect(submissions.querySelectorAll('.garage-submission')).toHaveLength(3);expect(submissions.querySelectorAll('.is-submitted')).toHaveLength(1);
});
it('keeps navigation usable when progress is unavailable and does not claim zero penalties',async()=>{
 const {api,ev}=await world();vi.spyOn(api,'submissionState').mockRejectedValue(Error('Offline'));
 const root=await eventHomeScreen(makeCtx(api).ctx,ev.id);expect(root.textContent).toContain('Submission progress could not be loaded');expect(root.textContent).toContain('Unavailable');expect(root.textContent).not.toContain('0 pts');
});
it('keeps the organiser workspace outside the manager redesign',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);const root=await eventHomeScreen(makeCtx(api).ctx,ev.id);expect(root.querySelector('.garage-hero')).toBeNull();expect(root.textContent).toContain('Scrutineering setup');
});
