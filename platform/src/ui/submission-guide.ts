import {SUBMISSION_GUIDE_URL,SUBMISSION_GUIDE_VERSION,type SubmissionGuideState} from '../api';
import type {Ctx} from './ctx';
import {h} from './dom';

export interface SubmissionGuideGate { element: HTMLElement; unlocked(): boolean; guard(element: HTMLElement): void }
const clock = (seconds: number) => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

/** Only contiguous, visible playback at normal speed counts. Rewatching is always allowed. */
export class GuidePlayback {
  furthest: number;
  private position: number;
  private at = 0;
  constructor(saved: number) { this.furthest = this.position = saved; }
  reset(position: number, now: number) { this.position = position; this.at = now; }
  sample(position: number, now: number, watching: boolean) {
    const delta = position-this.position, elapsed = Math.max(0,(now-this.at)/1000);
    if (watching && delta>=0 && delta<=elapsed+0.3 && this.position<=this.furthest+0.05) this.furthest = Math.max(this.furthest,position);
    this.reset(position,now);
  }
}

export async function submissionGuide(ctx: Ctx, eventId: string): Promise<SubmissionGuideGate> {
  const root=h('section',{class:'submission-guide stack','aria-label':'Required submission guide'});
  const guarded:HTMLElement[]=[];
  let alive=true, state:SubmissionGuideState|null=null;
  const session=await ctx.api.getSession();
  const unlocked=()=>!!state&&(!state.required||state.complete);
  const sync=()=>guarded.forEach(element=>{element.hidden=!unlocked();});
  const gate={element:root,unlocked,guard(element:HTMLElement){guarded.push(element);element.hidden=!unlocked();}};
  try { state=await ctx.api.submissionGuideState(eventId); }
  catch {
    root.append(h('h2',null,'Watch before you submit'),h('p',{class:'alert',role:'alert'},'Your guide progress could not be loaded. Reconnect and try again; uploads stay locked until completion is confirmed.'),h('button',{type:'button',class:'btn btn--ghost',onclick:()=>ctx.rerender()},'Retry guide'));
    return gate;
  }
  if(!state.required || state.complete) { root.hidden=true;return gate; }
  if(state.version!==SUBMISSION_GUIDE_VERSION) {
    root.append(h('p',{class:'alert',role:'alert'},'The submission guide has changed. Reload the website before continuing.'));
    return gate;
  }
  let confirmed=state.watchedSeconds, watching=false, sending=false, saveAgain=false, retryNeeded=false, metadataReady=false;
  const playback=new GuidePlayback(confirmed);
  const video=h('video',{src:SUBMISSION_GUIDE_URL,controls:true,preload:'auto',playsinline:true,controlslist:'nodownload noplaybackrate noremoteplayback',disablepictureinpicture:true,disableremoteplayback:true,'aria-label':'Submission guide video','aria-describedby':'submission-guide-instructions'});
  const progress=h('progress',{max:state.duration,value:confirmed,'aria-label':'Submission guide watched'});
  const status=h('p',{class:'muted small'});
  const announcement=h('p',{class:'sr-only',role:'status','aria-live':'polite'});
  const failure=h('p',{class:'alert',role:'alert',hidden:true});
  const retry=h('button',{type:'button',class:'btn btn--ghost',hidden:true},'Retry saving progress');
  const paint=()=>{
    progress.value=Math.min(playback.furthest,state!.duration);
    progress.setAttribute('aria-valuetext',`${clock(progress.value)} of ${clock(state!.duration)} watched`);
    if(unlocked()&&!announcement.textContent)announcement.textContent='Guide complete. Submission controls unlocked.';
    status.textContent=unlocked()?'Guide complete. Your submission controls are now unlocked.':`${clock(progress.value)} / ${clock(state!.duration)} watched · uploads unlock after the whole video. Saved to your account at ${clock(confirmed)}.`;
  };
  const sample=()=>{playback.sample(video.currentTime,performance.now(),watching&&!document.hidden&&!video.seeking&&video.playbackRate===1);paint();};
  const fail=(message:string)=>{video.pause();watching=false;retryNeeded=true;failure.textContent=message;failure.hidden=false;retry.hidden=false;};
  const save=async()=>{
    if(!alive||!state||unlocked()||!metadataReady)return;
    if(sending){saveAgain=true;return;}
    sending=true;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      if((await ctx.api.getSession())?.userId!==session?.userId)return;
      const next=await Promise.race([
        ctx.api.recordSubmissionGuideProgress(eventId,Math.min(playback.furthest,state.duration)),
        new Promise<SubmissionGuideState>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('Guide save timed out')),15000);}),
      ]);
      if(!alive)return;
      confirmed=next.watchedSeconds;
      if(confirmed+0.5<playback.furthest){
        playback.furthest=confirmed;video.currentTime=confirmed;playback.reset(confirmed,performance.now());
        fail('Playback was ahead of your saved progress. Resume from the saved point to finish the guide.');return;
      }
      // A forged ended event or a seek to the end cannot unlock an unwatched video.
      state={...next,complete:next.complete&&video.ended};
      retryNeeded=false;failure.hidden=true;retry.hidden=true;sync();paint();
    }catch{if(alive){playback.furthest=confirmed;video.currentTime=confirmed;fail('Your progress could not be saved. Check your internet connection and retry. You will resume from your last saved point.');}}
    finally{clearTimeout(timeout);sending=false;if(saveAgain&&alive){saveAgain=false;void save();}}
  };
  video.addEventListener('loadedmetadata',()=>{
    if(!Number.isFinite(video.duration)||Math.abs(video.duration-state!.duration)>1){fail('This video could not be verified. Reload the page to load the current guide.');return;}
    metadataReady=true;if(confirmed>0)video.currentTime=confirmed;playback.reset(confirmed,performance.now());paint();
    // Establish the server heartbeat before playback. Long idle time cannot be banked as watched time.
    void save();
  });
  video.addEventListener('playing',()=>{
    if(retryNeeded||!metadataReady){video.pause();return;}
    // The decoder may already be a frame ahead when 'playing' fires. Seeking here would restart it repeatedly.
    watching=true;playback.reset(Math.min(video.currentTime,playback.furthest),performance.now());
  });
  video.addEventListener('timeupdate',sample);
  video.addEventListener('seeking',()=>{
    if(video.currentTime>playback.furthest+0.05){
      if(!watching&&playback.furthest<0.05){
        // Cancel an initial unbuffered seek cleanly; immediately re-seeking can strand native players in 'waiting'.
        metadataReady=false;video.load();
      }else video.currentTime=playback.furthest;
      status.textContent='Watch the video in order. You can replay any part you have already watched.';
    }
    playback.reset(Math.min(video.currentTime,playback.furthest),performance.now());
  });
  video.addEventListener('seeked',()=>playback.reset(video.currentTime,performance.now()));
  video.addEventListener('ratechange',()=>{if(video.playbackRate!==1){video.playbackRate=1;playback.reset(video.currentTime,performance.now());status.textContent='The guide must be watched at normal speed.';}});
  video.addEventListener('pause',()=>{sample();watching=false;void save();});
  video.addEventListener('ended',()=>{sample();watching=false;void save();});
  video.addEventListener('error',()=>fail('The submission video could not be loaded. Check your connection, then retry.'));
  const visibility=()=>{if(document.hidden){video.pause();watching=false;void save();}};
  document.addEventListener('visibilitychange',visibility);
  const timer=setInterval(()=>{if(watching)void save();},10000);
  retry.onclick=()=>{retryNeeded=false;failure.hidden=true;retry.hidden=true;if(video.error){metadataReady=false;video.load();}else void save();};
  ctx.onLeave(()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);video.pause();video.removeAttribute('src');video.load();});
  root.append(h('p',{class:'eyebrow'},'Before your first submission'),h('h2',null,'Watch the submission guide'),h('p',{id:'submission-guide-instructions'},'Watch the full 13-minute guide once to unlock portfolios, photographs and digital media uploads. Play at normal speed and keep this tab visible. You can pause, rewind and resume from saved progress, even on another device.'),video,progress,status,announcement,failure,retry);
  paint();
  return gate;
}
