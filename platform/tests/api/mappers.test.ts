import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  firstRow, mapAuthError, mapPgError, PG_ERROR_CODES, toCardRow, toEventRow, toInviteRow, toOverrideRow, toPenaltyRow,
  toRoleRow, toSnapshotRow, toTeamRow,
} from '../../src/api/mappers';

describe('mapPgError', () => {
  it('maps Postgres codes to API error codes', () => {
    expect(mapPgError({ message: 'x', code: '42501' }).code).toBe('forbidden');
    expect(mapPgError({ message: 'x', code: '55000' }).code).toBe('locked');
    expect(mapPgError({ message: 'x', code: '23505' }).code).toBe('duplicate');
    for (const c of ['23514', '22023', '22P02', '23502']) expect(mapPgError({ message: 'x', code: c }).code, c).toBe('invalid');
    expect(mapPgError({ message: 'x', code: 'P0002' }).code).toBe('not-found');
  });

  it('treats a failed fetch as a network error, and keeps the message', () => {
    expect(mapPgError({ message: 'TypeError: Failed to fetch' }).code).toBe('network');
    expect(mapPgError({ message: 'NetworkError when attempting to fetch resource.' }).code).toBe('network');
    expect(mapPgError({ message: 'TypeError: fetch failed' }).code).toBe('network');
    expect(mapPgError({ message: 'something odd' }).code).toBe('unknown');
    expect(mapPgError({ message: 'criterion Team Contribution has no score', code: '23514' }).message).toContain('no score');
  });

  it('maps row level security violations to forbidden', () => {
    expect(mapPgError({ message: 'new row violates row-level security policy for table "scorecards"', code: '42501' }).code).toBe('forbidden');
  });

  it('maps the other states the database and PostgREST can produce', () => {
    // 28000: create_event without a signed-in user. 23503: a team that is not part of the event (composite foreign key).
    for (const c of ['28000', 'PGRST301', 'PGRST303']) expect(mapPgError({ message: 'x', code: c }).code, c).toBe('unauthenticated');
    for (const c of ['23503', '22007', '22008', '22001', '22003']) expect(mapPgError({ message: 'x', code: c }).code, c).toBe('invalid');
    expect(mapPgError({ message: 'x', code: 'PGRST116' }).code).toBe('not-found');
    expect(mapPgError({ message: 'x', code: '' }).code).toBe('unknown');
    expect(mapPgError({ message: 'x', code: '40001' }).code).toBe('conflict');
  });

  it('maps an expired or missing token to unauthenticated, never to forbidden', () => {
    expect(mapPgError({ message: 'JWT expired', code: 'PGRST301' }).code).toBe('unauthenticated');
    expect(mapPgError({ message: 'JWT expired' }).code).toBe('unauthenticated');
    expect(mapPgError({ message: 'Bad request: JWT expired at 123', code: '400' }).code).toBe('unauthenticated');
    expect(mapPgError({ message: 'new row violates row-level security policy', code: '42501' }).code).toBe('forbidden');
  });

  it('knows every errcode the migrations raise', () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const raised = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)) raised.add(m[1]);
    }
    expect([...raised].sort()).toEqual(expect.arrayContaining(['22023', '23514', '42501', '55000', 'P0002']));
    for (const c of raised) expect(PG_ERROR_CODES[c], `errcode ${c} is raised by a migration but not mapped`).toBeDefined();
  });
});

describe('mapAuthError', () => {
  it('maps auth failures', () => {
    expect(mapAuthError({ message: 'Failed to fetch', name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network');
    expect(mapAuthError({ message: 'x', status: 0 }).code).toBe('network');
    expect(mapAuthError({ message: 'Unable to validate email address: invalid format', code: 'email_address_invalid', status: 400 }).code).toBe('invalid');
    expect(mapAuthError({ message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 }).code).toBe('unknown');
    expect(mapAuthError({ message: 'Email rate limit exceeded', status: 429 }).message).toContain('rate limit');
  });
});

describe('row mappers', () => {
  it('maps events and roles to camelCase', () => {
    expect(toEventRow({ id: 'e', name: 'N', starts_on: '2026-11-01', ruleset: { id: 'r' }, results_released: true })).toEqual({
      id: 'e', name: 'N', startsOn: '2026-11-01', ruleset: { id: 'r' }, resultsReleased: true,
    });
    expect(toRoleRow({ id: 'r', event_id: 'e', user_id: 'u', role: 'judge', panel: 'verbal', team_id: null, email: 'a@x.test' })).toEqual({
      id: 'r', eventId: 'e', userId: 'u', role: 'judge', panel: 'verbal', teamId: null, email: 'a@x.test',
    });
  });

  it('maps teams, invitations, overrides and penalties', () => {
    expect(toTeamRow({ id: 't', event_id: 'e', number: '7', name: 'Seven' })).toEqual({ id: 't', eventId: 'e', number: '7', name: 'Seven', school: '' });
    expect(toInviteRow({ id: 'i', event_id: 'e', email: 'a@x.test', role: 'team_manager', panel: null, team_id: 't' })).toEqual({
      id: 'i', eventId: 'e', email: 'a@x.test', role: 'team_manager', panel: null, teamId: 't', emailStatus: 'not_sent', emailSentAt: null, emailFailure: null,
    });
    // numeric(5,1) can arrive as a string from some drivers: always a number out.
    expect(toOverrideRow({ event_id: 'e', team_id: 't', area_id: 'a', value: '12.5', reason: 'why' })).toEqual({
      eventId: 'e', teamId: 't', areaId: 'a', value: 12.5, reason: 'why',
    });
    expect(toPenaltyRow({ id: 'p', event_id: 'e', team_id: 't', points: 2, reason: 'why' })).toEqual({
      id: 'p', eventId: 'e', teamId: 't', points: 2, reason: 'why',
    });
  });

  it('folds nested score rows into scores and comments', () => {
    const card = toCardRow({
      id: 'c', event_id: 'e', team_id: 't', area_id: 'verbal-technique', panel: 'verbal', judge_id: 'j', status: 'draft', reopened_count: 2,
      scorecard_scores: [{ criterion_id: 'team-contribution', score: 12, comment: 'Clear roles' }, { criterion_id: 'engagement-presentation-dynamics', score: 14, comment: '' }],
    });
    expect(card.scores).toEqual({ 'team-contribution': 12, 'engagement-presentation-dynamics': 14 });
    expect(card.comments['team-contribution']).toBe('Clear roles');
    expect(card.reopenedCount).toBe(2);
    expect(toCardRow({ id: 'c', event_id: 'e', team_id: 't', area_id: 'a', panel: 'verbal', judge_id: 'j', status: 'draft', reopened_count: 0 }).scores).toEqual({});
  });

  it('maps snapshots, and never carries inputs', () => {
    const row = toSnapshotRow({ id: 's', event_id: 'e', created_at: '2026-11-01T00:00:00Z', ruleset_id: 'r', input_hash: 'h', rows: [], released: true, inputs: { secret: 1 } });
    expect(row).toEqual({
      id: 's', eventId: 'e', createdAt: '2026-11-01T00:00:00Z', rulesetId: 'r', inputHash: 'h', rows: [], released: true,
    });
    expect('inputs' in row).toBe(false);
  });

  it('takes the first element when a function result arrives as an array', () => {
    expect(firstRow({ id: 'a' })).toEqual({ id: 'a' });
    expect(firstRow([{ id: 'a' }, { id: 'b' }])).toEqual({ id: 'a' });
    expect(() => firstRow([])).toThrow();
    expect(() => firstRow(null)).toThrow();
    expect(toEventRow(firstRow([{ id: 'e', name: 'N', starts_on: null, ruleset: { id: 'r' }, results_released: false }])).id).toBe('e');
  });
});
