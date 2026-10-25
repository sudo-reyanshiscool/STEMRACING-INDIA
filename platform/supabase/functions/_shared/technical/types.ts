export type RuleClass = 'GEN' | 'SAF' | 'PERF';
export type Unit = 'mm' | 'g' | 'deg' | 'count';
export type SectionId =
  | 'registration'
  | 'scales'
  | 'chamber'
  | 'tethers'
  | 'wheels'
  | 'nose'
  | 'rear'
  | 'halo'
  | 'drawings';

export interface FlatPenalty { flat: number }
export interface UnitPenalty { perUnit: number }
export type Penalty = FlatPenalty | UnitPenalty;

interface RuleBase {
  article: string;
  name: string;
  cls: RuleClass;
  section: SectionId;
  /** Measurement condition shown on the row, e.g. cartridge inserted. */
  condition?: string;
  hint?: string;
}

/** One number against min/max. Unit comes from the rule. */
export interface RangeRule extends RuleBase {
  kind: 'range';
  unit: Unit;
  min?: number;
  max?: number;
  penalty: Penalty;
  /** T3.6: officials add underside ballast at 0.2 g per 0.1 g under. */
  ballastIfUnder?: boolean;
}

/** One pass/fail question. true = compliant. */
export interface CheckRule extends RuleBase {
  kind: 'check';
  question: string;
  penalty: FlatPenalty;
}

export interface ItemDef {
  id: string;
  label: string;
  group?: string;
  min?: number;
  max?: number;
}

/** One number per item (wheel, axle, chord extreme). Penalty is charged per failing item. */
export interface PerItemRangeRule extends RuleBase {
  kind: 'perItemRange';
  unit: Unit;
  items: ItemDef[];
  penalty: Penalty;
  /** T7.4/T7.5: if no axle has both wheels out, keep the points but classify General. */
  generalIfOneWheelPerAxle?: boolean;
}

/** One pass/fail per item. Penalty is charged per failing item. */
export interface PerItemCheckRule extends RuleBase {
  kind: 'perItemCheck';
  question: string;
  items: ItemDef[];
  penalty: FlatPenalty;
}

export const SPAN_LINES = ['leading', 'trailing', 'top', 'bottom'] as const;
export type SpanLine = (typeof SPAN_LINES)[number];

/** Wing span: four measured lines, the shortest governs. Always mm. */
export interface SpanRule extends RuleBase {
  kind: 'span';
  min: number;
  penalty: UnitPenalty;
}

export type Rule = RangeRule | CheckRule | PerItemRangeRule | PerItemCheckRule | SpanRule;

export type Value = number | boolean | Record<string, number | boolean | undefined> | undefined;
/** Keyed by rule article. */
export type Measurements = Record<string, Value>;

export type Status = 'pending' | 'pass' | 'fail' | 'invalid';

export interface Result {
  article: string;
  name: string;
  /** Effective class after any reclassification. */
  cls: RuleClass;
  declaredCls: RuleClass;
  status: Status;
  penalty: number;
  /** Human-readable lines explaining each breach. */
  detail: string[];
  /** Extra notes such as ballast or reclassification. */
  notes: string[];
  /** Passing, but within 0.5 of a limit. */
  atRisk: boolean;
}

export type Car = 'A' | 'B';
export type InspectionStatus = 'in_progress' | 'submitted' | 'reopened';

/** A technical inspection record for one car, persisted in Supabase. */
export interface Inspection {
  id: string;
  eventId: string;
  teamId: string;
  car: Car;
  inspectorId: string;
  status: InspectionStatus;
  rulesetId: string;
  selectedArticles?: string[] | null;
  measurements: Measurements;
  notes: Record<string, string>;
  startedAt: string;
  submittedAt: string | null;
  updatedAt: string;
  revision: number;
}
