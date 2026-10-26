import {ApiError,type Api,type TeamRow} from './types';
import {COMPULSORY_ASSET_SPECS,type CompulsoryAssetKey,type TeamCompulsoryAssets,type TeamColours} from './compulsory-assets';
export interface BrandingAsset {key:string;label:string;name:string;mime:string;size:number;revision:number;updatedAt:string;width:number|null;height:number|null}
export interface TeamBrandingProfile {
 schemaVersion:1;eventId:string;eventName:string;competitionLevel:'regional'|'national'|null;team:TeamRow;
 colours:TeamColours|null;members:Array<{id:string;name:string;role:string;assetKey:string|null}>;
 assets:BrandingAsset[];missing:CompulsoryAssetKey[];completedCount:number;totalCount:8;version:string;
}
export interface BrandingAssetFile extends BrandingAsset {base64:string}
export function assembleTeamBrandingProfile(event:{id:string;name:string;competitionLevel?:'regional'|'national'},team:TeamRow,state:TeamCompulsoryAssets):TeamBrandingProfile {
 const assets:BrandingAsset[]=[];
 const files=[['team_logo','teamLogo','Team logo'],['car_render_fl','carRenderFL','Car render · front-left'],['car_render_fr','carRenderFR','Car render · front-right'],['car_model_3d','carModel3D','3D car model'],['model_materials','modelMaterials','Materials and textures']] as const;
 for(const [key,field,label] of files){const f=state[field];if(f)assets.push({key,label,name:f.name,mime:f.mime,size:f.size,revision:f.revision??1,updatedAt:f.updatedAt,width:f.width??null,height:f.height??null});}
 const photo=state.officialPhoto;
 if(photo?.hasOriginal)assets.push({key:'official_photo_original',label:'Official team photograph · original',name:photo.originalName,mime:photo.originalMime,size:photo.originalSize,revision:photo.revision,updatedAt:photo.uploadedAt,width:photo.originalWidth,height:photo.originalHeight});
 if(photo?.approvalStatus==='approved'&&photo.hasApproved)assets.push({key:'official_photo_approved',label:'Team cutout · approved for broadcast',name:'team-approved.png',mime:'image/png',size:photo.approvedSize??0,revision:photo.revision,updatedAt:photo.approvedAt??photo.uploadedAt,width:photo.approvedWidth,height:photo.approvedHeight});
 const members=(state.memberPortraits??[]).map(m=>{
  const key=m.photoBase64?`portrait:${m.id}`:null;
  if(key)assets.push({key,label:`Portrait · ${m.name}`,name:m.fileName??'portrait.png',mime:m.photoMime??'image/png',size:atob(m.photoBase64!).length,revision:state.revision??0,updatedAt:m.updatedAt??'',width:null,height:null});
  return {id:m.id,name:m.name,role:m.role,assetKey:key};
 });
 const core={schemaVersion:1 as const,eventId:event.id,eventName:event.name,competitionLevel:event.competitionLevel??null,team:{...team},colours:state.teamColours??null,members,assets:assets.sort((a,b)=>a.key.localeCompare(b.key)),missing:[...state.missingKeys],completedCount:state.completedCount,totalCount:8 as const};
 // The memory adapter uses a deterministic opaque version. Production uses a server digest.
 return {...core,version:JSON.stringify({...core,detailsRevision:state.revision??0})};
}
export const brandingMissingLabels=(profile:TeamBrandingProfile)=>profile.missing.map(key=>COMPULSORY_ASSET_SPECS.find(s=>s.key===key)?.name??key);
const slug=(s:string)=>s.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'team';
export const brandingArchiveName=(p:TeamBrandingProfile)=>`STEM-Racing_${slug(p.team.number)}-${slug(p.team.name)}_Branding.zip`;
export function brandingAssetPath(asset:BrandingAsset,profile:TeamBrandingProfile):string {
 const ext=asset.mime==='image/svg+xml'?'svg':asset.mime==='image/jpeg'?'jpg':asset.mime==='image/png'?'png':asset.key==='car_model_3d'?'obj':'zip';
 const fixed:Record<string,string>={team_logo:'identity/team-logo',car_render_fl:'car/front-left',car_render_fr:'car/front-right',car_model_3d:'car/model',model_materials:'car/materials',official_photo_original:'photos/team-original',official_photo_approved:'photos/team-approved'};
 if(fixed[asset.key])return `${fixed[asset.key]}.${ext}`;
 const member=profile.members.find(m=>m.assetKey===asset.key);if(!member)throw new ApiError('invalid','Unknown branding asset');
 return `members/${String(profile.members.indexOf(member)+1).padStart(2,'0')}-${slug(member.name)}.${ext}`;
}
export async function buildBrandingArchive(api:Pick<Api,'teamBrandingProfile'|'downloadTeamBrandAsset'>,profile:TeamBrandingProfile,onProgress?:(message:string)=>void):Promise<Uint8Array<ArrayBuffer>> {
 const {Zip,ZipPassThrough,strToU8}=await import('fflate');
 const chunks:Uint8Array<ArrayBuffer>[]=[];let failure:Error|null=null;
 const zip=new Zip((err,bytes)=>{if(err)failure=err;else chunks.push(new Uint8Array(bytes));});
 const add=(name:string,bytes:Uint8Array)=>{const entry=new ZipPassThrough(name);zip.add(entry);entry.push(bytes,true);};
 try {
  const entries:Array<BrandingAsset&{path:string}>=[];
  for(const asset of profile.assets){
   onProgress?.(`Preparing ${asset.label.toLowerCase()}…`);
   const data=await api.downloadTeamBrandAsset(profile.eventId,profile.team.id,asset.key,profile.version);
   if(data.key!==asset.key||data.mime!==asset.mime||data.revision!==asset.revision)throw new ApiError('conflict','Branding changed. Refresh the profile and try again.');
   const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));if(bytes.length!==asset.size)throw new ApiError('conflict','A branding file changed. Refresh and try again.');
   const path=brandingAssetPath(asset,profile);add(path,bytes);entries.push({...asset,path});
  }
  if((await api.teamBrandingProfile(profile.eventId,profile.team.id)).version!==profile.version)throw new ApiError('conflict','Branding changed while preparing the download. Refresh and try again.');
  add('profile.html',strToU8(brandingProfileHtml(profile)));
  add('profile.json',strToU8(JSON.stringify({...profile,assets:entries},null,2)));
  const colors=profile.colours;add('colours.css',strToU8(colors?`:root {\n  --team-primary: ${colors.primary};\n  --team-secondary: ${colors.secondary};\n  --team-accent: ${colors.accent};\n}\n`:'/* Team colours have not been submitted. */\n'));
  add('README.txt',strToU8(`${profile.team.number} · ${profile.team.name}\n${profile.team.school}\n${profile.eventName}\n\nAutomatically assembled from current submitted branding assets.\n${profile.completedCount}/8 media categories submitted.\nMissing: ${brandingMissingLabels(profile).join(', ')||'None'}\n\nOriginal files retain their submitted content. Approved cutouts are identified separately; an original photo is not an approved cutout.\nExtract this ZIP and open profile.html for the visual, printable team profile. Profile data and colours are included for branding workflows. The final designed download template can be added later.\nThis pack contains team/member photographs; share it only with the intended team and event organisers.\n`));
  zip.end();if(failure)throw failure;
  const size=chunks.reduce((n,c)=>n+c.length,0),result=new Uint8Array(size);let at=0;for(const c of chunks){result.set(c,at);at+=c.length;}return result;
 }catch(err){zip.terminate();throw err;}
}

/** Offline, printable profile. All team text is escaped; uploaded artwork stays in image files. */
export function brandingProfileHtml(p:TeamBrandingProfile):string {
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const image=(key:string,alt:string)=>{const a=p.assets.find(a=>a.key===key);return a?`<img src="${escape(brandingAssetPath(a,p))}" alt="${escape(alt)}">`:'';};
 const photo=p.assets.some(a=>a.key==='official_photo_approved')?'official_photo_approved':'official_photo_original';
 const colours=p.colours?Object.entries(p.colours).map(([label,value])=>`<div><div class="swatch" style="background:${/^#[0-9a-f]{6}$/i.test(value)?value:'#ddd'}"></div><b>${escape(label)}</b><p>${escape(value)}</p></div>`).join(''):'<p>Colours not yet submitted.</p>';
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>${escape(p.team.name)} · Branding profile</title><style>body{font:16px/1.5 Arial,sans-serif;color:#202027;margin:0;background:#f5f5f6}main{max-width:1000px;margin:40px auto;padding:40px;background:white;border-top:6px solid #e7212b}header{display:flex;gap:30px;align-items:center}header img{width:130px;height:130px;object-fit:contain}h1{font-size:48px;line-height:1.1;margin:12px 0}h2{margin-top:40px}p{margin:8px 0}.kicker{letter-spacing:.1em;font-size:12px;text-transform:uppercase}.palette,.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.swatch{height:100px;border:1px solid #ddd}.hero{max-width:100%;max-height:420px;object-fit:contain}.photo img{max-width:100%;max-height:420px}.grid img{width:100%;max-height:220px;object-fit:contain}footer{margin-top:40px;border-top:1px solid #ddd;padding-top:20px;font-size:12px}@media(max-width:600px){main{margin:0;padding:24px}h1{font-size:32px}header{display:block}.grid{grid-template-columns:1fr}}@media print{body{background:white}main{margin:0;padding:10px}article,header,.palette{break-inside:avoid}}</style><main><header>${image('team_logo','Team logo')}<div><p class="kicker">STEM Racing India / ${escape(p.eventName)}</p><p>TEAM ${escape(p.team.number)}</p><h1>${escape(p.team.name)}</h1><p>${escape(p.team.school)}</p></div></header><h2>Team photograph</h2><div class="photo">${image(photo,'Team photograph')||'<p>Not yet submitted.</p>'}</div><h2>Signature colours</h2><div class="palette">${colours}</div><h2>The car</h2><div class="grid">${image('car_render_fl','Car front-left')}${image('car_render_fr','Car front-right')}</div><h2>The team</h2><div class="grid">${p.members.map(m=>`<article>${m.assetKey?image(m.assetKey,m.name):''}<h3>${escape(m.name)}</h3><p>${escape(m.role)}</p></article>`).join('')||'<p>Member portraits not yet submitted.</p>'}</div><footer>${p.completedCount}/8 media categories submitted. Missing: ${escape(brandingMissingLabels(p).join(', ')||'None')}.<p>Automatically generated from submitted assets. Source files and colour values accompany this profile. Team and member photographs are intended for the team and event organisers.</p></footer></main></html>`;
}
