import type {JudgeExemption,RoleRow,TeamRow} from '../api';
import {h} from './dom';
export function judgeExemptionEditor(roles:RoleRow[],teams:TeamRow[],exemptions:JudgeExemption[],save:(user:string,team:string,exempt:boolean,reason:string)=>void):HTMLElement {
 const people=[...new Map(roles.map(r=>[r.userId,r])).values()].sort((a,b)=>(a.email??'').localeCompare(b.email??''));
 const person=h('select',{name:'exemption-person',required:true},h('option',{value:''},'Choose a person'),people.map(r=>h('option',{value:r.userId},r.email??'Event member')));
 const team=h('select',{name:'exemption-team',required:true},h('option',{value:''},'Choose a team'),teams.map(t=>h('option',{value:t.id},`Team ${t.number} · ${t.name}`)));
 const reason=h('input',{name:'exemption-reason',maxlength:1000,type:'text'});
 const error=h('p',{class:'alert',role:'alert',hidden:true});
 const form=h('form',{class:'stack','aria-label':'Judge exemptions',novalidate:true},h('div',{class:'form'},
   h('label',{class:'field'},h('span',{class:'field__label'},'Person'),person),
   h('label',{class:'field'},h('span',{class:'field__label'},'Team'),team),
   h('label',{class:'field'},h('span',{class:'field__label'},'Reason (optional)'),reason)),error,
   h('button',{class:'btn btn--ghost',type:'submit'},'Exempt judge from team'));
 form.addEventListener('submit',e=>{e.preventDefault();error.hidden=true;if(!person.value||!team.value){error.textContent='Choose an event member and team.';error.hidden=false;return;}save(person.value,team.value,true,reason.value);});
 const who=(id:string)=>people.find(p=>p.userId===id)?.email??'Event member';
 const teamName=(id:string)=>{const t=teams.find(t=>t.id===id);return t?`Team ${t.number} · ${t.name}`:'Removed team';};
 return h('div',{class:'stack'},h('h2',null,'Judge exemptions'),
  h('p',{class:'muted'},'Exempt a judge from a team across every panel, including an “All teams” assignment. Their other teams stay assigned. Remove the exemption to allow judging again.'),
  h('p',{class:'small muted'},'If they have submitted a scorecard for the team, the Chair must reopen it before adding an exemption.'),form,
  exemptions.length?h('ul',{class:'list'},exemptions.map(x=>h('li',null,h('strong',null,who(x.judgeId)),h('span',{class:'small'},teamName(x.teamId)),x.reason?h('p',{class:'small muted'},x.reason):null,
    h('button',{class:'btn btn--ghost btn--small',type:'button','aria-label':`Remove exemption for ${who(x.judgeId)} from ${teamName(x.teamId)}`,onclick:()=>save(x.judgeId,x.teamId,false,'')},'Remove exemption')))):h('p',{class:'muted'},'No judge exemptions.'));
}
