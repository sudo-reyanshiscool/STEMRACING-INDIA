import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {BRANDING_RESOURCES,loadBrandingResources} from '../../src/api/branding-resources';
afterEach(()=>vi.unstubAllGlobals());
it('loads supplied artwork and fonts from this platform for complete offline packs',async()=>{
 const fetcher=vi.fn(async(url:string)=>{const bytes=readFileSync(new URL('../../public'+url,import.meta.url));return new Response(bytes,{status:200});});vi.stubGlobal('fetch',fetcher);
 const resources=await loadBrandingResources();expect(resources.map(r=>r.path)).toEqual(BRANDING_RESOURCES.map(r=>r.path));expect(resources.every(r=>r.bytes.length>0)).toBe(true);
 for(const r of resources)expect(r.bytes).toEqual(new Uint8Array(readFileSync(new URL('../../public'+BRANDING_RESOURCES.find(a=>a.path===r.path)!.url,import.meta.url))));
 expect(fetcher.mock.calls.every(([url])=>url.startsWith('/'))).toBe(true);
});
it('stops the download when brand resources fail instead of creating an unbranded pack',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));await expect(loadBrandingResources()).rejects.toThrow(/Brand artwork/);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:200})));await expect(loadBrandingResources()).rejects.toThrow(/Brand artwork/);
});
