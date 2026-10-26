// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {MemoryApi,type EventLogos} from '../../src/api';
import {eventsScreen} from '../../src/ui/events';
import {mountShell} from '../../src/ui/shell';
import {makeCtx} from './helpers';
const logo={name:'logo.png',mime:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
async function setup(){const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');return {api,...makeCtx(api)};}
it('previews regional branding by default and requires this event’s two national logos',async()=>{
 const {api,ctx}=await setup();const create=vi.spyOn(api,'createEvent');const root=await eventsScreen(ctx);document.body.append(root);
 const selector=root.querySelector<HTMLSelectElement>('[name=level]')!;expect(selector.value).toBe('regional');expect(root.querySelector('img[alt="Regional finals logo"]')).not.toBeNull();
 selector.value='national';selector.dispatchEvent(new Event('change'));
 const fieldset=root.querySelector('fieldset')!;expect(fieldset.hidden).toBe(false);(root.querySelector('[name=name]') as HTMLInputElement).value='National Finals';
 root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('both light and dark'));expect(create).not.toHaveBeenCalled();
});
it('creates national events only after both actual logo files are read and validated',async()=>{
 const {api,ctx}=await setup();const root=await eventsScreen(ctx);const create=vi.spyOn(api,'createEvent');
 (root.querySelector('[name=name]') as HTMLInputElement).value='Delhi Nationals';const selector=root.querySelector<HTMLSelectElement>('[name=level]')!;selector.value='national';selector.dispatchEvent(new Event('change'));
 for(const input of root.querySelectorAll('input[type=file]'))Object.defineProperty(input,'files',{value:[{name:'logo.png',size:70,arrayBuffer:async()=>Uint8Array.from(atob(logo.base64),c=>c.charCodeAt(0)).buffer}]});
 root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(create).toHaveBeenCalledTimes(1));expect(create.mock.calls[0][0]).toMatchObject({competitionLevel:'national',logos:{light:logo,dark:logo}});
 await vi.waitFor(()=>expect(location.hash).toMatch(/event/));
});
it('selects light/dark nationals logos and clears identity when leaving an event',()=>{
 const root=document.createElement('div'),shell=mountShell(root);document.body.append(root);
 shell.setBranding({level:'national',logos:{light:logo,dark:{...logo,base64:logo.base64+'different'}}});
 expect(root.querySelector<HTMLImageElement>('.brand-logo--light')!.src).toBe(`data:image/png;base64,${logo.base64}`);
 expect(root.querySelector<HTMLImageElement>('.brand-logo--dark')!.alt).toContain('National');
 shell.setBranding({level:'regional',logos:null});expect(root.querySelector('.brand-home')!.classList.contains('brand-home--regional')).toBe(true);
 shell.setBranding(null);expect(root.querySelector<HTMLImageElement>('.brand-logo--light')!.getAttribute('src')).toBe('/brand/logo-india-mono-black.png');expect(root.querySelector('.brand-home')!.classList.contains('brand-home--regional')).toBe(false);
});
