export type PanelId = 'scrutineering' | 'design_engineering' | 'project_management' | 'enterprise' | 'verbal';
export type CategoryId =
  | 'specification'
  | 'design-engineering'
  | 'project-management'
  | 'enterprise'
  | 'verbal'
  | 'racing';

export interface Band { min: number; max: number; description?: string }
export interface Criterion { id: string; name: string; max: number; bands: Band[] }

export interface Area {
  id: string;
  name: string;
  categoryId: CategoryId;
  /** scorecard = scored by judges; derived = computed or entered by other modules (later phases). */
  kind: 'scorecard' | 'derived';
  panel: PanelId | null;
  max: number;
  criteria: Criterion[];
}

export interface Category { id: CategoryId; name: string }

export interface Ruleset {
  id: string;
  name: string;
  version: number;
  issued: string;
  source: string;
  categories: Category[];
  areas: Area[];
  /** Area whose score breaks ties in the final ranking (C3.4). */
  tieBreakAreaId: string;
  /** Points deducted for an unsuccessful protest or appeal (C11.3). */
  protestPenalty: number;
}
