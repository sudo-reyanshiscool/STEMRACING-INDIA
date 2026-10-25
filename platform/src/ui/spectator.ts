import type {RoleRow} from '../api';
import type {Route} from './router';
import type {Ctx} from './ctx';
import {h} from './dom';
import {ROLE_LABEL,PANEL_LABEL} from './labels';
export const spectatorOnly=(roles:RoleRow[])=>roles.length>0&&roles.every(r=>r.role==='spectator');
export const SPECTATOR_PAGES:Array<[string,Route['name']]>=[['Event','event'],['Scheduling & Streams','schedule'],['Teams','teams'],['People','people'],['Draw lots','draw'],['Communications','communications'],['Scores','scores'],['Race control','racing'],['Moderation','moderate'],['Rankings','rankings'],['Submissions','submissions'],['Team files','team-files'],['Team feedback','team-feedback'],['Results','results']];
export async function spectatorReadScreen(ctx:Ctx,eventId:string,page:Route['name']):Promise<HTMLElement>{
 const title=SPECTATOR_PAGES.find(([,name])=>name===page)?.[0]??'Event';
 const root=h('div',{class:'stack stack--lg'},h('h1',null,title),h('p',{class:'notice'},'Platform Spectator · read-only access'));
 const rows=h('div',{class:'stack'});root.append(rows);
 const card=(title:string,...lines:Array<string|null|undefined>)=>h('article',{class:'row stack'},h('h3',null,title),lines.filter(Boolean).map(line=>h('p',{style:'white-space:pre-wrap'},line!)));
 if(page==='teams'){
  const [teams,contacts]=await Promise.all([ctx.api.listTeams(eventId),ctx.api.listTeamContacts(eventId)]);
  rows.append(...teams.map(t=>card(`${t.number} · ${t.name}`,t.school,contacts.find(c=>c.teamId===t.id)?.managerEmail)));
 }else if(page==='people'){
  const [people,invites]=await Promise.all([ctx.api.listRoles(eventId),ctx.api.listInvitations(eventId)]);
  rows.append(h('h2',null,'People'),...people.map(p=>card(p.name||p.email||'Account',ROLE_LABEL[p.role],p.panel?PANEL_LABEL[p.panel]:null,p.name?p.email:null)),h('h2',null,'Pending invitations'),...invites.map(i=>card(i.name||i.email,ROLE_LABEL[i.role],i.name?i.email:null)));
 }else if(page==='communications'){
  const messages=await ctx.api.listBroadcasts(eventId);rows.append(...messages.map(m=>card(m.subject,m.body,`${m.recipientCount} recipients`,m.senderEmail)));
 }else if(page==='team-feedback'){
  const [concerns,teams]=await Promise.all([ctx.api.listTeamConcerns(eventId),ctx.api.listTeams(eventId)]);
  rows.append(...concerns.map(c=>card(teams.find(t=>t.id===c.teamId)?.name??'Team',PANEL_LABEL[c.panel],c.status,c.message,c.response)));
 }else if(page==='draw'){
  const state=await ctx.api.drawLotsState(eventId);
  rows.append(h('h2',null,'Current team numbers'),...state.teams.map(t=>card(`${t.number} · ${t.name}`,t.school)),h('h2',null,'Current judging assignments'),...state.roles.filter(r=>r.role==='judge'||r.role==='lead_judge').map(r=>card(r.name||r.email||'Judge',r.panel?PANEL_LABEL[r.panel]:null,r.teamId?state.teams.find(t=>t.id===r.teamId)?.name:'All teams')));
 }
 if(!rows.childNodes.length)rows.append(h('p',{class:'muted'},'No records yet.'));
 return root;
}
