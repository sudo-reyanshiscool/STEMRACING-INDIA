// @vitest-environment jsdom
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {GuidePlayback,submissionGuide} from '../../src/ui/submission-guide';
import {teamFilesScreen} from '../../src/ui/team-files';
import {MemoryApi,SUBMISSION_GUIDE_DURATION} from '../../src/api';
import {makeCtx,world} from './helpers';
import {watchGuide} from '../guide-helper';
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(function(this:HTMLMediaElement){this.currentTime=0;});});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();document.body.replaceChildren();});
it('credits only contiguous visible playback, allows rewinds and rejects seeking gaps',()=>{
 const track=new GuidePlayback(0);track.reset(0,0);
 track.sample(1,1000,true);expect(track.furthest).toBe(1);
 track.sample(500,2000,true);expect(track.furthest).toBe(1);
 track.reset(1,2000);track.sample(2,3000,false);expect(track.furthest).toBe(1);
 track.reset(0,4000);track.sample(1,5000,true);track.sample(2,6000,true);expect(track.furthest).toBe(2);
 track.sample(12,7000,true);expect(track.furthest).toBe(2);
});
it('locks submission controls, blocks jumping forward and forces normal speed',async()=>{
 const {api,ev}=await world(),{ctx,leaves}=makeCtx(api);
 const gate=await submissionGuide(ctx,ev.id);document.body.append(gate.element);
 const form=document.createElement('form');gate.guard(form);expect(form.hidden).toBe(true);
 const video=gate.element.querySelector('video')!;
 Object.defineProperty(video,'duration',{value:SUBMISSION_GUIDE_DURATION});video.dispatchEvent(new Event('loadedmetadata'));
 video.currentTime=700;video.dispatchEvent(new Event('seeking'));expect(video.currentTime).toBe(0);
 video.playbackRate=2;video.dispatchEvent(new Event('ratechange'));expect(video.playbackRate).toBe(1);
 video.dispatchEvent(new Event('ended'));await new Promise(r=>setTimeout(r,0));expect(gate.unlocked()).toBe(false);
 leaves.forEach(f=>f());
});
it('does not unlock via the Team files route, and reuses account completion after real timed progress',async()=>{
 const {api,ev}=await world(),first=makeCtx(api);
 const screen=await teamFilesScreen(first.ctx,ev.id);expect(screen.querySelector('form')?.hidden).toBe(true);
 await watchGuide(api,ev.id);
 const again=makeCtx(api),second=await teamFilesScreen(again.ctx,ev.id);
 expect(second.querySelector('form')?.hidden).toBe(false);
 first.leaves.forEach(f=>f());again.leaves.forEach(f=>f());
});
it('keeps two signed-in people’s progress separate and rejects untimed completion',async()=>{
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const e=await api.createEvent({name:'Guide test'});
 await api.createTeam(e.id,{number:'1',name:'One',managerEmail:'first@x.test'});await api.createTeam(e.id,{number:'2',name:'Two',managerEmail:'second@x.test'});
 await api.signIn('first@x.test');await api.claimInvitations();
 expect((await api.recordSubmissionGuideProgress(e.id,SUBMISSION_GUIDE_DURATION)).complete).toBe(false);
 await watchGuide(api,e.id);expect((await api.submissionGuideState(e.id)).complete).toBe(true);
 await api.signIn('second@x.test');await api.claimInvitations();expect((await api.submissionGuideState(e.id)).complete).toBe(false);
});

it('unlocks guarded controls only after the complete normal-speed playback and server save',async()=>{
 vi.useFakeTimers();
 let elapsed=0;
 vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 const {api,ev}=await world(),{ctx,leaves}=makeCtx(api);
 const gate=await submissionGuide(ctx,ev.id),form=document.createElement('form');gate.guard(form);
 const video=gate.element.querySelector('video')!;
 Object.defineProperty(video,'duration',{value:SUBMISSION_GUIDE_DURATION});
 video.dispatchEvent(new Event('loadedmetadata'));
 await vi.advanceTimersByTimeAsync(0);
 video.dispatchEvent(new Event('playing'));
 for(let position=10;position<SUBMISSION_GUIDE_DURATION;position+=10){
  elapsed=position*1000;video.currentTime=position;video.dispatchEvent(new Event('timeupdate'));
  await vi.advanceTimersByTimeAsync(10000);
 }
 expect(form.hidden).toBe(true);
 elapsed=SUBMISSION_GUIDE_DURATION*1000;video.currentTime=SUBMISSION_GUIDE_DURATION;
 Object.defineProperty(video,'ended',{value:true});video.dispatchEvent(new Event('timeupdate'));
 await vi.advanceTimersByTimeAsync(4040);
 video.dispatchEvent(new Event('ended'));await vi.advanceTimersByTimeAsync(0);
 expect(gate.unlocked()).toBe(true);expect(form.hidden).toBe(false);
 expect(gate.element.textContent).toContain('Your submission controls are now unlocked');
 leaves.forEach(f=>f());
});

it('hides the guide and unlocks uploads for the exempt account while other managers remain gated',async()=>{
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const event=await api.createEvent({name:'Exemption test'});
 await api.createTeam(event.id,{number:'001',name:'Supercharged',managerEmail:'supercharged@british-school.org'});
 await api.createTeam(event.id,{number:'002',name:'Other team',managerEmail:'other@x.test'});
 await api.signIn('supercharged@british-school.org');await api.claimInvitations();
 const {ctx}=makeCtx(api),screen=await teamFilesScreen(ctx,event.id);
 expect(screen.querySelector('video')).toBeNull();expect(screen.querySelector('form')?.hidden).toBe(false);
 expect(await api.submissionGuideState(event.id)).toMatchObject({required:false,complete:false,watchedSeconds:0});
 await api.signIn('other@x.test');await api.claimInvitations();expect((await api.submissionGuideState(event.id)).required).toBe(true);
});
