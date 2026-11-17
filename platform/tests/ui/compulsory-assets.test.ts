// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import { MemoryApi } from '../../src/api/memory';
import {compulsoryAssetsSection} from '../../src/ui/compulsory-assets';
import {makeCtx} from './helpers';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
afterEach(()=>{document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks();});
async function setup(){const api=new MemoryApi();await api.signIn('owner@platform.invalid');const e=await api.createEvent({name:'Event'}),t=await api.createTeam(e.id,{number:'1',name:'Apex'});return {api,e,t,...makeCtx(api)};}
it('saves the actual member role and portrait, then reloads the server-confirmed checklist',async()=>{
 const {api,e,t,ctx}=await setup();const save=vi.spyOn(api,'saveTeamMemberPortraits');const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);document.body.append(root);
 (root.querySelector('[aria-label="Member name"]') as HTMLInputElement).value='Aarav';(root.querySelector('[aria-label="Member role"]') as HTMLInputElement).value='Chief Engineer';
 const input=root.querySelector('[aria-label="Member portrait"]') as HTMLInputElement;
 Object.defineProperty(input,'files',{value:[{name:'portrait.png',size:70,arrayBuffer:async()=>Uint8Array.from(atob(png),c=>c.charCodeAt(0)).buffer}]});
 input.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.textContent).toContain('1 / 10 media categories submitted'));
 expect(save.mock.calls[0][2][0]).toMatchObject({name:'Aarav',role:'Chief Engineer',photoBase64:png});
 expect(root.textContent).toContain('Chief Engineer');
});
it('shows load failures and a retry instead of falsely reporting empty or complete submissions',async()=>{
 const {api,e,t,ctx}=await setup();vi.spyOn(api,'getCompulsoryAssets').mockRejectedValue(new Error('Server unavailable'));
 const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);
 expect(root.querySelector('[role=alert]')).not.toBeNull();expect(root.textContent).toContain('Retry media status');expect(root.textContent).not.toContain('10 / 10');
});
it('keeps released submissions read-only, including all colour and portrait controls',async()=>{
 const {api,e,t,ctx}=await setup();vi.spyOn(api,'getEvent').mockResolvedValue({...e,resultsReleased:true});
 const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);
 expect(root.textContent).toContain('Submissions are read-only');expect(root.querySelector('input[type=file]')).toBeNull();
 expect([...root.querySelectorAll('button')].every(b=>b.disabled)).toBe(true);
});
it('does not count earlier local-only data as confirmed event submissions',async()=>{
 const {e,t,ctx}=await setup();localStorage.setItem(`compulsory:${e.id}:${t.id}`,JSON.stringify({carRenderFL:{name:'local.png',base64:'bad'}}));
 const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);
 expect(root.textContent).toContain('0 / 10 media categories submitted');expect(root.textContent).toContain('not confirmed event submissions');expect(root.textContent).toContain('Recover valid local files');
});
it('lets a team save its school name and upload its school logo, then shows both as submitted',async()=>{
 const {api,e,t,ctx}=await setup();const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);document.body.append(root);
 expect(root.textContent).toContain('9. School logo');expect(root.textContent).toContain('10. School name');
 const name=root.querySelector('[aria-label="School name"]') as HTMLInputElement;name.value='  The British School ';
 name.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.textContent).toContain('1 / 10 media categories submitted'));
 expect((await api.listTeams(e.id))[0].school).toBe('The British School');
 expect((root.querySelector('[aria-label="School name"]') as HTMLInputElement).value).toBe('The British School');
 const logo=root.querySelector('[aria-label="School logo file"]') as HTMLInputElement;expect(logo.accept).toBe('.svg,.png');
 Object.defineProperty(logo,'files',{value:[{name:'school.png',size:70,arrayBuffer:async()=>Uint8Array.from(atob(png),c=>c.charCodeAt(0)).buffer}]});
 logo.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.textContent).toContain('2 / 10 media categories submitted'));
 expect((await api.getCompulsoryAssets(e.id,t.id)).schoolLogo).toMatchObject({name:'school.png',mime:'image/png'});
});
it('refuses an empty school name without calling the server',async()=>{
 const {api,e,t,ctx}=await setup();const save=vi.spyOn(api,'saveSchoolName');const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);document.body.append(root);
 const name=root.querySelector('[aria-label="School name"]') as HTMLInputElement;name.value='   ';
 name.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.querySelector('.alert')).not.toBeNull());expect(save).not.toHaveBeenCalled();
});
