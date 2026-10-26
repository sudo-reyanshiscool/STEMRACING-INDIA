import type {Ctx} from './ctx';
import type {TeamRow} from '../api';
import {COMPULSORY_ASSET_SPECS,validateCompulsoryFile,validateMemberPortraits,validateTeamColours,type CompulsoryAssetKey,type StoredCompulsoryFile,type TeamCompulsoryAssets,type TeamMemberPortrait} from '../api/compulsory-assets';
import {h} from './dom';
import {errorText} from './common';
const fields={team_logo:'teamLogo',car_render_fl:'carRenderFL',car_render_fr:'carRenderFR',car_model_3d:'carModel3D',model_materials:'modelMaterials'} as const;
const toBase64=async(file:File)=>{const bytes=new Uint8Array(await file.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(bin);};
export async function compulsoryAssetsSection(ctx:Ctx,eventId:string,teams:TeamRow[],managedTeamIds:string[],isStaff:boolean):Promise<HTMLElement>{
 const [event,roles]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.myRoles(eventId)]);
 const readOnly=!!event?.resultsReleased||roles.some(r=>r.role==='spectator');
 const available=teams.filter(t=>isStaff||roles.some(r=>r.role==='spectator')||managedTeamIds.includes(t.id));
 const root=h('section',{class:'stack stack--lg compulsory-assets-container'});if(!available.length)return root;
 let teamId=available[0].id,request=0,alive=true;
 ctx.onLeave(()=>{alive=false;request++;});
 const status=h('p',{role:'status',hidden:true});
 const notify=(message:string,failed=false)=>{if(!alive)return;status.textContent=message;status.hidden=false;status.className=failed?'alert':'notice';};
 const body=h('div',{class:'stack stack--lg'});
 const chooser=h('select',{'aria-label':'Select team for compulsory asset submission'},available.map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`)));
 chooser.onchange=()=>{teamId=chooser.value;void refresh();};
 root.append(h('p',{class:'eyebrow'},'Competition deliverables'),h('h2',null,'Compulsory Digital Media Submissions'),h('p',{class:'muted'},'Submit all eight media categories. Organisers review file contents and confirm that every registered member has a portrait.'),status);
 if(available.length>1)root.append(h('label',{class:'field'},'Team',chooser));root.append(body);
 async function refresh(){
  const current=++request,target=teamId;body.replaceChildren(h('p',null,'Loading media status…'));
  try{const state=await ctx.api.getCompulsoryAssets(eventId,target);if(alive&&current===request)render(state,target);}
  catch(err){if(alive&&current===request)body.replaceChildren(h('p',{class:'alert',role:'alert'},errorText(err)),h('button',{class:'btn btn--ghost',onclick:()=>void refresh()},'Retry media status'));}
 }
 const run=async(button:HTMLButtonElement,action:()=>Promise<void>)=>{if(button.disabled)return;button.disabled=true;try{await action();notify('Saved to the event.');await refresh();}catch(err){notify(errorText(err),true);}finally{if(alive)button.disabled=false;}};
 const download=async(target:string,key:CompulsoryAssetKey)=>{
  const f=await ctx.api.downloadCompulsoryAsset(eventId,target,key);if(!f.base64)throw new Error('File unavailable');
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],{type:'application/octet-stream'}));h('a',{href:url,download:f.name}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 function render(state:TeamCompulsoryAssets,target:string){
  body.replaceChildren();
  body.append(h('article',{class:'card stack'},h('strong',null,`${available.find(t=>t.id===target)?.name} · ${state.completedCount} / 8 media categories submitted`),h('progress',{max:8,value:state.completedCount,'aria-label':`${state.completedCount} of 8 compulsory assets submitted`}),h('p',{class:'muted small'},state.isAllCompleted?'All media categories have submissions. Organiser review is still required.':'Complete the missing categories below. Portraits must cover your full registered team.')));
  if(readOnly)body.append(h('p',{class:'notice'},event?.resultsReleased?'Results are released. Submissions are read-only.':'Read-only media access.'));
  const rows=COMPULSORY_ASSET_SPECS.map(spec=>{
   const field=fields[spec.key as keyof typeof fields],file=field?state[field]:undefined;
   const done=!state.missingKeys.includes(spec.key);
   const actions=h('div',{class:'actions'});
   if(file){const btn=h('button',{class:'btn btn--ghost btn--small',onclick:async()=>{btn.disabled=true;try{await download(target,spec.key);}catch(err){notify(errorText(err),true);}finally{btn.disabled=false;}}},'Download');actions.append(btn);}
   if(!readOnly){const btn=h('button',{class:'btn btn--ghost btn--small',onclick:()=>{
    if(spec.key==='official_photo'){root.parentElement?.querySelector('.team-photo-section')?.scrollIntoView({behavior:'smooth'});return;}
    body.querySelector(`[data-asset="${spec.key}"]`)?.scrollIntoView({behavior:'smooth'});
   }},done?'Manage':'Submit');actions.append(btn);}
   return h('tr',null,h('th',{scope:'row'},`${spec.num}. ${spec.name}`,file?h('p',{class:'small muted'},`${file.name} · ${Math.ceil(file.size/1024)} KB`):null),h('td',null,spec.format,h('p',{class:'small muted'},spec.specifications)),h('td',null,h('span',{class:done?'tag tag--pass':'tag'},done?'Submitted':'Missing')),h('td',null,actions));
  });
  body.append(h('div',{class:'table-wrap'},h('table',{'aria-label':'Compulsory media checklist'},h('thead',null,h('tr',null,['Asset','Format and specification','Status','Action'].map(t=>h('th',{scope:'col'},t)))),h('tbody',null,rows))));
  if(!readOnly)for(const spec of COMPULSORY_ASSET_SPECS.filter(s=>s.key in fields)){
   const field=fields[spec.key as keyof typeof fields],existing=state[field];
   const accept=spec.key==='team_logo'?'.svg,.png':spec.key.startsWith('car_render_')?'.png':spec.key==='car_model_3d'?'.obj':'.zip';
   const input=h('input',{type:'file',accept,required:true,'aria-label':`${spec.name} file`});
   const limit=spec.key==='team_logo'?2:spec.key.startsWith('car_render_')?25:50;
   const save=h('button',{class:'btn btn--primary',type:'submit'},`Upload ${spec.name}`);
   const form=h('form',{class:'stack','data-asset':spec.key,onsubmit:(e:Event)=>{e.preventDefault();void run(save,async()=>{
    const file=input.files?.[0];if(!file)throw new Error('Choose a file.');if(file.size>limit*1024*1024)throw new Error(`File must be ${limit} MB or smaller.`);
    const payload={name:file.name,mime:spec.key==='team_logo'?file.name.toLowerCase().endsWith('.svg')?'image/svg+xml':'image/png':spec.key.startsWith('car_render_')?'image/png':spec.key==='car_model_3d'?'model/obj':'application/zip',base64:await toBase64(file)};
    validateCompulsoryFile(spec.key,payload);await ctx.api.uploadCompulsoryAsset(eventId,target,spec.key,payload,existing?.revision??0);
   });}},h('h3',null,spec.name),h('p',{class:'muted'},`${spec.specifications}. Maximum ${limit} MB. Replaces this category’s current file.`),h('label',{class:'field'},spec.format,input),save);
   body.append(h('details',{class:'card'},h('summary',null,`${existing?'Replace':'Submit'} ${spec.name}`),form));
  }
  const colours=state.teamColours??{primary:'#E6007E',secondary:'#312783',accent:'#FCBC00'};
  const colorInputs=(['primary','secondary','accent'] as const).map(k=>({key:k,input:h('input',{value:colours[k],required:true,maxlength:7,'aria-label':`${k} HEX colour`,disabled:readOnly})}));
  const colorSave=h('button',{class:'btn btn--primary',type:'submit',disabled:readOnly},'Save Team Colours');
  body.append(h('form',{class:'card stack','data-asset':'team_colours',onsubmit:(e:Event)=>{e.preventDefault();void run(colorSave,async()=>{const values={primary:colorInputs[0].input.value,secondary:colorInputs[1].input.value,accent:colorInputs[2].input.value};await ctx.api.saveTeamColours(eventId,target,validateTeamColours(values),state.revision);});}},h('h3',null,'Team Colours (HEX)'),colorInputs.map(f=>h('label',{class:'field'},f.key,f.input)),colorSave));
  const members=state.memberPortraits??[];
  const portraitCard=h('article',{class:'card stack','data-asset':'member_portraits'},h('h3',null,'Individual Team Member Portraits'),h('p',{class:'muted'},'Add a JPG or PNG portrait (up to 2 MB), name and role for every registered member. The platform has no separate member roster to check this automatically.'));
  for(const m of members){const remove=h('button',{class:'btn btn--ghost btn--small',disabled:readOnly,onclick:()=>void run(remove,async()=>{await ctx.api.saveTeamMemberPortraits(eventId,target,members.filter(x=>x.id!==m.id),state.revision);})},'Remove');portraitCard.append(h('div',{class:'row'},m.photoBase64?h('img',{src:`data:${m.photoMime};base64,${m.photoBase64}`,alt:m.name,width:64,height:64}):null,h('strong',null,m.name),h('p',null,m.role),remove));}
  if(!readOnly){
   const name=h('input',{required:true,maxlength:100,'aria-label':'Member name'}),role=h('input',{required:true,maxlength:100,'aria-label':'Member role'}),photo=h('input',{type:'file',accept:'.jpg,.jpeg,.png',required:true,'aria-label':'Member portrait'});
   const add=h('button',{class:'btn btn--primary',type:'submit'},'Add Member Portrait');
   portraitCard.append(h('form',{class:'stack',onsubmit:(e:Event)=>{e.preventDefault();void run(add,async()=>{
    const file=photo.files?.[0];if(!file)throw new Error('Choose a portrait.');if(file.size>2*1024*1024)throw new Error('Portrait must be 2 MB or smaller.');
    const next:TeamMemberPortrait={id:crypto.randomUUID(),name:name.value,role:role.value,fileName:file.name,photoMime:file.name.toLowerCase().endsWith('.png')?'image/png':'image/jpeg',photoBase64:await toBase64(file)};
    await ctx.api.saveTeamMemberPortraits(eventId,target,validateMemberPortraits([...members,next]),state.revision);
   });}},h('label',{class:'field'},'Full name',name),h('label',{class:'field'},'Role',role),h('label',{class:'field'},'Portrait',photo),add));
  }body.append(portraitCard);
  // Old releases kept unconfirmed media only in localStorage. Preserve it, identify it as local,
  // and recover through the same validated server APIs. Never count it as a server submission.
  let legacy:Partial<TeamCompulsoryAssets>|null=null;try{const text=localStorage.getItem(`compulsory:${eventId}:${target}`);if(text)legacy=JSON.parse(text);}catch{/* Server records remain authoritative. */}
  if(legacy&&!readOnly){const draft=legacy;const recover=h('button',{class:'btn btn--ghost',onclick:()=>void run(recover,async()=>{
    for(const [key,field] of Object.entries(fields)){const file=draft[field as keyof typeof draft] as StoredCompulsoryFile|undefined;if(file?.base64){const fresh=await ctx.api.getCompulsoryAssets(eventId,target);if(!fresh[field as keyof typeof fresh])await ctx.api.uploadCompulsoryAsset(eventId,target,key as CompulsoryAssetKey,{name:file.name,mime:file.mime,base64:file.base64},0);}}
    let fresh=await ctx.api.getCompulsoryAssets(eventId,target);if(draft.teamColours&&!fresh.teamColours)await ctx.api.saveTeamColours(eventId,target,draft.teamColours,fresh.revision);
    fresh=await ctx.api.getCompulsoryAssets(eventId,target);if(draft.memberPortraits?.length&&!fresh.memberPortraits?.length)await ctx.api.saveTeamMemberPortraits(eventId,target,draft.memberPortraits,fresh.revision);
   })},'Recover valid local files');body.prepend(h('aside',{class:'notice stack'},h('p',null,'An earlier version saved media only in this browser. Those local files are not confirmed event submissions. Recovery validates them and uploads missing files; your local copy is preserved.'),recover));}
 }
 await refresh();return root;
}
