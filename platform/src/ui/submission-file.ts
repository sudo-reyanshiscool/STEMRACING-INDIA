import {SubmissionValidationError} from './submission-errors';
/** Native FileReader avoids large intermediate JS strings and supports Safari file handles. */
export async function readSubmissionFile(file:File,limit:number,onProgress?:(loaded:number,total:number)=>void):Promise<string> {
 if(file.size<1)throw new SubmissionValidationError('This file is empty. Choose the original file and try again.');
 if(file.size>limit)throw new SubmissionValidationError(`File must be ${(limit/1048576).toFixed(0)} MB or smaller. Selected file is ${(file.size/1048576).toFixed(1)} MB.`);
 return new Promise<string>((resolve,reject)=>{
  let settled=false,reader:FileReader|undefined;
  const finish=(error:Error|null,result?:string)=>{if(settled)return;settled=true;clearTimeout(timer);if(reader){reader.onload=reader.onerror=reader.onabort=reader.onprogress=null;}if(error)reject(error);else resolve(result!);};
  const timer=setTimeout(()=>{finish(new SubmissionValidationError('The file could not be read in time. Download it fully to this device, choose it again and retry.'));reader?.abort();},60000);
  if(typeof FileReader!=='undefined'&&file instanceof Blob){
   reader=new FileReader();reader.onprogress=e=>onProgress?.(e.loaded,e.total||file.size);
   reader.onerror=()=>finish(new SubmissionValidationError('This file could not be read. Save a copy on this device and choose it again.'));
   reader.onabort=()=>finish(new SubmissionValidationError('Reading the file was interrupted. Choose it again to retry.'));
   reader.onload=()=>{const result=reader!.result;if(typeof result!=='string'||!result.includes(';base64,')){finish(new SubmissionValidationError('This file could not be read. Choose it again.'));return;}finish(null,result.slice(result.indexOf(',')+1));};
   try{reader.readAsDataURL(file);}catch{finish(new SubmissionValidationError('The browser could not open this file. Save a local copy and choose it again.'));}
  }else{
   void file.arrayBuffer().then(buffer=>{const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));finish(null,btoa(binary));}).catch(()=>finish(new SubmissionValidationError('This file could not be read. Choose it again.')));
  }
 });
}
