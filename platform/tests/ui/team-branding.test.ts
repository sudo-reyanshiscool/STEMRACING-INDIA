// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {teamBrandingScreen} from '../../src/ui/team-branding';
import {brandingProfileHtml} from '../../src/api/team-branding';
import {world,makeCtx,EMAILS} from './helpers';
it('shows only managed profiles with missing assets, downloads and a submissions link',async()=>{
 const {api,ev,t1}=await world();const root=await teamBrandingScreen(makeCtx(api).ctx,ev.id);
 expect(root.querySelectorAll('option')).toHaveLength(1);expect(root.querySelector('option')!.value).toBe(t1.id);expect(root.textContent).toContain('0 of 8');expect(root.textContent).toContain('Download branding pack');expect(root.querySelector('a[href$="/submissions"]')).not.toBeNull();
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
