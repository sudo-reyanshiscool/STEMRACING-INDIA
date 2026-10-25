import { ApiError, type PlatformAccess, type OrganiserScope } from '../api';
import type { Ctx } from './ctx';
import { h } from './dom';
import { liveRefresh } from './live-refresh';
import { reportActionError } from './actions';

const label = (scope: string) => scope === 'admin' ? 'Platform Admin' : scope === 'platform' ? 'Platform Organiser' : scope==='spectator' ? 'Platform Spectator' : 'Competition Organiser';

export function organiserControls(ctx: Ctx, access: PlatformAccess, viewerId?: string): HTMLElement {
  const section = h('section', {class: 'section stack'}, h('h2', null, 'Organiser access'),
    h('p', {class: 'muted'}, 'Platform Organisers manage every event. Competition Organisers can create events and manage the competitions they are assigned to. Both have Chair of Judges and score override access within that scope.'));
  const error = h('p', {class: 'alert', role: 'alert', hidden: true});
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  const run = async (button: HTMLButtonElement, task: () => Promise<void>) => {
    if(button.disabled) return;
    button.disabled = true; error.hidden = true;
    try { await task(); if(alive) ctx.rerender(); }
    catch(e) {
      if(!alive) return;
      reportActionError(ctx,error,e); button.disabled = false;
      if(e instanceof ApiError && (e.code==='email-delivery' || e.code==='rate-limited')) {
        try {
          const latest=await ctx.api.platformAccess();
          if(alive) {const refreshed=organiserControls(ctx,latest,viewerId);refreshed.prepend(error);section.replaceWith(refreshed);}
        } catch { /* Keep the delivery error and existing controls if refreshing fails. */ }
      }
    }
  };
  const owner=access.kind==='admin'&&viewerId===access.ownerId&&access.viewerId===viewerId;
  const name=h('input',{type:'text',name:'organiserName',maxlength:100,autocomplete:'name'});
  const hidden=h('input',{type:'checkbox',name:'hiddenOrganiser'});
  hidden.onchange=()=>{name.required=hidden.checked;};
  const email = h('input', {type:'email',name:'organiserEmail',required:true,autocomplete:'email'});
  const scope = h('select', {name:'organiserScope'},
    h('option', {value:'competition'}, 'Competition Organiser'), h('option', {value:'platform'}, 'Platform Organiser'));
  if(owner)scope.append(h('option',{value:'spectator'},'Platform Spectator'));
  const send = h('button', {class:'btn btn--primary',type:'submit'}, 'Invite organiser');
  const form = h('form', {class:'form'},
    owner?h('label',{class:'field'},h('span',{class:'field__label'},'Full name'),name):null,
    h('label', {class:'field'}, h('span', {class:'field__label'}, 'Organiser email'), email),
    h('label', {class:'field'}, h('span', {class:'field__label'}, 'Access level'), scope),owner?h('label',null,hidden,' Hidden account · visible only to the Platform Admin'):null, send);
  form.addEventListener('submit', e => { e.preventDefault(); void run(send, () => ctx.api.inviteOrganiser(email.value,scope.value as OrganiserScope,owner?{name:name.value,hidden:hidden.checked}:undefined)); });
  const peopleList=(access:PlatformAccess,viewerId?:string)=>h('ul', {class:'list'}, access.organisers.filter(person=>!person.identityRestricted || (access.kind==='admin' && !!viewerId && viewerId===access.ownerId && access.viewerId===viewerId)).map(person => {
    const adminViewer=access.kind==='admin' && !!viewerId && viewerId===access.ownerId && access.viewerId===viewerId;
    const hidden=!!person.emailHidden || (!!person.contactRestricted && !adminViewer) || (access.viewerId!==undefined && access.viewerId!==viewerId);
    const address=hidden?null:person.email;
    const row = h('li', null, h('strong',null,person.name || address || 'Organiser'), hidden ? h('span',{class:'muted small'},'Email hidden') : person.name && address ? h('span',{class:'muted small'},address) : null, h('span',{class:'muted small'},label(person.scope)),
      person.permanent ? h('span',{class:'tag tag--pass'},'Permanent administrator') : null);
    if(owner&&!person.permanent) {
      const details=h('details',null,h('summary',null,'Account visibility'));
      const personName=h('input',{type:'text',value:person.name??'',maxlength:100,'aria-label':'Display name'});
      const privateAccount=h('input',{type:'checkbox',checked:person.identityRestricted,'aria-label':'Hidden account'});
      const save=h('button',{class:'btn btn--ghost btn--small',type:'submit'},'Save visibility');
      const edit=h('form',{class:'stack'},h('label',{class:'field'},h('span',{class:'field__label'},'Display name'),personName),h('label',null,privateAccount,' Hidden account · visible only to you'),save);
      edit.onsubmit=e=>{e.preventDefault();if(privateAccount.checked&&!personName.value.trim()){personName.setCustomValidity('Enter a name for this hidden account.');personName.reportValidity();return;}void run(save,()=>ctx.api.setOrganiserVisibility(person.userId,personName.value,privateAccount.checked));};
      personName.oninput=()=>personName.setCustomValidity('');details.append(edit);row.append(details);
    }
    if(access.canManage&&!person.permanent&&(owner||person.scope!=='spectator')) {
      const remove = h('button',{class:'btn btn--ghost btn--small',type:'button'},'Revoke organiser access');
      const confirm = h('button',{class:'btn btn--ghost btn--small',type:'button',hidden:true},'Confirm revoke');
      const cancel = h('button',{class:'btn btn--ghost btn--small',type:'button',hidden:true},'Cancel');
      const note = h('p',{class:'muted small',hidden:true},'This removes this organiser grant. Separate event assignments remain in place.');
      remove.onclick=()=>{remove.hidden=true;confirm.hidden=false;cancel.hidden=false;note.hidden=false;};
      cancel.onclick=()=>{remove.hidden=false;confirm.hidden=true;cancel.hidden=true;note.hidden=true;};
      confirm.onclick=()=>void run(confirm,()=>ctx.api.removeOrganiser(person.userId));
      row.append(remove,note,confirm,cancel);
    }
    return row;
  }));
  const people=h('div',null,peopleList(access,viewerId));
  section.append(error,...(access.canManage?[form]:[]),people);
  let signature=JSON.stringify(access.organisers);
  liveRefresh(ctx,async()=>{
    const [fresh,viewer]=await Promise.all([ctx.api.platformAccess(),ctx.api.getSession()]);
    if(!alive)return;
    const next=JSON.stringify(fresh.organisers);
    if(next!==signature || viewer?.userId!==viewerId) {people.replaceChildren(peopleList(fresh,viewer?.userId));signature=next;}
  },()=>{if(alive)people.replaceChildren();});
  if(access.invitations.length) section.append(h('h3',null,'Organiser invitations'), h('ul',{class:'list'},access.invitations.map(inv=>{
    const canAct=access.canManage&&(owner||(!inv.identityRestricted&&inv.scope!=='spectator'));
    const resend=h('button',{class:'btn btn--ghost btn--small',type:'button'},'Resend invitation');
    const withdraw=h('button',{class:'btn btn--ghost btn--small',type:'button'},'Withdraw');
    resend.onclick=()=>void run(resend,()=>ctx.api.sendInvitation(inv.id));
    withdraw.onclick=()=>void run(withdraw,()=>ctx.api.withdrawOrganiserInvitation(inv.id));
    return h('li',null,h('strong',null,inv.name||inv.email),inv.identityRestricted?h('span',{class:'tag'},'Hidden account'):null,h('span',{class:'muted small'},`${label(inv.scope)} · ${inv.emailStatus==='sent'?'Email sent':inv.emailStatus==='sending'?'Sending email':'Email not sent'}`),...(canAct?[resend,withdraw]:[]));
  })));
  return section;
}
