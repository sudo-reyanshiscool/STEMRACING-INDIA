import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {MemoryApi} from '../../src/api/memory';
import {buildGraphicsPackage,graphicsCsv,graphicsTeamFolder} from '../../src/api/graphics-package';
import {GRAPHICS_TEAM_HEADERS,GRAPHICS_MEMBER_HEADERS,graphicsWorkbook} from '../../src/api/graphics-workbook';
import {world,EMAILS} from '../ui/helpers';
import type {TeamBrandingProfile} from '../../src/api/team-branding';
import {ApiError} from '../../src/api/types';
const png=readFileSync(new URL('../fixtures/event-logo.png',import.meta.url));
const cell=(xml:string,address:string)=>xml.match(new RegExp(`<c r="${address}"[^>]*>.*?<t[^>]*>(.*?)</t>.*?</c>`,'s'))?.[1]??'';
async function fixture(){
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const event=await api.createEvent({name:'Graphics Event'});
 const team=await api.createTeam(event.id,{number:'001',name:'Crimson FALCONS & Co',school:'School Exact'});await api.createTeam(event.id,{number:'002',name:'Athena'});
 await api.uploadCompulsoryAsset(event.id,team.id,'team_logo',{name:'Original Logo.png',mime:'image/png',base64:png.toString('base64')},0);
 await api.saveTeamMemberPortraits(event.id,team.id,[{id:'jane',name:'JanE',role:'Design ENGINEER',fileName:'Original Portrait.png',photoMime:'image/png',photoBase64:png.toString('base64')}]);
 return {api,event,team};
}
it('automatically includes a two-sheet workbook, actual original bytes and matching relative paths',async()=>{
 const {api,event}=await fixture();const progress:string[]=[];
 const zip=unzipSync(await buildGraphicsPackage(api,event.id,p=>progress.push(p)));
 const xlsx=unzipSync(zip['STEM_Racing_India_Graphics_Data.xlsx']),book=strFromU8(xlsx['xl/workbook.xml']);
 expect(book.match(/<sheet /g)).toHaveLength(2);expect(book).toContain('name="Teams"');expect(book).toContain('name="Members"');
 const teams=strFromU8(xlsx['xl/worksheets/sheet1.xml']),members=strFromU8(xlsx['xl/worksheets/sheet2.xml']);
 expect(cell(teams,'A2')).toBe('001');expect(teams).toContain('t="inlineStr"');expect(cell(teams,'B2')).toBe('Crimson FALCONS &amp; Co');expect(cell(teams,'D2')).toBe('');
 const folder='001_Crimson FALCONS & Co';
 expect(cell(teams,'H2')).toBe((folder+'/Logos/Original Logo.png').replace('&','&amp;'));expect(cell(teams,'I2')).toBe('');expect(cell(teams,'K2')).toBe('');
 expect(zip[folder+'/Logos/Original Logo.png']).toEqual(new Uint8Array(png));
 expect(cell(members,'A2')).toBe('001');expect(cell(members,'B2')).toBe('JanE');expect(cell(members,'C2')).toBe('Design ENGINEER');
 expect(cell(members,'D2')).toBe((folder+'/Member portraits/01_JanE/Original Portrait.png').replace('&','&amp;'));
 expect(zip[folder+'/Member portraits/01_JanE/Original Portrait.png']).toEqual(new Uint8Array(png));
 expect(zip['002_Athena/']).toBeDefined();expect(strFromU8(zip['Missing_assets.csv'])).toContain('Car render front-left');expect(strFromU8(zip['Missing_information.csv'])).toContain('City');
 expect(strFromU8(zip['Asset_manifest.csv'])).toMatch(/[0-9a-f]{64}/);expect(progress.some(s=>s.includes('Team 2 of 2'))).toBe(true);
});
it('reads current saved colours anew on every export and never fabricates a city or missing asset path',async()=>{
 const {api,event,team}=await fixture();
 const first=unzipSync(unzipSync(await buildGraphicsPackage(api,event.id))['STEM_Racing_India_Graphics_Data.xlsx']);
 expect(cell(strFromU8(first['xl/worksheets/sheet1.xml']),'E2')).toBe('');
 await api.saveTeamColours(event.id,team.id,{primary:'#123456',secondary:'#654321',accent:'#ABCDEF'});
 const next=unzipSync(unzipSync(await buildGraphicsPackage(api,event.id))['STEM_Racing_India_Graphics_Data.xlsx']);const xml=strFromU8(next['xl/worksheets/sheet1.xml']);
 expect(cell(xml,'E2')).toBe('#123456');expect(cell(xml,'D2')).toBe('');expect(cell(xml,'M2')).toBe('');
});
it('denies managers and judges before downloading any private asset',async()=>{
 const {api,ev}=await world();const read=vi.spyOn(api,'downloadTeamBrandAsset');
 await expect(buildGraphicsPackage(api,ev.id)).rejects.toMatchObject({code:'forbidden'});await api.signIn(EMAILS.judge);
 await expect(buildGraphicsPackage(api,ev.id)).rejects.toMatchObject({code:'forbidden'});expect(read).not.toHaveBeenCalled();
});
it('cancels a pending read without returning a partial package',async()=>{
 const {api,event}=await fixture();const controller=new AbortController();const read=vi.spyOn(api,'teamBrandingProfile').mockImplementation(()=>new Promise(()=>{}));
 const result=buildGraphicsPackage(api,event.id,undefined,{signal:controller.signal});const check=expect(result).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(read).toHaveBeenCalled());controller.abort();await check;
});
it('refuses a package when an asset changes during export',async()=>{
 const {api,event,team}=await fixture();const original=api.downloadTeamBrandAsset.bind(api);
 vi.spyOn(api,'downloadTeamBrandAsset').mockImplementation(async(...args)=>{const data=await original(...args);await api.saveTeamColours(event.id,team.id,{primary:'#123456',secondary:'#654321',accent:'#ABCDEF'});return data;});
 await expect(buildGraphicsPackage(api,event.id)).rejects.toMatchObject({code:'conflict'});
});
it('retries transient read failures but never retries a permission denial',async()=>{
 const {api,event}=await fixture();const original=api.downloadTeamBrandAsset.bind(api);
 const read=vi.spyOn(api,'downloadTeamBrandAsset').mockRejectedValueOnce(new ApiError('network','Connection interrupted')).mockImplementation(original);
 await expect(buildGraphicsPackage(api,event.id)).resolves.toBeInstanceOf(Uint8Array);
 expect(read).toHaveBeenCalledTimes(3);
 read.mockClear().mockRejectedValue(new ApiError('forbidden','Access removed'));
 await expect(buildGraphicsPackage(api,event.id)).rejects.toMatchObject({code:'forbidden'});
 expect(read).toHaveBeenCalledTimes(2);
});
it('downloads at most three assets concurrently while preserving every included file',async()=>{
 const {api,event,team}=await fixture();
 for(const key of ['car_render_fl','car_render_fr'] as const)await api.uploadCompulsoryAsset(event.id,team.id,key,{name:key+'.png',mime:'image/png',base64:readFileSync(new URL('../fixtures/car-render.png',import.meta.url)).toString('base64')});
 const original=api.downloadTeamBrandAsset.bind(api);let active=0,maximum=0;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(api,'downloadTeamBrandAsset').mockImplementation(async(...args)=>{active++;maximum=Math.max(active,maximum);await gate;try{return await original(...args);}finally{active--;}});
 const pending=buildGraphicsPackage(api,event.id);
 await vi.waitFor(()=>expect(active).toBe(3));release();const files=unzipSync(await pending);
 expect(maximum).toBe(3);expect(Object.keys(files).filter(p=>p.endsWith('.png'))).toHaveLength(4);
});
it('preserves formula-looking names as literal Excel text and keeps CSV reports safe',()=>{
 const row=['001','=1+1','A & B','',...Array(10).fill('')];const file=unzipSync(graphicsWorkbook([row],[['001','<Name>','Role','']]));
 const xml=strFromU8(file['xl/worksheets/sheet1.xml']);expect(cell(xml,'B2')).toBe('=1+1');expect(xml).not.toContain('<f>');expect(cell(xml,'C2')).toBe('A &amp; B');
 expect(GRAPHICS_TEAM_HEADERS).toHaveLength(14);expect(GRAPHICS_MEMBER_HEADERS).toHaveLength(4);expect(graphicsCsv([['=1+1','a,b']])).toContain('"\'=1+1","a,b"');
 expect(()=>graphicsTeamFolder({team:{number:'../1',name:'Name'}} as TeamBrandingProfile)).toThrow();
});
