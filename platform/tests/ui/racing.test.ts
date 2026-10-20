// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {racingScreen} from '../../src/ui/racing';
import {blankLane,type TimingState} from '../../src/racing';
import {EMAILS,makeCtx,world,text} from './helpers';
let cleanups:Array<()=>void>=[];
afterEach(()=>{cleanups.forEach(f=>f());cleanups=[];vi.useRealTimers();document.body.replaceChildren();});
const seed=async()=>{const w=await world();await w.api.signIn(EMAILS.org);const row=await w.api.saveRace(w.ev.id,crypto.randomUUID(),0,{label:'Heat 1',phase:'reaction',lane1:blankLane(w.t1.id),lane2:blankLane(w.t2.id),note:'',source:'manual',sourceRunId:null});const {ctx,leaves}=makeCtx(w.api);cleanups=leaves;return {...w,ctx,row};};
const input=(el:HTMLElement,label:string,v:string)=>{const node=el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;node.value=v;node.dispatchEvent(new Event('input',{bubbles:true}));};
describe('race interface',()=>{
 it('saves actual lane times, shows car time, and retains values after invalid entry',async()=>{const {api,ctx,ev}=await seed();const el=await racingScreen(ctx,ev.id);input(el,'Lane 1 total time','1.310');input(el,'Lane 1 reaction time','0.210');input(el,'Lane 2 total time','1.440');input(el,'Lane 2 reaction time','0.240');const form=el.querySelector<HTMLFormElement>('.race-console form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await vi.waitFor(async()=>expect((await api.listRaces(ev.id))[0].lane1.totalMs).toBe(1310));expect(text(el)).toContain('1.100 s');expect(text(el)).toContain('Lane 1 wins');});
 it('gives judges a read-only view and hides unreleased race data from managers',async()=>{const {api,ctx,ev}=await seed();await api.signIn(EMAILS.judge);const el=await racingScreen(ctx,ev.id);expect(el.querySelector('.race-add')).toBeNull();expect(el.querySelector<HTMLButtonElement>('.race-console button[type=submit]')!.disabled).toBe(true);await api.signIn(EMAILS.mgr);expect(text(await racingScreen(ctx,ev.id))).toContain('not available');});
 it('captures only the next complete Denford race and never saves it without review',async()=>{vi.useFakeTimers();const {api,ctx,ev}=await seed();let state:TimingState={connectionId:'c',expiresAt:new Date(Date.now()+3600000).toISOString(),lastSeenAt:new Date().toISOString(),payload:{raceid:'11'}};vi.spyOn(api,'getTiming').mockImplementation(async()=>state);const save=vi.spyOn(api,'saveRace');const el=await racingScreen(ctx,ev.id);await Promise.resolve();const capture=[...el.querySelectorAll('button')].find(b=>text(b)==='Capture next track run')!;expect(capture.disabled).toBe(false);capture.click();state={...state,payload:{raceid:'12',racestatus:'LANE 1 WINS!',player1TriggerTime:'210',player2TriggerTime:'240',player1RaceTime:'1100',player2RaceTime:'1200',player1CombinedTime:'1310',player2CombinedTime:'1440'}};await vi.advanceTimersByTimeAsync(2000);expect(el.querySelector<HTMLInputElement>('[aria-label="Lane 1 total time"]')!.value).toBe('1.310');expect(text(el)).toContain('Captured track run 12');expect(save).not.toHaveBeenCalled();});
});

describe('qualification setup',()=>{
 it('requires an explicit decision on equal qualifying times before sharing seed order',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.org);await api.queueReactionRaces(ev.id);
  for(const row of await api.listRaces(ev.id))await api.saveRace(ev.id,row.id,row.revision,{...row,lane1:{...row.lane1,status:'finished',totalMs:1300,reactionMs:200},lane2:{...row.lane2,status:'finished',totalMs:1300,reactionMs:200}});
  await api.saveRacingSetup(ev.id,0,{seeds:[],reactionComplete:true,points:[10,26,52,85,106,120,135,10]});
  const {ctx,leaves}=makeCtx(api);cleanups=leaves;const el=await racingScreen(ctx,ev.id);document.body.append(el);
  const approve=[...el.querySelectorAll('button')].find(b=>text(b)==='Approve knockout seeds')!;expect(approve.disabled).toBe(true);
  const label=[...el.querySelectorAll('label')].find(l=>text(l).includes('resolved equal qualifying times'))!;
  label.querySelector<HTMLInputElement>('input')!.click();expect(approve.disabled).toBe(false);approve.click();
  await vi.waitFor(async()=>expect((await api.getRacingSetup(ev.id)).seeds).toHaveLength(2));
  await vi.waitFor(()=>expect(text(el)).toContain('Awaiting submitted Car A and B inspections'));
  expect([...el.querySelectorAll('button')].some(b=>text(b)==='Queue match')).toBe(false);
 });
});
