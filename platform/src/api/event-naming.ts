import type {CompetitionLevel,EventLogos} from './event-branding';
import type {EventRow,Role} from './types';

/** Fixed start of every automatic event name. The database builds the same name in event_display_name(). */
export const EVENT_NAME_PREFIX='STEM Racing India';
export const MAX_BATCH_EVENTS=30;

/** season is a year (2027) or a season of consecutive years (2026-27); see normaliseSeason. */
export interface NamedEventInput {level:CompetitionLevel;city:string;season:string;startsOn?:string;logos?:EventLogos}
/** customName set: stored as typed. Otherwise the name is rebuilt from the parts; a missing regionalNumber keeps the current one, or takes the next free number for a new city or season. */
export interface EventNameInput {city:string|null;season:string|null;regionalNumber?:number|null;customName?:string|null}
/** Roles that can be added to or removed from several events at once. Judges need a panel and team managers a team, so they stay on each event's People page. */
export const BATCH_ROLES=['organiser','chair','scrutineer','race_official'] as const satisfies readonly Role[];
export type BatchRole=typeof BATCH_ROLES[number];
export interface BatchOutcome {eventId:string;ok:boolean;message:string}

export const normaliseCity=(city:string)=>city.normalize('NFC').trim().replace(/\s+/gu,' ');
const cityKey=(city:string)=>normaliseCity(city).toLowerCase();

export const SEASON_HINT='Enter a year such as 2027, or a season such as 2026-27.';
/** Accepts 2027, 2026-27 or 2026-2027 (dashes too) and returns 2027 or 2026-27; null when invalid. Matches checked_event_season(). */
export function normaliseSeason(input:string|number|null|undefined):string|null{
  const s=String(input??'').trim().replace(/[–—]/gu,'-');
  if(/^\d{4}$/.test(s))return Number(s)>=2000&&Number(s)<=2100?s:null;
  const m=/^(\d{4})-(\d{2}|\d{4})$/.exec(s);if(!m)return null;
  const a=Number(m[1]),b=Number(m[2]);
  if(a<2000||a>2099||(m[2]!.length===2?b!==(a+1)%100:b!==a+1))return null;
  return `${a}-${String((a+1)%100).padStart(2,'0')}`;
}

/** regionalNumber may be placeholder text in previews, such as "(next number)". */
export function eventDisplayName(level:CompetitionLevel,city:string,season:string,regionalNumber?:number|string|null):string{
  return `${EVENT_NAME_PREFIX} ${normaliseCity(city)} ${level==='regional'?`Regionals ${regionalNumber}`:'Nationals'} ${normaliseSeason(season)??season.trim()}`;
}

/** Each city counts its own regionals per season, so the second Delhi regional of 2026-27 is Delhi Regionals 2. 2027 and 2026-27 count separately. */
export function nextRegionalNumber(events:readonly EventRow[],city:string,season:string,except?:string):number{
  const key=cityKey(city),s=normaliseSeason(season);
  return Math.max(0,...events.filter(e=>e.id!==except&&e.competitionLevel==='regional'&&!!s&&e.season===s&&e.city&&cityKey(e.city)===key).map(e=>e.regionalNumber??0))+1;
}

/** Previews the numbers a batch will receive, counting existing events and earlier rows of the same batch. */
export function previewBatchNames(existing:readonly EventRow[],rows:readonly Pick<NamedEventInput,'level'|'city'|'season'>[]):(string|null)[]{
  const taken=new Map<string,number>();
  return rows.map(r=>{
    const season=normaliseSeason(r.season);
    if(!normaliseCity(r.city)||!season)return null;
    if(r.level!=='regional')return eventDisplayName(r.level,r.city,season);
    const key=`${cityKey(r.city)}|${season}`;
    const n=(taken.get(key)??nextRegionalNumber(existing,r.city,season)-1)+1;
    taken.set(key,n);
    return eventDisplayName('regional',r.city,season,n);
  });
}

export function validateNamedEvent(i:NamedEventInput):string|null{
  if(i.level!=='regional'&&i.level!=='national')return 'Choose Regionals or Nationals.';
  const city=normaliseCity(i.city??'');
  if(!city||city.length>60)return 'Enter the city (up to 60 characters).';
  if(!normaliseSeason(i.season))return SEASON_HINT;
  if(i.startsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(i.startsOn))return 'Dates must be valid (YYYY-MM-DD).';
  return null;
}
