import { ApiError } from './types';
import type { TeamPhoto } from './types';

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
  name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  base64?: string;
  updatedAt: string;
}

export interface TeamCompulsoryAssets {
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
    primary: normalizeHexColor(colours.primary || '#E6007E'),
    secondary: normalizeHexColor(colours.secondary || '#312783'),
    accent: normalizeHexColor(colours.accent || '#FCBC00'),
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
  if (!raw.teamColours || !raw.teamColours.primary) missing.push('team_colours');
  if (!raw.memberPortraits || raw.memberPortraits.length === 0) missing.push('member_portraits');

  const completedCount = 8 - missing.length;
  return {
    eventId,
    teamId,
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
