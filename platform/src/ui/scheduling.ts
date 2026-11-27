import type {Ctx} from './ctx';
import type {Panel,TeamRow} from '../api';
import {h} from './dom';
import {errorText,notFound} from './common';
import {PANEL_LABEL} from './labels';
import {routeHref} from './router';
import {garageHeader} from './team-garage';
import {allocateStreams,generateTeamSlots,planWindowSlots,streamName,teamActivities,activityTeams,exempt,validateSchedule,localScheduleTime,scheduleTimeIso,type Activity,type ScheduleDoc,type TeamSchedule} from '../scheduling';
const time=(iso:string,tz:string)=>new Date(iso).toLocaleTimeString('en-IN',{timeZone:tz,hour:'2-digit',minute:'2-digit'});
const day=(iso:string,tz:string)=>new Date(iso).toLocaleDateString('en-IN',{timeZone:tz,weekday:'short',day:'numeric',month:'long',year:'numeric'});
const kinds={ceremony:'Shared ceremony',activity:'Activity',judging:'Judging',racing:'Racing'};
const input=(type:string,label:string,value='')=>h('input',{type,'aria-label':label,value});
const field=(label:string,control:HTMLElement)=>h('label',{class:'field'},h('span',{class:'field__label'},label),control);
const button=(label:string,action:()=>void,className='btn btn--ghost')=>h('button',{type:'button',class:className,onclick:action},label);
function timeline(doc:ScheduleDoc,activities:Activity[],teams:TeamRow[],editing?:(a:Activity)=>void,remove?:(a:Activity)=>void):HTMLElement {
 const list=h('div',{class:'schedule-timeline'});let last='';
 for(const a of [...activities].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id))){
  const date=day(a.start,doc.timezone);if(date!==last){list.append(h('h3',{class:'schedule-day'},date));last=date;}
  const scope=a.scope==='all'?'All Streams':a.scope==='stream'?doc.streams.find(s=>s.id===a.streamId)?.name??'Stream removed':a.teamIds.map(id=>{const t=teams.find(t=>t.id===id);return t?`${t.number} · ${t.name}`:'Team removed';}).join(', ');
  list.append(h('article',{class:`schedule-slot schedule-slot--${a.kind}`},h('div',{class:'schedule-slot__time'},h('strong',null,time(a.start,doc.timezone)),a.end?h('span',null,`– ${time(a.end,doc.timezone)}`):h('span',null,'Exact time')),
   h('div',{class:'stack'},h('span',{class:'eyebrow'},kinds[a.kind]),h('h3',null,a.title),h('p',{class:'small muted'},scope),a.panel?h('p',{class:'small'},PANEL_LABEL[a.panel]):null,a.kind==='judging'&&a.scope!=='teams'?h('p',{class:'notice small'},'Stream information block. Individual judging appointments are listed separately.'):null,a.location?h('p',{class:'small'},a.location):null,a.resourceIds.length?h('p',{class:'small muted'},(a.resourceNames??a.resourceIds.map(id=>doc.resources.find(r=>r.id===id)?.name??'Resource')).join(' · ')):null,
    editing?h('div',{class:'actions'},button('Edit appointment',()=>editing(a)),button('Remove appointment',()=>remove?.(a))):null)));
 }
 if(!activities.length)list.append(h('p',{class:'notice'},'No activities match this view.'));return list;
}
export async function myScheduleScreen(ctx:Ctx,eventId:string):Promise<HTMLElement> {
 const [event,teams,schedule]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.listTeams(eventId),ctx.api.mySchedule(eventId)]);
 if(!event)return notFound('Event not found.');
 const root=h('div',{class:'garage stack stack--lg'},garageHeader('Your team / On the clock','My Schedule',event.name),h('p',{class:'notice'},`All times use ${schedule.timezone}. Only the published schedule appears here.`));
 if(!schedule.publishedAt)return h('div',{class:'garage stack stack--lg'},...Array.from(root.childNodes),h('section',{class:'garage-results-wait stack'},h('h2',null,'Your schedule is on its way'),h('p',null,'The organisers have not published the stream allocations and schedule yet. Check back here for your official appointments.')));
 for(const own of schedule.teams){const team=teams.find(t=>t.id===own.teamId);root.append(h('section',{class:'stack'},h('div',{class:'garage-section-head'},h('h2',null,`${team?.number??''} · ${team?.name??'Your team'}`),h('span',{class:'garage-status'},own.stream??'Awaiting allocation')),timeline({timezone:schedule.timezone,streams:own.stream?[{id:'own',name:own.stream}]:[],allocations:[],exemptions:[],resources:[],activities:own.activities,days:[]},own.activities.map(a=>a.scope==='stream'?{...a,streamId:'own'}:a),teams)));}
 root.append(h('p',{class:'muted small'},`Published ${new Date(schedule.publishedAt).toLocaleString('en-IN',{timeZone:schedule.timezone})}`),button('Refresh schedule',()=>ctx.rerender()));return root;
}
export async function schedulingScreen(ctx:Ctx,eventId:string):Promise<HTMLElement> {
 const [event,roles]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.myRoles(eventId)]);
 if(!event)return notFound('Event not found.');
 const canEdit=roles.some(r=>r.role==='organiser'||r.role==='chair'),spectator=roles.some(r=>r.role==='spectator');
 if(!canEdit&&!spectator)return notFound('Scheduling is managed by event organisers.');
 const [state,teams]=await Promise.all([ctx.api.schedulingState(eventId),ctx.api.listTeams(eventId)]);
 let doc=structuredClone(state.draft),dirty=false,busy=false,editId:string|null=null,selected='streams',confirmDraw=false,confirmPublish=false,previewPublished=false,windowOpen=false,windowValues:Record<string,string>={};
 const root=h('div',{class:'stack stack--lg schedule-workspace'},h('h1',null,'Scheduling & Streams'),h('p',{class:'lead'},'Allocate teams, build the event timeline and publish each team’s official schedule.'));
 const status=h('p',{role:'status','aria-live':'polite'}),toolbar=h('div',{class:'schedule-toolbar'}),tabs=h('div',{class:'panel-switcher',role:'group','aria-label':'Scheduling views'}),body=h('div',{class:'stack stack--lg'}),issues=h('div',{class:'stack'});root.append(status,toolbar,tabs,issues,body);
 const run=async(action:()=>Promise<void>)=>{if(busy)return;busy=true;renderToolbar();try{await action();ctx.rerender();}catch(e){status.textContent=errorText(e);busy=false;renderToolbar();}};
 const changed=()=>{dirty=true;confirmPublish=false;render();};
 function renderToolbar(){
  const save=button('Save draft',()=>void run(()=>ctx.api.saveSchedule(eventId,state.revision,doc)),'btn btn--primary');save.disabled=busy||!dirty;
  const publish=button(confirmPublish?'Confirm publication to teams':'Publish schedule',()=>{if(!confirmPublish){confirmPublish=true;renderToolbar();return;}void run(()=>ctx.api.publishSchedule(eventId,state.revision));},'btn btn--primary');publish.disabled=busy||dirty||state.issues.some(i=>i.severity==='error');
  toolbar.replaceChildren(h('span',{class:'garage-status'},dirty?'Unsaved preview':`Saved draft · revision ${state.revision}`),h('span',{class:'muted small'},state.publishedAt?`Official version published ${new Date(state.publishedAt).toLocaleString()}`:'Nothing published to teams'),canEdit?save:h('span'),canEdit?publish:h('span'),canEdit&&confirmPublish?button('Cancel publication',()=>{confirmPublish=false;renderToolbar();}):h('span'));
 }
 const teamOptions=()=>teams.map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`));
 const streamOptions=()=>doc.streams.map(s=>h('option',{value:s.id},s.name));
 function renderStreams(){
  const wrapper=h('div',{class:'stack'});
  const draw=button(confirmDraw?'Confirm regenerate allocations':'Generate Stream Allocation',()=>{if(doc.allocations.length&&!confirmDraw){confirmDraw=true;render();return;}   // Preserve stable stream identities while previewing a new random team draw.
   const fresh=allocateStreams(teams.map(t=>t.id));const remap=new Map(fresh.streams.map((s,i)=>[s.id,doc.streams[i]?.id??s.id]));doc.streams=fresh.streams.map(s=>({...s,id:remap.get(s.id)!}));doc.allocations=fresh.allocations.map(a=>({...a,streamId:remap.get(a.streamId)!}));confirmDraw=false;changed();status.textContent='Allocation preview ready. Review the streams, then Save draft. Teams see it only after publication.';},'btn btn--primary');
  if(canEdit)wrapper.append(h('div',{class:'actions'},draw,confirmDraw?button('Cancel regeneration',()=>{confirmDraw=false;render();}):null,button('Add stream',()=>{doc.streams.push({id:crypto.randomUUID(),name:streamName(doc.streams.length)});changed();})));
  const missing=teams.filter(t=>!doc.allocations.some(a=>a.teamId===t.id));if(missing.length)wrapper.append(h('p',{class:'notice'},`${missing.length} teams awaiting allocation: ${missing.map(t=>t.name).join(', ')}. Existing teams will not be reshuffled automatically.`));
  wrapper.append(h('div',{class:'schedule-streams'},doc.streams.map(s=>h('section',{class:'card stack'},h('div',{class:'garage-section-head'},h('h2',null,s.name),h('span',{class:'garage-status'},`${doc.allocations.filter(a=>a.streamId===s.id).length} / 10`)),h('ul',{class:'list'},doc.allocations.filter(a=>a.streamId===s.id).map(a=>{const team=teams.find(t=>t.id===a.teamId);return h('li',null,team?`${team.number} · ${team.name}`:'Withdrawn team');}))))));
  if(canEdit){
   const team=h('select',{'aria-label':'Team to transfer',required:true},h('option',{value:''},'Choose a team'),teamOptions()),stream=h('select',{'aria-label':'Destination stream',required:true},streamOptions());
   wrapper.append(h('form',{class:'form',onsubmit:(e:Event)=>{e.preventDefault();if(doc.allocations.filter(a=>a.streamId===stream.value&&a.teamId!==team.value).length>=10){status.textContent='This stream already has 10 teams. Choose another stream or add one.';return;}if(!team.value||!stream.value)return;doc.allocations=doc.allocations.filter(a=>a.teamId!==team.value);doc.allocations.push({teamId:team.value,streamId:stream.value});changed();}},field('Team',team),field('Destination stream',stream),h('button',{class:'btn',type:'submit'},'Transfer team')));
   if(doc.allocations.some(a=>!teams.some(t=>t.id===a.teamId)))wrapper.append(button('Remove withdrawn teams from draft',()=>{const ids=teams.map(t=>t.id);doc.allocations=doc.allocations.filter(a=>ids.includes(a.teamId));doc.exemptions=doc.exemptions.filter(a=>ids.includes(a.teamId));doc.activities=doc.activities.map(a=>({...a,teamIds:a.teamIds.filter(id=>ids.includes(id))})).filter(a=>a.scope!=='teams'||a.teamIds.length>0);changed();}));
  }
  return wrapper;
 }
 function activityEditor(){
  const old=doc.activities.find(a=>a.id===editId),form=h('form',{class:'stack schedule-editor','aria-label':'Activity editor'});
  const title=input('text','Activity title',old?.title??'');title.required=true;title.maxLength=200;
  const kind=h('select',{'aria-label':'Activity type'},Object.entries(kinds).map(([id,label])=>h('option',{value:id},label)));kind.value=old?.kind??'activity';
  const scope=h('select',{'aria-label':'Activity scope'},h('option',{value:'all'},'All Streams'),h('option',{value:'stream'},'One stream — shared block'),h('option',{value:'teams'},'Individual team appointments'));scope.value=old?.scope??'all';
  const stream=h('select',{'aria-label':'Activity stream'},h('option',{value:''},'No stream association'),streamOptions());stream.value=old?.streamId??'';
  const panel=h('select',{'aria-label':'Judging category'},h('option',{value:''},'Choose category'),Object.entries(PANEL_LABEL).map(([p,label])=>h('option',{value:p},label)));panel.value=old?.panel??'';
  const start=input('datetime-local','Activity start',old?localScheduleTime(old.start,doc.timezone):doc.days[0]?`${doc.days[0].date}T${doc.days[0].opens}`:''),end=input('datetime-local','Activity end',old?.end?localScheduleTime(old.end,doc.timezone):'');start.required=true;
  const point=input('checkbox','Point-in-time activity');point.checked=old?.point??false;
  const location=input('text','Location',old?.location??'');location.maxLength=200;
  const boxes=teams.map(t=>({t,box:h('input',{type:'checkbox',value:t.id,checked:old?.teamIds.includes(t.id)})}));
  const choices=h('fieldset',{class:'assignment-teams'},h('legend',null,'Assigned teams'),boxes.map(({t,box})=>h('label',{class:'nomination-option'},box,`${t.number} · ${t.name}`)));
  const resources=doc.resources.map(r=>({r,box:h('input',{type:'checkbox',checked:old?.resourceIds.includes(r.id)})}));
  const sync=()=>{choices.hidden=scope.value!=='teams';stream.disabled=scope.value==='all';panel.disabled=kind.value!=='judging';end.disabled=point.checked;end.required=!point.checked;boxes.forEach(({t,box})=>{box.disabled=kind.value==='judging'&&exempt(doc,t.id,panel.value as Panel);if(box.disabled)box.checked=false;});};
  kind.onchange=sync;scope.onchange=sync;panel.onchange=sync;point.onchange=sync;
  form.append(h('h2',null,old?'Edit activity':'New activity'),h('div',{class:'form'},field('Activity title',title),field('Activity type',kind),field('Scope',scope),field('Stream association',stream),field('Judging category',panel),field(`Start (${doc.timezone})`,start),field(`End (${doc.timezone})`,end),field('Location',location)),h('label',null,point,' Exact point in time (no duration)'),choices,h('fieldset',{class:'assignment-teams'},h('legend',null,'Rooms, panels and tracks'),resources.length?resources.map(({r,box})=>h('label',{class:'nomination-option'},box,r.name)):h('p',{class:'muted small'},'Add resources in Event setup to check shared room, panel and track conflicts.')),h('p',{class:'notice small'},'Stream judging blocks provide information only. Use Individual team appointments for required judging slots. Exempt teams are excluded from the team chooser.'),h('div',{class:'actions'},h('button',{class:'btn btn--primary',type:'submit'},old?'Update draft activity':'Add to draft'),old?button('Cancel editing',()=>{editId=null;render();}):null));sync();
  form.onsubmit=e=>{e.preventDefault();try{
   if(kind.value==='racing'&&scope.value!=='teams')throw Error('Racing needs individual team appointments.');
   const a:Activity={id:old?.id??crypto.randomUUID(),title:title.value.trim(),kind:kind.value as Activity['kind'],scope:scope.value as Activity['scope'],streamId:scope.value==='all'?null:stream.value||null,teamIds:scope.value==='teams'?boxes.filter(x=>x.box.checked).map(x=>x.t.id):[],panel:kind.value==='judging'?panel.value as Panel:null,start:scheduleTimeIso(start.value,doc.timezone),end:point.checked?null:scheduleTimeIso(end.value,doc.timezone),point:point.checked,resourceIds:resources.filter(x=>x.box.checked).map(x=>x.r.id),location:location.value.trim()};
   if(a.scope==='stream'&&!a.streamId)throw Error('Choose a stream.');if(a.scope==='teams'&&!a.teamIds.length)throw Error('Choose at least one eligible team.');if(a.kind==='judging'&&!a.panel)throw Error('Choose a judging category.');if(!a.point&&Date.parse(a.end!)<=Date.parse(a.start))throw Error('End time must be after the start.');
   doc.activities=doc.activities.filter(x=>x.id!==a.id);doc.activities.push(a);editId=null;changed();status.textContent='Activity added to the draft. Review validation before publication.';
  }catch(e){status.textContent=errorText(e);}};return form;
 }
 function slotGenerator(){
  const kind=h('select',{'aria-label':'Slot activity type'},h('option',{value:'judging'},'Judging'),h('option',{value:'racing'},'Racing'));
  const panel=h('select',{'aria-label':'Slot judging category'},Object.entries(PANEL_LABEL).map(([p,l])=>h('option',{value:p},l)));
  const stream=h('select',{'aria-label':'Slot stream'},h('option',{value:''},'All allocated streams'),streamOptions());
  const start=input('datetime-local','First slot start',doc.days[0]?`${doc.days[0].date}T${doc.days[0].opens}`:'');start.required=true;
  const duration=input('number','Slot duration minutes','15'),gap=input('number','Gap between slots minutes','0'),rounds=input('number','Appointments per team','1');
  duration.min='1';duration.max='1440';gap.min='0';gap.max='1440';rounds.min='1';rounds.max='20';for(const i of [duration,gap,rounds]){i.step='1';i.required=true;}
  const resource=h('select',{'aria-label':'Slot resource'},h('option',{value:''},'No shared resource'),doc.resources.map(r=>h('option',{value:r.id},r.name)));
  const order=h('select',{'aria-label':'Slot team ordering'},h('option',{value:'allocation'},'Stream allocation order'),h('option',{value:'number'},'Team number order'));
  const location=input('text','Slot location');location.maxLength=200;
  const form=h('form',{class:'stack schedule-editor','aria-label':'Generate appointment slots',onsubmit:(e:Event)=>{e.preventDefault();try{
   const ordered=order.value==='number'?[...teams].sort((a,b)=>a.number.localeCompare(b.number,'en',{numeric:true})):doc.allocations.map(a=>teams.find(t=>t.id===a.teamId)).filter((t):t is TeamRow=>!!t);
   const slots=generateTeamSlots(doc,ordered,{kind:kind.value as 'judging'|'racing',panel:kind.value==='judging'?panel.value as Panel:null,start:scheduleTimeIso(start.value,doc.timezone),duration:Number(duration.value),gap:Number(gap.value),rounds:Number(rounds.value),streamId:stream.value||null,resourceId:resource.value||null,location:location.value});doc.activities.push(...slots);changed();status.textContent=`Preview added ${slots.length} appointments. Review conflicts and operating hours before saving or publishing.`;
  }catch(e){status.textContent=errorText(e);}}},h('p',{class:'notice small'},'Creates a draft preview only. Exempt teams are skipped for judging; racing keeps them. Existing activities are never moved. Any conflicts or slots outside event hours must be resolved before publication.'),h('div',{class:'form'},field('Activity',kind),field('Judging category',panel),field('Stream',stream),field(`First start (${doc.timezone})`,start),field('Duration (minutes)',duration),field('Gap (minutes)',gap),field('Appointments per team',rounds),field('Team order',order),field('Room, panel or track',resource),field('Location',location)),h('button',{type:'submit',class:'btn btn--primary'},'Generate slot preview'));
  kind.onchange=()=>panel.disabled=kind.value!=='judging';
  return h('details',null,h('summary',null,'Generate back-to-back appointment slots'),form);
 }
 function windowGenerator(){
  const v=windowValues,pick=(key:string,fallback:string)=>v[key]??fallback;
  const title=input('text','Area name',pick('title',PANEL_LABEL.verbal));title.required=true;title.maxLength=150;
  const kind=h('select',{'aria-label':'Window activity type'},h('option',{value:'judging'},'Judging'),h('option',{value:'racing'},'Racing'));kind.value=pick('kind','judging');
  const panel=h('select',{'aria-label':'Window judging category'},Object.entries(PANEL_LABEL).map(([p,l])=>h('option',{value:p},l)));panel.value=pick('panel','verbal');
  const stream=h('select',{'aria-label':'Window streams'},h('option',{value:''},'All allocated streams'),streamOptions());stream.value=pick('stream','');
  const lanes=h('select',{'aria-label':'Teams at the same time'},h('option',{value:'stream'},'One team per stream (a judge or panel per stream)'),h('option',{value:'single'},'One team at a time (single track or panel)'));lanes.value=pick('lanes','stream');
  const date=input('date','Window date',pick('date',doc.days[0]?.date??'')),from=input('time','Window from',pick('from','12:00')),to=input('time','Window to',pick('to','15:00'));
  const duration=input('number','Slot length minutes',pick('duration','20')),gap=input('number','Changeover minutes',pick('gap','0'));
  duration.min='1';duration.max='1440';gap.min='0';gap.max='1440';for(const i of [date,from,to,duration,gap])i.required=true;for(const i of [duration,gap])i.step='1';
  const order=h('select',{'aria-label':'Window team ordering'},h('option',{value:'number'},'Team number order'),h('option',{value:'allocation'},'Stream allocation order'));order.value=pick('order','number');
  const location=input('text','Window location',pick('location',''));location.maxLength=150;
  const replace=input('checkbox','Replace earlier slots for this area');replace.checked=pick('replace','true')==='true';
  const result=h('div',{class:'stack','aria-live':'polite'});
  const remember=()=>{windowValues={title:title.value,kind:kind.value,panel:panel.value,stream:stream.value,lanes:lanes.value,date:date.value,from:from.value,to:to.value,duration:duration.value,gap:gap.value,order:order.value,location:location.value,replace:String(replace.checked)};};
  const sync=()=>{panel.disabled=kind.value!=='judging';};
  // Keep the area name following the category until the organiser types their own.
  const defaults=()=>[...Object.values(PANEL_LABEL),'Racing'];
  kind.onchange=()=>{if(defaults().includes(title.value))title.value=kind.value==='racing'?'Racing':PANEL_LABEL[panel.value as Panel];sync();result.replaceChildren();};
  panel.onchange=()=>{if(defaults().includes(title.value))title.value=PANEL_LABEL[panel.value as Panel];result.replaceChildren();};
  const teamLabel=(id:string)=>{const t=teams.find(t=>t.id===id);return t?`${t.number} · ${t.name}`:'Team';};
  const preview=()=>{try{
   remember();
   const ordered=order.value==='number'?[...teams].sort((a,b)=>a.number.localeCompare(b.number,'en',{numeric:true})):doc.allocations.map(a=>teams.find(t=>t.id===a.teamId)).filter((t):t is TeamRow=>!!t);
   const plan=planWindowSlots(doc,ordered,{kind:kind.value as 'judging'|'racing',title:title.value,panel:kind.value==='judging'?panel.value as Panel:null,start:scheduleTimeIso(`${date.value}T${from.value}`,doc.timezone),end:scheduleTimeIso(`${date.value}T${to.value}`,doc.timezone),duration:Number(duration.value),gap:Number(gap.value),lanes:lanes.value as 'stream'|'single',streamId:stream.value||null,location:location.value,replace:replace.checked});
   const placed=plan.slots.length,full=plan.leftover.filter(x=>x.reason==='full'),blocked=plan.leftover.filter(x=>x.reason==='busy');
   const shape=`The window holds ${plan.slotTimes} slot time${plan.slotTimes===1?'':'s'}${plan.lanes.length>1?` × ${plan.lanes.length} streams in parallel = ${plan.capacity} places`:''}.`;
   const summary=plan.leftover.length?h('div',{class:'notice schedule-error stack',role:'alert'},h('strong',null,`${placed} of ${plan.eligible} teams fit. ${plan.leftover.length} left over.`),h('p',null,shape),
     full.length?h('p',null,`No room in the window for: ${full.map(x=>teamLabel(x.teamId)).join(', ')}.${plan.neededEnd?` To fit everyone, end at ${time(plan.neededEnd,doc.timezone)}, use shorter slots or add a stream.`:''}`):null,
     blocked.length?h('p',null,`Already booked elsewhere for every free slot: ${blocked.map(x=>teamLabel(x.teamId)).join(', ')}.`):null)
    :h('p',{class:'notice'},h('strong',null,`All ${placed} teams fit. `),shape);
   const last=plan.slots.at(-1);
   const times=[...new Set(plan.slots.map(s=>s.start))].sort();
   const grid=h('table',{class:'schedule-window-grid'},h('thead',null,h('tr',null,h('th',{scope:'col'},'Time'),plan.lanes.map(l=>h('th',{scope:'col'},`${l.name} (${l.placed}/${l.teams})`)))),
    h('tbody',null,times.map(at=>h('tr',null,h('th',{scope:'row'},`${time(at,doc.timezone)}–${time(new Date(Date.parse(at)+Number(duration.value)*60000).toISOString(),doc.timezone)}`),plan.lanes.map(l=>{const s=plan.slots.find(s=>s.start===at&&(l.streamId===null||s.streamId===l.streamId));return h('td',null,s?teamLabel(s.teamIds[0]):'—');})))));
   const add=button(`Add ${placed} slots to draft`,()=>{
    doc.activities=doc.activities.filter(a=>!plan.replaced.includes(a));doc.activities.push(...plan.slots);windowOpen=true;changed();
    status.textContent=`Added ${placed} ${title.value.trim()} slots to the draft${plan.replaced.length?`, replacing ${plan.replaced.length} earlier ones`:''}.${plan.leftover.length?` ${plan.leftover.length} teams are still without a slot: ${plan.leftover.map(x=>teamLabel(x.teamId)).join(', ')}.`:''} Edit any appointment below, then Save draft.`;
   },'btn btn--primary');add.disabled=!placed;
   result.replaceChildren(h('div',{class:'stack'},summary,plan.outsideHours?h('p',{class:'notice schedule-warning'},'This window is outside the event day’s operating hours. Publication stays blocked until the hours or the window change.'):null,
    plan.replaced.length?h('p',{class:'small muted'},`Replaces ${plan.replaced.length} earlier ${title.value.trim()} slots.`):null,
    placed?h('p',{class:'small muted'},`Runs ${time(plan.slots[0].start,doc.timezone)}–${time(last!.end!,doc.timezone)}. Nothing changes until you add the slots to the draft.`):null,placed?grid:null,h('div',{class:'actions'},add)));
  // Planner and timezone errors are written for organisers; only server errors go through errorText.
  }catch(e){result.replaceChildren(h('p',{class:'notice schedule-error',role:'alert'},e instanceof Error&&e.constructor===Error?e.message:errorText(e)));}};
  const form=h('form',{class:'stack schedule-editor','aria-label':'Generate slots from a time window',onsubmit:(e:Event)=>{e.preventDefault();preview();}},
   h('p',{class:'notice small'},'Set when an area runs and how long each slot is. Every team gets one exact slot; streams run side by side, and nobody is booked in two places at once. Exempt teams are skipped for judging.'),
   h('div',{class:'form'},field('Area name',title),field('Activity',kind),field('Judging category',panel),field('Streams',stream),field('Teams at the same time',lanes),field('Date',date),field(`From (${doc.timezone})`,from),field(`To (${doc.timezone})`,to),field('Slot length (minutes)',duration),field('Changeover (minutes)',gap),field('Team order',order),field('Location',location)),
   h('label',null,replace,' Replace earlier slots for this area'),h('button',{type:'submit',class:'btn btn--primary'},'Preview slots'),result);
  sync();
  const box=h('details',{open:windowOpen},h('summary',null,'Generate slots from a time window'),form);box.addEventListener('toggle',()=>{windowOpen=box.open;});return box;
 }
 function renderTimeline(){
  const wrapper=h('div',{class:'stack stack--lg'}),source=previewPublished?state.published??doc:doc;
  const filterDay=h('select',{'aria-label':'Schedule day'},h('option',{value:''},'All days'),source.days.map(d=>h('option',{value:d.date},d.date)));
  const stream=h('select',{'aria-label':'Filter schedule by stream'},h('option',{value:''},'All streams'),source.streams.map(s=>h('option',{value:s.id},s.name)));
  const team=h('select',{'aria-label':'Filter schedule by team'},h('option',{value:''},'All teams'),teamOptions());
  const kind=h('select',{'aria-label':'Filter activity type'},h('option',{value:''},'All activities'),Object.entries(kinds).map(([id,label])=>h('option',{value:id},label)));
  const official=h('input',{type:'checkbox',checked:previewPublished,'aria-label':'Preview published schedule'});official.onchange=()=>{previewPublished=official.checked;render();};
  const list=h('div');const refresh=()=>{const shown=source.activities.filter(a=>(!filterDay.value||localScheduleTime(a.start,source.timezone).startsWith(filterDay.value))&&(!kind.value||a.kind===kind.value)&&(!stream.value||a.scope==='all'||a.streamId===stream.value||a.teamIds.some(id=>source.allocations.some(x=>x.teamId===id&&x.streamId===stream.value)))&&(!team.value||teamActivities(source,team.value).some(x=>x.id===a.id)));list.replaceChildren(timeline(source,shown,teams,canEdit&&!previewPublished?a=>{editId=a.id;render();root.querySelector('form[aria-label="Activity editor"]')?.scrollIntoView({behavior:'smooth',block:'start'});}:undefined,a=>{doc.activities=doc.activities.filter(x=>x.id!==a.id);changed();}));};
  for(const control of [filterDay,stream,team,kind])control.onchange=refresh;
  wrapper.append(h('label',null,official,' Preview official published version'),h('div',{class:'form'},field('Day',filterDay),field('Stream',stream),field('Team',team),field('Activity',kind)),h('p',{class:'muted small'},`Times shown in ${source.timezone}. ${previewPublished?'Published version — changes here require editing the draft.':'Draft preview — teams cannot see these changes.'}`),list);refresh();if(canEdit&&!previewPublished)wrapper.append(windowGenerator(),slotGenerator(),activityEditor());return wrapper;
 }
 function renderSetup(){
  const zone=input('text','Event timezone',doc.timezone);zone.required=true;
  const wrapper=h('div',{class:'stack'},h('form',{class:'form',onsubmit:(e:Event)=>{e.preventDefault();try{new Intl.DateTimeFormat('en',{timeZone:zone.value}).format();doc.timezone=zone.value;changed();}catch{status.textContent='Choose a valid timezone, such as Asia/Kolkata.';}}},field('Event timezone',zone),h('button',{class:'btn',type:'submit'},'Set timezone')),h('h2',null,'Event days and operating hours'));
  for(const d of doc.days)wrapper.append(h('div',{class:'row actions'},`${d.date} · ${d.opens}–${d.closes}`,canEdit?button('Remove day',()=>{doc.days=doc.days.filter(x=>x!==d);changed();}):null));
  const date=input('date','Event date',event?.startsOn??''),opens=input('time','Opening time','09:00'),closes=input('time','Closing time','17:00');date.required=opens.required=closes.required=true;
  wrapper.append(h('form',{class:'form',onsubmit:(e:Event)=>{e.preventDefault();if(opens.value>=closes.value){status.textContent='Closing time must follow opening time.';return;}doc.days=doc.days.filter(d=>d.date!==date.value);doc.days.push({date:date.value,opens:opens.value,closes:closes.value});doc.days.sort((a,b)=>a.date.localeCompare(b.date));changed();}},field('Event date',date),field('Opens',opens),field('Closes',closes),h('button',{class:'btn',type:'submit'},'Add or update event day')));
  wrapper.append(h('h2',null,'Rooms, judging panels and tracks'),...doc.resources.map(r=>h('div',{class:'row actions'},`${r.name} · ${r.kind}`,canEdit?button('Remove resource',()=>{doc.resources=doc.resources.filter(x=>x.id!==r.id);changed();}):null)));
  const name=input('text','Resource name'),kind=h('select',{'aria-label':'Resource type'},['track','room','panel','other'].map(k=>h('option',{value:k},k)));name.required=true;name.maxLength=150;
  wrapper.append(h('form',{class:'form',onsubmit:(e:Event)=>{e.preventDefault();doc.resources.push({id:crypto.randomUUID(),name:name.value.trim(),kind:kind.value as 'track'});changed();}},field('Name',name),field('Type',kind),h('button',{class:'btn',type:'submit'},'Add resource')));
  if(!canEdit)wrapper.querySelectorAll<HTMLInputElement>('input,select,button').forEach(x=>x.disabled=true);return wrapper;
 }
 function renderExemptions(){
  const wrapper=h('div',{class:'stack'},h('h2',null,'Team judging exemptions'),h('p',{class:'notice'},'These exclusions apply to judging activities, not racing or stream eligibility. Existing judge–team exclusions and declared conflicts remain separate. Changes validate the draft and reach teams only after publication.'),...doc.exemptions.map(x=>h('div',{class:'row stack'},h('strong',null,`${teams.find(t=>t.id===x.teamId)?.name??'Withdrawn team'} · ${x.panel==='all'?'All judging':PANEL_LABEL[x.panel]}`),h('p',null,x.reason),canEdit?button('Remove exemption',()=>{doc.exemptions=doc.exemptions.filter(e=>e!==x);changed();}):null)));
  if(state.judgeExemptions?.length)wrapper.append(h('details',null,h('summary',null,'Existing judge-specific exclusions'),h('p',{class:'muted small'},'These exclude a particular judge from a team. They do not exempt the team from judging sessions.'),h('ul',{class:'list'},state.judgeExemptions.map(x=>h('li',null,`${x.judgeName} · ${teams.find(t=>t.id===x.teamId)?.name??'Team'} · ${x.reason}`)))));
  if(canEdit){const team=h('select',{'aria-label':'Exempt team'},teamOptions()),panel=h('select',{'aria-label':'Exempt category'},h('option',{value:'all'},'All judging'),Object.entries(PANEL_LABEL).map(([p,l])=>h('option',{value:p},l))),reason=input('text','Exemption reason');reason.required=true;reason.minLength=3;reason.maxLength=500;
   wrapper.append(h('form',{class:'form',onsubmit:(e:Event)=>{e.preventDefault();doc.exemptions=doc.exemptions.filter(x=>x.teamId!==team.value||x.panel!==panel.value);doc.exemptions.push({teamId:team.value,panel:panel.value as Panel|'all',reason:reason.value.trim()});changed();status.textContent='Exemption preview updated. Review any affected appointments in validation.';}},field('Team',team),field('Category',panel),field('Reason',reason),h('button',{class:'btn',type:'submit'},'Set team exemption')));
  }return wrapper;
 }
 function render(){
  renderToolbar();tabs.replaceChildren(...['streams','timeline','setup','exemptions','history'].map(key=>h('button',{type:'button',class:'btn btn--ghost','aria-pressed':String(selected===key),onclick:()=>{selected=key;editId=null;render();}},({streams:'Streams',timeline:'Master schedule',setup:'Event setup',exemptions:'Judging exemptions',history:'Change history'}[key]))));
  const local=validateSchedule(doc,teams);issues.replaceChildren(h('details',{},h('summary',null,`Validation · ${local.filter(i=>i.severity==='error').length} blocking errors · ${local.filter(i=>i.severity==='warning').length} warnings`),h('ul',{class:'list'},local.map(i=>h('li',{class:i.severity==='error'?'schedule-error':'schedule-warning'},`${i.severity==='error'?'Blocking':'Warning'}: ${i.message}`)))));
  body.replaceChildren(selected==='streams'?renderStreams():selected==='timeline'?renderTimeline():selected==='setup'?renderSetup():selected==='exemptions'?renderExemptions():h('section',{class:'stack'},h('h2',null,'Saved schedule history'),h('p',{class:'muted'},'Every saved draft and publication records the acting account and time in the event audit trail.'),h('ul',{class:'list'},state.history.map(his=>h('li',null,`Revision ${his.revision} · ${his.action} · ${his.actor??'Event staff'} · ${new Date(his.at).toLocaleString()}`)))));
 }
 render();ctx.onLeave(()=>{busy=true;});return root;
}
