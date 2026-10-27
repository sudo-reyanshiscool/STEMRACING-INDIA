import {loadBrandingResources,type BrandingResource} from './branding-resources';
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
type BrandingApi=Pick<Api,'teamBrandingProfile'|'downloadTeamBrandAsset'>;
export type BrandingPdfRenderer=typeof import('../pdf/branding-profile').renderBrandingPdf;
const defaultPdfRenderer:BrandingPdfRenderer=async(p,source)=>(await import('../pdf/branding-profile')).renderBrandingPdf(p,source);
async function confirmBrandingVersion(api:BrandingApi,profile:TeamBrandingProfile){
 if((await api.teamBrandingProfile(profile.eventId,profile.team.id)).version!==profile.version)throw new ApiError('conflict','Branding changed while preparing the download. Refresh and try again.');
}
async function prepareBranding(api:BrandingApi,profile:TeamBrandingProfile,onProgress:((message:string)=>void)|undefined,loadResources:typeof loadBrandingResources,imagesOnly=false){
 onProgress?.('Preparing official STEM Racing branding…');
 const resources=await loadResources(),files:Array<{path:string;mime:string;bytes:Uint8Array}>=[];
 for(const asset of profile.assets.filter(a=>!imagesOnly||a.mime.startsWith('image/'))){
  onProgress?.(`Preparing ${asset.label.toLowerCase()}…`);
  const data=await api.downloadTeamBrandAsset(profile.eventId,profile.team.id,asset.key,profile.version);
  if(data.key!==asset.key||data.mime!==asset.mime||data.revision!==asset.revision)throw new ApiError('conflict','Branding changed. Refresh the profile and try again.');
  const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));if(bytes.length!==asset.size)throw new ApiError('conflict','A branding file changed. Refresh and try again.');
  files.push({path:brandingAssetPath(asset,profile),mime:asset.mime,bytes});
 }
 if((await api.teamBrandingProfile(profile.eventId,profile.team.id)).version!==profile.version)throw new ApiError('conflict','Branding changed while preparing the download. Refresh and try again.');
 return {resources,files};
}
export async function buildTeamBrandingPdf(api:BrandingApi,profile:TeamBrandingProfile,onProgress?:(message:string)=>void,loadResources=loadBrandingResources,renderPdf=defaultPdfRenderer){
 const source=await prepareBranding(api,profile,onProgress,loadResources,true);onProgress?.('Creating your PDF…');const pdf=await renderPdf(profile,source);await confirmBrandingVersion(api,profile);return pdf;
}
export async function buildBrandingArchive(api:BrandingApi,profile:TeamBrandingProfile,onProgress?:(message:string)=>void,loadResources=loadBrandingResources,renderPdf=defaultPdfRenderer):Promise<Uint8Array<ArrayBuffer>> {
 const {Zip,ZipPassThrough,strToU8}=await import('fflate');
 const source=await prepareBranding(api,profile,onProgress,loadResources);
 onProgress?.('Creating your PDF…');const pdf=await renderPdf(profile,source);await confirmBrandingVersion(api,profile);
 const chunks:Uint8Array<ArrayBuffer>[]=[];let failure:Error|null=null;
 const zip=new Zip((err,bytes)=>{if(err)failure=err;else chunks.push(new Uint8Array(bytes));});
 const add=(name:string,bytes:Uint8Array)=>{const entry=new ZipPassThrough(name);zip.add(entry);entry.push(bytes,true);};
 try{
  for(const f of [...source.resources,...source.files])add(f.path,f.bytes);
  add('profile.pdf',pdf);
  add('profile.json',strToU8(JSON.stringify({...profile,assets:profile.assets.map(a=>({...a,path:brandingAssetPath(a,profile)}))},null,2)));
  const colors=profile.colours;add('colours.css',strToU8(colors?`:root {\n  --team-primary: ${colors.primary};\n  --team-secondary: ${colors.secondary};\n  --team-accent: ${colors.accent};\n}\n`:'/* Team colours have not been submitted. */\n'));
  add('README.txt',strToU8(`${profile.team.number} · ${profile.team.name}\n${profile.team.school}\n${profile.eventName}\n\nOpen profile.pdf for the team branding profile. Original assets retain their submitted content. Approved cutouts are identified separately.\n${profile.completedCount}/8 media categories submitted.\nMissing: ${brandingMissingLabels(profile).join(', ')||'None'}\n\nThis pack contains team/member photographs; share only with the intended team and event organisers.\n`));
  zip.end();if(failure)throw failure;
  const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){result.set(c,at);at+=c.length;}return result;
 }catch(err){zip.terminate();throw err;}
}

/** Offline, printable profile. Brand fonts are embedded so they also work from a local file. */
export function brandingProfileHtml(p:TeamBrandingProfile,resources:BrandingResource[]=[]):string {
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const font=(name:string)=>{
  const resource=resources.find(r=>r.path===`brand/${name}.woff2`);
  if(!resource)return `brand/${name}.woff2`;
  let binary='';for(let i=0;i<resource.bytes.length;i+=8192)binary+=String.fromCharCode(...resource.bytes.subarray(i,i+8192));
  return `data:font/woff2;base64,${btoa(binary)}`;
 };
 const image=(key:string,alt:string)=>{const a=p.assets.find(a=>a.key===key);return a?`<img src="${escape(brandingAssetPath(a,p))}" alt="${escape(alt)}" loading="lazy">`:'';};
 const photo=p.assets.some(a=>a.key==='official_photo_approved')?'official_photo_approved':'official_photo_original';
 const colours=p.colours?(['primary','secondary','accent'] as const).map(key=>{
  const value=p.colours![key];return `<div class="colour"><div class="swatch" style="--team-swatch:${/^#[0-9a-f]{6}$/i.test(value)?value:'#DDD'}"></div><h3>${key[0].toUpperCase()+key.slice(1)}</h3><p>${escape(value)}</p></div>`;
 }).join(''):'<p>Colours not yet submitted.</p>';
 const photoImage=image(photo,'Team photograph'),carImages=image('car_render_fl','Car front-left')+image('car_render_fr','Car front-right');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'unsafe-inline'"><title>${escape(p.team.name)} · Branding profile</title><style>
@font-face{font-family:Magistral;src:url('${font('Magistral-BoldItalic')}') format('woff2');font-weight:700;font-style:italic;font-display:swap}
@font-face{font-family:MachoModular;src:url('${font('MachoModular-Medium')}') format('woff2');font-weight:400 500;font-display:swap}
@font-face{font-family:MachoModular;src:url('${font('MachoModular-Bold')}') format('woff2');font-weight:700;font-display:swap}
:root{--carbon:#05000B;--pink:#E6007E;--white:#FFF;--paper:#F3F3F7;--rule:#D7D6E3;--muted:#5B5376;--display:Magistral,Verdana,sans-serif;--body:MachoModular,Verdana,sans-serif}
*{box-sizing:border-box}body{font:400 16px/1.6 var(--body);color:var(--carbon);margin:0;background:var(--paper)}main{max-width:1120px;margin:40px auto;background:var(--white)}.masthead{background:var(--carbon);padding:26px 40px;display:flex;align-items:center;justify-content:space-between;gap:32px;color:var(--white)}.brand-lockup{padding:24px;flex:none}.brand-lockup img{display:block;height:48px;width:auto}.masthead p{max-width:320px;text-align:left}.eyebrow{letter-spacing:.12em;text-transform:uppercase;font-size:12px}.hero{position:relative;isolation:isolate;overflow:hidden;background:var(--carbon);color:var(--white);padding:44px 64px 68px;min-height:360px;display:flex;align-items:center}.hero-copy{position:relative;z-index:1;width:64%;overflow-wrap:anywhere}.track-shape{position:absolute;z-index:0;width:340px;height:auto;right:-35px;bottom:-150px;pointer-events:none}.team-number{color:var(--white);font-size:16px}.hero h1{font:700 italic clamp(38px,5.2vw,68px)/1.05 var(--display);margin:12px 0 20px}.hero .eyebrow{margin:0 0 20px}.profile-body{padding:40px 64px 52px}h2{font:700 italic 32px/1.2 var(--display);margin:0 0 24px}h3{font:700 17px/1.4 var(--body);margin:12px 0 6px}p{margin:8px 0}.section{padding:32px 0;border-bottom:1px solid var(--rule)}.section-title{display:flex;align-items:baseline;gap:16px}.section-index{font:700 italic 18px var(--display);color:var(--pink)}.identity-grid{display:grid;grid-template-columns:1fr 2fr;gap:40px}.team-logo{background:var(--paper);min-height:160px;padding:28px;display:flex;align-items:center;justify-content:center}.team-logo img{width:100%;height:140px;object-fit:contain}.palette,.members{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.swatch{height:100px;background:var(--team-swatch);border:1px solid var(--rule)}.colour p{color:var(--muted);font-size:14px}.photo{background:var(--paper);padding:24px}.photo img{display:block;max-width:100%;max-height:480px;margin:auto;object-fit:contain}.cars{display:grid;grid-template-columns:1fr 1fr;gap:24px}.cars img{width:100%;height:auto;object-fit:contain;background:var(--paper)}.members article{min-width:0;overflow-wrap:anywhere}.members img{width:100%;height:220px;object-fit:contain;background:var(--paper)}.empty{color:var(--muted)}footer{padding-top:32px;font-size:12px;color:var(--muted)}.status{display:inline-block;background:var(--paper);padding:8px 12px;margin:0 0 8px;color:var(--carbon)}
@media(max-width:650px){main{margin:0}.masthead{padding:16px;display:block}.brand-lockup{display:inline-block}.masthead p{padding-inline:24px}.hero{padding:32px 24px 52px;min-height:320px}.hero-copy{width:76%}.hero h1{font-size:38px}.track-shape{width:220px;right:-90px;bottom:-70px}.profile-body{padding:24px}.identity-grid{grid-template-columns:1fr;gap:24px}.palette,.members{gap:12px}.members{grid-template-columns:1fr 1fr}.cars{grid-template-columns:1fr}h2{font-size:27px}}
@page{size:A4;margin:12mm}@media print{body{background:var(--white);font-size:11px;print-color-adjust:exact;-webkit-print-color-adjust:exact}main{margin:0;max-width:none}.masthead{padding:8px 18px}.brand-lockup{padding:18px}.brand-lockup img{height:36px}.hero{padding:30px 36px 40px;min-height:240px}.hero h1{font-size:44px}.track-shape{width:250px;bottom:-100px}.profile-body{padding:16px 24px}.section{padding:24px 0}header,article,.palette,.identity-grid,.photo,.cars{break-inside:avoid}h2{font-size:25px;break-after:avoid}.swatch{height:70px}.members img{height:150px}.photo img{max-height:300px}}
</style><main><div class="masthead"><div class="brand-lockup"><img src="brand/stem-racing-india.png" alt="STEM Racing India"></div><p class="eyebrow">${escape(p.eventName)}<br>Team branding profile</p></div><header class="hero"><img class="track-shape" src="brand/track-shape-pink.svg" alt="" aria-hidden="true"><div class="hero-copy"><p class="eyebrow">Team identity / ${escape(p.team.number)}</p><h1>${escape(p.team.name)}</h1><p>${escape(p.team.school)}</p></div></header><div class="profile-body">
<section class="section"><div class="section-title"><span class="section-index">01</span><h2>Team identity</h2></div><div class="identity-grid"><div class="team-logo">${image('team_logo','Team logo')||'<p class="empty">Logo not yet submitted.</p>'}</div><div><p class="eyebrow">TEAM ${escape(p.team.number)}</p><h3>${escape(p.team.name)}</h3><p>${escape(p.team.school)}</p><p class="empty">${escape(p.eventName)}</p></div></div></section>
<section class="section"><div class="section-title"><span class="section-index">02</span><h2>Signature colours</h2></div><div class="palette">${colours}</div></section>
<section class="section"><div class="section-title"><span class="section-index">03</span><h2>Team photograph</h2></div>${photoImage?`<div class="photo">${photoImage}</div>`:'<p class="empty">Not yet submitted.</p>'}</section>
<section class="section"><div class="section-title"><span class="section-index">04</span><h2>The car</h2></div>${carImages?`<div class="cars">${carImages}</div>`:'<p class="empty">Car renders not yet submitted.</p>'}</section>
<section class="section"><div class="section-title"><span class="section-index">05</span><h2>The team</h2></div><div class="members">${p.members.map(m=>`<article>${m.assetKey?image(m.assetKey,m.name):''}<h3>${escape(m.name)}</h3><p>${escape(m.role)}</p></article>`).join('')||'<p class="empty">Member portraits not yet submitted.</p>'}</div></section>
<footer><p class="status">${p.completedCount}/8 media categories submitted</p><p>Missing: ${escape(brandingMissingLabels(p).join(', ')||'None')}.</p><p>Automatically generated from submitted assets. Source files and colour values accompany this profile. Team and member photographs are intended for the team and event organisers.</p></footer></div></main></html>`;
}
