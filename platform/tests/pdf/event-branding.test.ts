import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {jsPDF} from 'jspdf';
import {drawEventLockup} from '../../supabase/functions/_shared/event-lockup';
import {buildHeatsPdf} from '../../src/pdf/heatsPdf';
const image={base64:readFileSync(new URL('../fixtures/event-logo.png',import.meta.url)).toString('base64'),mime:'image/png',width:12,height:4};
it('uses the national PNG instead of regional vector artwork and preserves its aspect ratio',()=>{
 const doc=new jsPDF(),add=vi.spyOn(doc,'addImage'),vector=vi.spyOn(doc,'path');
 drawEventLockup(doc,10,10,60,40,true,{level:'national',logos:{light:image,dark:image}});
 expect(add).toHaveBeenCalled();expect(vector).not.toHaveBeenCalled();expect(add.mock.calls[0].slice(2,6)).toEqual([10,20,60,20]);
 const regional=new jsPDF(),paths=vi.spyOn(regional,'path');drawEventLockup(regional,10,10,60,40,true,{level:'regional',logos:null});expect(paths).toHaveBeenCalled();
});
it('identifies national heats correctly without inserting the regional logo image',()=>{
 const doc=buildHeatsPdf({eventName:'National Finals',teams:[],races:[],branding:{level:'national',logos:{light:image,dark:image}}});
 expect(doc.output()).toContain('National Finals');expect(doc.output()).not.toContain('Regional Finals');
 expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
});
