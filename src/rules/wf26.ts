import type {
  CheckRule, ItemDef, PerItemCheckRule, PerItemRangeRule, RangeRule, Rule, RuleClass, SectionId, SpanRule, Unit,
} from '../engine/types';

export interface Ruleset {
  id: string;
  name: string;
  issued: string;
  rules: Rule[];
}

const CI = 'Cartridge in, car resting on all four wheels unaided';

interface RangeOpts {
  unit: Unit;
  min?: number;
  max?: number;
  flat?: number;
  perUnit?: number;
  condition?: string;
  hint?: string;
  ballastIfUnder?: boolean;
}

const range = (article: string, name: string, cls: RuleClass, section: SectionId, o: RangeOpts): RangeRule => ({
  kind: 'range', article, name, cls, section, unit: o.unit, min: o.min, max: o.max,
  penalty: o.perUnit !== undefined ? { perUnit: o.perUnit } : { flat: o.flat as number },
  condition: o.condition, hint: o.hint, ballastIfUnder: o.ballastIfUnder,
});

const check = (
  article: string, name: string, cls: RuleClass, section: SectionId, flat: number, question: string,
  extra: { condition?: string; hint?: string } = {},
): CheckRule => ({ kind: 'check', article, name, cls, section, question, penalty: { flat }, ...extra });

const perCheck = (
  article: string, name: string, cls: RuleClass, section: SectionId, flat: number, question: string,
  items: ItemDef[], extra: { condition?: string; hint?: string } = {},
): PerItemCheckRule => ({ kind: 'perItemCheck', article, name, cls, section, question, items, penalty: { flat }, ...extra });

const perRange = (
  article: string, name: string, cls: RuleClass, section: SectionId, unit: Unit, perUnit: number, items: ItemDef[],
  extra: { condition?: string; hint?: string; generalIfOneWheelPerAxle?: boolean } = {},
): PerItemRangeRule => ({ kind: 'perItemRange', article, name, cls, section, unit, items, penalty: { perUnit }, ...extra });

const span = (article: string, name: string, section: SectionId, min: number, perUnit: number, hint?: string): SpanRule => ({
  kind: 'span', article, name, cls: 'PERF', section, min, penalty: { perUnit }, hint,
});

const WHEELS: ItemDef[] = [
  { id: 'FL', label: 'Front left', group: 'front' },
  { id: 'FR', label: 'Front right', group: 'front' },
  { id: 'RL', label: 'Rear left', group: 'rear' },
  { id: 'RR', label: 'Rear right', group: 'rear' },
];
const withLimits = (min?: number, max?: number, frontMin?: number, rearMin?: number): ItemDef[] =>
  WHEELS.map((w) => ({
    ...w,
    min: frontMin !== undefined ? (w.group === 'front' ? frontMin : rearMin) : min,
    max,
  }));

const chordItems = (): ItemDef[] => [
  { id: 'narrowest', label: 'Narrowest chord', min: 15 },
  { id: 'widest', label: 'Widest chord', max: 25 },
];
const thicknessItems = (): ItemDef[] => [
  { id: 'thinnest', label: 'Thinnest point', min: 2 },
  { id: 'thickest', label: 'Thickest point', max: 6 },
];

const rules: Rule[] = [
  // Registration and identity
  check('T3.1.3', 'Holographic Model Block sticker', 'GEN', 'registration', 5, 'The holographic sticker from this car\'s Model Block is on the submission sheet'),
  check('T3.1.4', 'Cars A and B identical', 'GEN', 'registration', 5, 'Both race cars have identical geometry'),
  check('T3.3', 'Only T1.1 components', 'PERF', 'registration', 20, 'Nothing on the car is outside the twelve T1.1 components'),
  range('T3.9.2', 'Introduced spare components', 'GEN', 'registration', { unit: 'count', max: 0, perUnit: 5, hint: 'Count spares not submitted at registration or not geometrically identical' }),
  check('T4.1', 'Single-piece body', 'GEN', 'registration', 20, 'Body is one continuous CNC-machined Model Block piece rear of plane A'),
  check('T4.6', 'Logo decal on each side', 'GEN', 'registration', 5, 'One 30 x 15 mm official decal per side, fully adhered and fully visible in side view'),
  check('T4.7', 'Team number and A/B marking', 'GEN', 'registration', 2, 'Number plus A or B between halo front edge and plane A, visible in plan view, text at least 8.0 mm high'),
  range('T4.8', 'Decal thickness', 'GEN', 'registration', { unit: 'mm', max: 0.5, flat: 5, hint: 'Total decal thickness, excluding surface finish' }),

  // Scales and gauges
  check('T3.2', 'Safe construction', 'SAF', 'scales', 10, 'The car is judged safe to race'),
  check('T2.7', 'Rests on four wheels', 'GEN', 'scales', 0, 'With a full cartridge inserted the car rests on all four wheels unaided', {
    condition: CI,
    hint: 'No penalty of its own, but a nose-up car fails T3.5, T3.7, T5.2, T5.4, T7.6 and T7.11',
  }),
  range('T3.4', 'Total width', 'GEN', 'scales', { unit: 'mm', min: 65, max: 85, perUnit: 5, hint: 'Widest feature, paint and decals included' }),
  range('T3.5', 'Total height', 'GEN', 'scales', { unit: 'mm', max: 65, perUnit: 5, condition: CI }),
  range('T3.6', 'Total weight (no cartridge)', 'PERF', 'scales', { unit: 'g', min: 48, perUnit: 10, ballastIfUnder: true, hint: 'Use the calibrated competition scales' }),
  range('T3.7', 'Track clearance', 'GEN', 'scales', { unit: 'mm', min: 1.5, perUnit: 10, condition: CI, hint: 'Every component except the wheels. Watch low front wings and tether guides' }),

  // Chamber and cartridge
  range('T5.1', 'Chamber diameter', 'SAF', 'chamber', { unit: 'mm', min: 18, max: 18.5, flat: 5, hint: 'Any point through the minimum depth' }),
  range('T5.2', 'Chamber distance from track', 'GEN', 'chamber', { unit: 'mm', min: 30, max: 40, perUnit: 5, condition: CI, hint: 'Rear centre of the cartridge to the track' }),
  range('T5.3', 'Chamber depth', 'SAF', 'chamber', { unit: 'mm', min: 45, max: 58, flat: 5 }),
  range('T5.4', 'Chamber angle', 'SAF', 'chamber', { unit: 'deg', min: -3, max: 3, flat: 5, condition: CI }),
  range('T5.5', 'Chamber wall thickness', 'SAF', 'chamber', { unit: 'mm', min: 3, flat: 10, hint: 'Unpainted and uninterrupted around the minimum depth' }),
  range('T5.6', 'Cartridge protrusion', 'PERF', 'chamber', { unit: 'mm', min: 5, perUnit: 10, hint: 'Beyond the rear of the car, and fully visible through a 360° sweep' }),

  // Tether guides
  check('T6.1', 'Tether guide location', 'SAF', 'tethers', 10, 'Exactly two secure guides: front within 10.0 mm ahead of the front axle, rear within 10.0 mm behind the rear axle'),
  check('T6.2', 'Tether guide opening', 'SAF', 'tethers', 5, 'The 3.5 mm tool passes and the 6.0 mm tool is blocked'),
  check('T6.3', 'Tether guide strength', 'SAF', 'tethers', 10, 'Holes fully closed and each guide holds 300 g'),

  // Wheels
  check('T7.1', 'Four cylindrical wheels', 'GEN', 'wheels', 25, 'Four cylindrical wheels, opposing wheels on a common axis'),
  perRange('T7.2', 'Distance between opposing wheels', 'PERF', 'wheels', 'mm', 2.5, [
    { id: 'front', label: 'Front axle', group: 'front', min: 38 },
    { id: 'rear', label: 'Rear axle', group: 'rear', min: 34 },
  ], { hint: 'Innermost distance between rotating wheel parts' }),
  range('T7.3', 'Wheelbase', 'PERF', 'wheels', { unit: 'mm', min: 120, max: 140, perUnit: 5, hint: 'Front to rear wheel centre lines, side view' }),
  perRange('T7.4', 'Track contact width', 'PERF', 'wheels', 'mm', 2.5, withLimits(undefined, undefined, 12, 15), {
    generalIfOneWheelPerAxle: true, hint: 'Constant-contact surface, excluding chamfers and fillets',
  }),
  perRange('T7.5', 'Wheel diameter', 'PERF', 'wheels', 'mm', 2.5, withLimits(28, 32), { generalIfOneWheelPerAxle: true }),
  perCheck('T7.6', 'All four wheels touch the track', 'PERF', 'wheels', 2.5, 'Wheel touches the track across its full contact width', WHEELS, { condition: CI }),
  perCheck('T7.7', 'Rolling surface', 'PERF', 'wheels', 2.5, 'Diameter is consistent across the contact width (no tread)', WHEELS),
  perCheck('T7.8', 'Free rotation', 'PERF', 'wheels', 5, 'Rotates freely on a 3° incline', WHEELS),
  check('T7.9.1', 'Clear zone in front of front wheels', 'PERF', 'wheels', 2.5, 'The 5.0 mm zone tool fits with no obstruction'),
  check('T7.9.2', 'Clear zone behind front wheels', 'PERF', 'wheels', 5, 'The zone tool (30.0 mm at the outer edge, tapering at 60° to 15.0 mm) fits'),
  check('T7.9.3', 'Clear zone in front of rear wheels', 'PERF', 'wheels', 5, 'The zone tool (30.0 mm at the outer edge, tapering at 45° to 5.0 mm) fits'),
  check('T7.9.4', 'Clear zone behind rear wheels', 'PERF', 'wheels', 2.5, 'The 5.0 mm zone tool fits with no obstruction'),
  perCheck('T7.10', 'Wheel visibility, side view', 'PERF', 'wheels', 10, 'Wheel is unobscured except by wheel support systems', WHEELS),
  range('T7.11', 'Front wheel obstruction, front view', 'PERF', 'wheels', { unit: 'mm', max: 20, perUnit: 10, condition: CI, hint: 'Highest point of any front-view obstruction of the front wheels' }),
  check('T7.12', 'Wheel supports inside the wheel cylinder', 'GEN', 'wheels', 5, 'Every wheel support fits inside the cylinder through the opposing wheels\' diameters'),
  perCheck('T7.13', 'Wheel safety test', 'SAF', 'wheels', 2.5, 'Holds 300 g on the claw tool', WHEELS, { hint: 'Needs clearance at the wheel inner corner for the claw' }),

  // Nose and front wing
  range('T8.2', 'Nose cone overhang', 'GEN', 'nose', { unit: 'mm', max: 40, flat: 5, hint: 'Forward of plane A to the extreme front of the car' }),
  check('T8.3', 'Front wing description', 'GEN', 'nose', 5, 'Wing on the nose with a leading and trailing edge across the full span'),
  check('T8.4', 'Front wing rigidity', 'GEN', 'nose', 5, 'Wing is rigid and its span does not change'),
  check('T8.5.1', 'Nose and wing support location', 'GEN', 'nose', 10, 'Forward of plane A, at most 25.0 mm high, within 15.0 mm either side of the centre line'),
  check('T8.5.2', 'Front wing location', 'GEN', 'nose', 10, 'At most 20.0 mm high wherever wider than 15.0 mm either side of the centre line'),
  check('T8.5.3', 'Front wing end plates', 'GEN', 'nose', 10, 'Outside the minimum span, at most 10.0 mm wide, at most 25.0 mm high beyond the wheels or 20.0 mm in front of them'),
  span('T8.6.1', 'Front wing span', 'nose', 50, 2, 'Enter each line\'s span counting only segments of at least 25.0 mm (a shorter segment counts as 0). Maximum two segments'),
  perRange('T8.6.2', 'Front wing chord', 'PERF', 'nose', 'mm', 1, chordItems(), { hint: 'Up to three elements that overlap in plan view' }),
  perRange('T8.6.3', 'Front wing thickness', 'PERF', 'nose', 'mm', 1, thicknessItems()),
  check('T8.7', 'Front wing clear airflow', 'PERF', 'nose', 5, 'The 5.0 mm ball on a 2.0 mm rod passes around the wing across the minimum span'),
  check('T8.8', 'Front wing visibility', 'PERF', 'nose', 10, 'Wing is unobstructed in front view'),

  // Rear wing
  check('T9.2', 'Rear wing description', 'GEN', 'rear', 5, 'Wing at the rear with a leading and trailing edge across the required span'),
  check('T9.3', 'Rear wing rigidity', 'GEN', 'rear', 5, 'Wing is rigid and its span does not change'),
  check('T9.4.1', 'Rear wing location', 'GEN', 'rear', 10, 'Wing and support are wholly rear of plane B'),
  range('T9.4.2', 'Rear overhang length', 'GEN', 'rear', { unit: 'mm', max: 40, flat: 5, hint: 'Behind plane B to the extreme rear of the car' }),
  range('T9.4.3', 'Rear overhang height', 'GEN', 'rear', { unit: 'mm', max: 65, flat: 5, hint: 'Rear of plane B, above the track' }),
  span('T9.5.1', 'Rear wing span', 'rear', 50, 2, 'A single unbroken span. A support that intersects the span fails it'),
  perRange('T9.5.2', 'Rear wing chord', 'PERF', 'rear', 'mm', 1, chordItems(), { hint: 'Up to two elements that overlap' }),
  perRange('T9.5.3', 'Rear wing thickness', 'PERF', 'rear', 'mm', 1, thicknessItems()),
  range('T9.5.4', 'Rear wing height deviation', 'GEN', 'rear', { unit: 'mm', max: 15, perUnit: 1, hint: 'Change from the wing\'s highest point along the minimum span, top surface' }),
  check('T9.6', 'Rear wing clear airflow', 'PERF', 'rear', 5, 'The 5.0 mm ball on a 2.0 mm rod passes around the wing across the minimum span'),
  check('T9.7', 'Rear wing visibility', 'PERF', 'rear', 10, 'Wing is unobstructed in front and rear views across the minimum span'),

  // Halo, helmet and virtual cargo
  check('T4.2', 'Virtual cargo', 'PERF', 'halo', 25, 'Minimum envelope (60.0 x 55.0 tapering to 10.0 x 10.0 mm) is inside the body, between the axle centre lines, symmetric, and clear of the halo pocket'),
  check('T4.4.1', 'Official halo, unmodified', 'PERF', 'halo', 10, 'Halo is the official 2026 file with no dimensional or surface changes'),
  check('T4.4.2', 'Halo visible, front and side', 'GEN', 'halo', 10, 'Unobstructed by any other component'),
  check('T4.4.3', 'Halo visible, top', 'GEN', 'halo', 10, 'Unobstructed in plan view except by the helmet'),
  range('T4.4.4', 'Halo notch height', 'SAF', 'halo', { unit: 'mm', min: 33, max: 35, flat: 5, hint: 'Notch centre 34.0 ± 1.0 mm above the track (pocket floor 24.0 mm)' }),
  check('T4.4.5', 'Halo safety test 1', 'SAF', 'halo', 5, 'Car on a cartridge carries a 2 kg load at the notch'),
  check('T4.4.6', 'Halo safety test 2', 'SAF', 'halo', 5, 'Car horizontal, supported by the chamber, carries 300 g on the halo front edge'),
  check('T4.5', 'Official helmet, unmodified', 'GEN', 'halo', 5, 'Official 2026 helmet, unmodified dimensions, not glued in (ballast access)'),

  // Engineering drawings
  check('T4.3', 'Virtual cargo identified in drawings', 'GEN', 'drawings', 5, 'Dimensioned from an axle centre line and height above track, and hatched, shaded or outlined'),
  check('T7.12.2', 'Wheel supports identified in drawings', 'GEN', 'drawings', 5, 'Front and rear wheel support surfaces are identified'),
  check('T8.1', 'Nose and front wing identified in drawings', 'GEN', 'drawings', 5, 'Nose, front wing(s), end plates and supports are dimensioned and identified'),
  check('T9.1', 'Rear wing identified in drawings', 'GEN', 'drawings', 5, 'Rear wing and supports are dimensioned and identified'),
];

export const WF26: Ruleset = {
  id: 'wf26-professional',
  name: 'Aramco STEM Racing World Finals 2026: Professional',
  issued: '2026-02-10',
  rules,
};

const byArticle = new Map(rules.map((r) => [r.article, r]));
export const ruleByArticle = (article: string): Rule | undefined => byArticle.get(article);
