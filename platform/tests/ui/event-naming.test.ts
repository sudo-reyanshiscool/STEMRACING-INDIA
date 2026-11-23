// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {previewBatchNames,eventDisplayName,nextRegionalNumber,normaliseSeason,type EventRow} from '../../src/api';
import {eventHomeScreen} from '../../src/ui/event-home';
import {eventsScreen} from '../../src/ui/events';
import {EMAILS,makeCtx,text,world} from './helpers';

const button=(el:Element,name:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent===name)!;
const type=(el:HTMLInputElement|HTMLSelectElement,value:string)=>{el.value=value;el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));};
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
async function signedIn(email:string=EMAILS.org){const w=await world();await w.api.signIn(email);return {...w,...makeCtx(w.api)};}

describe('automatic names',()=>{
 const ev=(city:string,season:string,regionalNumber:number):EventRow=>({id:`${city}-${season}-${regionalNumber}`,name:'',startsOn:null,ruleset:{} as never,resultsReleased:false,competitionLevel:'regional',city,season,regionalNumber});
 it('builds regional and national names',()=>{
  expect(eventDisplayName('regional','  New   Delhi ','2027',2)).toBe('STEM Racing India New Delhi Regionals 2 2027');
  expect(eventDisplayName('national','Delhi','2026–2027')).toBe('STEM Racing India Delhi Nationals 2026-27');
 });
 it('reads years and hyphenated seasons, rejecting non-consecutive ones',()=>{
  expect(['2027','2026-27',' 2026–2027 ','2099-00','2026-28','2026/27','1999','27'].map(normaliseSeason)).toEqual(['2027','2026-27','2026-27','2099-00',null,null,null,null]);
  expect(nextRegionalNumber([ev('Delhi','2026-27',1),ev('Delhi','2027',4)],'Delhi','2026-2027')).toBe(2);
 });
 it('counts each city and year separately, ignoring case',()=>{
  const existing=[ev('Delhi','2027',1),ev('Delhi','2027',2),ev('Mumbai','2027',1),ev('Delhi','2026',7)];
  expect(nextRegionalNumber(existing,'delhi','2027')).toBe(3);
  expect(nextRegionalNumber(existing,'Pune','2027')).toBe(1);
  expect(previewBatchNames(existing,[{level:'regional',city:'Delhi',season:'2027'},{level:'regional',city:'Pune',season:'2027'},{level:'regional',city:'DELHI',season:'2027'},{level:'regional',city:'',season:'2027'}]))
   .toEqual(['STEM Racing India Delhi Regionals 3 2027','STEM Racing India Pune Regionals 1 2027','STEM Racing India DELHI Regionals 4 2027',null]);
 });
});

describe('renaming an event',()=>{
 it('rebuilds the name from new parts and keeps the regional number',async()=>{
  const {api,ctx}=await signedIn();
  const [e]=await api.createEvents([{level:'regional',city:'Delhi',season:'2027'}]);
  await api.createEvents([{level:'regional',city:'Mumbai',season:'2027'}]);
  const el=await eventHomeScreen(ctx,e!.id);document.body.append(el);
  button(el,'Rename event').click();
  const city=el.querySelector<HTMLInputElement>('.event-rename input[name=city]')!;
  type(city,'Mumbai');
  expect(text(el)).toContain('New name: STEM Racing India Mumbai Regionals (next free number) 2027');
  type(el.querySelector<HTMLInputElement>('.event-rename input[name=number]')!,'4');
  expect(text(el)).toContain('New name: STEM Racing India Mumbai Regionals 4 2027');
  button(el,'Save name').click();
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  expect((await api.getEvent(e!.id))!.name).toBe('STEM Racing India Mumbai Regionals 4 2027');
 });
 it('moves an event into a hyphenated season and rejects an invalid one',async()=>{
  const {api,ctx}=await signedIn();
  const [e]=await api.createEvents([{level:'regional',city:'Delhi',season:'2027'}]);
  const el=await eventHomeScreen(ctx,e!.id);document.body.append(el);
  button(el,'Rename event').click();
  const season=el.querySelector<HTMLInputElement>('.event-rename input[name=year]')!;
  expect(season.value).toBe('2027');
  type(season,'2026-28');expect(text(el)).toContain('season such as 2026-27');
  button(el,'Save name').click();expect(ctx.rerender).not.toHaveBeenCalled();
  type(season,'2026-27');expect(text(el)).toContain('New name: STEM Racing India Delhi Regionals (next free number) 2026-27');
  button(el,'Save name').click();
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  expect(await api.getEvent(e!.id)).toMatchObject({name:'STEM Racing India Delhi Regionals 1 2026-27',season:'2026-27'});
 });
 it('offers only a custom name for events made before automatic names, and lets Chairs rename',async()=>{
  const {api,ev,ctx}=await signedIn(EMAILS.chair);
  const el=await eventHomeScreen(ctx,ev.id);document.body.append(el);
  expect(el.querySelector('.event-management')).toBeNull();
  button(el,'Rename event').click();
  const custom=el.querySelector<HTMLInputElement>('.event-rename input[name=custom]')!;
  expect(custom.checked).toBe(true);expect(custom.disabled).toBe(true);
  const name=el.querySelector<HTMLInputElement>('.event-rename input[name=name]')!;
  type(name,' ');button(el,'Save name').click();
  expect(text(el)).toContain('Enter the event name.');
  type(name,'National Finals 2026');button(el,'Save name').click();
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  expect((await api.getEvent(ev.id))!.name).toBe('National Finals 2026');
 });
 it('is hidden from judges',async()=>{
  const {ev,ctx}=await signedIn(EMAILS.judge);
  const el=await eventHomeScreen(ctx,ev.id);
  expect(el.querySelector('.event-rename')).toBeNull();
 });
});

describe('people across events',()=>{
 async function setup(){
  const w=await signedIn();
  const made=await w.api.createEvents([{level:'regional',city:'Delhi',season:'2027'},{level:'regional',city:'Pune',season:'2027'}]);
  const el=await eventsScreen(w.ctx);document.body.append(el);
  const panel=[...el.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='People across events')!;
  return {...w,made,el,panel};
 }
 it('adds a Chair to the chosen events with one call and reports each event',async()=>{
  const {api,made,panel}=await setup();
  const batch=vi.spyOn(api,'inviteToEvents');
  type(panel.querySelector<HTMLInputElement>('input[name=email]')!,'New.Chair@X.test');
  type(panel.querySelector<HTMLSelectElement>('select[name=role]')!,'chair');
  button(panel,'Regionals').click();
  expect(text(button(panel,'Add to 2 events'))).toBe('Add to 2 events');
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(panel.querySelectorAll('.batch-results li')).toHaveLength(2));
  expect(batch).toHaveBeenCalledExactlyOnceWith(made.map(e=>e.id),{email:'new.chair@x.test',role:'chair'});
  for(const e of made)expect((await api.listInvitations(e.id)).map(i=>[i.email,i.role])).toContainEqual(['new.chair@x.test','chair']);
  expect(text(panel)).toContain('Invited');
 });
 it('asks for confirmation before removing, then removes roles and pending invitations',async()=>{
  const {api,ev,made,panel}=await setup();
  await api.inviteToEvents([made[0]!.id],{email:'gone@x.test',role:'organiser'});
  const roles=vi.spyOn(api,'removeRole'),invites=vi.spyOn(api,'removeInvitation');
  type(panel.querySelector<HTMLSelectElement>('select[name=action]')!,'remove');
  type(panel.querySelector<HTMLInputElement>('input[name=email]')!,'gone@x.test');
  button(panel,'All').click();
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(invites).not.toHaveBeenCalled();
  expect(text(panel)).toContain('Confirm: remove Competition Organiser gone@x.test from 3 events');
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(panel.querySelectorAll('.batch-results li')).toHaveLength(3));
  expect(invites).toHaveBeenCalledTimes(1);expect(roles).not.toHaveBeenCalled();
  expect(await api.listInvitations(made[0]!.id)).not.toContainEqual(expect.objectContaining({email:'gone@x.test'}));
  expect(text(panel)).toContain('Invitation withdrawn');expect(text(panel)).toContain('Not in this event');
  expect(ev).toBeDefined();
 });
 it('keeps the last organiser of an event',async()=>{
  const {made,panel}=await setup();
  type(panel.querySelector<HTMLSelectElement>('select[name=action]')!,'remove');
  type(panel.querySelector<HTMLInputElement>('input[name=email]')!,EMAILS.org);
  panel.querySelector<HTMLInputElement>(`input[value="${made[0]!.id}"]`)!.click();
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(text(panel)).toContain('at least one organiser'));
 });
 it('validates the email and the event choice before doing anything',async()=>{
  const {api,panel}=await setup();
  const batch=vi.spyOn(api,'inviteToEvents');
  type(panel.querySelector<HTMLInputElement>('input[name=email]')!,'not-an-email');
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(text(panel)).toContain('Enter a valid email address.');
  type(panel.querySelector<HTMLInputElement>('input[name=email]')!,'a@x.test');
  panel.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  expect(text(panel)).toContain('Choose at least one event.');
  expect(batch).not.toHaveBeenCalled();
 });
});
