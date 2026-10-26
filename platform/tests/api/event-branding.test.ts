import {it,expect} from 'vitest';
import {MemoryApi,eventLogoSource,validateEventLogos} from '../../src/api';
const logo={name:'logo.png',mime:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
it('keeps independently uploaded national identities across event reads and copy boundaries',async()=>{
 const api=new MemoryApi();await api.signIn('reyanshg11111@gmail.com');const a=await api.createEvent({name:'A',competitionLevel:'national',logos:{light:logo,dark:logo}}),b=await api.createEvent({name:'B',competitionLevel:'national',logos:{light:{...logo,name:'B.png'},dark:logo}});
 expect((await api.getEvent(a.id))?.competitionLevel).toBe('national');expect((await api.eventBranding(a.id)).logos?.light.name).toBe('logo.png');expect((await api.eventBranding(b.id)).logos?.light.name).toBe('B.png');
 const read=await api.eventBranding(a.id);read.logos!.light.name='changed';expect((await api.eventBranding(a.id)).logos?.light.name).toBe('logo.png');
 await expect(api.createEvent({name:'Invalid',competitionLevel:'national'})).rejects.toMatchObject({code:'invalid'});expect((await api.listEvents()).length).toBe(2);
});
it('validates logo files and uses the selected competition identity without guessing from the name',()=>{
 expect(validateEventLogos({light:logo,dark:logo}).light).toMatchObject({width:1,height:1});expect(()=>validateEventLogos({light:{...logo,mime:'image/svg+xml' as any},dark:logo})).toThrow();
 expect(eventLogoSource({level:'regional',logos:null})).toContain('logo-regional-finals');expect(eventLogoSource({level:'national',logos:{light:logo,dark:logo}},true)).toContain(logo.base64);expect(eventLogoSource({level:null,logos:null})).toBeNull();
});
