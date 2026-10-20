import {zipSync, type Zippable} from 'fflate';
import type {ResultsPacket} from '../api/result-mail';
import type {TeamRow} from '../api';
import {buildStandingsPdf,teamResultPdfFiles} from './resultReports';

const safe=(value:string)=>value.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,100)||'Event';
export class ArchiveCancelled extends Error {}
export class ResultsArchiveError extends Error {}

/** Build one staff-only event archive. No partial archive is offered if a team fails. */
export async function buildResultsArchive(
 event:{id:string;name:string;snapshotId:string},teams:Pick<TeamRow,'id'|'number'|'name'>[],
 load:(teamId:string)=>Promise<ResultsPacket>,
 options:{cancelled:()=>boolean;progress:(completed:number,total:number)=>void},
){
 if(!teams.length)throw new ResultsArchiveError('Add teams before downloading their PDFs.');
 const files:Zippable={};let common:string|undefined;
 for(const [index,team] of teams.entries()){
  if(options.cancelled())throw new ArchiveCancelled();
  options.progress(index,teams.length);
  // Yield between teams so progress and cancellation remain responsive.
  await new Promise(resolve=>setTimeout(resolve,0));
  if(options.cancelled())throw new ArchiveCancelled();
  const packet=await load(team.id);
  if(options.cancelled())throw new ArchiveCancelled();
  if(packet.eventId!==event.id||packet.team.id!==team.id||packet.snapshotId!==event.snapshotId)
   throw new ResultsArchiveError('The teams or ranking snapshot changed. Refresh and download the PDFs again.');
  const signature=JSON.stringify([packet.eventName,packet.standings,packet.awards,packet.released,packet.awardsConfirmed]);
  if(common!==undefined&&common!==signature)throw new ResultsArchiveError('Results or awards changed during download. Please try again.');
  if(index===0){
   common=signature;
   files[`${safe(event.name)}-Final-Standings-and-Awards.pdf`]=new Uint8Array(buildStandingsPdf(packet).output('arraybuffer'));
  }
  // An ordinal makes folders unique even when names become identical after sanitising.
  const folder=`Teams/${String(index+1).padStart(3,'0')}-${safe(team.number)}-${safe(team.name)}`;
  for(const file of teamResultPdfFiles(packet))files[`${folder}/${file.filename}`]=file.bytes;
  options.progress(index+1,teams.length);
 }
 if(options.cancelled())throw new ArchiveCancelled();
 // PDFs are already compressed. Store them directly to avoid a second expensive compression pass.
 return {filename:`${safe(event.name)}-All-Results-PDFs.zip`,bytes:zipSync(files,{level:0}),count:1+teams.length*2};
}
