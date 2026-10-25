import { ApiError } from './types';
import type { Panel } from './types';
export const FILE_KINDS = {logo:'Team logo',design_portfolio:'Design & Engineering portfolio',enterprise_portfolio:'Enterprise portfolio',project_portfolio:'Project Management portfolio'} as const;
export type TeamFileKind = keyof typeof FILE_KINDS;
export const FILE_PANEL: Record<TeamFileKind,Panel|null> = {logo:null,design_portfolio:'design_engineering',enterprise_portfolio:'enterprise',project_portfolio:'project_management'};
export interface TeamFile {id:string;eventId:string;teamId:string;kind:TeamFileKind;name:string;mime:string;size:number;revision:number;updatedAt:string}
export interface TeamFileInput {kind:TeamFileKind;name:string;mime:string;base64:string}
export function validateTeamFile(input: TeamFileInput): number {
  if(!input || !Object.hasOwn(FILE_KINDS,input.kind) || typeof input.name!=='string' || !input.name.trim() || input.name.length>180 || /[\x00-\x1f/\\]/.test(input.name)) throw new ApiError('invalid','Use a file name of 1–180 characters without path separators.');
  const limit=input.kind==='logo'?2*1024*1024:12*1024*1024;
  if(typeof input.base64!=='string'||input.base64.length>Math.ceil(limit/3)*4||!input.base64.length||input.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new ApiError('invalid','Invalid file encoding or file too large.');
  const bytes=atob(input.base64); if(bytes.length>limit)throw new ApiError('invalid','File too large.');
  if(input.kind==='logo') {
    if(input.mime==='image/png' && /\.png$/i.test(input.name) && bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.length>=33 && bytes.slice(12,16)==='IHDR') {
      const width=[16,17,18,19].reduce((v,i)=>v*256+bytes.charCodeAt(i),0), height=[20,21,22,23].reduce((v,i)=>v*256+bytes.charCodeAt(i),0);
      if(width<1||height<1||width>12000||height>12000)throw new ApiError('invalid','PNG dimensions must be between 1 and 12000 pixels.');
    } else if(input.mime==='image/svg+xml' && /\.svg$/i.test(input.name) && /<svg[\s>]/i.test(bytes) && /<\/svg\s*>/i.test(bytes)) {
      const tags=[...bytes.matchAll(/<\s*\/?\s*([A-Za-z_][\w.:-]*)/g)].map(m=>m[1].toLowerCase());
      const allowed=new Set(['svg','g','path','defs','lineargradient','radialgradient','stop','clippath','mask','pattern','rect','circle','ellipse','line','polyline','polygon','title','desc']);
      if(tags.some(t=>!allowed.has(t)))throw new ApiError('invalid','SVG contains unsupported elements. Export as PNG if needed.');
      // Self-contained vector artwork only. Downloaded files never enter the page DOM.
      if(/<\s*(?:script|foreignObject|iframe|object|embed|image|use|style|animate|set)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\s*\(|<!|<\?|&(?:#|[a-z])/i.test(bytes))throw new ApiError('invalid','SVG must contain self-contained static vector artwork. Export as PNG if needed.');
    } else throw new ApiError('invalid','Use a PNG or self-contained SVG logo.');
  } else if(input.mime!=='application/pdf'||!/\.pdf$/i.test(input.name)||!bytes.startsWith('%PDF-')||!bytes.slice(-2048).includes('%%EOF'))throw new ApiError('invalid','Use a complete PDF portfolio.');
  return bytes.length;
}
