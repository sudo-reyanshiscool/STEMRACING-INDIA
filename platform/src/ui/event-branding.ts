import {COMPETITION_LEVEL_LABEL,eventLogoSource,type EventBranding,type EventRow} from '../api';
import {h} from './dom';
export function eventIdentity(event:EventRow,branding:EventBranding){
 const src=eventLogoSource(branding,true);if(!event.competitionLevel||!src)return null;
 return h('section',{class:'event-identity','aria-label':`${COMPETITION_LEVEL_LABEL[event.competitionLevel]} identity`},
  h('img',{src,alt:`STEM Racing India · ${COMPETITION_LEVEL_LABEL[event.competitionLevel]}`,class:'event-identity__logo'}),
  h('div',null,h('p',{class:'eyebrow'},COMPETITION_LEVEL_LABEL[event.competitionLevel]),h('p',{class:'event-identity__name'},event.name)));
}
export async function readEventLogo(file:File){
 if(file.size>2*1024*1024)throw new Error('Each logo must be 2 MB or smaller.');
 const bytes=new Uint8Array(await file.arrayBuffer());let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {name:file.name,mime:'image/png' as const,base64:btoa(value)};
}
