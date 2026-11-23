import type {CompetitionLevel,EventLogos} from './event-branding';
import type {EventRow,Role} from './types';

/** Fixed start of every automatic event name. The database builds the same name in event_display_name(). */
export const EVENT_NAME_PREFIX='STEM Racing India';
export const MAX_BATCH_EVENTS=30;

export interface NamedEventInput {level:CompetitionLevel;city:string;year:number;startsOn?:string;logos?:EventLogos}
/** customName set: stored as typed. Otherwise the name is rebuilt from the parts; a missing regionalNumber keeps the current one, or takes the next free number for a new city or year. */
export interface EventNameInput {city:string|null;year:number|null;regionalNumber?:number|null;customName?:string|null}
/** Roles that can be added to or removed from several events at once. Judges need a panel and team managers a team, so they stay on each event's People page. */
export const BATCH_ROLES=['organiser','chair','scrutineer','race_official'] as const satisfies readonly Role[];
export type BatchRole=typeof BATCH_ROLES[number];
export interface BatchOutcome {eventId:string;ok:boolean;message:string}

export const normaliseCity=(city:string)=>city.normalize('NFC').trim().replace(/\s+/gu,' ');
const cityKey=(city:string)=>normaliseCity(city).toLowerCase();

/** regionalNumber may be placeholder text in previews, such as "(next number)". */
export function eventDisplayName(level:CompetitionLevel,city:string,year:number,regionalNumber?:number|string|null):string{
  return `${EVENT_NAME_PREFIX} ${normaliseCity(city)} ${level==='regional'?`Regionals ${regionalNumber}`:'Nationals'} ${year}`;
}

/** Each city counts its own regionals per year, so the second Delhi regional of 2027 is Delhi Regionals 2. */
export function nextRegionalNumber(events:readonly EventRow[],city:string,year:number,except?:string):number{
  const key=cityKey(city);
  return Math.max(0,...events.filter(e=>e.id!==except&&e.competitionLevel==='regional'&&e.year===year&&e.city&&cityKey(e.city)===key).map(e=>e.regionalNumber??0))+1;
}

/** Previews the numbers a batch will receive, counting existing events and earlier rows of the same batch. */
export function previewBatchNames(existing:readonly EventRow[],rows:readonly Pick<NamedEventInput,'level'|'city'|'year'>[]):(string|null)[]{
  const taken=new Map<string,number>();
  return rows.map(r=>{
    if(!normaliseCity(r.city)||!Number.isInteger(r.year))return null;
    if(r.level!=='regional')return eventDisplayName(r.level,r.city,r.year);
    const key=`${cityKey(r.city)}|${r.year}`;
    const n=(taken.get(key)??nextRegionalNumber(existing,r.city,r.year)-1)+1;
    taken.set(key,n);
    return eventDisplayName('regional',r.city,r.year,n);
  });
}

export function validateNamedEvent(i:NamedEventInput):string|null{
  if(i.level!=='regional'&&i.level!=='national')return 'Choose Regionals or Nationals.';
  const city=normaliseCity(i.city??'');
  if(!city||city.length>60)return 'Enter the city (up to 60 characters).';
  if(!Number.isInteger(i.year)||i.year<2000||i.year>2100)return 'Enter a year between 2000 and 2100.';
  if(i.startsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(i.startsOn))return 'Dates must be valid (YYYY-MM-DD).';
  return null;
}
