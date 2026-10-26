import {ApiError} from './types';
import {validateTeamFile} from './team-files';
export type CompetitionLevel='regional'|'national';
export const COMPETITION_LEVEL_LABEL:Record<CompetitionLevel,string>={regional:'Regional finals',national:'National finals'};
export interface EventLogo {name:string;mime:'image/png';base64:string;width?:number;height?:number}
export interface EventLogos {light:EventLogo;dark:EventLogo}
export interface EventBranding {level:CompetitionLevel|null;logos:EventLogos|null}
export interface NewEvent {name:string;startsOn?:string;competitionLevel?:CompetitionLevel;logos?:EventLogos}
export function validateEventLogos(value:EventLogos):EventLogos {
 if(!value||typeof value!=='object')throw new ApiError('invalid','Upload both nationals logos.');
 const result={} as EventLogos;
 for(const key of ['light','dark'] as const){
  const logo=value[key];if(!logo||logo.mime!=='image/png')throw new ApiError('invalid','Upload a PNG logo for light backgrounds and another for dark backgrounds.');
  validateTeamFile({...logo,kind:'logo'});const bytes=atob(logo.base64);
  const dimension=(at:number)=>[at,at+1,at+2,at+3].reduce((v,i)=>v*256+bytes.charCodeAt(i),0);
  result[key]={name:logo.name.trim(),mime:'image/png',base64:logo.base64,width:dimension(16),height:dimension(20)};
 }return result;
}
export const eventLogoSource=(branding:EventBranding|null|undefined,dark=false):string|null=>{
 if(branding?.level==='regional')return '/brand/logo-regional-finals-white.png';
 const logo=branding?.level==='national'?branding.logos?.[dark?'dark':'light']:null;
 return logo?`data:image/png;base64,${logo.base64}`:null;
};
