// @vitest-environment jsdom
import {Blob as NodeBlob} from 'node:buffer';
import {unzipSync,strFromU8} from 'fflate';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {teamFilesScreen} from '../../src/ui/team-files';
import {inspectionScopeControl} from '../../src/ui/inspection-scope';
import {racingScreen} from '../../src/ui/racing';
import {blankLane} from '../../src/racing';
import {EMAILS,makeCtx,world} from './helpers';
let cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.forEach(f=>f());cleanup=[];vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
const button=(root:HTMLElement,label:string)=>[...root.querySelectorAll('button')].find(b=>b.textContent===label)!;
describe('2027 event workflows',()=>{
 it('uploads a portfolio for the manager’s own team and displays the saved file',async()=>{
  const {api,ev,t1}=await world();const {ctx}=makeCtx(api);const root=await teamFilesScreen(ctx,ev.id);document.body.append(root);
  const team=root.querySelector<HTMLSelectElement>('[aria-label="Upload team"]')!;expect([...team.options].map(o=>o.value)).toEqual([t1.id]);
  const category=root.querySelector<HTMLSelectElement>('[aria-label="File category"]')!;category.value='design_portfolio';category.dispatchEvent(new Event('change'));
  const bytes=new TextEncoder().encode('%PDF-1.7\nTest\n%%EOF');
  const file={name:'design.pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
  Object.defineProperty(root.querySelector('input[type=file]'),'files',{value:[file]});
  root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  expect((await api.listTeamFiles(ev.id))[0]).toMatchObject({teamId:t1.id,kind:'design_portfolio',name:'design.pdf'});
  expect((await teamFilesScreen(ctx,ev.id)).textContent).toContain('design.pdf');
 });
 it('exports all team logos with distinct numbered names and a team index',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.org);
  const other=await api.createTeam(ev.id,{number:'001',name:'Another numbered team'});
  const input={kind:'logo' as const,name:'logo.svg',mime:'image/svg+xml',base64:btoa('<svg><path d="M0 0L1 1"/></svg>')};
  for(const t of [t1,other])await api.uploadTeamFile(ev.id,t.id,0,input);
  let output:NodeBlob|undefined;
  const NativeURL=URL;
  vi.stubGlobal('Blob',NodeBlob);
  vi.stubGlobal('URL',class extends NativeURL {static createObjectURL(blob:unknown){output=blob as NodeBlob;return 'blob:preview';}static revokeObjectURL(){}});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const {ctx}=makeCtx(api),root=await teamFilesScreen(ctx,ev.id);
  button(root,'Download team logos ZIP').click();
  await vi.waitFor(()=>expect(root.textContent).toContain('Prepared 2 team logos'));
  const zip=unzipSync(new Uint8Array(await output!.arrayBuffer()));
  const manifest=JSON.parse(strFromU8(zip['teams.json']));
  expect(manifest).toHaveLength(2);expect(new Set(manifest.map((m:any)=>m.file)).size).toBe(2);
  for(const row of manifest)expect(strFromU8(zip[row.file])).toBe(atob(input.base64));
 });
 it('saves a shared selected checklist and locks its controls after an inspection begins',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.org);const {ctx}=makeCtx(api);
  const root=await inspectionScopeControl(ctx,ev.id);const inputs=[...root.querySelectorAll<HTMLInputElement>('input')];
  inputs[0].checked=false;inputs[0].dispatchEvent(new Event('change'));inputs.slice(1).forEach(i=>i.checked=false);inputs[1].checked=true;
  root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  const scope=await api.getInspectionScope(ev.id);expect(scope.articles).toHaveLength(1);
  const inspection=await api.saveInspection(ev.id,t1.id,'A',{});expect(inspection.selectedArticles).toEqual(scope.articles);
  const locked=await inspectionScopeControl(ctx,ev.id);expect([...locked.querySelectorAll<HTMLInputElement>('input')].every(i=>i.disabled)).toBe(true);
 });
 it('adds same-team A/B pairings and queues a lane-swapped race through the interface',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.org);const {ctx,leaves}=makeCtx(api);cleanup=leaves;
  const root=await racingScreen(ctx,ev.id);document.body.append(root);
  for(const label of ['New heat lane 1','New heat lane 2'])root.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!.value=t1.id;
  root.querySelector('.race-add')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(button(root,'Queue lane-swapped race')).toBeDefined());
  expect((await api.listRaces(ev.id))[0].lane2.car).toBe('B');
  button(root,'Queue lane-swapped race').click();await vi.waitFor(async()=>expect(await api.listRaces(ev.id)).toHaveLength(2));
  const [original,swapped]=await api.listRaces(ev.id);expect(swapped.parentHeat).toBe(original.id);expect(swapped.lane1.car).toBe('B');expect(swapped.lane2.car).toBe('A');
 });
 it('offers a rerun for DNS but no ordinary DNF rerun',async()=>{
  const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);
  for(const status of ['dns','dnf'] as const){
   const row=await api.saveRace(ev.id,crypto.randomUUID(),0,{label:status,phase:'reaction',lane1:{...blankLane(t1.id),status},lane2:{...blankLane(t2.id),status:'false_start'},note:'',source:'manual',sourceRunId:null});
   const {ctx,leaves}=makeCtx(api);cleanup.push(...leaves);const root=await racingScreen(ctx,ev.id);document.body.replaceChildren(root);
   [...root.querySelectorAll<HTMLButtonElement>('.race-queue-item')].find(b=>b.textContent?.includes(row.label))!.click();
   expect(!!button(root,'Queue eligible rerun')).toBe(status==='dns');
  }
 });
});
