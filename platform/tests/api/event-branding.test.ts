import {it,expect} from 'vitest';
import { eventLogoSource, validateEventLogos } from '../../src/api';
import { MemoryApi } from '../../src/api/memory';
const logo={name:'logo.png',mime:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
it('keeps independently uploaded national identities across event reads and copy boundaries',async()=>{
 const api=new MemoryApi();await api.signIn('owner@platform.invalid');const a=await api.createEvent({name:'A',competitionLevel:'national',logos:{monoBlack:logo,monoWhite:logo,light:logo,dark:logo}}),b=await api.createEvent({name:'B',competitionLevel:'national',logos:{monoBlack:logo,monoWhite:logo,light:{...logo,name:'B.png'},dark:logo}});
 expect((await api.getEvent(a.id))?.competitionLevel).toBe('national');expect((await api.eventBranding(a.id)).logos?.light.name).toBe('logo.png');expect((await api.eventBranding(b.id)).logos?.light.name).toBe('B.png');
 const read=await api.eventBranding(a.id);read.logos!.light.name='changed';expect((await api.eventBranding(a.id)).logos?.light.name).toBe('logo.png');
 await expect(api.createEvent({name:'Invalid',competitionLevel:'national'})).rejects.toMatchObject({code:'invalid'});expect((await api.listEvents()).length).toBe(2);
});
it('validates logo files and uses the selected competition identity without guessing from the name',()=>{
 expect(validateEventLogos({monoBlack:logo,monoWhite:logo,light:logo,dark:logo}).light).toMatchObject({width:1,height:1});expect(()=>validateEventLogos({monoBlack:logo,monoWhite:logo,light:{...logo,mime:'image/svg+xml' as any},dark:logo})).toThrow();
 expect(eventLogoSource({level:'regional',logos:null})).toContain('logo-regional-finals');expect(eventLogoSource({level:'national',logos:{monoBlack:logo,monoWhite:logo,light:logo,dark:logo}},true)).toContain(logo.base64);expect(eventLogoSource({level:null,logos:null})).toBeNull();
});

it('keeps all four variants, prefers full colour and falls back to monochrome only when full colour is missing',()=>{
 const set={monoBlack:{...logo,name:'mono-black.png'},monoWhite:{...logo,name:'mono-white.png'},light:{...logo,name:'colour-black.png'},dark:{...logo,name:'colour-white.png'}};
 expect(Object.keys(validateEventLogos(set))).toEqual(['monoBlack','monoWhite','light','dark']);
 expect(()=>validateEventLogos({light:logo,dark:logo} as any)).toThrow(/four/);
 const branding={level:'national' as const,logos:{...set,monoBlack:{...logo,base64:'mono-black'},monoWhite:{...logo,base64:'mono-white'},light:{...logo,base64:'colour-black'},dark:{...logo,base64:'colour-white'}}};
 expect(eventLogoSource(branding,false)).toBe('data:image/png;base64,colour-black');expect(eventLogoSource(branding,true)).toBe('data:image/png;base64,colour-white');
 const monoOnly={level:'national' as const,logos:{monoBlack:branding.logos.monoBlack,monoWhite:branding.logos.monoWhite} as any};
 expect(eventLogoSource(monoOnly,false)).toBe('data:image/png;base64,mono-black');expect(eventLogoSource(monoOnly,true)).toBe('data:image/png;base64,mono-white');
 expect(eventLogoSource({level:'regional',logos:null},false)).toBe('/brand/logo-regional-finals-black.png');expect(eventLogoSource({level:'regional',logos:null},true)).toBe('/brand/logo-regional-finals-white.png');
 // An opaque PNG (colour type 2, no alpha) would show as a solid rectangle on the page.
 const bytes=atob(logo.base64),opaque=btoa(bytes.slice(0,25)+String.fromCharCode(2)+bytes.slice(26));
 expect(()=>validateEventLogos({...set,light:{...logo,name:'boxed.png',base64:opaque}})).toThrow(/transparent background/);
});
