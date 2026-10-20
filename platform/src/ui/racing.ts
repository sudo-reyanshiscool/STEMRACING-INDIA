import { competitionPanel } from './racing-competition';
import { defaultRacingSetup, adjustedTime, carCheck } from '../racing/competition';
import { blankLane, outcome, parseDenford, parseSeconds, raceRecorded, raceStandings, seconds, STATUS_LABEL, validateRace, type RaceHeat, type RaceInput, type RaceLane, type RaceStatus, type TimingState } from '../racing';
import { reportActionError } from './actions';
import { notFound, tag } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { liveRefresh } from './live-refresh';

export async function racingScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, teams] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.listTeams(eventId)]);
  if (!event || !roles.length || (roles.every(r => r.role === 'team_manager') && !event.resultsReleased)) return notFound('Race control is not available to this account.');
  const canEdit = !event.resultsReleased && roles.some(r => ['organiser','chair','race_official'].includes(r.role));
  let races = await ctx.api.listRaces(eventId), selected: RaceHeat | null = null, dirty = false, alive = true;
  const staff = roles.some(r=>r.role!=='team_manager');
  let [setup, inspections] = await Promise.all([staff?ctx.api.getRacingSetup(eventId):Promise.resolve(defaultRacingSetup()),staff?ctx.api.listInspections(eventId):Promise.resolve([])]);
  let captureNeedsFinish = false;
  let source: RaceInput['source'] = 'manual', sourceRunId: string | null = null;
  let timing: TimingState | null = null, armed: { heat: string; connection: string; baseline: string } | null = null;
  let applyCapture: ((payload: NonNullable<ReturnType<typeof parseDenford>>) => void) | null = null;
  ctx.onLeave(() => { alive = false; armed = null; });
  const error = h('p', { class:'alert', role:'alert', hidden:true });
  const status = h('p', { class:'small muted', role:'status' });
  const counters = h('div', { class:'race-metrics' });
  const queue = h('div', { class:'race-queue stack' });
  const editor = h('section', { class:'race-console stack', 'aria-label':'Selected race' });
  const board = h('div', { class:'table-wrap' });
  const trackStatus = h('span', { class:'tag tag--todo' }, 'Not connected');
  const trackHelp = h('p', { class:'small muted' }, 'Connect the track laptop by Wi-Fi or Ethernet. Use the exact track IP address and keep internet access available for shared capture.');
  const capture = h('button', { class:'btn btn--ghost', type:'button', disabled:true }, 'Capture next track run');
  const teamName = (id: string) => { const t = teams.find(t => t.id === id); return t ? `#${t.number} ${t.name}` : 'Unavailable team'; };
  const table = (head: string[], rows: HTMLElement[]) => h('table', { class:'table' }, h('thead',null,h('tr',null,head.map(x => h('th',{scope:'col'},x)))),h('tbody',null,rows));
  const fail = (e: unknown) => reportActionError(ctx,error,e,{invalid:'Check the lane values and correction reason. Finished runs need total and reaction times; other statuses must have no times.',duplicate:'That track run has already been saved. Select its existing race record.'});
  const teamSelect = (value = '') => h('select',{},h('option',{value:''},'Select team'),teams.map(t => h('option',{value:t.id},`#${t.number} · ${t.name}`)));
  const field = (label: string, control: HTMLElement) => h('label',{class:'field'},h('span',{class:'field__label'},label),control);
  const changed = () => { dirty = true; armed = null; status.textContent = 'Unsaved changes'; updateTrack(); };
  const renderBoard = () => {
    counters.replaceChildren(...[['Recorded heats',races.filter(raceRecorded).length],['Queued heats',races.filter(r => !raceRecorded(r)).length],['Teams entered',teams.length]].map(([label,value]) => h('div',null,h('strong',null,value),h('span',null,label))));
    queue.replaceChildren(h('h2',null,'Race queue'),...(races.length ? races.map(r => h('button',{type:'button',class:'race-queue-item', 'aria-pressed':selected?.id===r.id, onclick:() => select(r)},
      h('span',{class:'eyebrow'},`HEAT ${String(r.number).padStart(2,'0')} · ${r.phase === 'reaction' ? 'Reaction' : 'Knockout'}`),h('strong',null,r.label),h('span',{class:'small'},`${teamName(r.lane1.teamId)} / ${teamName(r.lane2.teamId)}`),h('span',{class:'small muted'},r.phase==='knockout'?'Knockout · see bracket outcome':outcome(r)))) : [h('p',{class:'muted'},'No heats yet. Add your first pairing below.')]));
    competition.render();
    const standings = raceStandings(races);
    let rank=0, previous:number|null=null;
    board.replaceChildren(table(['Position','Team','Runs','Best total','Best car'],standings.map((r,i) => { if(r.totalMs!==null && r.totalMs!==previous) rank=i+1; previous=r.totalMs; return h('tr',null,h('td',{class:'num'},r.totalMs===null?'—':rank),h('th',{scope:'row'},teamName(r.teamId)),h('td',{class:'num'},r.runs),h('td',{class:'num'},seconds(r.totalMs)),h('td',{class:'num'},seconds(r.carMs))); })));
  };
  function select(row: RaceHeat, force=false) {
    if (!force && dirty && !window.confirm('Discard the unsaved lane changes and open this heat?')) return;
    selected = row; dirty = false; armed = null; captureNeedsFinish = false; source = row.source; sourceRunId = row.sourceRunId; error.hidden = true;
    status.textContent = `Saved revision ${row.revision} · ${new Date(row.updatedAt).toLocaleTimeString()}`;
    const laneControls = (lane: RaceLane, n: number) => {
      const team = teamSelect(); team.value=lane.teamId;
      const car = h('select',{},['A','B'].map(c=>h('option',{value:c},`Car ${c}`)));car.value=lane.car;
      const result = h('select',{'aria-label':`Lane ${n} status`},Object.entries(STATUS_LABEL).map(([key,label])=>h('option',{value:key},label))); result.value=lane.status;
      const total=h('input',{type:'text',inputmode:'decimal',placeholder:'0.000','aria-label':`Lane ${n} total time`,value:lane.totalMs===null?'':seconds(lane.totalMs),autocomplete:'off'});
      const reaction=h('input',{type:'text',inputmode:'decimal',placeholder:'0.000','aria-label':`Lane ${n} reaction time`,value:lane.reactionMs===null?'':seconds(lane.reactionMs),autocomplete:'off'});
      const carTime=h('p',{class:'race-car-time'});
      const update = () => { const t=parseSeconds(total.value),rt=parseSeconds(reaction.value); carTime.textContent=`Car time ${t!==null && rt!==null && t>rt?seconds(t-rt)+' s':'—'}`; };
      for(const input of [total,reaction]) input.addEventListener('input',()=>{if(total.value || reaction.value)result.value='finished';update();changed();});
      result.addEventListener('change',()=>{if(result.value!=='finished'){total.value='';reaction.value='';}update();changed();});
      for(const input of [team,car])input.addEventListener('change',changed);
      const controls=[team,car,result,total,reaction];controls.forEach(c=>c.disabled=!canEdit || (row.phase==='reaction' && setup.reactionComplete));
      if(row.bracket)team.disabled=true;
      update();
      const node=h('fieldset',{class:`race-lane race-lane--${n}`},h('legend',null,`Lane ${n}`),field('Team',team),field('Car',car),field('Result',result),field('Total time · seconds',total),field('Reaction time · seconds',reaction),carTime);
      const value=():RaceLane=>({teamId:team.value,car:car.value as 'A'|'B',status:result.value as RaceStatus,totalMs:result.value==='finished'?parseSeconds(total.value):null,reactionMs:result.value==='finished'?parseSeconds(reaction.value):null});
      return {node,value,total,reaction,result,update};
    };
    const left=laneControls(row.lane1,1),right=laneControls(row.lane2,2);
    const label=h('input',{value:row.label,maxlength:100,disabled:!canEdit});label.addEventListener('input',changed);
    const note=h('textarea',{rows:2,maxlength:1000,disabled:!canEdit,'aria-label':'Race notes or correction reason',placeholder:raceRecorded(row)?'Explain the correction before saving.':'Optional official notes'});note.addEventListener('input',changed);
    const save=h('button',{class:'btn',type:'submit',disabled:!canEdit||(row.phase==='reaction'&&setup.reactionComplete)},'Save race result');
    const reload=h('button',{class:'btn btn--ghost',type:'button',onclick:()=>{const fresh=races.find(r=>r.id===row.id);if(fresh)select(fresh);}},'Reload saved race');
    const preview=(r:RaceInput)=>{if(r.phase==='reaction')return outcome(r);const a=adjustedTime(r,r.lane1,inspections),b=adjustedTime(r,r.lane2,inspections);if([r.lane1,r.lane2].some(l=>!carCheck(inspections,l.teamId,l.car).ready))return 'Awaiting submitted inspection · adjusted totals pending';return `${outcome({...r,lane1:{...r.lane1,totalMs:a},lane2:{...r.lane2,totalMs:b}})} · adjusted totals ${seconds(a)} / ${seconds(b)} s${[r.lane1,r.lane2].some(l=>!carCheck(inspections,l.teamId,l.car).ready)?' · awaiting inspection':''}`;};
    const resultPreview=h('p',{class:'race-outcome',role:'status'},preview(row));
    const form=h('form',{class:'stack'},field('Heat label',label),h('div',{class:'race-lanes'},left.node,right.node),resultPreview,field(raceRecorded(row)?'Correction reason · required':'Official notes',note),h('div',{class:'actions'},save,reload));
    form.addEventListener('input',()=>{resultPreview.textContent=preview({...row,lane1:left.value(),lane2:right.value()});});
    applyCapture=(reading)=>{
      captureNeedsFinish=[reading.lane1,reading.lane2].some(l=>l.status==='reaction_only');
      for(const [control,lane] of [[left,reading.lane1],[right,reading.lane2]] as const){control.result.value=lane.status==='reaction_only'?'pending':lane.status;control.total.value=lane.totalMs===null?'':seconds(lane.totalMs);control.reaction.value=lane.reactionMs===null?'':seconds(lane.reactionMs);control.update();}
      source='denford';sourceRunId=`${timing!.connectionId}:${reading.raceId}`;changed();
      resultPreview.textContent=preview({...row,lane1:left.value(),lane2:right.value()});
      status.textContent=[reading.lane1,reading.lane2].some(l=>l.status==='reaction_only')?'Reaction-only gate mode: finish times are missing. Enter real total times before saving.':`Captured track run ${reading.raceId}. Review both lanes, then save.`;
    };
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(!canEdit || save.disabled)return;
      const input:RaceInput={bracket:row.bracket,label:label.value,phase:row.phase,lane1:left.value(),lane2:right.value(),note:note.value,source,sourceRunId};
      const issue=(captureNeedsFinish && (left.result.value==='pending'||right.result.value==='pending') ? 'The track supplied reaction times only. Enter real total times for those lanes before saving.' : null) ?? validateRace(input) ?? (raceRecorded(row)&&note.value.trim().length<5?'Explain the correction in at least 5 characters.':null);
      if(issue){error.textContent=issue;error.hidden=false;return;}
      save.disabled=true;
      try{const saved=await ctx.api.saveRace(eventId,row.id,row.revision,input);if(!alive)return;races=races.filter(r=>r.id!==saved.id);races.push(saved);races.sort((a,b)=>a.number-b.number);await refresh();select(saved,true);status.textContent='Race result saved and shared.';}catch(e){if(alive)fail(e);}finally{if(alive)save.disabled=!canEdit;}
    });
    editor.replaceChildren(h('div',{class:'race-console-heading'},h('div',null,h('p',{class:'eyebrow'},`${row.phase==='reaction'?'Reaction racing':'Knockout racing'} · HEAT ${String(row.number).padStart(2,'0')}`),h('h2',null,row.label)),tag(raceRecorded(row)?'Recorded':'Ready to race',raceRecorded(row)?'pass':'todo')),form);
    renderBoard();updateTrack();
  }
  const addForm=h('form',{class:'stack race-add'});
  if(canEdit){
    const a=teamSelect(),b=teamSelect();a.setAttribute('aria-label','New heat lane 1');b.setAttribute('aria-label','New heat lane 2');
    const phase=h('select',{'aria-label':'New heat phase'},h('option',{value:'reaction'},'Reaction racing'));
    const add=h('button',{class:'btn btn--ghost',type:'submit',disabled:teams.length<2},'Add pairing');
    addForm.append(h('h3',null,'New pairing'),field('Phase',phase),field('Lane 1',a),field('Lane 2',b),add);
    addForm.addEventListener('submit',async e=>{e.preventDefault();if(add.disabled)return;if(dirty&&!window.confirm('Discard the unsaved lane changes and create a new pairing?'))return;if(!a.value||!b.value||a.value===b.value){error.textContent='Choose two different teams for this heat.';error.hidden=false;return;}add.disabled=true;
      try{const row=await ctx.api.saveRace(eventId,crypto.randomUUID(),0,{label:`${phase.value==='reaction'?'Reaction':'Knockout'} · Heat ${Math.max(0,...races.map(r=>r.number))+1}`,phase:phase.value as RaceInput['phase'],lane1:blankLane(a.value),lane2:blankLane(b.value),note:'',source:'manual',sourceRunId:null});races.push(row);if(alive)select(row,true);}catch(e){if(alive)fail(e);}finally{if(alive)add.disabled=false;}
    });
  }
  const connectionMethod=h('select',{'aria-label':'Track connection method'},h('option',{value:'wifi'},'Track Wi-Fi'),h('option',{value:'ethernet'},'Ethernet'));
  const connectionHelp=h('p',{class:'small muted'},'Wi-Fi: join the track network. Its address is commonly http://10.0.0.1. Use a separate internet connection for cloud sync.');
  const gateUrl=h('input',{type:'url',placeholder:'http://10.0.0.1','aria-label':'Denford track address',required:true});
  connectionMethod.addEventListener('change',()=>{
    const wired=connectionMethod.value==='ethernet';
    gateUrl.placeholder=wired?'http://192.168.50.2':'http://10.0.0.1';
    connectionHelp.textContent=wired?'Ethernet: connect to the track’s wired network and enter its configured IP address. A direct cable may need static IP addresses on both the gate and laptop. Keep internet access available for cloud sync.':'Wi-Fi: join the track network. Its address is commonly http://10.0.0.1. Use a separate internet connection for cloud sync.';
  });
  const pair=h('button',{class:'btn btn--ghost',type:'button',disabled:!canEdit},'Pair track laptop');
  const pairingHelp=h('div',{class:'stack'});
  pair.addEventListener('click',async()=>{
    if(pair.disabled)return;
    if(timing && !window.confirm('Replace the current track pairing? The track laptop will need the new pairing file.'))return;
    if(!/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\/?$/.test(gateUrl.value)){error.textContent='Enter the exact track IP address, including http://.';error.hidden=false;gateUrl.focus();return;}
    pair.disabled=true;
    try{
      const connection=await ctx.api.pairTiming(eventId);
      const config={connectionMethod:connectionMethod.value,gateUrl:gateUrl.value,projectUrl:import.meta.env.VITE_SUPABASE_URL,anonKey:import.meta.env.VITE_SUPABASE_ANON_KEY,token:connection.token};
      const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
      const link=h('a',{class:'btn',href:url,download:'denford-connection.json'},'Download pairing file');
      ctx.onLeave(()=>URL.revokeObjectURL(url));
      pairingHelp.replaceChildren(h('p',{class:'small'},'Run the bridge on the laptop connected to this track. Keep the pairing file private. It expires in 8 hours; pairing again replaces it.'),link,h('a',{href:'/tools/denford-bridge.py',download:'denford-bridge.py'},'Get the Python bridge'),h('code',null,'python3 denford-bridge.py --config /path/to/denford-connection.json'));
      timing={connectionId:connection.connectionId,expiresAt:connection.expiresAt,lastSeenAt:null,payload:null};armed=null;updateTrack();
    }catch(e){fail(e);}finally{pair.disabled=!canEdit;}
  });
  function updateTrack(){
    const connected=!!timing?.lastSeenAt && Date.now()-Date.parse(timing.lastSeenAt)<15000 && Date.parse(timing.expiresAt)>Date.now();
    trackStatus.textContent=armed?'Waiting for next run':connected?'Connected':timing?'Waiting for bridge':'Not paired';
    trackStatus.className=`tag tag--${connected?'pass':'todo'}`;
    capture.disabled=!canEdit||!selected||dirty||!connected||!timing?.payload||armed!==null;
    if(connected)trackHelp.textContent='Live Denford measurements. Verify the selected heat and lane assignments before capturing.';
    if(armed && (!timing || armed.connection!==timing.connectionId)){armed=null;status.textContent='Track connection changed. Select the heat and capture again.';}
  }
  capture.addEventListener('click',()=>{
    if(capture.disabled||!selected||!timing?.payload)return;
    armed={heat:selected.id,connection:timing.connectionId,baseline:String(timing.payload.raceid??'0')};
    status.textContent='Waiting for a new track race ID. Existing readings will not be assigned to this heat.';updateTrack();
  });
  let polling=false;
  const pollTiming=async()=>{
    if(!alive||polling||document.visibilityState==='hidden')return;polling=true;
    try{const fresh=await ctx.api.getTiming(eventId);if(!alive)return;timing=fresh;
      if(armed && timing && armed.connection===timing.connectionId && selected?.id===armed.heat && timing.lastSeenAt && Date.now()-Date.parse(timing.lastSeenAt)<15000){const reading=parseDenford(timing.payload);if(reading && reading.raceId!==armed.baseline){const expected=BigInt(armed.baseline)+1n;armed=null;if(BigInt(reading.raceId)!==expected){status.textContent='The track skipped or reset race IDs. Verify the heat and capture again.';}else applyCapture?.(reading);}}
      updateTrack();
    }catch{if(alive){trackStatus.textContent='Connection unavailable';capture.disabled=true;}}finally{polling=false;}
  };
  const timer=setInterval(()=>void pollTiming(),2000);ctx.onLeave(()=>clearInterval(timer));void pollTiming();
  const refresh=async()=>{const [fresh,newSetup,newInspections]=await Promise.all([ctx.api.listRaces(eventId),staff?ctx.api.getRacingSetup(eventId):Promise.resolve(setup),staff?ctx.api.listInspections(eventId):Promise.resolve(inspections)]);if(!alive)return;const checksChanged=setup.version!==newSetup.version;races=fresh;setup=newSetup;inspections=newInspections;renderBoard();if(selected){const latest=races.find(r=>r.id===selected!.id);if(latest&&(latest.revision!==selected.revision||checksChanged)){if(dirty)status.textContent='This heat was changed on another device. Reload it before saving your changes.';else select(latest,true);}}};
  const competition=competitionPanel(ctx,eventId,()=>({teams,races,inspections,setup}),(row)=>{select(row);editor.scrollIntoView?.({behavior:'smooth',block:'start'});},refresh,fail,!event.resultsReleased&&roles.some(r=>['chair','organiser'].includes(r.role)),canEdit);
  liveRefresh(ctx,refresh,fail);
  renderBoard();
  const first=races.find(r=>!raceRecorded(r))??races.at(-1);
  if(first)select(first);else editor.append(h('p',{class:'eyebrow'},'Start line'),h('h2',null,'Set the first pairing.'),h('p',{class:'muted'},canEdit?'Choose the teams for both lanes, then add the heat to the queue.':'A race official will add the first pairing.'));
  return h('div',{class:'race-screen stack stack--lg'},h('header',{class:'race-heading'},h('div',null,h('p',{class:'eyebrow'},event.name),h('h1',null,'Race control'),h('p',{class:'lead'},'Two lanes. Every run recorded.')),trackStatus),counters,
    event.resultsReleased?h('p',{class:'notice'},'Results are released. Race records are read-only.'):!canEdit?h('p',{class:'notice'},'Viewing race records. Only organisers, the Chair and race officials can enter results.'):null,
    error,status,h('div',{class:'race-workspace'},h('aside',{class:'stack'},queue,canEdit?addForm:null),editor),staff?competition.root:null,
    h('section',{class:'section stack'},h('div',{class:'row__head'},h('h2',null,'Denford timing'),capture),trackHelp,canEdit?h('div',{class:'inline-form'},field('Connection method',connectionMethod),field('Exact track address',gateUrl),pair):null,canEdit?connectionHelp:null,pairingHelp),
    h('section',{class:'section stack'},h('h2',null,'Reaction racing standings'),h('p',{class:'muted small'},'Times in seconds. Best total and best car time are tracked independently. Confirmed racing points feed into overall rankings. Approve the top-64 seeds in Competition racing to start the bracket.'),board));
}
