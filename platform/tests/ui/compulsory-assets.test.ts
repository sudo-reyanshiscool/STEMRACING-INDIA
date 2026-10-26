// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {MemoryApi} from '../../src/api';
import {compulsoryAssetsSection} from '../../src/ui/compulsory-assets';
import {makeCtx} from './helpers';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
afterEach(()=>{document.body.replaceChildren();localStorage.clear();vi.restoreAllMocks();});
async function setup(){const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const e=await api.createEvent({name:'Event'}),t=await api.createTeam(e.id,{number:'1',name:'Apex'});return {api,e,t,...makeCtx(api)};}
it('saves the actual member role and portrait, then reloads the server-confirmed checklist',async()=>{
 const {api,e,t,ctx}=await setup();const save=vi.spyOn(api,'saveTeamMemberPortraits');const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);document.body.append(root);
 (root.querySelector('[aria-label="Member name"]') as HTMLInputElement).value='Aarav';(root.querySelector('[aria-label="Member role"]') as HTMLInputElement).value='Chief Engineer';
 const input=root.querySelector('[aria-label="Member portrait"]') as HTMLInputElement;
 Object.defineProperty(input,'files',{value:[{name:'portrait.png',size:70,arrayBuffer:async()=>Uint8Array.from(atob(png),c=>c.charCodeAt(0)).buffer}]});
 input.closest('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.textContent).toContain('1 / 8 media categories submitted'));
 expect(save.mock.calls[0][2][0]).toMatchObject({name:'Aarav',role:'Chief Engineer',photoBase64:png});
 expect(root.textContent).toContain('Chief Engineer');
});
it('shows load failures and a retry instead of falsely reporting empty or complete submissions',async()=>{
 const {api,e,t,ctx}=await setup();vi.spyOn(api,'getCompulsoryAssets').mockRejectedValue(new Error('Server unavailable'));
 const root=await compulsoryAssetsSection(ctx,e.id,[t],[],true);
 expect(root.querySelector('[role=alert]')).not.toBeNull();expect(root.textContent).toContain('Retry media status');expect(root.textContent).not.toContain('8 / 8');
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
 expect(root.textContent).toContain('0 / 8 media categories submitted');expect(root.textContent).toContain('not confirmed event submissions');expect(root.textContent).toContain('Recover valid local files');
});
