import { ApiError } from './types';

export const PHOTO_MAX_BYTES = 26214400; // 25 MB
export const RECOMMENDED_WIDTH = 3840;
export const RECOMMENDED_HEIGHT = 2160;

export interface PhotoResolutionCheck {
  width: number;
  height: number;
  isRecommended: boolean;
  warning?: string;
}

export function checkResolution(width: number, height: number): PhotoResolutionCheck {
  const isRecommended = width >= RECOMMENDED_WIDTH && height >= RECOMMENDED_HEIGHT;
  let warning: string | undefined;
  if (!isRecommended) {
    warning = `Resolution is ${width} × ${height} px. We recommend at least ${RECOMMENDED_WIDTH} × ${RECOMMENDED_HEIGHT} px (4K) for sharp projection on large arena screens. Lower-resolution photographs may appear pixelated.`;
  }
  return { width, height, isRecommended, warning };
}

export function validatePhotoUpload(input: {
  name: string;
  mime: string;
  base64: string;
  mediaConsent: boolean;
}): { size: number; mime: string } {
  if (!input || !input.mediaConsent) {
    throw new ApiError('invalid', 'Media & minor consent acknowledgement is required for official team photographs.');
  }

  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180 || /[\x00-\x1f/\\]/.test(input.name)) {
    throw new ApiError('invalid', 'Provide a valid file name of 1–180 characters without path separators.');
  }

  const mime = input.mime.toLowerCase().trim();
  if (!['image/jpeg', 'image/jpg', 'image/png'].includes(mime)) {
    throw new ApiError('invalid', 'Only JPG, JPEG, and PNG photographs are supported.');
  }

  if (
    typeof input.base64 !== 'string' ||
    !input.base64.length ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  ) {
    throw new ApiError('invalid', 'Invalid photograph base64 encoding.');
  }

  const binary = atob(input.base64);
  const size = binary.length;
  if (size === 0 || size > PHOTO_MAX_BYTES) {
    throw new ApiError('invalid', `Photograph must be between 1 byte and 25 MB (was ${(size / (1024 * 1024)).toFixed(1)} MB).`);
  }

  if (mime === 'image/png') {
    if (!binary.startsWith('\x89PNG\r\n\x1a\n')) {
      throw new ApiError('invalid', 'Corrupt or invalid PNG header.');
    }
  } else {
    if (!binary.startsWith('\xff\xd8\xff')) {
      throw new ApiError('invalid', 'Corrupt or invalid JPEG header.');
    }
  }

  return { size, mime: mime === 'image/jpg' ? 'image/jpeg' : mime };
}

/** Reads dimensions from PNG or JPEG binary string or Uint8Array. */
export function extractDimensions(binary: string | Uint8Array): { width: number; height: number } | null {
 const length=binary.length,byte=(i:number)=>typeof binary==='string'?binary.charCodeAt(i):binary[i];
 if(length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>byte(i)===n)){
  const word=(i:number)=>(byte(i)*16777216+byte(i+1)*65536+byte(i+2)*256+byte(i+3));
  const width=word(16),height=word(20);return width>0&&height>0?{width,height}:null;
 }
 if(length<12||byte(0)!==255||byte(1)!==216)return null;
 let offset=2;
 while(offset+8<length){
  if(byte(offset)!==255)return null;
  while(offset+1<length&&byte(offset+1)===255)offset++;
  const marker=byte(offset+1);if(marker===217||marker===218)return null;
  if(marker===1||(marker>=208&&marker<=215)){offset+=2;continue;}
  const size=byte(offset+2)*256+byte(offset+3);if(size<2||offset+2+size>length)return null;
  if([192,193,194].includes(marker)){
   if(size<7)return null;const height=byte(offset+5)*256+byte(offset+6),width=byte(offset+7)*256+byte(offset+8);return width>0&&height>0?{width,height}:null;
  }
  offset+=2+size;
 }
 return null;
}

export const DEFAULT_WORKER_URL = 'http://127.0.0.1:5195';

/** The original remains saved when the processor is unavailable; never fabricate a cutout. */
export async function executeBackgroundRemoval(imageBase64:string,options:{workerUrl?:string;timeoutMs?:number}={}):Promise<{cutoutBase64:string;width:number;height:number}> {
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??25000);
 try {
  const res=await fetch(`${options.workerUrl??DEFAULT_WORKER_URL}/remove-background`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:imageBase64}),signal:controller.signal});
  if(!res.ok)throw new Error('Processor failed');
  const data=await res.json();
  validatePhotoUpload({name:'cutout.png',mime:'image/png',base64:data?.base64,mediaConsent:true});
  const dims=extractDimensions(atob(data.base64));
  if(!dims||dims.width<1||dims.height<1||dims.width>16000||dims.height>16000)throw new Error('Invalid processor image');
  return {cutoutBase64:data.base64,...dims};
 }catch{throw new ApiError('network','Background removal is unavailable. Your original photograph is saved. Retry processing or upload a corrected PNG.');}
 finally{clearTimeout(timer);}
}
