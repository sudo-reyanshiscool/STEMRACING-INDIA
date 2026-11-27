import type {Panel,TeamRow} from '../api/types';
export interface Stream {id:string;name:string}
export interface Allocation {teamId:string;streamId:string}
export interface TeamJudgingExemption {teamId:string;panel:Panel|'all';reason:string}
export interface ScheduleResource {id:string;name:string;kind:'track'|'room'|'panel'|'other'}
export interface Activity {resourceNames?:string[];id:string;title:string;kind:'ceremony'|'activity'|'judging'|'racing';scope:'all'|'stream'|'teams';streamId:string|null;teamIds:string[];panel:Panel|null;start:string;end:string|null;point:boolean;resourceIds:string[];location:string}
export interface ScheduleDoc {timezone:string;days:Array<{date:string;opens:string;closes:string}>;streams:Stream[];allocations:Allocation[];exemptions:TeamJudgingExemption[];resources:ScheduleResource[];activities:Activity[]}
export interface ScheduleIssue {severity:'error'|'warning';code:string;message:string;activityId?:string;teamId?:string}
export interface ScheduleState {judgeExemptions?:Array<{teamId:string;judgeName:string;reason:string}>;revision:number;draft:ScheduleDoc;published:ScheduleDoc|null;publishedAt:string|null;issues:ScheduleIssue[];history:Array<{revision:number;action:string;at:string;actor?:string}>}
export interface TeamSchedule {timezone:string;publishedAt:string|null;teams:Array<{teamId:string;stream:string|null;activities:Activity[]}>}
export const emptySchedule=():ScheduleDoc=>({timezone:'Asia/Kolkata',days:[],streams:[],allocations:[],exemptions:[],resources:[],activities:[]});
export function streamName(index:number):string {let n=index+1,s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return `Stream ${s}`;}
/** Rejection sampling avoids modulo bias in the Fisher–Yates draw. */
export function allocateStreams(teamIds:string[],random=()=>crypto.getRandomValues(new Uint32Array(1))[0]):Pick<ScheduleDoc,'streams'|'allocations'> {
 const ids=[...new Set(teamIds)];for(let i=ids.length-1;i>0;i--){const limit=Math.floor(4294967296/(i+1))*(i+1);let n;do{n=random();}while(n>=limit);const j=n%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
 const count=Math.ceil(ids.length/10),streams=Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),name:streamName(i)}));
 return {streams,allocations:ids.map((teamId,i)=>({teamId,streamId:streams[i%count].id}))};
}
export function activityTeams(doc:ScheduleDoc,a:Activity,teamIds:string[]):string[] {return a.scope==='all'?teamIds:a.scope==='teams'?a.teamIds:doc.allocations.filter(x=>x.streamId===a.streamId).map(x=>x.teamId);}
export function exempt(doc:ScheduleDoc,teamId:string,panel:Panel|null) {return doc.exemptions.some(e=>e.teamId===teamId&&(e.panel==='all'||e.panel===panel));}
export function teamActivities(doc:ScheduleDoc,teamId:string):Activity[] {return doc.activities.filter(a=>activityTeams(doc,a,[teamId]).includes(teamId)&&!(a.kind==='judging'&&exempt(doc,teamId,a.panel))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));}
export function overlaps(a:Activity,b:Activity) {const as=Date.parse(a.start),bs=Date.parse(b.start),ae=a.point?as:Date.parse(a.end!),be=b.point?bs:Date.parse(b.end!);return a.point&&b.point?as===bs:a.point?as>=bs&&as<be:b.point?bs>=as&&bs<ae:as<be&&bs<ae;}
export function validateSchedule(doc:ScheduleDoc,teams:Pick<TeamRow,'id'|'name'>[]):ScheduleIssue[] {
 const issues:ScheduleIssue[]=[],ids=teams.map(t=>t.id),add=(severity:ScheduleIssue['severity'],code:string,message:string,activityId?:string,teamId?:string)=>issues.push({severity,code,message,...(activityId?{activityId}:{}),...(teamId?{teamId}:{})});
 const assigned=new Set<string>();
 for(const s of doc.streams)if(doc.allocations.filter(a=>a.streamId===s.id).length>10)add('error','capacity',`${s.name} exceeds 10 teams.`);
 for(const a of doc.allocations){if(assigned.has(a.teamId))add('error','duplicate','A team belongs to multiple streams.',undefined,a.teamId);assigned.add(a.teamId);if(!ids.includes(a.teamId)||!doc.streams.some(s=>s.id===a.streamId))add('error','allocation','An allocation references a removed team or stream.',undefined,a.teamId);}
 for(const team of teams)if(!assigned.has(team.id))add('error','unallocated',`${team.name} is awaiting stream allocation.`,undefined,team.id);
 let formatter:Intl.DateTimeFormat;try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:doc.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{add('error','timezone','Choose a valid event timezone.');return issues;}
 const local=(date:string)=>{const p=Object.fromEntries(formatter.formatToParts(new Date(date)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};};
 for(const a of doc.activities){
  if(!a.title.trim()||!Number.isFinite(Date.parse(a.start))||(!a.point&&(!a.end||!Number.isFinite(Date.parse(a.end))||Date.parse(a.end)<=Date.parse(a.start)))||(a.point&&a.end!==null)){add('error','duration',`${a.title||'Activity'} needs a valid start and duration or point-in-time format.`,a.id);continue;}
  const start=local(a.start),end=local(a.end??a.start),day=doc.days.find(d=>d.date===start.date);
  if(!day||end.date!==start.date||start.time<day.opens||end.time>day.closes)add('error','hours',`${a.title} is outside event operating hours.`,a.id);
  if(a.scope==='stream'&&!doc.streams.some(s=>s.id===a.streamId))add('error','stream',`${a.title} references an unknown stream.`,a.id);
  if(a.scope==='teams'&&(!a.teamIds.length||a.teamIds.some(t=>!ids.includes(t))))add('error','team',`${a.title} needs valid event teams.`,a.id);
  if(a.scope==='teams'&&a.streamId&&a.teamIds.some(t=>!doc.allocations.some(x=>x.teamId===t&&x.streamId===a.streamId)))add('error','stream_assignment',`${a.title} no longer matches its team's stream.`,a.id);
  if(a.kind==='judging'&&!a.panel)add('error','panel',`${a.title} needs a judging category.`,a.id);
  if(a.kind==='racing'&&a.scope!=='teams')add('error','racing_team',`${a.title} needs individual team appointments.`,a.id);
  if(a.kind==='judging'&&a.scope==='teams')for(const t of a.teamIds)if(exempt(doc,t,a.panel))add('error','exempt',`${a.title} includes an exempt team.`,a.id,t);
  if(a.resourceIds.some(id=>!doc.resources.some(r=>r.id===id)))add('error','resource',`${a.title} references an unknown resource.`,a.id);
 }
 for(let i=0;i<doc.activities.length;i++)for(let j=i+1;j<doc.activities.length;j++){
  const a=doc.activities[i],b=doc.activities[j];if(!overlaps(a,b))continue;
  const required=(x:Activity)=>x.kind==='judging'&&x.scope!=='teams'?[]:activityTeams(doc,x,ids);
  for(const t of required(a).filter(t=>required(b).includes(t)))add('error','overlap',`${a.title} overlaps ${b.title} for ${teams.find(x=>x.id===t)?.name??'a team'}.`,a.id,t);
  if(a.resourceIds.some(id=>b.resourceIds.includes(id))||(a.location.trim()&&a.location.trim().toLowerCase()===b.location.trim().toLowerCase()))add('warning','resource_overlap',`${a.title} and ${b.title} overlap at a shared room, panel or track.`,a.id);
 }
 return issues;
}
export function localScheduleTime(iso:string,timezone:string):string {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
export function scheduleTimeIso(local:string,timezone:string):string {
 const desired=Date.parse(local+'Z');if(!Number.isFinite(desired))throw Error('Choose a valid date and time.');let guess=desired;
 for(let i=0;i<4;i++){const rendered=localScheduleTime(new Date(guess).toISOString(),timezone);const delta=desired-Date.parse(rendered+'Z');if(!delta)return new Date(guess).toISOString();guess+=delta;}
 throw Error('That local time does not exist in this timezone. Choose another time.');
}
export interface SlotOptions {kind:'judging'|'racing';panel:Panel|null;start:string;duration:number;gap:number;rounds:number;streamId:string|null;resourceId:string|null;location:string}
export function generateTeamSlots(doc:ScheduleDoc,teams:Pick<TeamRow,'id'|'number'|'name'>[],options:SlotOptions):Activity[] {
 if(!Number.isFinite(Date.parse(options.start))||![options.duration,options.gap,options.rounds].every(Number.isInteger)||options.duration<1||options.duration>1440||options.gap<0||options.gap>1440||options.rounds<1||options.rounds>20||(options.kind==='judging'&&!options.panel))throw Error('Choose valid slot times, judging category and number of rounds.');
 const eligible=teams.filter(t=>doc.allocations.some(a=>a.teamId===t.id&&(!options.streamId||a.streamId===options.streamId))&&!(options.kind==='judging'&&exempt(doc,t.id,options.panel)));
 if(!eligible.length)throw Error('No allocated, eligible teams match this selection.');
 if(eligible.length*options.rounds+doc.activities.length>1500)throw Error('This would exceed 1,500 activities. Generate fewer slots.');
 const slots:Activity[]=[];let at=Date.parse(options.start);
 for(let round=1;round<=options.rounds;round++)for(const t of eligible){slots.push({id:crypto.randomUUID(),title:`${options.kind==='racing'?'Racing':'Judging'} — Team ${t.number}${options.rounds>1?` · round ${round}`:''}`,kind:options.kind,scope:'teams',streamId:doc.allocations.find(a=>a.teamId===t.id)!.streamId,teamIds:[t.id],panel:options.kind==='judging'?options.panel:null,start:new Date(at).toISOString(),end:new Date(at+options.duration*60000).toISOString(),point:false,resourceIds:options.resourceId?[options.resourceId]:[],location:options.location});at+=(options.duration+options.gap)*60000;}
 return slots;
}
/** Bounds-based slot generation: a judging area or racing runs from `start` to `end` in fixed-length slots. */
export interface WindowSlotOptions {kind:'judging'|'racing';title:string;panel:Panel|null;start:string;end:string;duration:number;gap:number;
 /** 'stream': each stream has its own judge/panel, so every slot time holds one team per stream. 'single': one team at a time (e.g. one track). */
 lanes:'stream'|'single';streamId:string|null;location:string;
 /** Replace this area's earlier generated appointments (same type, category and title) instead of adding to them. */
 replace:boolean}
export interface WindowLane {streamId:string|null;name:string;teams:number;placed:number}
export interface WindowSlotPlan {slots:Activity[];replaced:Activity[];leftover:Array<{teamId:string;reason:'full'|'busy'}>;eligible:number;slotTimes:number;lanes:WindowLane[];capacity:number;
 /** Where the window would need to end for every team to fit, when it is too short. */
 neededEnd:string|null;outsideHours:boolean}
const generatedTitle=(title:string,number:string)=>`${title} — Team ${number}`;
export function isWindowSlotOf(a:Activity,o:Pick<WindowSlotOptions,'kind'|'panel'|'title'>):boolean {return a.kind===o.kind&&a.scope==='teams'&&(a.panel??null)===(o.kind==='judging'?o.panel:null)&&a.title.startsWith(`${o.title.trim()} — Team `);}
/**
 * Gives every eligible team one exact slot inside the window, in its lane, never clashing with anything else the team
 * is already booked for (other judging areas, racing, ceremonies). As many teams as possible are placed. Teams that cannot be placed are reported as leftover rather than overflowing the window.
 */
export function planWindowSlots(doc:ScheduleDoc,teams:Pick<TeamRow,'id'|'number'|'name'>[],o:WindowSlotOptions):WindowSlotPlan {
 const title=o.title.trim(),S=Date.parse(o.start),E=Date.parse(o.end);
 if(!title||title.length>150)throw Error('Give the area a name of up to 150 characters, such as Verbal Presentation.');
 if(!Number.isFinite(S)||!Number.isFinite(E)||E<=S)throw Error('The window must end after it starts.');
 if(!Number.isInteger(o.duration)||o.duration<1||o.duration>1440||!Number.isInteger(o.gap)||o.gap<0||o.gap>1440)throw Error('Choose a slot length of 1 to 1,440 minutes and a gap of 0 to 1,440 minutes.');
 if(o.kind==='judging'&&!o.panel)throw Error('Choose a judging category.');
 if(!doc.allocations.length)throw Error('Generate the stream allocation first. Slots are built per stream.');
 const L=o.duration*60000,G=o.gap*60000,times:number[]=[];for(let t=S;t+L<=E&&times.length<1500;t+=L+G)times.push(t);
 const stream=(id:string)=>doc.allocations.find(a=>a.teamId===id)?.streamId??null;
 const eligible=teams.filter(t=>{const s=stream(t.id);return s!==null&&(!o.streamId||s===o.streamId)&&!(o.kind==='judging'&&exempt(doc,t.id,o.panel));});
 if(!eligible.length)throw Error('No allocated, eligible teams match this selection.');
 const replaced=o.replace?doc.activities.filter(a=>isWindowSlotOf(a,{...o,title})):[],kept=doc.activities.filter(a=>!replaced.includes(a));
 // Same rule as validateSchedule: judging not booked per team never blocks a team.
 const busy=new Map<string,Activity[]>();for(const t of eligible)busy.set(t.id,kept.filter(a=>!(a.kind==='judging'&&a.scope!=='teams')&&activityTeams(doc,a,[t.id]).includes(t.id)));
 const lanes:Array<WindowLane&{members:typeof eligible}>=o.lanes==='single'?[{streamId:null,name:'All streams',teams:eligible.length,placed:0,members:eligible}]
  :doc.streams.map(s=>{const members=eligible.filter(t=>stream(t.id)===s.id);return {streamId:s.id,name:s.name,teams:members.length,placed:0,members};}).filter(l=>l.members.length);
 const slots:Activity[]=[],leftover:WindowSlotPlan['leftover']=[],place=o.location.trim();
 for(const lane of lanes){
  const location=place&&o.lanes==='stream'&&lanes.length>1?`${place} · ${lane.name}`:place;
  const free=lane.members.map(t=>times.map(at=>!busy.get(t.id)!.some(b=>overlaps(b,{start:new Date(at).toISOString(),end:new Date(at+L).toISOString(),point:false} as Activity))));
  // Maximum bipartite matching (augmenting paths): a team only stays unplaced if no rearrangement could fit it.
  // Teams are tried in order and times earliest first, so the result stays close to the chosen team order.
  const owner:number[]=times.map(()=>-1);
  // An open slot is always taken first; earlier teams are only moved when that is the only way to fit this one.
  const tryPlace=(u:number,seen:boolean[]):boolean=>{
   const open=times.findIndex((_,i)=>free[u][i]&&!seen[i]&&owner[i]<0);if(open>=0){seen[open]=true;owner[open]=u;return true;}
   for(let i=0;i<times.length;i++){if(!free[u][i]||seen[i])continue;seen[i]=true;if(tryPlace(owner[i],seen)){owner[i]=u;return true;}}return false;};
  lane.members.forEach((_,u)=>tryPlace(u,times.map(()=>false)));
  owner.forEach((u,i)=>{if(u<0)return;const t=lane.members[u];lane.placed++;
   slots.push({id:crypto.randomUUID(),title:generatedTitle(title,t.number),kind:o.kind,scope:'teams',streamId:stream(t.id),teamIds:[t.id],panel:o.kind==='judging'?o.panel:null,start:new Date(times[i]).toISOString(),end:new Date(times[i]+L).toISOString(),point:false,resourceIds:[],location});});
  const placed=new Set(owner);for(const [u,t] of lane.members.entries())if(!placed.has(u))leftover.push({teamId:t.id,reason:lane.placed>=times.length?'full':'busy'});
 }
 if(kept.length+slots.length>1500)throw Error('This would exceed 1,500 activities. Generate fewer slots.');
 slots.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const most=Math.max(...lanes.map(l=>l.teams)),need=S+most*L+(most-1)*G;
 const startLocal=localScheduleTime(o.start,doc.timezone),endLocal=localScheduleTime(o.end,doc.timezone),day=doc.days.find(d=>d.date===startLocal.slice(0,10));
 return {slots,replaced,leftover,eligible:eligible.length,slotTimes:times.length,lanes:lanes.map(({members:_,...l})=>l),capacity:times.length*lanes.length,
  neededEnd:leftover.length&&need>E?new Date(need).toISOString():null,outsideHours:!day||endLocal.slice(0,10)!==day.date||startLocal.slice(11)<day.opens||endLocal.slice(11)>day.closes};
}
