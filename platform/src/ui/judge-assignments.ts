import type { Panel, RoleRow, TeamRow } from '../api';
import type { Ctx } from './ctx';
import { h } from './dom';
import { PANEL_LABEL } from './labels';

export function judgeAssignmentEditor(ctx: Ctx, eventId: string, roles: RoleRow[], teams: TeamRow[], save: (action: () => Promise<void>) => Promise<void>, refreshed: () => Promise<void>): HTMLElement {
  const people = [...new Map(roles.map(r=>[r.userId,r])).values()].sort((a,b)=>(a.name||a.email||'').localeCompare(b.name||b.email||''));
  const person = h('select', {name:'assignment-person',required:true}, h('option',{value:''},'Choose a person'), people.map(r=>h('option',{value:r.userId},r.name ? `${r.name} · ${r.email ?? ''}` : r.email??'Event member')));
  const panel = h('select', {name:'assignment-panel',required:true}, h('option',{value:''},'Choose a panel'), Object.entries(PANEL_LABEL).map(([p,label])=>h('option',{value:p},label)));
  const scope = h('select', {name:'assignment-scope',required:true}, h('option',{value:''},'Choose team scope'),h('option',{value:'all'},'All teams'),h('option',{value:'selected'},'Selected teams'));
  const boxes = teams.map(t=>({id:t.id,input:h('input',{type:'checkbox',value:t.id}),label:`Team ${t.number} · ${t.name}`}));
  const teamChoices = h('fieldset', {class:'assignment-teams',hidden:true},h('legend',null,'Assigned teams'),boxes.map(b=>h('label',{class:'nomination-option'},b.input,b.label)));
  const error=h('p',{class:'alert',role:'alert',hidden:true});
  const syncScope=()=>{teamChoices.hidden=scope.value!=='selected';};
  const loadScope=()=>{
    const current=roles.filter(r=>r.userId===person.value && r.role==='judge' && r.panel===panel.value);
    scope.value=current.some(r=>r.teamId===null)?'all':current.length?'selected':'';
    boxes.forEach(b=>{b.input.checked=current.some(r=>r.teamId===b.id);});syncScope();
  };
  person.addEventListener('change',loadScope);panel.addEventListener('change',loadScope);scope.addEventListener('change',syncScope);
  const form=h('form',{class:'stack',novalidate:true,'aria-label':'Judge assignments'},
    h('div',{class:'form'},
      h('label',{class:'field'},h('span',{class:'field__label'},'Person'),person),
      h('label',{class:'field'},h('span',{class:'field__label'},'Judging panel'),panel),
      h('label',{class:'field'},h('span',{class:'field__label'},'Team scope'),scope)),
    teamChoices,error,h('button',{class:'btn btn--primary',type:'submit'},'Save assignment'));
  form.addEventListener('submit',e=>{
    e.preventDefault();error.hidden=true;
    const teamIds=scope.value==='all'?null:boxes.filter(b=>b.input.checked).map(b=>b.id);
    const problem=!person.value?'Choose an event member.':!panel.value?'Choose a panel.':!scope.value?'Choose all teams or selected teams.':teamIds!==null&&!teamIds.length?'Select at least one team.':null;
    if(problem){error.textContent=problem;error.hidden=false;return;}
    const userId=person.value, chosen=panel.value as Panel;
    void save(async()=>{await ctx.api.setJudgeAssignment(eventId,userId,chosen,teamIds);await refreshed();});
  });
  return h('div',{class:'stack'},h('h2',null,'Judge assignments'),
    h('p',{class:'muted'},'One person can judge several panels and teams. Save each panel’s team scope separately. Changes apply immediately and keep their other assignments.'),
    h('p',{class:'small muted'},'Invite new people first. They appear here after accepting. An assignment to a specific team with a declared conflict is refused.'),form);
}
