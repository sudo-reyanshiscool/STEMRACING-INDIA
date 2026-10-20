// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest';
import {resultDelivery} from '../../src/ui/result-delivery';
import {makeCtx,world,EMAILS,text} from './helpers';
import {rank} from '../../src/engine';
vi.mock('../../src/pdf/resultsArchive',()=>({
 buildResultsArchive:vi.fn(async()=>({filename:'Nationals-All-Results-PDFs.zip',bytes:new Uint8Array([80,75]),count:5})),
 ArchiveCancelled:class extends Error {},
 ResultsArchiveError:class extends Error {},
}));
import {buildResultsArchive} from '../../src/pdf/resultsArchive';
import * as pdfTools from '../../src/ui/pdf-tools';
const wait=()=>new Promise(r=>setTimeout(r,0));
async function setup(){const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.org);await api.setTeamContact(ev.id,t1.id,'manager@x.test');const rows=rank({ruleset:ev.ruleset,teams:[t1,t2],cards:[],overrides:[],penalties:[]}).rows;await api.publishSnapshot(ev.id,{rulesetId:ev.ruleset.id,inputHash:'a'.repeat(64),inputs:{},rows});return {api,ev,t1,t2};}
const button=(el:HTMLElement,label:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent===label)!;
describe('results delivery controls',()=>{
 it('offers a reload when an updated deployment removes a preview module and retains the selected team',async()=>{
  const {api,ev,t1}=await setup();const send=vi.spyOn(api,'sendTeamResults');
  const failed=vi.spyOn(pdfTools,'loadPdfReports').mockRejectedValueOnce(new pdfTools.PdfToolsLoadError(new TypeError('Failed to fetch dynamically imported module')));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
   const el=await resultDelivery(makeCtx(api).ctx,ev),select=el.querySelector<HTMLSelectElement>('[aria-label="Team PDF preview"]')!;
   select.value=t1.id;select.dispatchEvent(new Event('change'));
   button(el,'Download PDF previews').click();
   await vi.waitFor(()=>expect(button(el,'Reload website').hidden).toBe(false));
   expect(el.querySelector('[role=alert]')!.textContent).toContain('Reload the website and try again');
   await vi.waitFor(()=>expect(button(el,'Download PDF previews').disabled).toBe(false));
   expect(el.querySelector<HTMLSelectElement>('[aria-label="Team PDF preview"]')!.value).toBe(t1.id);
   expect(send).not.toHaveBeenCalled();
  }finally{failed.mockRestore();log.mockRestore();}
 });
 it('offers the same recovery when the all-team archive module cannot load',async()=>{
  const {api,ev}=await setup();
  const failed=vi.spyOn(pdfTools,'loadResultsArchive').mockRejectedValueOnce(new pdfTools.PdfToolsLoadError(new TypeError('Importing a module script failed')));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
   const el=await resultDelivery(makeCtx(api).ctx,ev);button(el,'Download all PDFs (ZIP)').click();
   await vi.waitFor(()=>expect(button(el,'Reload website').hidden).toBe(false));
   expect(el.querySelector('[role=alert]')!.textContent).toContain('PDF tools could not load');
  }finally{failed.mockRestore();log.mockRestore();}
 });
 it('downloads every team in one ZIP without sending emails or requiring a selected preview team',async()=>{
  const {api,ev,t1,t2}=await setup();const send=vi.spyOn(api,'sendTeamResults');
  const el=await resultDelivery(makeCtx(api).ctx,ev);
  const create=vi.fn((_blob:Blob)=> 'blob:archive'),revoke=vi.fn();
  vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:create,revokeObjectURL:revoke}));
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  try{
   button(el,'Download all PDFs (ZIP)').click();
   await vi.waitFor(()=>expect(click).toHaveBeenCalledOnce());
   expect(buildResultsArchive).toHaveBeenCalledWith(expect.objectContaining({id:ev.id}),[t1,t2],expect.any(Function),expect.any(Object));
   expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('Nationals-All-Results-PDFs.zip');
   expect(send).not.toHaveBeenCalled();expect(create.mock.calls[0][0].type).toBe('application/zip');
   expect(text(el)).toContain('Downloaded 5 PDFs in one ZIP file');
  }finally{click.mockRestore();vi.unstubAllGlobals();}
 });
 it('requires released results and awards confirmed by event staff before sending',async()=>{
  const {api,ev}=await setup();const el=await resultDelivery(makeCtx(api).ctx,ev);
  expect(button(el,'Email results to managers').disabled).toBe(true);
  button(el,'Confirm award winners').click();await wait();expect((await api.resultMailState(ev.id)).confirmed).toBe(true);
  expect(button(el,'Email results to managers').disabled).toBe(true);
 });
 it('reviews saved recipients, sends only after confirmation, and skips successful deliveries',async()=>{
  const {api,ev}=await setup();await api.confirmAwards(ev.id);await api.setReleased(ev.id,true);const released=(await api.getEvent(ev.id))!;
  const send=vi.spyOn(api,'sendTeamResults');const el=await resultDelivery(makeCtx(api).ctx,released);
  button(el,'Email results to managers').click();expect(text(el)).toContain('manager@x.test');expect(send).not.toHaveBeenCalled();
  button(el,'Send 1 results email').click();await vi.waitFor(()=>expect(send).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(button(el,'Email results to managers').disabled).toBe(true));
  await vi.waitFor(()=>expect(text(el)).toContain('Email sent'));expect(text(el)).toContain('Add email in Teams');
 });
 it('saves manually selected awards and requires confirmation again after changes',async()=>{
  const {api,ev,t1}=await setup();const el=await resultDelivery(makeCtx(api).ctx,ev);
  (el.querySelector('[name=awardTitle]') as HTMLInputElement).value='Team Identity';(el.querySelector('[name=awardTeam]') as HTMLSelectElement).value=t1.id;
  el.querySelector<HTMLFormElement>('form[aria-label="Award winners"]')!.dispatchEvent(new Event('submit',{cancelable:true}));await wait();
  expect((await api.resultMailState(ev.id)).awards).toMatchObject([{title:'Team Identity',teamId:t1.id}]);expect((await api.resultMailState(ev.id)).confirmed).toBe(false);
  button(el,'Confirm award winners').click();await wait();expect((await api.resultMailState(ev.id)).confirmed).toBe(true);
 });
});
