import { ApiError } from './types';
import type { TeamPhoto } from './types';
import {validateTeamFile} from './team-files';
import {extractDimensions,validatePhotoUpload} from './team-photos';

export type CompulsoryAssetKey =
  | 'team_logo'
  | 'car_render_fl'
  | 'car_render_fr'
  | 'car_model_3d'
  | 'model_materials'
  | 'official_photo'
  | 'team_colours'
  | 'member_portraits';

export interface CompulsoryAssetSpec {
  num: number;
  key: CompulsoryAssetKey;
  name: string;
  format: string;
  specifications: string;
  compulsory: true;
}

export const COMPULSORY_ASSET_SPECS: readonly CompulsoryAssetSpec[] = [
  {
    num: 1,
    key: 'team_logo',
    name: 'Team logo',
    format: 'SVG preferred, PNG accepted',
    specifications: 'High resolution, transparent background',
    compulsory: true,
  },
  {
    num: 2,
    key: 'car_render_fl',
    name: 'Car render — Front-left ¾',
    format: 'PNG',
    specifications: '3840 × 2160, transparent background',
    compulsory: true,
  },
  {
    num: 3,
    key: 'car_render_fr',
    name: 'Car render — Front-right ¾',
    format: 'PNG',
    specifications: '3840 × 2160, transparent background',
    compulsory: true,
  },
  {
    num: 4,
    key: 'car_model_3d',
    name: '3D car model',
    format: 'OBJ',
    specifications: 'Complete model at correct scale and orientation',
    compulsory: true,
  },
  {
    num: 5,
    key: 'model_materials',
    name: 'Model materials and textures',
    format: 'MTL + texture files',
    specifications: 'Packaged with OBJ in ZIP',
    compulsory: true,
  },
  {
    num: 6,
    key: 'official_photo',
    name: 'Official team photograph',
    format: 'JPG, JPEG or PNG',
    specifications: 'Preferably 3840 × 2160 or higher',
    compulsory: true,
  },
  {
    num: 7,
    key: 'team_colours',
    name: 'Team colours',
    format: 'HEX codes',
    specifications: 'Primary, secondary and accent colours',
    compulsory: true,
  },
  {
    num: 8,
    key: 'member_portraits',
    name: 'Individual team member portraits',
    format: 'JPG, JPEG or PNG',
    specifications: 'High-resolution individual portrait photograph per registered team member with name and role',
    compulsory: true,
  },
] as const;

export interface TeamColours {
  primary: string;
  secondary: string;
  accent: string;
}

export interface TeamMemberPortrait {
  id: string;
  name: string;
  role: string;
  fileName?: string;
  photoMime?: string;
  photoBase64?: string;
  updatedAt?: string;
}

export interface StoredCompulsoryFile {
  revision?: number;
  name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  base64?: string;
  updatedAt: string;
}

export interface TeamCompulsoryAssets {
  revision?: number;
  eventId: string;
  teamId: string;
  teamLogo?: StoredCompulsoryFile;
  carRenderFL?: StoredCompulsoryFile;
  carRenderFR?: StoredCompulsoryFile;
  carModel3D?: StoredCompulsoryFile;
  modelMaterials?: StoredCompulsoryFile;
  officialPhoto?: TeamPhoto;
  teamColours?: TeamColours;
  memberPortraits?: TeamMemberPortrait[];
  completedCount: number;
  totalCount: 8;
  isAllCompleted: boolean;
  missingKeys: CompulsoryAssetKey[];
}

export function normalizeHexColor(input: string): string {
  if(typeof input!=='string')throw new ApiError('invalid','All three HEX colours are required.');
  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new ApiError('invalid', `Invalid hex color code: ${input}. Use format #RRGGBB.`);
  }
  return `#${hex.toUpperCase()}`;
}

export function validateTeamColours(colours: TeamColours): TeamColours {
  if (!colours || typeof colours !== 'object') {
    throw new ApiError('invalid', 'Provide primary, secondary, and accent colors.');
  }
  return {
    primary: normalizeHexColor(colours.primary),
    secondary: normalizeHexColor(colours.secondary),
    accent: normalizeHexColor(colours.accent),
  };
}

export function extractPngDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  try {
    const bin = atob(base64.slice(0, 100));
    if (bin.length >= 24 && bin.charCodeAt(0) === 0x89 && bin.slice(1, 4) === 'PNG') {
      const width =
        (bin.charCodeAt(16) << 24) |
        (bin.charCodeAt(17) << 16) |
        (bin.charCodeAt(18) << 8) |
        bin.charCodeAt(19);
      const height =
        (bin.charCodeAt(20) << 24) |
        (bin.charCodeAt(21) << 16) |
        (bin.charCodeAt(22) << 8) |
        bin.charCodeAt(23);
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {
    // ignore
  }
  return null;
}

export function computeCompulsoryAssetStatus(
  eventId: string,
  teamId: string,
  raw: Partial<TeamCompulsoryAssets>,
): TeamCompulsoryAssets {
  const missing: CompulsoryAssetKey[] = [];

  if (!raw.teamLogo) missing.push('team_logo');
  if (!raw.carRenderFL) missing.push('car_render_fl');
  if (!raw.carRenderFR) missing.push('car_render_fr');
  if (!raw.carModel3D) missing.push('car_model_3d');
  if (!raw.modelMaterials) missing.push('model_materials');
  if (!raw.officialPhoto) missing.push('official_photo');
  if (!raw.teamColours || !['primary','secondary','accent'].every(k=>/^#[A-Fa-f0-9]{6}$/.test(raw.teamColours![k as keyof TeamColours]))) missing.push('team_colours');
  if (!raw.memberPortraits?.length || raw.memberPortraits.some(m=>!m.name?.trim()||!m.role?.trim()||!m.photoBase64||!['image/jpeg','image/png'].includes(m.photoMime??''))) missing.push('member_portraits');

  const completedCount = 8 - missing.length;
  return {
    eventId,
    teamId,
    revision:raw.revision??0,
    teamLogo: raw.teamLogo,
    carRenderFL: raw.carRenderFL,
    carRenderFR: raw.carRenderFR,
    carModel3D: raw.carModel3D,
    modelMaterials: raw.modelMaterials,
    officialPhoto: raw.officialPhoto,
    teamColours: raw.teamColours,
    memberPortraits: raw.memberPortraits,
    completedCount,
    totalCount: 8,
    isAllCompleted: completedCount === 8,
    missingKeys: missing,
  };
}

export function validateMemberPortraits(members:TeamMemberPortrait[]):TeamMemberPortrait[] {
 if(!Array.isArray(members)||members.length>12)throw new ApiError('invalid','Provide up to 12 member portraits.');
 const ids=new Set<string>();
 return members.map(m=>{
  if(!m||typeof m.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(m.id)||ids.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.trim().length>100||typeof m.role!=='string'||!m.role.trim()||m.role.trim().length>100)throw new ApiError('invalid','Each member needs a unique ID, name and role.');
  ids.add(m.id);
  if(!m.photoBase64||!m.fileName||!['image/jpeg','image/png'].includes(m.photoMime??'')||m.photoBase64.length>Math.ceil(2*1024*1024/3)*4)throw new ApiError('invalid','Each member needs a JPG or PNG portrait up to 2 MB.');
  const checked=validatePhotoUpload({name:m.fileName,mime:m.photoMime!,base64:m.photoBase64,mediaConsent:true});
  if(checked.size>2*1024*1024||!extractDimensions(atob(m.photoBase64)))throw new ApiError('invalid','Use a complete portrait up to 2 MB.');
  return {...m,name:m.name.trim(),role:m.role.trim()};
 });
}
export function validateCompulsoryFile(key:CompulsoryAssetKey,file:{name:string;mime:string;base64:string}):{size:number;width:number|null;height:number|null} {
 if(key==='team_logo')return {size:validateTeamFile({...file,kind:'logo'}),width:null,height:null};
 if(!['car_render_fl','car_render_fr','car_model_3d','model_materials'].includes(key)||!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||/[\x00-\x1f/\\]/.test(file.name))throw new ApiError('invalid','Invalid media file details.');
 const limit=(key.startsWith('car_render_')?25:50)*1024*1024;
 if(typeof file.base64!=='string'||!file.base64.length||file.base64.length>Math.ceil(limit/3)*4||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw new ApiError('invalid','Invalid media file encoding or size.');
 const bytes=atob(file.base64);if(!bytes.length||bytes.length>limit)throw new ApiError('invalid','File too large.');
 let dims:{width:number;height:number}|null=null;
 if(key.startsWith('car_render_')){
  dims=extractDimensions(bytes);
  if(file.mime!=='image/png'||!/^.+\.png$/i.test(file.name)||!dims||!bytes.slice(-12).includes('IEND'))throw new ApiError('invalid','Use a complete PNG for the car render.');
  const issues:string[]=[];
  if(dims.width!==3840||dims.height!==2160)issues.push(`This render is ${dims.width} × ${dims.height} px. Export it at 3840 × 2160 px.`);
  if(![4,6].includes(bytes.charCodeAt(25)))issues.push('This PNG has no alpha channel. Export it with a transparent background.');
  if(issues.length)throw new ApiError('invalid',issues.join(' '));
 }else if(key==='car_model_3d'){
  if(file.mime!=='model/obj'||!/\.obj$/i.test(file.name)||!/(^|\n)v[ \t]+[-+0-9.]/.test(bytes)||!/(^|\n)f[ \t]+[0-9]/.test(bytes))throw new ApiError('invalid','Use an OBJ model containing vertices and faces.');
 }else if(file.mime!=='application/zip'||!/\.zip$/i.test(file.name)||!bytes.startsWith('PK\x03\x04')||!bytes.slice(-65557).includes('PK\x05\x06'))throw new ApiError('invalid','Use a complete ZIP of materials and textures.');
 return {size:bytes.length,width:dims?.width??null,height:dims?.height??null};
}
