import {ApiError,BATCH_ROLES,COMPETITION_LEVEL_LABEL,type BatchOutcome,type BatchRole,type EventRow} from '../api';
import {reportActionError} from './actions';
import {buttonBusy} from './button-busy';
import type {Ctx} from './ctx';
import {h} from './dom';
import {ROLE_LABEL} from './labels';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adds or removes one person's Organiser, Chair, Scrutineer or Race official role across several events at once. */
export function batchPeopleControl(ctx:Ctx,events:readonly EventRow[]):HTMLElement{
  let alive=true,busy=false,confirming=false;
  ctx.onLeave(()=>{alive=false;});
  const action=h('select',{name:'action','aria-label':'Add or remove'},h('option',{value:'add'},'Add'),h('option',{value:'remove'},'Remove'));
  const role=h('select',{name:'role','aria-label':'Role'},BATCH_ROLES.map(r=>h('option',{value:r},ROLE_LABEL[r])));
  const email=h('input',{name:'email',type:'email',autocomplete:'off',maxlength:254});
  const name=h('input',{name:'person',maxlength:100,autocomplete:'off'});
  const nameField=h('label',{class:'field'},h('span',{class:'field__label'},'Name (optional)'),name);
  const boxes=events.map(e=>({event:e,box:h('input',{type:'checkbox',name:'event',value:e.id})}));
  const pick=(label:string,test:(e:EventRow)=>boolean)=>{const b=h('button',{class:'btn btn--ghost btn--small',type:'button'},label);b.addEventListener('click',()=>{boxes.forEach(x=>{x.box.checked=test(x.event);});reset();});return b;};
  const error=h('p',{class:'alert',role:'alert',hidden:true});
  const results=h('ul',{class:'list batch-results','aria-live':'polite'});
  const submit=h('button',{class:'btn btn--primary',type:'submit'},'Apply');
  const note=h('p',{class:'small muted'});
  const chosen=()=>boxes.filter(x=>x.box.checked).map(x=>x.event);
  function reset(){
    confirming=false;const n=chosen().length,remove=action.value==='remove';
    nameField.hidden=remove;
    submit.textContent=n?`${remove?'Remove from':'Add to'} ${n} event${n===1?'':'s'}`:'Choose events';
    note.textContent=remove?'Removes the role and any pending invitation for this email from each chosen event. An event always keeps at least one organiser.':'One invitation email is sent. Signing in with that address gives access to every chosen event.';
  }
  [action,role].forEach(x=>x.addEventListener('change',reset));boxes.forEach(x=>x.box.addEventListener('change',reset));email.addEventListener('input',()=>{confirming=false;reset();});

  const removeFrom=async(eventId:string,address:string,r:BatchRole):Promise<BatchOutcome>=>{
    try{
      const [people,invites]=await Promise.all([ctx.api.listRoles(eventId),ctx.api.listInvitations(eventId)]);
      const roleRows=people.filter(p=>p.role===r&&p.email?.toLowerCase()===address);
      const inviteRows=invites.filter(i=>i.role===r&&i.email.toLowerCase()===address);
      if(!roleRows.length&&!inviteRows.length)return {eventId,ok:true,message:'Not in this event'};
      for(const p of roleRows)await ctx.api.removeRole(p.id);
      for(const i of inviteRows)await ctx.api.removeInvitation(i.id);
      return {eventId,ok:true,message:roleRows.length?'Removed':'Invitation withdrawn'};
    }catch(e){return {eventId,ok:false,message:e instanceof ApiError&&e.code==='locked'?'Kept: an event needs at least one organiser':e instanceof Error?e.message:'Could not remove'};}
  };

  const form=h('form',{class:'stack batch-people',novalidate:true},
    h('div',{class:'batch-people__fields'},h('label',{class:'field'},h('span',{class:'field__label'},'Action'),action),h('label',{class:'field'},h('span',{class:'field__label'},'Role'),role),
      h('label',{class:'field'},h('span',{class:'field__label'},'Email'),email),nameField),
    h('fieldset',{class:'stack batch-people__events'},h('legend',null,'Events'),
      h('div',{class:'actions'},pick('All',()=>true),pick('Regionals',e=>e.competitionLevel==='regional'),pick('Nationals',e=>e.competitionLevel==='national'),pick('None',()=>false)),
      h('ul',{class:'list batch-events'},boxes.map(x=>h('li',null,h('label',{class:'checkbox'},x.box,' ',x.event.name,x.event.competitionLevel?h('span',{class:'tag'},COMPETITION_LEVEL_LABEL[x.event.competitionLevel]):null))))),
    note,error,submit,results);
  reset();

  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;error.hidden=true;
    const address=email.value.trim().toLowerCase(),targets=chosen(),r=role.value as BatchRole,remove=action.value==='remove';
    if(!EMAIL.test(address)){error.textContent='Enter a valid email address.';error.hidden=false;email.focus();return;}
    if(!targets.length){error.textContent='Choose at least one event.';error.hidden=false;return;}
    if(remove&&!confirming){confirming=true;submit.textContent=`Confirm: remove ${ROLE_LABEL[r]} ${address} from ${targets.length} event${targets.length===1?'':'s'}`;return;}
    busy=true;const finish=buttonBusy(submit,remove?'Removing…':'Inviting…');results.replaceChildren();
    try{
      const outcomes=remove?await Promise.all(targets.map(t=>removeFrom(t.id,address,r))):await ctx.api.inviteToEvents(targets.map(t=>t.id),{email:address,role:r,...(name.value.trim()?{name:name.value.trim()}:{})});
      if(!alive)return;
      const nameOf=new Map(events.map(ev=>[ev.id,ev.name]));
      results.replaceChildren(...outcomes.map(o=>h('li',null,h('strong',null,nameOf.get(o.eventId)??o.eventId),' ',h('span',{class:o.ok?'tag tag--pass':'tag tag--fail'},o.message))));
    }catch(err){if(alive)reportActionError(ctx,error,err);}
    finally{busy=false;finish();if(alive)reset();}
  });
  return h('section',{class:'section'},h('h2',null,'People across events'),h('p',{class:'muted'},'Add or remove an Organiser, Chair, Scrutineer or Race official on several events at once. Judges and team managers are still added on each event’s People page, because they need a panel or team.'),form);
}
