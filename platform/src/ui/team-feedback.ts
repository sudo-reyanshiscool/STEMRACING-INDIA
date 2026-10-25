import {managerOnly,garageHeader} from './team-garage';
import type { Ctx } from './ctx';
import type { Panel } from '../api';
import { h } from './dom';
import { errorText, notFound } from './common';
import { PANEL_LABEL } from './labels';

export async function teamFeedbackScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const roles = await ctx.api.myRoles(eventId);
  const staff = roles.some(r => r.role === 'organiser' || r.role === 'chair');
  const managed = roles.filter(r => r.role === 'team_manager').map(r => r.teamId);
  if (!staff && !managed.length) return notFound('Team feedback is available to team managers, organisers and the Chair.');
  const [teams, concerns] = await Promise.all([ctx.api.listTeams(eventId), ctx.api.listTeamConcerns(eventId)]);
  const root = h('div', {class: managerOnly(roles)?'garage garage-feedback stack stack--lg':'stack stack--lg'}, managerOnly(roles)?garageHeader('Your team / Support','Team feedback','A direct line to the organisers. Share what happened and follow the response.'):h('h1', null, 'Team feedback'),
    h('p', {class:'lead'}, staff ? 'Review concerns raised after judging sessions and respond to the team.' : 'Tell the organisers about interrupted presentations, procedural issues or other judging concerns.'));
  const alert = h('p', {role:'status', 'aria-live':'polite'});
  root.append(alert);
  if (managed.length) {
    const team = h('select', {required:true, id:'concern-team'}, teams.filter(t => managed.includes(t.id)).map(t => h('option', {value:t.id}, `${t.number} · ${t.name}`)));
    const panel = h('select', {required:true, id:'concern-panel'}, Object.entries(PANEL_LABEL).map(([id,label]) => h('option', {value:id}, label)));
    const message = h('textarea', {required:true, maxlength:4000, rows:5, id:'concern-message'});
    const submit = h('button', {type:'submit', class:'btn btn--primary'}, 'Send feedback');
    const form = h('form', {class:'stack', onsubmit:async (e:Event) => {
      e.preventDefault(); if(submit.disabled)return; if (!message.value.trim()) { message.setCustomValidity('Describe your concern.'); message.reportValidity(); return; }
      submit.disabled=true; alert.textContent='Sending feedback…';
      try { await ctx.api.submitTeamConcern(eventId,team.value,panel.value as Panel,message.value); ctx.rerender(); }
      catch (err) { alert.textContent=errorText(err); submit.disabled=false; }
    }}, h('h2',null,'Report a concern'),h('label',{class:'field',for:'concern-team'},h('span',{class:'field__label'},'Team'),team),
    h('label',{class:'field',for:'concern-panel'},h('span',{class:'field__label'},'Judging panel'),panel),h('label',{class:'field',for:'concern-message'},h('span',{class:'field__label'},'What happened?'),message),
    h('p',{class:'muted'},'Your submission and the organiser response are visible to your team managers, organisers and the Chair.'),submit);
    message.addEventListener('input',()=>message.setCustomValidity(''));
    root.append(form);
  }
  const filter = h('select', {'aria-label':'Filter feedback'}, h('option',{value:'all'},'All feedback'),h('option',{value:'open'},'Open'),h('option',{value:'resolved'},'Resolved'));
  const list = h('div',{class:'stack'});
  const render = () => {
    const shown = concerns.filter(c=>filter.value==='all' || c.status===filter.value);
    list.replaceChildren(...shown.map(c => {
      const team = teams.find(t=>t.id===c.teamId);
      const card = h('section',{class:'row stack'},h('h3',null,team ? `${team.number} · ${team.name}` : 'Team'),
        h('p',{class:'muted'},`${PANEL_LABEL[c.panel]} · ${c.status === 'open' ? 'Open' : 'Resolved'} · ${new Date(c.createdAt).toLocaleString()}`),
        h('p',{style:'white-space:pre-wrap'},c.message));
      if(c.response) card.append(h('h4',null,'Organiser response'),h('p',{style:'white-space:pre-wrap'},c.response));
      if(staff && c.status==='open') {
        const response=h('textarea',{required:true,maxlength:4000,rows:3,'aria-label':'Response to the team'});
        const save=h('button',{type:'submit',class:'btn btn--primary'},'Respond and resolve');
        card.append(h('form',{class:'stack',onsubmit:async(e:Event)=>{
          e.preventDefault(); if(save.disabled)return; if(!response.value.trim()) {response.setCustomValidity('Enter a response.');response.reportValidity();return;}
          save.disabled=true;
          try {await ctx.api.resolveTeamConcern(eventId,c.id,response.value);ctx.rerender();}
          catch(err){alert.textContent=errorText(err);save.disabled=false;}
        }},h('label',{class:'field'},h('span',{class:'field__label'},'Response to the team'),response),save));
        response.addEventListener('input',()=>response.setCustomValidity(''));
      }
      return card;
    }));
    if(!shown.length) list.append(h('p',{class:'muted'},'No feedback to show.'));
  };
  filter.addEventListener('change',render); render();
  root.append(h('h2',null,staff?'Team submissions':'Your team submissions'),h('label',{class:'field'},h('span',{class:'field__label'},'Status'),filter),
    h('button',{class:'btn btn--ghost',onclick:()=>ctx.rerender()},'Refresh feedback'),list);
  return root;
}
