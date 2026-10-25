import type { Ctx } from './ctx';
import { FILE_KINDS, validateTeamFile, type TeamFileKind, type TeamFileInput } from '../api';
import { h } from './dom';
import { errorText, notFound } from './common';

export async function teamFilesScreen(ctx: Ctx, eventId: string, portfoliosOnly=false): Promise<HTMLElement> {
  const [event,roles,teams,allFiles]=await Promise.all([ctx.api.getEvent(eventId),ctx.api.myRoles(eventId),ctx.api.listTeams(eventId),ctx.api.listTeamFiles(eventId)]);
  const files=allFiles.filter(f=>!portfoliosOnly||f.kind!=='logo');
  if(!event||!roles.length)return notFound('Team files are unavailable.');
  let alive=true;ctx.onLeave(()=>{alive=false;});
  const staff=roles.some(r=>r.role==='chair'||r.role==='organiser');
  const managed=roles.filter(r=>r.role==='team_manager').map(r=>r.teamId);
  const uploadTeams=teams.filter(t=>staff||managed.includes(t.id));
  const root=h('div',{class:'stack stack--lg'},h(portfoliosOnly?'h2':'h1',null,portfoliosOnly?'Upload and download portfolios':'Team files'),h('p',{class:'lead'},portfoliosOnly?'PDF portfolios, up to 12 MB each. Access follows judging assignments and declared conflicts.':'Upload team artwork and portfolios. Portfolio access follows judging assignments and declared conflicts.'));
  const status=h('p',{role:'status','aria-live':'polite'});root.append(status);
  if(uploadTeams.length&&!event.resultsReleased) {
    const team=h('select',{'aria-label':'Upload team'},uploadTeams.map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`)));
    const kind=h('select',{'aria-label':'File category'},Object.entries(FILE_KINDS).filter(([k])=>!portfoliosOnly||k!=='logo').map(([k,label])=>h('option',{value:k},label)));
    const file=h('input',{type:'file',accept:'.png,.svg','aria-label':'Choose team file',required:true});
    const guide=h('p',{class:'muted'},'PNG or self-contained SVG, up to 2 MB. Use high-resolution artwork.');
    kind.onchange=()=>{file.accept=kind.value==='logo'?'.png,.svg':'.pdf';file.value='';guide.textContent=kind.value==='logo'?'PNG or self-contained SVG, up to 2 MB. Use high-resolution artwork.':'PDF portfolio, up to 12 MB.';};
    if(portfoliosOnly)kind.onchange(new Event('change'));
    const save=h('button',{type:'submit',class:'btn btn--primary'},'Upload file');
    root.append(h('form',{class:'stack',onsubmit:async(e:Event)=>{
      e.preventDefault();if(save.disabled)return;const selected=file.files?.[0];if(!selected)return;
      const limit=kind.value==='logo'?2*1024*1024:12*1024*1024;
      if(selected.size>limit){status.textContent=kind.value==='logo'?'Logo must be 2 MB or smaller.':'Portfolio must be 12 MB or smaller.';return;}
      save.disabled=true;status.textContent='Uploading…';
      try {
        const bytes=new Uint8Array(await selected.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const input:TeamFileInput={kind:kind.value as TeamFileKind,name:selected.name,mime:/\.svg$/i.test(selected.name)?'image/svg+xml':/\.png$/i.test(selected.name)?'image/png':'application/pdf',base64:btoa(binary)};
        try { validateTeamFile(input); } catch(err) { status.textContent=err instanceof Error?err.message:'Check the file.';return; }
        const existing=files.find(f=>f.teamId===team.value&&f.kind===kind.value);
        await ctx.api.uploadTeamFile(eventId,team.value,existing?.revision??0,input);if(alive)ctx.rerender();
      }catch(err){if(alive)status.textContent=errorText(err);}
      finally{if(alive)save.disabled=false;}
    }},h('label',{class:'field'},h('span',{class:'field__label'},'Team'),team),h('label',{class:'field'},h('span',{class:'field__label'},'Category'),kind),h('label',{class:'field'},h('span',{class:'field__label'},'File'),file),guide,h('p',{class:'muted'},'Uploading replaces the existing file in this category. Published results lock uploads.'),save));
  }
  if(staff && files.some(f=>f.kind==='logo')) {
    const archive=h('button',{type:'button',class:'btn btn--ghost'},'Download team logos ZIP');
    archive.onclick=async()=>{
      if(archive.disabled)return;archive.disabled=true;status.textContent='Preparing team artwork…';
      try {
        const {Zip,ZipPassThrough,strToU8}=await import('fflate');
        const parts:Uint8Array<ArrayBuffer>[]=[];
        const zip=new Zip((err,data)=>{if(err)throw err;parts.push(new Uint8Array(data));});
        const manifest:Array<{number:string;name:string;file:string}>=[],used=new Set<string>();
        for(const logo of files.filter(f=>f.kind==='logo')) {
          const team=teams.find(t=>t.id===logo.teamId);if(!team)continue;
          status.textContent=`Preparing artwork: ${team.number} · ${team.name}`;
          const data=await ctx.api.downloadTeamFile(eventId,logo.id);
          const prefix=team.number.padStart(3,'0').replace(/[^A-Za-z0-9_-]/g,'_');
          let name=`${prefix}-logo.${data.mime==='image/png'?'png':'svg'}`;
          if(used.has(name))name=`${prefix}-${team.id.replace(/[^A-Za-z0-9_-]/g,'_')}-logo.${data.mime==='image/png'?'png':'svg'}`;
          used.add(name);manifest.push({number:team.number,name:team.name,file:name});
          const entry=new ZipPassThrough(name);zip.add(entry);entry.push(Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)),true);
        }
        const entry=new ZipPassThrough('teams.json');zip.add(entry);entry.push(strToU8(JSON.stringify(manifest,null,2)),true);zip.end();
        const url=URL.createObjectURL(new Blob(parts,{type:'application/zip'}));
        h('a',{href:url,download:'STEM-Racing-team-logos.zip'}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        status.textContent=`Prepared ${manifest.length} team logos with numbered filenames and a team index.`;
      }catch(err){status.textContent=errorText(err);}finally{archive.disabled=false;}
    };
    root.append(archive);
  }
  const teamFilter=h('select',{'aria-label':'Filter files by team'},h('option',{value:''},'All available teams'),teams.filter(t=>files.some(f=>f.teamId===t.id)).map(t=>h('option',{value:t.id},`${t.number} · ${t.name}`)));
  const list=h('div',{class:'stack'});
  const render=()=>{list.replaceChildren(...files.filter(f=>!teamFilter.value||f.teamId===teamFilter.value).map(f=>{
    const team=teams.find(t=>t.id===f.teamId),download=h('button',{type:'button',class:'btn btn--ghost'},'Download');
    download.onclick=async()=>{download.disabled=true;try{
      const data=await ctx.api.downloadTeamFile(eventId,f.id),bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
      // Always download as an attachment; never inject uploaded SVG or PDF into the page.
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const number=teams.find(t=>t.id===data.teamId)?.number??data.teamId;
      const filename=data.kind==='logo'?`${number.padStart(3,'0').replace(/[^A-Za-z0-9_-]/g,'_')}-logo.${data.mime==='image/png'?'png':'svg'}`:data.name;
      const a=h('a',{href:url,download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){status.textContent=errorText(err);}finally{download.disabled=false;}};
    return h('article',{class:'row stack'},h('h3',null,`${team?`${team.number} · ${team.name}`:'Team'} · ${FILE_KINDS[f.kind]}`),h('p',null,f.name),h('p',{class:'muted'},`${Math.ceil(f.size/1024)} KB · version ${f.revision}`),download);
  }));if(!list.children.length)list.append(h('p',{class:'muted'},'No files available.'));};
  teamFilter.onchange=render;render();root.append(h('h2',null,'Available files'),h('label',{class:'field'},h('span',{class:'field__label'},'Team'),teamFilter),list);return root;
}
