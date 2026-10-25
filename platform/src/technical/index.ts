export * from './types';
export { parseMeasurement } from './parse';
export { round6, wholeUnits, breachOf, penaltyFor, nearLimit } from './penalty';
export { evaluate } from './evaluate';
export { describeLimit, describePenalty, fmt } from './describe';
export { AWARDS_LOST, selectedRules, summarise, carStatus, summarisePair, specificationsScore, type CarSummary, type CarStatus, type PairSummary } from './summarise';
export { INDIA_TECHNICAL, ruleByArticle, type Ruleset as TechnicalRuleset } from './rules';
export { SECTIONS } from './sections';
