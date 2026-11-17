import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs/promises';
const base=path.resolve(import.meta.dirname,'..');
const output=path.resolve(base,'../output/walkthroughs');
await fs.mkdir(output,{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(base,'src/Root.tsx'),publicDir:path.join(base,'public')});
const ids=process.argv.filter(x=>['Teams','Judges','Organisers'].includes(x));
const preview=process.argv.includes('--stills');
const storyboard=process.argv.includes('--storyboard');
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for(const id of ids.length?ids:['Teams','Judges','Organisers']){
 const composition=await selectComposition({serveUrl,id,browserExecutable});
 if(storyboard){
   const dir=path.join(output,'qa');await fs.mkdir(dir,{recursive:true});let at=0;
   for(const [i,s] of composition.props.video.scenes.entries()){await renderStill({serveUrl,composition,output:path.join(dir,`${id.toLowerCase()}-${String(i).padStart(2,'0')}.png`),frame:(at+3)*24,browserExecutable});at+=s.seconds;}
   console.log(`${id}: storyboard ready`);continue;
 }
 if(preview){
   for(const [label,second] of [['cover',3],['sample',22]])await renderStill({serveUrl,composition,output:path.join(output,`${id.toLowerCase()}-${label}.png`),frame:second*24,browserExecutable});
   console.log(`${id}: preview stills ready`);continue;
 }
 let last=-1;
 await renderMedia({serveUrl,composition,codec:'h264',outputLocation:path.join(output,`STEM-Racing-${id}-Guide.mp4`),browserExecutable,crf:19,pixelFormat:'yuv420p',concurrency:4,onProgress:({progress})=>{const n=Math.floor(progress*10);if(n!==last){last=n;console.log(`${id}: ${n*10}%`)}}});
 console.log(`${id}: complete`);
}
