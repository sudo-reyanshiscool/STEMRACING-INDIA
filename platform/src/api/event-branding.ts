import {ApiError} from './types';
import {validateTeamFile} from './team-files';
export type CompetitionLevel='regional'|'national';
export const COMPETITION_LEVEL_LABEL:Record<CompetitionLevel,string>={regional:'Regional finals',national:'National finals'};
export interface EventLogo {name:string;mime:'image/png';base64:string;width?:number;height?:number}
export interface EventLogos {monoBlack:EventLogo;monoWhite:EventLogo;light:EventLogo;dark:EventLogo}
export const EVENT_LOGO_SLOTS=[{key:'monoBlack',label:'Monochrome black',dark:false},{key:'monoWhite',label:'Monochrome white',dark:true},{key:'dark',label:'Full colour · white text',dark:true},{key:'light',label:'Full colour · black text',dark:false}] as const;
export interface EventBranding {level:CompetitionLevel|null;logos:EventLogos|null}
export interface NewEvent {name:string;startsOn?:string;competitionLevel?:CompetitionLevel;logos?:EventLogos}
export function validateEventLogos(value:EventLogos):EventLogos {
 if(!value||typeof value!=='object')throw new ApiError('invalid','Upload all four nationals logos.');
 const result={} as EventLogos;
 for(const key of ['monoBlack','monoWhite','light','dark'] as const){
  const logo=value[key];if(!logo||logo.mime!=='image/png')throw new ApiError('invalid','Upload all four PNG logos: monochrome black, monochrome white, full colour with white text, and full colour with black text.');
  validateTeamFile({...logo,kind:'logo'});const bytes=atob(logo.base64);
  const dimension=(at:number)=>[at,at+1,at+2,at+3].reduce((v,i)=>v*256+bytes.charCodeAt(i),0);
  result[key]={name:logo.name.trim(),mime:'image/png',base64:logo.base64,width:dimension(16),height:dimension(20)};
 }return result;
}
export const eventLogoSource=(branding:EventBranding|null|undefined,dark=false,monochrome=false):string|null=>{
 if(branding?.level==='regional')return '/brand/logo-regional-finals-white.png';
 const logo=branding?.level==='national'?(monochrome?(branding.logos?.[dark?'monoWhite':'monoBlack']??branding.logos?.[dark?'dark':'light']):branding.logos?.[dark?'dark':'light']):null;
 return logo?`data:image/png;base64,${logo.base64}`:null;
};
