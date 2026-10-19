import type { Area } from '../engine';
import { NOMINATION_AWARDS } from '../rulesets/rubrics';
import { ApiError } from './types';

export interface TeamFeedback { overall: string; strengths: string; improvements: string }
export interface PrivateReview { criterionNotes: Record<string, string>; internalNotes: string; nominations: string[] }
export type CardReview = TeamFeedback & PrivateReview;
export interface FeedbackRow extends TeamFeedback { cardId: string }
export interface NominationRow { cardId: string; teamId: string; panel: string; judgeId: string; nominations: string[] }

export const blankReview = (): CardReview => ({
  overall: '', strengths: '', improvements: '', criterionNotes: {}, internalNotes: '', nominations: [],
});

/** Also validates browser drafts before restoring them. The database independently enforces the same bounds. */
export function validateReview(value: unknown, area: Area): CardReview {
  if (!value || typeof value !== 'object') throw new ApiError('invalid', 'Invalid feedback');
  const r = value as CardReview;
  for (const key of ['overall', 'strengths', 'improvements', 'internalNotes'] as const) {
    if (typeof r[key] !== 'string' || r[key].length > 4000) throw new ApiError('invalid', 'Feedback must be 4000 characters or fewer');
  }
  if (!r.criterionNotes || typeof r.criterionNotes !== 'object' || Array.isArray(r.criterionNotes)
    || Object.entries(r.criterionNotes).some(([key, note]) => !area.criteria.some((c) => c.id === key) || typeof note !== 'string' || note.length > 1000)) {
    throw new ApiError('invalid', 'Invalid criterion notes');
  }
  if (!Array.isArray(r.nominations) || r.nominations.length > NOMINATION_AWARDS.length
    || new Set(r.nominations).size !== r.nominations.length
    || r.nominations.some((id) => !NOMINATION_AWARDS.some((a) => a.id === id))) throw new ApiError('invalid', 'Choose a listed award');
  return structuredClone(r);
}
