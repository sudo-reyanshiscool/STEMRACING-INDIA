import {ApiError,type Api} from './types';
import type {TeamBrandingProfile} from './team-branding';
import {graphicsWorkbook} from './graphics-workbook';
export class GraphicsExportError extends Error {}
const fileName=(s:string)=>s.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/,'')||'file';
export function graphicsTeamFolder(p:TeamBrandingProfile):string{
 const id=p.team.number;
 if(!id||/[<>:"/\\|?*\x00-\x1F]/.test(id)||/[. ]$/.test(id))throw new GraphicsExportError('A team ID is missing or cannot be used as a folder name. Correct it before exporting.');
 return `${id}_${fileName(p.team.name)}`;
}
export function graphicsAssetPath(p:TeamBrandingProfile,key:string,name:string):string{
 const category:Record<string,string>={team_logo:'Logos',official_photo_original:'Team photos/Original',official_photo_approved:'Team photos/Approved cutout',car_render_fl:'Car renders/Front-left',car_render_fr:'Car renders/Front-right',car_model_3d:'3D models',model_materials:'3D models/Materials'};
 if(category[key])return category[key]+'/'+fileName(name);
 const i=p.members.findIndex(m=>m.assetKey===key);
 if(i<0)throw new ApiError('invalid','Unknown member portrait');
 return `Member portraits/${String(i+1).padStart(2,'0')}_${fileName(p.members[i].name||p.members[i].id)}/${fileName(name)}`;
}
export const graphicsCsv=(rows:Array<Array<string|number>>)=>'\uFEFF'+rows.map(row=>row.map(v=>{
 let text=String(v);if(/^[=+\-@\t\r]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}).join(',')).join('\r\n')+'\r\n';
export const graphicsPackageName=(name:string)=>`STEM-Racing_${fileName(name)}_Graphics-Package.zip`;
type GraphicsApi=Pick<Api,'getSession'|'getEvent'|'listTeams'|'myRoles'|'teamBrandingProfile'|'downloadTeamBrandAsset'>;
/** Fresh, authorised source data only. Original asset bytes never enter an image encoder. */
export async function buildGraphicsPackage(api:GraphicsApi,eventId:string,onProgress?:(message:string)=>void,options:{signal?:AbortSignal}={}):Promise<Uint8Array<ArrayBuffer>>{
 const signal=options.signal;
 const stopped=()=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};
 const wait=<T>(task:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
  if(signal?.aborted){void task.catch(()=>{});reject(new DOMException('Export cancelled','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Export cancelled','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);reject(new ApiError('network','Graphics export timed out'));},60000);
  signal?.addEventListener('abort',abort,{once:true});
  task.then(v=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();else resolve(v);},e=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(e);});
 });
 const read=async<T>(task:()=>Promise<T>):Promise<T>=>{
  for(let attempt=0;;attempt++){
   stopped();
   try{return await wait(task());}catch(error){
    if(attempt>=2||!(error instanceof ApiError)||!(error.code==='network'||error.detailCode==='57014'))throw error;
    stopped();onProgress?.('Connection interrupted — retrying the current read…');
    await wait(new Promise<void>(resolve=>setTimeout(resolve,500*(attempt+1))));
   }
  }
 };
 stopped();const viewer=await wait(api.getSession());if(!viewer)throw new ApiError('unauthenticated','Sign in to export graphics');
 const [event,teams,roles]=await wait(Promise.all([api.getEvent(eventId),api.listTeams(eventId),api.myRoles(eventId)]));
 if(!event||!roles.some(r=>['organiser','chair','spectator'].includes(r.role)))throw new ApiError('forbidden','Only event staff can export every team');
 if(!teams.length)throw new GraphicsExportError('This event has no teams to export.');
 const {Zip,ZipPassThrough,strToU8}=await import('fflate');
 const chunks:Uint8Array<ArrayBuffer>[]=[];let failure:Error|null=null;
 const zip=new Zip((error,bytes)=>{if(error)failure=error;else chunks.push(new Uint8Array(bytes));});
 const add=(path:string,bytes:Uint8Array)=>{stopped();if(failure)throw failure;const entry=new ZipPassThrough(path);zip.add(entry);entry.push(bytes,true);if(failure)throw failure;};
 const teamRows:string[][]=[],memberRows:string[][]=[],folders=new Set<string>();
 const missingAssets:string[][]=[['Team ID','Team name','Missing asset','Member name','Details']];
 const missingInfo:string[][]=[['Team ID','Team name','Missing field','Details']];
 const manifest:Array<Array<string|number>>=[['Team ID','Team name','Asset type','Original filename','Export path','Bytes','SHA256']];
 try{
  for(let i=0;i<teams.length;i++){
   stopped();if((await wait(api.getSession()))?.userId!==viewer.userId)throw new ApiError('unauthenticated','The account changed');
   const team=teams[i],prefix=`Team ${i+1} of ${teams.length} · ${team.name}`;
   onProgress?.(`${prefix} — Reading latest saved data…`);
   const p=await read(()=>api.teamBrandingProfile(eventId,team.id));
   if(p.eventId!==eventId||p.team.id!==team.id)throw new ApiError('conflict','The team changed');
   const folder=graphicsTeamFolder(p);
   if(folders.has(folder.toLowerCase()))throw new GraphicsExportError('Two teams produce the same folder name. Correct their team IDs before exporting.');
   folders.add(folder.toLowerCase());add(folder+'/',new Uint8Array());
   const id=p.team.number,name=p.team.name,city=(p.team as typeof p.team&{city?:string|null}).city??'';
   const colours=(['primary','secondary','accent'] as const).map(key=>{
    const value=p.colours?.[key]??'';
    if(!/^#[0-9a-f]{6}$/i.test(value)){missingInfo.push([id,name,`${key[0].toUpperCase()+key.slice(1)} colour HEX`,value?'Invalid HEX recorded':'Not recorded']);return '';}
    return value;
   });
   const paths=new Map(p.assets.map(a=>[a.key,folder+'/'+graphicsAssetPath(p,a.key,a.name)]));
   teamRows.push([id,name,p.team.school??'',city,...colours,...['team_logo','official_photo_original','official_photo_approved','car_render_fl','car_render_fr','car_model_3d','model_materials'].map(key=>paths.get(key)??'')]);
   for(const [field,value] of [['School/institution',p.team.school],['City',city]])if(!value)missingInfo.push([id,name,field!,'Not recorded']);
   if(!p.members.length){missingInfo.push([id,name,'Member details','Not recorded']);missingAssets.push([id,name,'Member portraits','','No member details or portraits recorded']);}
   for(const m of p.members){
    memberRows.push([id,m.name??'',m.role??'',m.assetKey?paths.get(m.assetKey)??'':'']);
    if(!m.name)missingInfo.push([id,name,'Member name','Not recorded']);if(!m.role)missingInfo.push([id,name,'Member role','Not recorded']);
    if(!m.assetKey||!paths.has(m.assetKey))missingAssets.push([id,name,'Member portrait',m.name??'','Not available']);
   }
   for(const [key,label] of [['team_logo','Logo'],['official_photo_original','Team photo'],['car_render_fl','Car render front-left'],['car_render_fr','Car render front-right'],['car_model_3d','3D model']])if(!p.assets.some(a=>a.key===key))missingAssets.push([id,name,label!,'','Not available']);
   for(let start=0;start<p.assets.length;start+=3){
    const files=await Promise.all(p.assets.slice(start,start+3).map(async asset=>{
    stopped();onProgress?.(`${prefix} — Preparing ${asset.label.toLowerCase()}…`);
    const data=await read(()=>api.downloadTeamBrandAsset(eventId,team.id,asset.key,p.version));
    if(data.key!==asset.key||data.mime!==asset.mime||data.revision!==asset.revision)throw new ApiError('conflict','An asset changed');
    const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));if(bytes.length!==asset.size)throw new ApiError('conflict','An asset changed size');
    const digest=await wait(crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    return {asset,bytes,hash};
    }));
    for(const {asset,bytes,hash} of files){
    const path=folder+'/'+graphicsAssetPath(p,asset.key,asset.name);add(path,bytes);
    manifest.push([id,name,asset.key,asset.name,path,bytes.length,hash]);
    }
   }
   if((await read(()=>api.teamBrandingProfile(eventId,team.id))).version!==p.version)throw new ApiError('conflict','Branding changed during export');
   await wait(new Promise<void>(resolve=>setTimeout(resolve,0)));
  }
  if((await wait(api.getSession()))?.userId!==viewer.userId)throw new ApiError('unauthenticated','The account changed');
  onProgress?.('Creating the Teams and Members workbook…');
  add('STEM_Racing_India_Graphics_Data.xlsx',graphicsWorkbook(teamRows,memberRows));
  add('Missing_assets.csv',strToU8(graphicsCsv(missingAssets)));add('Missing_information.csv',strToU8(graphicsCsv(missingInfo)));add('Asset_manifest.csv',strToU8(graphicsCsv(manifest)));
  add('README.txt',strToU8(`${event.name} · Graphics package\n\nTeam IDs are the recorded competition team numbers, stored as text. The workbook contains Teams and Members only. File-path columns are relative to the root of this ZIP and point to the included files; missing file paths are blank. Names and capitalisation follow saved data. Missing information is blank and listed separately. No details or replacement images are invented.\n\nEach TeamID_TeamName folder contains available original assets. File bytes, image quality and transparency are unchanged. Approved cutouts are separate from original photographs. Asset_manifest.csv records byte counts and SHA256 hashes. Invalid filename characters are replaced with underscores in paths only. Each team reflects its saved version when read during this export.\n`));
  zip.end();if(failure)throw failure;stopped();
  const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
 }catch(error){zip.terminate();throw error;}
}
