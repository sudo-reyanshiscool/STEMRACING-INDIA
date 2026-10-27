import type {Ctx} from './ctx';
import {buildBrandingArchive,buildTeamBrandingPdf,brandingArchiveName,brandingMissingLabels,type TeamBrandingProfile} from '../api';
import {h} from './dom';
import {errorText,notFound} from './common';
import {routeHref} from './router';

export async function teamBrandingScreen(ctx:Ctx,eventId:string):Promise<HTMLElement>{
 const [event,roles,teams]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.myRoles(eventId),ctx.api.listTeams(eventId)]);
 const staff=roles.some(r=>['organiser','chair','spectator'].includes(r.role));
 const available=teams.filter(t=>staff||roles.some(r=>r.role==='team_manager'&&r.teamId===t.id));
 if(!event||!available.length)return notFound('Team branding is available to your team and event organisers.');
 let alive=true,request=0;ctx.onLeave(()=>{alive=false;request++;});
 const root=h('div',{class:'stack stack--lg branding-page'},h('header',{class:'stack'},h('p',{class:'eyebrow'},'TEAM IDENTITY / BRANDING'),h('h1',null,'Your team. In full colour.'),h('p',{class:'lead'},'A living branding profile, automatically assembled from your latest submitted assets.')));
 const select=h('select',{'aria-label':'Branding team'},available.map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`)));
 const body=h('div',{class:'stack stack--lg'}),status=h('p',{role:'status','aria-live':'polite'});
 root.append(h('label',{class:'field'},h('span',{class:'field__label'},'Team'),select),status,body);
 const save=(bytes:BlobPart,name:string,type:string)=>{const url=URL.createObjectURL(new Blob([bytes],{type}));h('a',{href:url,download:name}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const render=async()=>{
  const current=++request;body.replaceChildren();status.textContent='Assembling your branding profile…';
  try{
   const p=await ctx.api.teamBrandingProfile(eventId,select.value);if(!alive||current!==request)return;
   status.textContent='';
   const identity=h('div',{class:'branding-identity'},h('img',{class:'branding-track',src:'/brand/track-shape-pink.svg',alt:'','aria-hidden':'true'}),h('div',{class:'stack branding-identity__copy'},h('p',{class:'eyebrow'},`${p.eventName} / TEAM ${p.team.number}`),h('h2',null,p.team.name),h('p',null,p.team.school),h('p',{class:'muted'},`${p.completedCount} of ${p.totalCount} media categories submitted`)));
   const logo=p.assets.find(a=>a.key==='team_logo');
   if(logo?.mime==='image/png'){
    const img=h('img',{class:'branding-logo',alt:`${p.team.name} logo`});identity.prepend(img);
    void ctx.api.downloadTeamBrandAsset(eventId,p.team.id,logo.key,p.version).then(f=>{if(alive&&current===request)img.src=`data:image/png;base64,${f.base64}`;}).catch(()=>{img.remove();});
   }
   const download=h('button',{type:'button',class:'btn btn--primary'},'Download branding pack');
   download.onclick=async()=>{download.disabled=pdf.disabled=refresh.disabled=select.disabled=true;try{const bytes=await buildBrandingArchive(ctx.api,p,message=>{if(alive)status.textContent=message;});if(alive){save(bytes,brandingArchiveName(p),'application/zip');status.textContent='Branding pack ready. Includes your PDF, original assets and colour values.';}}catch(err){if(alive)status.textContent=errorText(err);}finally{if(alive){download.disabled=pdf.disabled=refresh.disabled=select.disabled=false;}}};
   const pdf=h('button',{type:'button',class:'btn btn--primary'},'Download PDF');
   pdf.onclick=async()=>{pdf.disabled=download.disabled=refresh.disabled=select.disabled=true;try{const bytes=await buildTeamBrandingPdf(ctx.api,p,message=>{if(alive)status.textContent=message;});if(alive){save(bytes,brandingArchiveName(p).replace('.zip','.pdf'),'application/pdf');status.textContent='Your branding PDF is ready.';}}catch(err){if(alive)status.textContent=errorText(err);}finally{if(alive)pdf.disabled=download.disabled=refresh.disabled=select.disabled=false;}};
   const data=h('button',{type:'button',class:'btn btn--ghost'},'Download profile data');data.onclick=()=>save(JSON.stringify(p,null,2),brandingArchiveName(p).replace('.zip','.json'),'application/json');
   const refresh=h('button',{type:'button',class:'btn btn--ghost'},'Refresh profile');refresh.onclick=render;
   body.append(identity,h('div',{class:'actions'},pdf,download,data,refresh),h('p',{class:'muted'},'Download your profile as a PDF, or get the PDF and original assets together in the branding pack. Incomplete profiles can still be downloaded.'));
   if(p.missing.length)body.append(h('aside',{class:'notice stack'},h('strong',null,'Build out your team identity'),h('p',null,`Still to submit: ${brandingMissingLabels(p).join(', ')}.`),roles.some(r=>r.role!=='spectator')?h('a',{href:routeHref({name:'submissions',eventId})},'Go to submissions →'):null));
   body.append(palette(p),h('section',{class:'stack'},h('h2',null,'The people behind the car'),p.members.length?h('div',{class:'branding-members'},p.members.map(m=>h('article',{class:'row stack'},h('h3',null,m.name),h('p',{class:'muted'},m.role),h('span',null,m.assetKey?'Portrait included in pack':'Portrait not submitted')))):h('p',{class:'muted'},'Member names, roles and portraits will appear here once submitted.')),
    h('section',{class:'stack'},h('h2',null,'Your asset library'),p.assets.length?h('div',{class:'branding-assets'},p.assets.map(a=>{const card=h('article',{class:'row stack'},h('h3',null,a.label),h('p',null,a.name),h('p',{class:'muted'},`${(a.size/1048576).toFixed(2)} MB${a.width&&a.height?` · ${a.width} × ${a.height}`:''} · revision ${a.revision}`));
     if(['image/png','image/jpeg'].includes(a.mime)){const preview=h('button',{type:'button',class:'btn btn--ghost'},'Preview image');preview.onclick=async()=>{preview.disabled=true;try{const f=await ctx.api.downloadTeamBrandAsset(eventId,p.team.id,a.key,p.version);if(alive&&current===request){card.append(h('img',{src:`data:${a.mime};base64,${f.base64}`,alt:a.label,class:'branding-asset-preview'}));preview.remove();}}catch(err){if(alive)status.textContent=errorText(err);preview.disabled=false;}};card.append(preview);}return card;})):h('p',{class:'muted'},'Upload your team assets in Submissions to populate this profile.')));
  }catch(err){if(alive&&current===request)status.textContent=errorText(err);}
 };
 select.onchange=render;await render();return root;
}
function palette(p:TeamBrandingProfile):HTMLElement{
 return h('section',{class:'stack'},h('h2',null,'Signature colours'),p.colours?h('div',{class:'branding-palette'},(['primary','secondary','accent'] as const).map(key=>h('div',{class:'branding-swatch'},h('div',{class:'branding-swatch__colour',style:`background:${/^#[0-9a-f]{6}$/i.test(p.colours![key])?p.colours![key]:'#ddd'}`}),h('strong',null,key[0].toUpperCase()+key.slice(1)),h('code',null,p.colours![key])))):h('p',{class:'muted'},'Your primary, secondary and accent colours have not been submitted.'));
}
