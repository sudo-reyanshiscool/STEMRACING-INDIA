import {
  ApiError, type ApiErrorCode, type CardRow, type ConflictRow, type EventRow, type InviteRow, type OverrideRow, type PenaltyRow, type RoleRow,
  type SnapshotRow, type TeamRow,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * SQLSTATE (or PostgREST) code to API error code. Table-driven: add a line, add a test. A test also scans the
 * migrations so that every errcode they raise is listed here.
 */
export const PG_ERROR_CODES: Readonly<Record<string, ApiErrorCode>> = {
  '42501': 'forbidden', // insufficient_privilege: RLS violation, or a function/table not granted to this role
  '28000': 'unauthenticated', // create_event with no signed-in user
  PGRST301: 'unauthenticated', // PostgREST: JWT invalid or expired
  PGRST303: 'unauthenticated', // PostgREST: JWT claims validation failed
  '55000': 'locked', // object_not_in_prerequisite_state: submitted card, released freeze, immutable snapshot
  '40001': 'conflict', // race revised on another device
  '23505': 'duplicate', // unique_violation
  '23514': 'invalid', // check_violation (also: criterion has no score on submit)
  '23502': 'invalid', // not_null_violation
  '23503': 'invalid', // foreign_key_violation: e.g. a team that is not part of the event
  '22023': 'invalid', // invalid_parameter_value: unknown area, criterion, ruleset mismatch
  '22P02': 'invalid', // invalid_text_representation
  '22007': 'invalid', // invalid_datetime_format
  '22008': 'invalid', // datetime_field_overflow
  '22001': 'invalid', // string_data_right_truncation
  '22003': 'invalid', // numeric_value_out_of_range
  P0002: 'not-found', // no_data_found (reopen_scorecard on an unknown card)
  PGRST116: 'not-found', // PostgREST: single row expected, none found
};

const EXPIRED = /jwt expired/i;
const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnrefused|enotfound/i;

export function mapPgError(e: { message: string; code?: string }): ApiError {
  if (e.code === '55000' && e.message === 'watch the full submission guide before uploading') return new ApiError('guide-required', e.message);
  const known = e.code && Object.prototype.hasOwnProperty.call(PG_ERROR_CODES, e.code) ? PG_ERROR_CODES[e.code] : undefined;
  if (known) return new ApiError(known, e.message);
  if (EXPIRED.test(e.message)) return new ApiError('unauthenticated', e.message);
  if (NETWORK.test(e.message)) return new ApiError('network', 'No connection to the server');
  return new ApiError('unknown', e.message);
}

/** supabase-js auth errors: status 0 is a failed fetch; a malformed address is the caller's mistake. */
export function mapAuthError(e: { message: string; name?: string; code?: string; status?: number }): ApiError {
  if (e.status === 0 || e.name === 'AuthRetryableFetchError') return new ApiError('network', 'No connection to the server');
  if (e.status === 429) return new ApiError('rate-limited', 'Email sending limit reached');
  if (e.code && ['otp_expired', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier', 'mfa_challenge_expired'].includes(e.code)) return new ApiError('invalid-auth', 'Sign-in link or code expired');
  if (e.code && ['mfa_verification_failed', 'invalid_grant', 'mfa_factor_not_found', 'mfa_challenge_not_found'].includes(e.code)) return new ApiError('invalid-auth', 'Invalid authenticator code. Check your app and try again.');
  if (e.code === 'email_address_invalid' || e.code === 'validation_failed') return new ApiError('invalid', e.message);
  return mapPgError({ message: e.message });
}

/** A function returning a table row arrives as an object or, depending on the client version, a one-element array. */
export function firstRow(v: unknown): Row {
  const r = Array.isArray(v) ? v[0] : v;
  if (r === null || r === undefined || typeof r !== 'object') throw new ApiError('unknown', 'The server returned no row');
  return r as Row;
}

export const toEventRow = (r: Row): EventRow => ({
  id: r.id, name: r.name, startsOn: r.starts_on ?? null, ruleset: r.ruleset, resultsReleased: !!r.results_released,
});
export const toTeamRow = (r: Row): TeamRow => ({ id: r.id, eventId: r.event_id, number: r.number, name: r.name, school: r.school ?? '' });
export const toRoleRow = (r: Row): RoleRow => ({
  ...(r.display_name ? {name:r.display_name} : {}),
  id: r.id, eventId: r.event_id, userId: r.user_id, role: r.role, panel: r.panel ?? null, teamId: r.team_id ?? null, email: r.email ?? null,
});
export const toInviteRow = (r: Row): InviteRow => ({
  ...(r.display_name ? {name:r.display_name} : {}),
  id: r.id, eventId: r.event_id, email: r.email, role: r.role, panel: r.panel ?? null, teamId: r.team_id ?? null,
  emailStatus: r.email_status ?? 'not_sent', emailSentAt: r.email_sent_at ?? null, emailFailure: r.email_failure ?? null,
});
export const toCardRow = (r: Row): CardRow => {
  const scores: Record<string, number> = {};
  const comments: Record<string, string> = {};
  for (const s of (r.scorecard_scores ?? []) as Row[]) {
    scores[s.criterion_id] = s.score;
    comments[s.criterion_id] = s.comment ?? '';
  }
  return {
    id: r.id, eventId: r.event_id, teamId: r.team_id, areaId: r.area_id, panel: r.panel, judgeId: r.judge_id,
    status: r.status, reopenedCount: r.reopened_count ?? 0, scores, comments,
  };
};
export const toOverrideRow = (r: Row): OverrideRow => ({
  eventId: r.event_id, teamId: r.team_id, areaId: r.area_id, value: Number(r.value), reason: r.reason,
});
export const toPenaltyRow = (r: Row): PenaltyRow => ({
  id: r.id, eventId: r.event_id, teamId: r.team_id, points: Number(r.points), reason: r.reason,
});
/** Deliberately ignores `inputs`: the column is not readable through the table, and the type has no place for it. */
export const toSnapshotRow = (r: Row): SnapshotRow => ({
  id: r.id, eventId: r.event_id, createdAt: r.created_at, rulesetId: r.ruleset_id, inputHash: r.input_hash, rows: r.rows, released: !!r.released,
});
export const toConflictRow = (r: Row): ConflictRow => ({ eventId: r.event_id, judgeId: r.judge_id, teamId: r.team_id });
const parseJson = (v: any) => {
  if (!v) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  return typeof v === 'object' ? v : {};
};

export const toInspectionRow = (r: Row): import('../technical').Inspection => ({
  id: r.id,
  eventId: r.event_id,
  teamId: r.team_id,
  car: r.car,
  inspectorId: r.inspector_id,
  status: r.status,
  rulesetId: r.ruleset_id,
  selectedArticles: r.selected_articles ?? null,
  measurements: parseJson(r.measurements),
  notes: parseJson(r.notes),
  startedAt: r.started_at,
  submittedAt: r.submitted_at ?? null,
  updatedAt: r.updated_at,
  revision: r.revision ?? 1,
});

export const toBroadcastRow = (r: any): import('./types').BroadcastEmail => ({
  id: r.id,
  eventId: r.event_id,
  senderId: r.sender_id ?? null,
  senderEmail: r.sender_email ?? null,
  audienceType: r.audience_type,
  panel: r.panel ?? null,
  recipientCount: r.recipient_count ?? 0,
  subject: r.subject,
  category: r.category ?? null,
  body: r.body,
  buttonText: r.button_text ?? null,
  buttonUrl: r.button_url ?? null,
  createdAt: r.created_at,
});

export const toTeamPhotoRow = (r: any): import('./types').TeamPhoto => ({
  id: r.id,
  eventId: r.eventId ?? r.event_id,
  teamId: r.teamId ?? r.team_id,
  revision: r.revision ?? 1,
  version: r.version ?? 1,
  originalName: r.originalName ?? r.original_name,
  originalMime: r.originalMime ?? r.original_mime,
  originalSize: r.originalSize ?? r.original_size,
  originalWidth: r.originalWidth ?? r.original_width ?? null,
  originalHeight: r.originalHeight ?? r.original_height ?? null,
  originalPath: r.originalPath ?? r.original_path,
  processedPath: r.processedPath ?? r.processed_path ?? null,
  processedSize: r.processedSize ?? r.processed_size ?? null,
  processedWidth: r.processedWidth ?? r.processed_width ?? null,
  processedHeight: r.processedHeight ?? r.processed_height ?? null,
  approvedPath: r.approvedPath ?? r.approved_path ?? null,
  approvedSize: r.approvedSize ?? r.approved_size ?? null,
  approvedWidth: r.approvedWidth ?? r.approved_width ?? null,
  approvedHeight: r.approvedHeight ?? r.approved_height ?? null,
  processingStatus: r.processingStatus ?? r.processing_status ?? 'pending',
  approvalStatus: r.approvalStatus ?? r.approval_status ?? 'pending',
  processingError: r.processingError ?? r.processing_error ?? null,
  retryCount: r.retryCount ?? r.retry_count ?? 0,
  mediaConsent: r.mediaConsent ?? r.media_consent ?? true,
  uploadedAt: r.uploadedAt ?? r.uploaded_at,
  processedAt: r.processedAt ?? r.processed_at ?? null,
  approvedAt: r.approvedAt ?? r.approved_at ?? null,
  approvedBy: r.approvedBy ?? r.approved_by ?? null,
  correctionNotes: r.correctionNotes ?? r.correction_notes ?? null,
  hasOriginal: r.hasOriginal ?? true,
  hasProcessed: r.hasProcessed ?? !!(r.processedPath || r.processed_path),
  hasApproved: r.hasApproved ?? !!(r.approvedPath || r.approved_path),
});

export const toTeamPhotoHistoryRow = (r: any): import('./types').TeamPhotoHistoryItem => ({
  id: r.id,
  eventId: r.eventId ?? r.event_id,
  teamId: r.teamId ?? r.team_id,
  version: r.version,
  approvedPath: r.approvedPath ?? r.approved_path,
  approvedSize: r.approvedSize ?? r.approved_size,
  approvedWidth: r.approvedWidth ?? r.approved_width ?? null,
  approvedHeight: r.approvedHeight ?? r.approved_height ?? null,
  approvedAt: r.approvedAt ?? r.approved_at,
  approvedBy: r.approvedBy ?? r.approved_by ?? null,
  correctionNotes: r.correctionNotes ?? r.correction_notes ?? null,
});


