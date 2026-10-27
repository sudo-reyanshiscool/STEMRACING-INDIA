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
 let html=brandingProfileHtml(profile,source.resources);
 for(const file of [...source.resources,...source.files])html=html.replaceAll(`src="${file.path}"`,`src="${dataUrl(file.mime,file.bytes)}"`);
 html=html.replaceAll('loading="lazy"','loading="eager"').replace('</style>',`
 main{margin:0;width:794px;max-width:none}.masthead{padding:12px 24px}.hero{min-height:240px;padding:30px 40px 40px}.hero h1{font-size:48px}.hero{isolation:auto}.hero-copy{z-index:2}.track-shape{z-index:1;width:260px;bottom:-110px}.profile-body{padding:0 40px}.section{padding:24px 0}.members img{height:180px}.photo img{max-height:380px}
 .pdf-page{position:relative;width:794px;height:1123px;padding:20px 0 38px;background:white;overflow:hidden}.pdf-page-number{position:absolute;bottom:12px;right:40px;font-size:10px;color:var(--muted)}
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
  const blocks:HTMLElement[]=[doc.querySelector('.masthead')!,doc.querySelector('.hero')!];
  for(const section of Array.from(doc.querySelectorAll<HTMLElement>('.profile-body>.section,.profile-body>footer'))){
   const members=section.querySelector('.members');
   if(members&&members.querySelector('article')){
    const cards=Array.from(members.children);
    for(let i=0;i<cards.length;i+=3){const part=section.cloneNode(false) as HTMLElement;part.append(section.querySelector('.section-title')!.cloneNode(true));const row=members.cloneNode(false) as HTMLElement;row.append(...cards.slice(i,i+3));part.append(row);const wrap=doc.createElement('div');wrap.className='profile-body';wrap.append(part);blocks.push(wrap);}
   }else{const wrap=doc.createElement('div');wrap.className='profile-body';wrap.append(section);blocks.push(wrap);}
  }
  main.replaceChildren();const pages:HTMLElement[]=[];
  const page=()=>{const el=doc.createElement('div');el.className='pdf-page';main.append(el);pages.push(el);return el;};
  let current=page();
  for(const block of blocks){current.append(block);if(current.scrollHeight>1123){block.remove();if(!current.children.length)throw new Error('A profile section is too large for a PDF page');current=page();current.append(block);if(current.scrollHeight>1123)throw new Error('A profile section is too large for a PDF page');}}
  const pdf=new jsPDF({format:'a4',unit:'mm',compress:true});
  pdf.setProperties({title:`${profile.team.name} - Team branding profile`,author:'STEM Racing India'});
  for(let i=0;i<pages.length;i++){
   const label=doc.createElement('div');label.className='pdf-page-number';label.textContent=`${profile.team.number} · ${profile.team.name} | ${i+1} / ${pages.length}`;pages[i].append(label);
   const canvas=await html2canvas(pages[i],{scale:2,backgroundColor:'#ffffff',logging:false,windowWidth:794,windowHeight:1123});
   if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.95),'JPEG',0,0,210,297,undefined,'FAST');canvas.width=canvas.height=0;
  }
  return new Uint8Array(pdf.output('arraybuffer'));
 }finally{frame.remove();}
}
