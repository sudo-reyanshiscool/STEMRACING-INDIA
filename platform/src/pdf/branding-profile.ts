import {jsPDF} from 'jspdf';
import html2canvas from 'html2canvas';
import {brandingProfileHtml,type TeamBrandingProfile} from '../api/team-branding';
import type {BrandingResource} from '../api/branding-resources';
import {ApiError} from '../api/types';

export interface BrandingPdfSource {resources:BrandingResource[];files:Array<{path:string;mime:string;bytes:Uint8Array}>}
const dataUrl=(mime:string,bytes:Uint8Array)=>{
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return `data:${mime};base64,${btoa(binary)}`;
};
/** Render the branded layout in an isolated document, then paginate whole content blocks. */
export async function renderBrandingPdf(profile:TeamBrandingProfile,source:BrandingPdfSource):Promise<Uint8Array<ArrayBuffer>> {
 const frame=document.createElement('iframe');frame.title='Preparing team branding PDF';
 frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-same-origin');
 frame.style.cssText='position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;pointer-events:none';
 const resourceUrl=(path:string)=>{const resource=source.resources.find(r=>r.path===path);if(!resource)throw new Error('PDF letterhead is unavailable');return dataUrl(resource.mime,resource.bytes);};
 const letterhead=resourceUrl('brand/profile-letterhead.png'),footerRule=resourceUrl('brand/profile-footer-rule.png');
 let html=brandingProfileHtml(profile,source.resources);
 for(const file of [...source.resources,...source.files])html=html.replaceAll(`src="${file.path}"`,`src="${dataUrl(file.mime,file.bytes)}"`);
 html=html.replaceAll('loading="lazy"','loading="eager"').replace('</style>',`
 main{margin:0;width:794px;max-width:none}.masthead{display:none}.hero{min-height:170px;padding:30px 64px 24px;background:var(--white);color:var(--carbon);isolation:auto}.hero h1{font-size:40px;color:var(--carbon);margin:10px 0 14px}.hero-copy{width:100%}.hero .eyebrow{color:var(--pink)}.track-shape{display:none}.profile-body{padding:0 64px}.section{padding:24px 0}.members img{height:180px}.photo img{max-height:340px}
 .pdf-page{position:relative;width:794px;height:1123px;padding:0 0 80px;background:white;overflow:hidden}.pdf-letterhead{display:block;width:794px;height:153.59px;object-fit:contain}.pdf-footer{position:absolute;bottom:32px;left:64px;right:64px;font-size:9px;line-height:1.4;color:var(--muted)}.pdf-footer-rule{display:block;width:100%;height:2.5px;margin-bottom:8px}.pdf-footer-row{display:flex;justify-content:space-between;gap:16px}.pdf-footer-row span:last-child{white-space:nowrap}
 </style>`);
 try {
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new ApiError('network','The PDF could not be prepared. Try again.')),20000);
   frame.onload=()=>{clearTimeout(timer);resolve();};frame.srcdoc=html;document.body.append(frame);
  });
  const doc=frame.contentDocument;if(!doc)throw new Error('PDF document unavailable');
  await doc.fonts.ready;
  await Promise.all(Array.from(doc.images).map(async img=>{
   if(!img.complete)await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('An image could not be loaded for the PDF'));});
   if(!img.naturalWidth)throw new Error('An image could not be loaded for the PDF');
  }));
  // Give SVGs explicit raster dimensions for consistent canvas export (including supplied gradients).
  for(const img of Array.from(doc.images).filter(img=>img.src.startsWith('data:image/svg+xml'))){
   const canvas=doc.createElement('canvas');const scale=1600/Math.max(img.naturalWidth,img.naturalHeight);canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const context=canvas.getContext('2d');if(!context)throw new Error('PDF image rendering unavailable');context.drawImage(img,0,0,canvas.width,canvas.height);
   const png=canvas.toDataURL('image/png');await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('PDF image rendering failed'));img.src=png;});
   canvas.width=canvas.height=0;
  }
  const main=doc.querySelector('main')!;
  const blocks:HTMLElement[]=[doc.querySelector('.hero')!];
  for(const section of Array.from(doc.querySelectorAll<HTMLElement>('.profile-body>.section,.profile-body>footer'))){
   const members=section.querySelector('.members');
   if(members&&members.querySelector('article')){
    const cards=Array.from(members.children);
    for(let i=0;i<cards.length;i+=3){const part=section.cloneNode(false) as HTMLElement;part.append(section.querySelector('.section-title')!.cloneNode(true));const row=members.cloneNode(false) as HTMLElement;row.append(...cards.slice(i,i+3));part.append(row);const wrap=doc.createElement('div');wrap.className='profile-body';wrap.append(part);blocks.push(wrap);}
   }else{const wrap=doc.createElement('div');wrap.className='profile-body';wrap.append(section);blocks.push(wrap);}
  }
  main.replaceChildren();const pages:HTMLElement[]=[];
  const page=()=>{const el=doc.createElement('div');el.className='pdf-page';const header=doc.createElement('img');header.className='pdf-letterhead';header.src=letterhead;header.alt='STEM Racing India';el.append(header);main.append(el);pages.push(el);return el;};
  let current=page();
  for(const block of blocks){current.append(block);if(current.scrollHeight>1123){block.remove();if(current.children.length===1)throw new Error('A profile section is too large for a PDF page');current=page();current.append(block);if(current.scrollHeight>1123)throw new Error('A profile section is too large for a PDF page');}}
  const pdf=new jsPDF({format:'a4',unit:'mm',compress:true});
  pdf.setProperties({title:`${profile.team.name} - Team branding profile`,author:'STEM Racing India'});
  for(let i=0;i<pages.length;i++){
   const footer=doc.createElement('div');footer.className='pdf-footer';const rule=doc.createElement('img');rule.className='pdf-footer-rule';rule.src=footerRule;rule.alt='';const row=doc.createElement('div');row.className='pdf-footer-row';const title=doc.createElement('span');title.textContent=`STEM Racing India | Team branding profile | Team ${profile.team.number}`;const number=doc.createElement('span');number.textContent=`${i+1} / ${pages.length}`;row.append(title,number);footer.append(rule,row);pages[i].append(footer);
   const canvas=await html2canvas(pages[i],{scale:2,backgroundColor:'#ffffff',logging:false,windowWidth:794,windowHeight:1123});
   if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.95),'JPEG',0,0,210,297,undefined,'FAST');canvas.width=canvas.height=0;
  }
  return new Uint8Array(pdf.output('arraybuffer'));
 }finally{frame.remove();}
}
