// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {MemoryApi} from '../../src/api';
import {eventsScreen} from '../../src/ui/events';
import {eventHomeScreen} from '../../src/ui/event-home';
import {eventNav} from '../../src/ui/event-nav';
import {spectatorReadScreen} from '../../src/ui/spectator';
import {rankingsScreen} from '../../src/ui/rankings';
import {moderationScreen} from '../../src/ui/moderation';
import {scoresScreen} from '../../src/ui/scores';
import {makeCtx} from './helpers';
let cleanup:Array<()=>void>=[];afterEach(()=>{cleanup.forEach(f=>f());cleanup=[];vi.restoreAllMocks();document.body.replaceChildren();});
const OWNER='reyanshg11111@gmail.com',SPECTATOR='spectator@x.test',ORG='organiser@x.test';
async function fixture(){const api=new MemoryApi();await api.signIn(OWNER);const ev=await api.createEvent({name:'Nationals'});await api.createTeam(ev.id,{number:'001',name:'Apex'});return {api,ev};}
function context(api:MemoryApi){const c=makeCtx(api);cleanup.push(...c.leaves);return c.ctx;}
describe('owner-only platform member controls',()=>{
 it('lets the owner invite a hidden spectator using the platform form',async()=>{
  const {api}=await fixture(),ctx=context(api),root=await eventsScreen(ctx);document.body.append(root);
  const scopes=root.querySelector<HTMLSelectElement>('[name=organiserScope]')!;
  expect([...scopes.options].map(o=>o.text)).toContain('Platform Spectator');
  root.querySelector<HTMLInputElement>('[name=organiserEmail]')!.value=SPECTATOR;
  root.querySelector<HTMLInputElement>('[name=organiserName]')!.value='Hidden Observer';
  const hidden=root.querySelector<HTMLInputElement>('[name=hiddenOrganiser]')!;hidden.checked=true;hidden.dispatchEvent(new Event('change'));
  scopes.value='spectator';scopes.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  expect((await api.platformAccess()).invitations).toMatchObject([{scope:'spectator',name:'Hidden Observer',identityRestricted:true}]);
 });
 it('does not expose hidden or spectator grant controls to other Platform Organisers',async()=>{
  const {api}=await fixture();await api.inviteOrganiser(ORG,'platform');await api.signIn(ORG);await api.claimInvitations();
  const root=await eventsScreen(context(api));
  expect(root.querySelector('[name=hiddenOrganiser]')).toBeNull();
  expect(root.querySelector('option[value=spectator]')).toBeNull();
  await expect(api.inviteOrganiser(SPECTATOR,'spectator')).rejects.toMatchObject({code:'forbidden'});
 });
});
describe('spectator workspace',()=>{
 it('offers event-wide reading without management or scoring controls',async()=>{
  const {api,ev}=await fixture();await api.inviteOrganiser(SPECTATOR,'spectator',{name:'Observer'});await api.signIn(SPECTATOR);await api.claimInvitations();
  expect(await api.canCreateEvent()).toBe(false);
  const roles=await api.myRoles(ev.id);expect(roles.map(r=>r.role)).toEqual(['spectator']);
  const home=await eventsScreen(context(api));expect(home.textContent).toContain('Platform Spectator');expect(home.querySelector('form')).toBeNull();
  const nav=eventNav(ev,roles,'event');expect(nav.textContent).toContain('Rankings');expect(nav.textContent).toContain('Moderation');expect(nav.textContent).not.toContain('My scorecards');
  const event=await eventHomeScreen(context(api),ev.id);expect(event.querySelector('form')).toBeNull();expect(event.textContent).toContain('View people without making changes');
  for(const page of ['teams','people','communications','draw','team-feedback'] as const){const node=await spectatorReadScreen(context(api),ev.id,page);expect(node.querySelector('form')).toBeNull();expect(node.textContent).toContain('read-only');}
  for(const screen of [scoresScreen,rankingsScreen,moderationScreen]){const node=await screen(context(api),ev.id);expect(node.textContent).not.toMatch(/Only the organiser|Only the Chair/);expect(node.querySelector('[data-override]')).toBeNull();expect(node.querySelector('[data-reopen]')).toBeNull();}
  await expect(api.createTeam(ev.id,{number:'2',name:'Forbidden'})).rejects.toMatchObject({code:'forbidden'});
  await expect(api.inviteOrganiser(ORG,'platform')).rejects.toMatchObject({code:'forbidden'});
 });
});
