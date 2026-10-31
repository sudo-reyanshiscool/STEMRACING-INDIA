// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import * as apiExports from '../../src/api';
import {teamBrandingScreen} from '../../src/ui/team-branding';
import {brandingProfileHtml} from '../../src/api/team-branding';
import {world,makeCtx,EMAILS} from './helpers';
it('shows only managed profiles with missing assets, downloads and a submissions link',async()=>{
 const {api,ev,t1}=await world();const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);
 expect(root.querySelectorAll('option')).toHaveLength(1);expect(root.querySelector('option')!.value).toBe(t1.id);expect(root.textContent).toContain('0 of 8');expect(root.textContent).toContain('Download branding pack');expect(root.textContent).toContain('Download PDF');expect(root.querySelector('a[href$="/submissions"]')).not.toBeNull();
 expect(root.textContent).not.toContain('Two');
});
it('lets organisers choose all teams and refuses judges',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);expect(root.querySelectorAll('option')).toHaveLength(2);
 await api.signIn(EMAILS.judge);const denied=await teamBrandingScreen(makeCtx(api).ctx,ev.id);expect(denied.textContent).toContain('available to your team');expect(denied.querySelector('button')).toBeNull();
});
it('escapes team content in downloadable HTML and keeps it offline',async()=>{
 const {api,ev,t1}=await world();const p=await api.teamBrandingProfile(ev.id,t1.id);p.team.name='<script>alert(1)</script>';const html=brandingProfileHtml(p);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain("default-src 'none'");expect(html).not.toContain('https://');
});
it('shows server errors without inventing an empty profile',async()=>{
 const {api,ev}=await world();vi.spyOn(api,'teamBrandingProfile').mockRejectedValue(Error('Offline'));const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);expect(root.querySelector('[role=status]')!.textContent).toContain('Something went wrong');expect(root.textContent).not.toContain('0 of 8');
});
it('offers the all-team pack to event staff only',async()=>{
 const {api,ev}=await world();
 expect((await teamBrandingScreen(makeCtx(api).ctx,ev.id)).textContent).not.toContain('Download all team branding');
 await api.signIn(EMAILS.org);const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);
 expect(root.textContent).toContain('Download all team branding');expect([...root.querySelectorAll('button')].find(b=>b.textContent==='Cancel download')?.hidden).toBe(true);
});

it('shows export progress, cancels and restores the controls without downloading a partial pack',async()=>{
 const build=vi.spyOn(apiExports,'buildEventBrandingArchive').mockImplementation(async(_api,_event,progress,options)=>{
  progress?.('Team 1 of 2 — Preparing logo…');
  return new Promise<Uint8Array<ArrayBuffer>>((_resolve,reject)=>options?.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
 });
 try{
  const {api,ev}=await world();await api.signIn(EMAILS.org);const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);
  const bulk=[...root.querySelectorAll('button')].find(b=>b.textContent==='Download all team branding')!;
  const cancel=[...root.querySelectorAll('button')].find(b=>b.textContent==='Cancel download')!;
  bulk.click();expect(bulk.disabled).toBe(true);expect(root.querySelector('select')!.disabled).toBe(true);expect(cancel.hidden).toBe(false);
  expect(root.querySelector('[role=status]')!.textContent).toContain('Team 1 of 2');
  cancel.click();await vi.waitFor(()=>expect(bulk.disabled).toBe(false));
  expect(root.querySelector('select')!.disabled).toBe(false);expect(cancel.hidden).toBe(true);expect(root.querySelector('[role=status]')!.textContent).toContain('No partial ZIP');
 }finally{build.mockRestore();}
});
