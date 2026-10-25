import type {EventRow,RoleRow,SubmissionState} from '../api';
import {FILE_KINDS} from '../api';
import type {Ctx} from './ctx';
import {h} from './dom';
import {routeHref,type Route} from './router';
export const managerOnly=(roles:RoleRow[])=>roles.length>0&&roles.every(r=>r.role==='team_manager');
export const garageDate=(iso:string)=>new Date(iso).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})+' IST';
export function garageHeader(kicker:string,title:string,copy:string) {
 return h('header',{class:'garage-page-head'},h('p',{class:'eyebrow'},kicker),h('h1',null,title),h('p',{class:'lead'},copy));
}
export function submissionProgress(state:SubmissionState) {
 const done=state.rows.filter(r=>r.submittedAt).length,total=state.rows.length;
 return h('section',{class:'garage-progress','aria-label':'Portfolio submission progress'},
  h('div',{class:'garage-progress__head'},h('div',null,h('p',{class:'eyebrow'},'Portfolio readiness'),h('strong',null,`${done} / ${total}`,h('span',null,' portfolios submitted'))),h('span',{class:'garage-status'},total>0&&done===total?'All portfolios received':'Your next milestone')),
  h('progress',{max:Math.max(total,1),value:done,'aria-label':`${done} of ${total} portfolios submitted`}),
  h('p',{class:'muted small'},total>0&&done===total?'Your files are safely submitted. You can still replace a portfolio before results are released.':'Upload each PDF to complete your team’s submission checklist.'));
}
export async function teamGarage(ctx:Ctx,event:EventRow,roles:RoleRow[]):Promise<HTMLElement> {
 const teams=(await ctx.api.listTeams(event.id)).filter(t=>roles.some(r=>r.teamId===t.id));
 let state:SubmissionState|null=null;
 try{state=await ctx.api.submissionState(event.id);}catch{/* Keep navigation available when submission status cannot be loaded. */}
 const href=(name:Route['name'])=>routeHref({name,eventId:event.id} as Route);
 const outstanding=state?.rows.filter(r=>!r.submittedAt&&r.deadline).sort((a,b)=>Date.parse(a.deadline!)-Date.parse(b.deadline!))??[];
 const next=outstanding[0],penalty=state?.rows.reduce((sum,r)=>sum+r.points,0)??0;
 const primary=teams[0];
 const hero=h('section',{class:'garage-hero'},
  h('div',{class:'garage-hero__copy'},h('p',{class:'garage-kicker'},'STEM Racing India / Team garage'),h('h1',null,primary?.name??'Your team garage'),h('p',{class:'garage-school'},primary?.school||'Ready for your next milestone.'),h('p',{class:'garage-event'},event.name,event.startsOn?` · ${new Date(event.startsOn+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}`:''),h('a',{class:'btn garage-hero__action',href:href('submissions')},event.resultsReleased?'View submissions ↗':'Submit your portfolios ↗')),
  h('div',{class:'garage-bib','aria-label':primary?`Team number ${primary.number}`:'Team garage'},h('span',null,'TEAM'),h('strong',null,primary?.number??'—'),h('span',null,event.resultsReleased?'RESULTS RELEASED':'COMPETITION ENTRY')));
 const metric=(label:string,value:string,note:string)=>h('article',{class:'garage-metric'},h('p',{class:'eyebrow'},label),h('strong',null,value),h('p',{class:'small muted'},note));
 const metrics=h('div',{class:'garage-metrics'},
  metric(next&&Date.parse(next.deadline!)<Date.now()?'Overdue portfolio':'Next deadline',next?garageDate(next.deadline!):'No upcoming deadline',next?FILE_KINDS[next.kind]:outstanding.length?'Check your submissions':'All times in India Standard Time'),
  metric('Submission penalties',state?`${penalty} pts`:'Unavailable','Calculated automatically from your portfolio receipts'),
  metric('Competition status',event.resultsReleased?'Results released':'In progress',event.resultsReleased?'Your team results are ready to view':'Results appear here when the organisers release them'));
 const tile=(number:string,title:string,body:string,page:Route['name'])=>h('a',{class:'tile garage-link',href:href(page)},h('span',{class:'garage-link__number','aria-hidden':'true'},number),h('div',null,h('h3',null,title),h('p',{class:'muted'},body)),h('span',{class:'garage-link__arrow','aria-hidden':'true'},'↗'));
 return h('div',{class:'garage stack stack--lg'},h('a',{class:'back',href:'#/'},'All events'),hero,
  teams.length>1?h('p',{class:'notice'},`You manage ${teams.length} teams: ${teams.map(t=>`${t.number} · ${t.name}`).join(', ')}. Progress below covers all your teams.`):null,
  metrics,state?submissionProgress(state):h('p',{class:'notice'},'Submission progress could not be loaded. Open Submissions to try again.'),
  h('section',{class:'stack'},h('div',{class:'garage-section-head'},h('h2',null,'Your competition toolkit'),h('p',{class:'muted small'},'Everything your team needs, in one place.')),
   h('div',{class:'garage-links'},tile('01','Submissions','Portfolios, deadlines and email confirmations.','submissions'),tile('02','Team files','Your team artwork and submitted documents.','team-files'),tile('03','Team feedback','Raise a concern and follow organiser responses.','team-feedback'),tile('04','Results',event.resultsReleased?'Explore your scores and judging feedback.':'Your team’s results will appear after release.','results'),event.resultsReleased?tile('05','Scores','Explore the released scores.','scores'):null,event.resultsReleased?tile('06','Race control','Review the event’s race records.','racing'):null)));
}
