import type {DrawLotsState,JudgeLotAssignment,Panel,TeamNumberAssignment} from '../api';
import {drawJudgeLots,drawTeamNumbers,DrawError} from '../draws/random';
import {reportActionError} from './actions';
import {notFound} from './common';
import type {Ctx} from './ctx';
import {h} from './dom';
import {PANEL_LABEL} from './labels';
import {routeHref} from './router';

export async function drawLotsScreen(ctx:Ctx,eventId:string):Promise<HTMLElement>{
 const [event,roles]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.myRoles(eventId)]);
 if(!event)return notFound('That event was not found.');
 if(!roles.some(r=>r.role==='organiser'||r.role==='chair'))return notFound('Only the organiser or chair can draw lots.',routeHref({name:'event',eventId}),event.name);
 let state:DrawLotsState=await ctx.api.drawLotsState(eventId),alive=true,busy=false;
 ctx.onLeave(()=>{alive=false;});
 const panels=[...new Set(event.ruleset.areas.filter(a=>a.kind==='scorecard'&&a.panel).map(a=>a.panel as Panel))];
 let panel=panels[0],numberPreview:{version:string;rows:TeamNumberAssignment[]}|null=null;
 let judgePreview:{version:string;panel:Panel;rows:JudgeLotAssignment[]}|null=null;
 let selectedJudges=new Set<string>();
 const candidates=()=>[...new Map(state.roles.filter(r=>r.role==='judge'&&r.panel===panel).map(r=>[r.userId,r])).values()];
 const selectDefaultJudges=()=>{selectedJudges=new Set(candidates().map(r=>r.userId));};selectDefaultJudges();
 const error=h('p',{class:'alert',role:'alert',hidden:true}),status=h('p',{class:'notice',role:'status',hidden:true}),body=h('div',{class:'stack stack--lg'});
 const fail=(e:unknown)=>{if(!alive)return;if(e instanceof DrawError){error.textContent=e.message;error.hidden=false;}else reportActionError(ctx,error,e,{conflict:'Teams, assignments or conflicts changed after this preview. Refresh draw data and preview again.',locked:'This draw is locked because judging, racing or results have already progressed. Refresh draw data to see the current state.'});};
 const fresh=async()=>{state=await ctx.api.drawLotsState(eventId);numberPreview=null;judgePreview=null;selectDefaultJudges();};
 const run=async(work:()=>Promise<void>)=>{
  if(busy)return;busy=true;error.hidden=true;status.hidden=true;body.querySelectorAll('button,input,select').forEach(b=>(b as HTMLInputElement).disabled=true);
  try{await work();}catch(e){fail(e);}finally{busy=false;if(alive)render();}
 };
 const teamLabel=(id:string)=>{const t=state.teams.find(t=>t.id===id);return t?`Team ${t.number} · ${t.name}`:'Removed team';};
 function render(){
  const numberButton=h('button',{class:'btn btn--ghost',type:'button',disabled:state.numberingLocked||!state.teams.length},numberPreview?'Redraw team numbers':'Preview number draw');
  numberButton.onclick=()=>{error.hidden=true;status.hidden=true;try{numberPreview={version:state.version,rows:drawTeamNumbers(state.teams,undefined,{reserveSupercharged:!ctx.demo})};render();}catch(e){fail(e);}};
  const applyNumbers=h('button',{class:'btn btn--primary',type:'button'},'Apply these team numbers');
  applyNumbers.onclick=()=>void run(async()=>{const preview=numberPreview!;await ctx.api.applyTeamNumberDraw(eventId,preview.version,preview.rows);await fresh();status.textContent='Team numbers applied.';status.hidden=false;});
  const numberRows=numberPreview?numberPreview.rows.map(row=>{const team=state.teams.find(t=>t.id===row.teamId)!;return h('tr',null,h('td',null,team.name),h('td',null,team.number),h('td',null,row.number));}):[];
  const panelSelect=h('select',{'aria-label':'Panel for judge draw'},panels.map(p=>h('option',{value:p},PANEL_LABEL[p])));panelSelect.value=panel;
  panelSelect.onchange=()=>{panel=panelSelect.value as Panel;judgePreview=null;selectDefaultJudges();render();};
  const locked=state.released||state.lockedPanels.includes(panel);
  const judgeChoices=h('fieldset',{class:'stack'},h('legend',null,'Judges taking part'),candidates().map(r=>{
   const input=h('input',{type:'checkbox',value:r.userId,checked:selectedJudges.has(r.userId),disabled:locked});
   input.onchange=()=>{if(input.checked)selectedJudges.add(r.userId);else selectedJudges.delete(r.userId);judgePreview=null;render();};
   return h('label',null,input,' ',r.name||r.email||'Judge');
  }));
  const drawJudges=h('button',{class:'btn btn--ghost',type:'button',disabled:locked||!state.teams.length||!candidates().length},judgePreview?'Redraw judging lots':'Preview judge draw');
  drawJudges.onclick=()=>{error.hidden=true;status.hidden=true;try{judgePreview={version:state.version,panel,rows:drawJudgeLots(state,panel,[...selectedJudges])};render();}catch(e){fail(e);}};
  const applyJudges=h('button',{class:'btn btn--primary',type:'button'},'Apply these judge assignments');
  applyJudges.onclick=()=>void run(async()=>{const preview=judgePreview!;await ctx.api.applyJudgeDraw(eventId,preview.version,preview.panel,preview.rows);await fresh();status.textContent='Judge assignments applied. Judges will see their updated teams in My scorecards.';status.hidden=false;});
  const refresh=h('button',{class:'btn btn--ghost',type:'button'},'Refresh draw data');refresh.onclick=()=>void run(fresh);
  body.replaceChildren(
   h('div',{class:'actions'},refresh),
   h('section',{class:'section stack'},h('h2',null,'Random team numbers'),h('p',{class:'muted'},ctx.demo?'Draw unique numbers from 001 upwards. Every team takes part in the random draw. Review the complete list before applying.':'Draw unique numbers from 001 upwards. SUPERCHARGED stays 001. Review the complete list before applying.'),
    state.numberingLocked?h('p',{class:'notice'},'Team-number draws are for event setup. This event already has scorecards, inspections, races, published rankings or released results.'):null,
    numberButton,numberPreview?h('div',{class:'stack'},h('p',{class:'notice'},'Preview only. Current team numbers have not changed.'),h('div',{class:'table-wrap'},h('table',{class:'table'},h('thead',null,h('tr',null,['Team','Current number','Drawn number'].map(s=>h('th',null,s)))),h('tbody',null,numberRows))),applyNumbers):null),
   h('section',{class:'section stack'},h('h2',null,'Random judging lots'),h('p',{class:'muted'},'Split all teams as evenly as possible between selected judges on one panel. Conflicts and exemptions are excluded. Only the selected judges’ assignments on this panel will be replaced.'),
    h('label',{class:'field'},h('span',{class:'field__label'},'Judging panel'),panelSelect),
    locked?h('p',{class:'notice'},'This panel has scorecards or inspections, or the event has released results. Random assignments are available before judging starts.'):null,
    candidates().length?judgeChoices:h('p',{class:'notice'},'No judges have joined this panel yet. Invite them from People and wait for them to accept.'),drawJudges,
    judgePreview?h('div',{class:'stack'},h('p',{class:'notice'},'Preview only. No assignments have changed.'),h('div',{class:'grid'},judgePreview.rows.map(row=>{
     const judge=state.roles.find(r=>r.userId===row.judgeId&&r.role==='judge'&&r.panel===panel)!;
     return h('article',{class:'card stack'},h('h3',null,judge.name||judge.email||'Judge'),h('p',null,`${row.teamIds.length} team${row.teamIds.length===1?'':'s'}`),h('ol',null,row.teamIds.map(id=>h('li',null,teamLabel(id)))));
    })),applyJudges):null),
  );
 }
 render();
 return h('div',{class:'stack stack--lg'},h('div',{class:'stack'},h('a',{class:'back',href:routeHref({name:'event',eventId})},event.name),h('h1',null,'Draw lots'),h('p',{class:'lead'},'Preview a random draw, then apply the version you reviewed. No invitations or emails are sent.')),error,status,body);
}
