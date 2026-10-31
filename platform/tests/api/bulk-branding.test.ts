import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {buildEventBrandingArchive,eventBrandingArchiveName} from '../../src/api/team-branding';
import {world,EMAILS} from '../ui/helpers';
const png=readFileSync(new URL('../fixtures/event-logo.png',import.meta.url));
const resources=vi.fn(async()=>[{path:'brand/shared-font.woff2',mime:'font/woff2',bytes:new Uint8Array([1,2,3])}]);
const renderPdf=vi.fn(async(p:any)=>new TextEncoder().encode('%PDF-example '+p.team.name));
it('puts every team in a distinct folder with a PDF, original bytes and missing-submission details',async()=>{
 const {api,ev,t1}=await world();await api.signIn(EMAILS.org);
 await api.uploadCompulsoryAsset(ev.id,t1.id,'team_logo',{name:'logo.png',mime:'image/png',base64:png.toString('base64')},0);
 const load=vi.fn(resources),render=vi.fn(renderPdf),progress:string[]=[];
 const bytes=await buildEventBrandingArchive(api,ev.id,s=>progress.push(s),{loadResources:load,renderPdf:render});
 const files=unzipSync(bytes),index=JSON.parse(strFromU8(files['index.json']));
 expect(index.teams).toHaveLength(2);expect(new Set(index.teams.map((t:any)=>t.folder)).size).toBe(2);
 expect(files[index.teams[0].folder+'/identity/team-logo.png']).toEqual(new Uint8Array(png));
 for(const team of index.teams){expect(strFromU8(files[team.folder+'/profile.pdf'])).toContain('%PDF-example');expect(files[team.folder+'/profile.json']).toBeDefined();expect(files[team.folder+'/colours.css']).toBeDefined();expect(strFromU8(files[team.folder+'/README.txt'])).toContain('Missing:');}
 expect(load).toHaveBeenCalledTimes(1);expect(render).toHaveBeenCalledTimes(2);expect(Object.keys(files).filter(p=>p.endsWith('shared-font.woff2'))).toHaveLength(1);
 expect(progress.some(p=>p.includes('Team 2 of 2'))).toBe(true);
 expect(eventBrandingArchiveName('../../Nationals')).not.toContain('../');expect(Object.keys(files).every(p=>!p.includes('../'))).toBe(true);
});
it('does not allow a team manager or judge to start an all-team export',async()=>{
 const {api,ev}=await world();const read=vi.spyOn(api,'downloadTeamBrandAsset');
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{loadResources:resources,renderPdf})).rejects.toMatchObject({code:'forbidden'});
 await api.signIn(EMAILS.judge);
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{loadResources:resources,renderPdf})).rejects.toMatchObject({code:'forbidden'});expect(read).not.toHaveBeenCalled();
});
it('cancels between teams and never returns a partial archive',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);const controller=new AbortController();const render=vi.fn(async()=>{controller.abort();return new Uint8Array([1]);});
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{signal:controller.signal,loadResources:resources,renderPdf:render})).rejects.toMatchObject({name:'AbortError'});expect(render).toHaveBeenCalledTimes(1);
});
it('fails the entire export when a PDF fails or the signed-in identity changes',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{loadResources:resources,renderPdf:async()=>{throw Error('render failed');}})).rejects.toThrow('render failed');
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{loadResources:resources,renderPdf:async()=>{await api.signIn(EMAILS.mgr);return new Uint8Array([1]);}})).rejects.toMatchObject({code:'unauthenticated'});
});
it('rejects a changed source before packaging the PDF',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.org);
 await expect(buildEventBrandingArchive(api,ev.id,undefined,{loadResources:resources,renderPdf:async(p)=>{await api.saveTeamColours(ev.id,p.team.id,{primary:'#123456',secondary:'#654321',accent:'#AABBCC'});return new Uint8Array([1]);}})).rejects.toMatchObject({code:'conflict'});
});
