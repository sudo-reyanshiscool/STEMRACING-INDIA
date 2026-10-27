import {ApiError} from './types';
/** Original supplied brand artwork; no generated logo, gradient or track geometry. */
export const BRANDING_RESOURCES = [
 {path:'brand/profile-letterhead.png',url:'/brand/profile-letterhead.png',mime:'image/png'},
 {path:'brand/profile-footer-rule.png',url:'/brand/profile-footer-rule.png',mime:'image/png'},
 {path:'brand/stem-racing-india.png',url:'/brand/logo-india-colour-white.png',mime:'image/png'},
 {path:'brand/track-shape-pink.svg',url:'/brand/track-shape-pink.svg',mime:'image/svg+xml'},
 {path:'brand/Magistral-BoldItalic.woff2',url:'/fonts/Magistral-BoldItalic.woff2',mime:'font/woff2'},
 {path:'brand/MachoModular-Medium.woff2',url:'/fonts/MachoModular-Medium.woff2',mime:'font/woff2'},
 {path:'brand/MachoModular-Bold.woff2',url:'/fonts/MachoModular-Bold.woff2',mime:'font/woff2'},
] as const;
export interface BrandingResource {path:string;mime:string;bytes:Uint8Array}
export async function loadBrandingResources():Promise<BrandingResource[]> {
 return Promise.all(BRANDING_RESOURCES.map(async asset=>{
  const response=await fetch(asset.url);
  if(!response.ok)throw new ApiError('network','Brand artwork could not be loaded. Please try the download again.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length)throw new ApiError('network','Brand artwork is unavailable. Please try again.');
  return {path:asset.path,mime:asset.mime,bytes};
 }));
}
