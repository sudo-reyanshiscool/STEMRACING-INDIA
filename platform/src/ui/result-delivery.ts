import type {EventRow,ResultMailState,TeamRow} from '../api';
import type {Ctx} from './ctx';
import {h} from './dom';
import {reportActionError} from './actions';

export async function resultDelivery(ctx:Ctx,event:EventRow):Promise<HTMLElement> {
 let alive=true,busy=false,stop=false;
 ctx.onLeave(()=>{alive=false;stop=true;});
 let [teams,contacts,state]=await Promise.all([ctx.api.listTeams(event.id),ctx.api.listTeamContacts(event.id),ctx.api.resultMailState(event.id)]);
 teams.sort((a,b)=>a.number.localeCompare(b.number,'en',{numeric:true}));
 const root=h('section',{class:'section stack','aria-label':'Results PDFs and manager emails'});
 const message=h('p',{class:'notice',role:'status',hidden:true}),error=h('p',{class:'alert',role:'alert',hidden:true});
 const content=h('div',{class:'stack'});root.append(h('h2',null,'Results PDFs and manager emails'),message,error,content);
 const refresh=async()=>{[contacts,state]=await Promise.all([ctx.api.listTeamContacts(event.id),ctx.api.resultMailState(event.id)]);if(alive)draw();};
 const run=async(task:()=>Promise<void>)=>{
  if(busy)return;busy=true;error.hidden=true;message.hidden=true;
  content.querySelectorAll('button').forEach(b=>{if(!b.dataset.stop)b.disabled=true;});
  try{await task();}catch(e){if(alive)reportActionError(ctx,error,e,{locked:'The results or delivery status changed. Refresh this page and review the awards and manager contacts before trying again.'});}
  finally{busy=false;if(alive)await refresh().catch(e=>reportActionError(ctx,error,e));}
 };
 const who=(id:string)=>{const t=teams.find(t=>t.id===id);return t?`${t.number} - ${t.name}`:'Removed team';};
 const currentDelivery=(t:TeamRow)=>{const email=contacts.find(c=>c.teamId===t.id)?.managerEmail;return state.deliveries.find(d=>d.teamId===t.id && d.email===email);};
 function draw(){
  const awardTitle=h('input',{name:'awardTitle',required:true,maxlength:120,placeholder:'e.g. Best Team Identity'});
  const awardTeam=h('select',{name:'awardTeam',required:true},h('option',{value:''},'Choose winning team'),teams.map(t=>h('option',{value:t.id},`${t.number} - ${t.name}`)));
  const awardForm=h('form',{class:'form',novalidate:true,'aria-label':'Award winners'},
   h('label',{class:'field'},h('span',{class:'field__label'},'Award'),awardTitle),h('label',{class:'field'},h('span',{class:'field__label'},'Winning team'),awardTeam),h('button',{class:'btn btn--ghost',type:'submit'},'Save award winner'));
  awardForm.onsubmit=e=>{e.preventDefault();if(!awardTitle.value.trim()||!awardTeam.value){error.textContent='Enter an award title and choose its winning team.';error.hidden=false;return;}void run(()=>ctx.api.saveAward(event.id,awardTitle.value,awardTeam.value));};
  const confirmAwards=h('button',{class:'btn btn--primary',type:'button',disabled:state.confirmed},state.confirmed?'Awards confirmed':'Confirm award winners');
  confirmAwards.onclick=()=>void run(()=>ctx.api.confirmAwards(event.id));
  const previewTeam=h('select',{'aria-label':'Team PDF preview'},h('option',{value:''},'Choose a team'),teams.map(t=>h('option',{value:t.id},`${t.number} - ${t.name}`)));
  const previewButton=h('button',{class:'btn btn--ghost',type:'button',disabled:!state.snapshotId},'Download PDF previews');
  previewButton.onclick=()=>void run(async()=>{
   if(!previewTeam.value){error.textContent='Choose a team for the scorecard preview.';error.hidden=false;return;}
   const packet=await ctx.api.previewResultsPacket(event.id,previewTeam.value);
   const [{resultPdfFiles},{RESULTS_LOGO}]=await Promise.all([import('../pdf/resultReports'),import('../../supabase/functions/_shared/results-logo')]);
   for(const file of resultPdfFiles(packet,RESULTS_LOGO)){
    const blob=new Blob([file.bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  });
  const eligible=teams.filter(t=>contacts.some(c=>c.teamId===t.id) && !['sent','sending','uncertain'].includes(currentDelivery(t)?.status??''));
  const uncertain=teams.filter(t=>currentDelivery(t)?.status==='uncertain');
  const retryControls=h('div',{class:'stack'},uncertain.map(t=>{
   const button=h('button',{class:'btn btn--ghost',type:'button'},`Review unconfirmed delivery for ${t.number}`);
   const confirm=h('button',{class:'btn btn--ghost',type:'button',hidden:true},'I checked the recipient inbox - allow a retry');
   const warning=h('p',{class:'notice',hidden:true},'The provider may already have delivered this email. Check with the recipient before enabling a retry to avoid a duplicate.');
   button.onclick=()=>{confirm.hidden=false;warning.hidden=false;};
   confirm.onclick=()=>void run(()=>ctx.api.acknowledgeResultRetry(event.id,t.id,{snapshotId:state.snapshotId!,awardsVersion:state.version!,email:contacts.find(c=>c.teamId===t.id)!.managerEmail}));
   return h('div',{class:'stack'},button,warning,confirm);
  }));
  const missing=teams.filter(t=>!contacts.some(c=>c.teamId===t.id)).length;
  const sent=teams.filter(t=>currentDelivery(t)?.status==='sent').length;
  const send=h('button',{class:'btn btn--primary',type:'button',disabled:!event.resultsReleased||!state.confirmed||!state.snapshotId||!eligible.length},'Email results to managers');
  const review=h('div',{class:'notice stack',hidden:true});
  const confirm=h('button',{class:'btn btn--primary',type:'button'},`Send ${eligible.length} results email${eligible.length===1?'':'s'}`);
  const cancel=h('button',{class:'btn btn--ghost',type:'button'},'Cancel');cancel.onclick=()=>{review.hidden=true;};
  const stopButton=h('button',{class:'btn btn--ghost',type:'button','data-stop':'true',hidden:true},'Stop after current email');stopButton.onclick=()=>{stop=true;stopButton.disabled=true;};
  send.onclick=()=>{review.hidden=false;};
  review.append(h('p',null,'Each manager receives the full final standings and confirmed awards, plus separate results and feedback PDFs for their own team.'),h('ul',null,eligible.map(t=>h('li',null,`${who(t.id)} → ${contacts.find(c=>c.teamId===t.id)!.managerEmail}`))),h('div',{class:'actions'},confirm,cancel));
  confirm.onclick=()=>void run(async()=>{
   stop=false;stopButton.hidden=false;review.hidden=true;let completed=0;
   for(const team of eligible){
    if(stop||!alive)break;
    message.textContent=`Sending results: ${completed} of ${eligible.length} processed…`;message.hidden=false;
    await ctx.api.sendTeamResults(event.id,team.id,{snapshotId:state.snapshotId!,awardsVersion:state.version!,email:contacts.find(c=>c.teamId===team.id)!.managerEmail});completed++;
   }
   message.textContent=stop?`Stopped after ${completed} email${completed===1?'':'s'}. Sent emails will be skipped when you continue.`:`Results emails processed for ${completed} team${completed===1?'':'s'}.`;message.hidden=false;
  });
  content.replaceChildren(
   h('h3',null,'Overall awards'),h('p',{class:'muted'},'The Organiser or Chair of Judges selects and confirms award winners. Saving or removing a winner requires confirmation again.'),
   state.awards.length?h('ul',{class:'list'},state.awards.map(a=>h('li',null,h('strong',null,a.title),h('span',null,who(a.teamId)),h('button',{class:'btn btn--ghost btn--small',type:'button',onclick:()=>void run(()=>ctx.api.removeAward(a.id))},'Remove award')))):h('p',{class:'muted'},'No overall awards selected. Confirming this list will include “No overall awards selected” in the PDF.'),awardForm,confirmAwards,
   h('h3',null,'Preview the PDFs'),h('p',{class:'muted'},'Download the standings and awards PDF, plus the selected team’s results and feedback PDFs. The sender uses the same reports.'),h('div',{class:'form'},previewTeam,previewButton),
   h('h3',null,'Manager email delivery'),h('p',{class:'notice',hidden:missing===0},`${missing} team${missing===1?' needs':'s need'} a manager email. Add it in Teams to include them in delivery.`),h('p',{class:'muted'},`${sent} of ${contacts.length} manager contacts have received this ranking and award version.`),
   h('p',{class:'notice',hidden:event.resultsReleased},'Release final results before sending manager emails.'),
   h('p',{class:'notice',hidden:state.confirmed},'Confirm the award winners before sending.'),
   h('div',{class:'table-wrap'},h('table',{class:'table'},h('thead',null,h('tr',null,['Team','Manager email','Delivery'].map(s=>h('th',null,s)))),h('tbody',null,teams.map(t=>h('tr',null,h('td',null,who(t.id)),h('td',null,contacts.find(c=>c.teamId===t.id)?.managerEmail??'Add email in Teams'),h('td',null,({sent:'Email sent',failed:'Failed - ready to retry',sending:'Sending',uncertain:'Unconfirmed - check recipient inbox'} as Record<string,string>)[currentDelivery(t)?.status??'']??'Not sent')))))),
   retryControls,h('div',{class:'actions'},send,stopButton),review,
  );
 }
 draw();return root;
}
