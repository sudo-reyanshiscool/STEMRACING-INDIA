import type {Ctx} from './ctx';
import {FILE_KINDS,type SubmissionRule} from '../api';
import {h} from './dom';
import {errorText,notFound} from './common';
import {teamFilesScreen} from './team-files';
const when=(value:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'Not set';
const localInput=(value:string|null)=>value?new Date(Date.parse(value)+330*60000).toISOString().slice(0,16):'';
export async function submissionsScreen(ctx:Ctx,eventId:string):Promise<HTMLElement> {
 const [roles,event]=await Promise.all([ctx.api.myRoles(eventId),ctx.api.getEvent(eventId)]);
 const staff=roles.some(r=>r.role==='organiser'||r.role==='chair');
 if(!event||!roles.some(r=>['organiser','chair','spectator','team_manager'].includes(r.role)))return notFound('Submissions are available to teams and event organisers.');
 const [state,teams]=await Promise.all([ctx.api.submissionState(eventId),ctx.api.listTeams(eventId)]);
 const root=h('div',{class:'stack stack--lg'},h('h1',null,'Submissions'),h('p',{class:'lead'},'Submit your portfolios and track deadlines, receipts and automatic late penalties.'));
 const status=h('p',{role:'status','aria-live':'polite'});root.append(status);
 root.append(h('p',{class:'notice'},'Deadlines use India Standard Time (IST). Each started late hour counts. The first successful upload stops the clock; replacement uploads keep that original receipt. Missing portfolios continue accruing penalties until submitted. Published results lock submissions.'));
 if(staff&&!event.resultsReleased) {
  const fields=state.rules.map(rule=>({rule,deadline:h('input',{type:'datetime-local',value:localInput(rule.deadline),'aria-label':`${FILE_KINDS[rule.kind]} deadline`}),rate:h('input',{type:'number',min:0,max:1000,step:0.1,value:rule.pointsPerHour,required:true,'aria-label':`${FILE_KINDS[rule.kind]} points per hour`})}));
  const save=h('button',{class:'btn btn--primary',type:'submit'},'Save submission deadlines');
  const form=h('form',{class:'stack',onsubmit:async(e:Event)=>{e.preventDefault();save.disabled=true;try {
   const rules:SubmissionRule[]=fields.map(f=>({kind:f.rule.kind,deadline:f.deadline.value?new Date(f.deadline.value+':00+05:30').toISOString():null,pointsPerHour:Number(f.rate.value)}));
   await ctx.api.saveSubmissionRules(eventId,state.revision,rules);ctx.rerender();
  }catch(err){status.textContent=errorText(err);}finally{save.disabled=false;}}},fields.map(f=>h('fieldset',{class:'stack'},h('legend',null,FILE_KINDS[f.rule.kind]),h('label',{class:'field'},'Deadline (IST; blank disables penalties)',f.deadline),h('label',{class:'field'},'Penalty points per started hour',f.rate))),save);
  root.append(h('details',null,h('summary',null,'Submission deadlines and penalties'),form));
 }
 root.append(await teamFilesScreen(ctx,eventId,true));
 const labels={not_open:'Deadline not set',pending:'Awaiting submission',overdue:'Overdue · not submitted',on_time:'Submitted on time',late:'Submitted late'};
 const team=h('select',{'aria-label':'Filter submissions by team'},h('option',{value:''},'All available teams'),teams.filter(t=>state.rows.some(r=>r.teamId===t.id)).map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`)));
 const list=h('div',{class:'stack'});
 const render=()=>list.replaceChildren(...state.rows.filter(r=>!team.value||r.teamId===team.value).map(row=>{
  const t=teams.find(t=>t.id===row.teamId),rule=state.rules.find(r=>r.kind===row.kind)!;
  const mailLabels={pending:'Not sent yet',sending:'Sending',sent:'Sent',failed:'Failed — your portfolio is saved',uncertain:'Unconfirmed — check your inbox',unavailable:'Unavailable — no recipient email'};
  const retry=h('button',{type:'button',class:'btn btn--ghost',onclick:async()=>{retry.disabled=true;try{await ctx.api.sendSubmissionConfirmation(eventId,row.teamId,row.kind,row.revision!);ctx.rerender();}catch(err){status.textContent=errorText(err);}finally{retry.disabled=false;}}},'Retry confirmation email');
  return h('article',{class:'row stack'},h('h3',null,`${t?.number} · ${t?.name} · ${FILE_KINDS[row.kind]}`),h('strong',null,labels[row.status]),h('p',null,`Deadline: ${when(row.deadline)}`),row.submittedAt?h('p',null,`First submitted: ${when(row.submittedAt)}`):null,h('p',null,`Late penalty: ${row.points} points · ${rule.pointsPerHour} points/hour`),row.confirmation?h('p',null,`Confirmation email: ${mailLabels[row.confirmation]}`):null,roles.some(r=>r.role!=='spectator')&&row.revision&&['pending','failed'].includes(row.confirmation??'')?retry:null);
 }));team.onchange=render;render();root.append(h('h2',null,'Submission status'),h('label',{class:'field'},'Team',team),list);
 const refresh=h('button',{type:'button',class:'btn btn--ghost',onclick:()=>ctx.rerender()},'Refresh submission status');root.append(refresh);
 return root;
}
