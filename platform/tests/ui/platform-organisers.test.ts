// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest';
import {MemoryApi,ApiError} from '../../src/api';
import {eventsScreen} from '../../src/ui/events';
import {makeCtx,text} from './helpers';
const OWNER='reyanshg11111@gmail.com';
describe('organiser access on Events',()=>{
 it('keeps the permanent owner visible without a revoke control and invites both organiser scopes',async()=>{
  const api=new MemoryApi();await api.signIn(OWNER);
  const {ctx}=makeCtx(api);const el=await eventsScreen(ctx);
  expect(text(el)).toContain('Platform Admin · permanent access to every event');
  expect(text(el)).toContain('Permanent administrator');
  expect(text(el)).not.toContain('Revoke organiser access');
  const email=el.querySelector<HTMLInputElement>('input[name=organiserEmail]')!;
  const scope=el.querySelector<HTMLSelectElement>('select[name=organiserScope]')!;
  expect([...scope.options].map(o=>o.text)).toEqual(['Competition Organiser','Platform Organiser']);
  email.value='platform@x.test';scope.value='platform';
  email.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalledOnce());
  expect((await api.platformAccess()).invitations).toMatchObject([{email:'platform@x.test',scope:'platform'}]);
 });
 it('shows creation but hides platform grants from Competition Organisers and denies uninvited bootstrap',async()=>{
  const api=new MemoryApi();await api.signIn('stranger@x.test');
  expect(await api.canCreateEvent()).toBe(false);
  await expect(api.createEvent({name:'Not authorised'})).rejects.toMatchObject({code:'forbidden'});
  await api.signIn(OWNER);await api.inviteOrganiser('competition@x.test','competition');
  await api.signIn('competition@x.test');await api.claimInvitations();
  const el=await eventsScreen(makeCtx(api).ctx);
  expect(el.querySelector('input[name=name]')).not.toBeNull();
  expect(el.querySelector('input[name=organiserEmail]')).toBeNull();
  expect(text(el)).toContain('Competition Organiser · assigned events');
  await expect(api.inviteOrganiser('friend@x.test','platform')).rejects.toMatchObject({code:'forbidden'});
 });
 it('retains a clear error when invitation delivery fails and prevents duplicate submissions',async()=>{
  const api=new MemoryApi();await api.signIn(OWNER);
  let reject!:(e:unknown)=>void;
  api.inviteOrganiser=vi.fn(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
  const {ctx}=makeCtx(api);const el=await eventsScreen(ctx);
  const email=el.querySelector<HTMLInputElement>('input[name=organiserEmail]')!;email.value='invite@x.test';
  const form=email.closest('form')!;form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(api.inviteOrganiser).toHaveBeenCalledOnce();
  reject(new ApiError('email-delivery','Invitation saved; delivery unconfirmed'));
  await vi.waitFor(()=>expect(text(el)).toContain('The invitation is saved'));
  expect(ctx.rerender).not.toHaveBeenCalled();
  expect(form.querySelector('button')!.disabled).toBe(false);
 });
 it('revokes Platform Organiser access without affecting the permanent owner',async()=>{
  const api=new MemoryApi();await api.signIn(OWNER);await api.inviteOrganiser('staff@x.test','platform');
  await api.signIn('staff@x.test');await api.claimInvitations();const event=await api.createEvent({name:'Staff event'});
  await api.signIn(OWNER);expect(await api.getEvent(event.id)).not.toBeNull();
  const access=await api.platformAccess();
  await expect(api.removeOrganiser('user:'+OWNER)).rejects.toMatchObject({code:'forbidden'});
  await api.removeOrganiser(access.organisers.find(r=>r.email==='staff@x.test')!.userId);
  await api.signIn('staff@x.test');expect((await api.platformAccess()).canManage).toBe(false);
  // Event creation assigned this person as its Competition Organiser, so that assignment survives.
  expect((await api.myRoles(event.id)).map(r=>r.role)).toEqual(['organiser','chair']);
 });
});
