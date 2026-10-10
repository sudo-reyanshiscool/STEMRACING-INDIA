import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { INDIA_2026 } from '../rulesets';
import {
  firstRow, mapAuthError, mapPgError, toCardRow, toEventRow, toInviteRow, toOverrideRow, toPenaltyRow, toRoleRow, toSnapshotRow,
  toTeamRow,
} from './mappers';
import type { Api, Session } from './types';
import { ApiError } from './types';

type Failure = { message: string; code?: string } | null;

function ok<T>(res: { data: T | null; error: Failure }): T {
  if (res.error) throw mapPgError(res.error);
  return res.data as T;
}

/** For `.single()` results: an error maps, and an empty result is a server fault, not a value. */
function one<T>(res: { data: T; error: Failure }): NonNullable<T> {
  if (res.error) throw mapPgError(res.error);
  if (res.data === null || res.data === undefined) throw new ApiError('unknown', 'The server returned no row');
  return res.data as NonNullable<T>;
}

/** supabase-js throws on network failure from some calls and returns it as an error from others. */
async function guard<T>(run: () => PromiseLike<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw mapPgError({ message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
}

// Explicit column lists, never `*`: ranking_snapshots.inputs is not readable through the table, so `select *` fails there,
// and a list keeps every other query independent of columns the app does not use.
const EVENT_COLS = 'id,name,starts_on,ruleset,results_released';
const TEAM_COLS = 'id,event_id,number,name,school';
const ROLE_COLS = 'id,event_id,user_id,role,panel,team_id,email';
const INVITE_COLS = 'id,event_id,email,role,panel,team_id';
const CARD_COLS = 'id,event_id,team_id,area_id,panel,judge_id,status,reopened_count,scorecard_scores(criterion_id,score,comment)';
const OVERRIDE_COLS = 'event_id,team_id,area_id,value,reason';
const PENALTY_COLS = 'id,event_id,team_id,points,reason';
const SNAPSHOT_COLS = 'id,event_id,created_at,ruleset_id,input_hash,rows,released';

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const FORBIDDEN = 'You do not have permission to do that';

export function createSupabaseApi(url: string, anonKey: string): Api {
  return createApiFromClient(createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
}

/** The adapter over an existing client. Split from createSupabaseApi so tests can drive it with a scripted client. */
export function createApiFromClient(sb: SupabaseClient): Api {
  const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
    u ? { userId: u.id, email: (u.email ?? '').toLowerCase() } : null;
  // Closures, not `this`: the returned object can be destructured safely.
  const session = async () => toSession((await guard(() => sb.auth.getSession())).data.session?.user);

  const updateScore = async (cardId: string, criterionId: string, patch: { score: number; comment?: string }) =>
    ok(await guard(() => sb.from('scorecard_scores').update(patch).eq('scorecard_id', cardId).eq('criterion_id', criterionId).select('criterion_id'))) as unknown[];

  const findCard = async (eventId: string, teamId: string, areaId: string, judgeId: string) =>
    ok(await guard(() => sb.from('scorecards').select(CARD_COLS).eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).eq('judge_id', judgeId).maybeSingle()));

  /** Delete by id. Row-level security hides rows silently, so no row deleted means missing or not permitted. */
  const removeById = async (table: string, id: string) => {
    const rows = ok(await guard(() => sb.from(table).delete().eq('id', id).select('id'))) as unknown[];
    if (rows.length === 0) throw new ApiError('forbidden', `${FORBIDDEN}, or it no longer exists`);
  };

  const writeScore = async (cardId: string, criterionId: string, score: number, comment?: string) => {
    // The comment column is left out of the write unless a string was passed, so an existing comment survives.
    // Update then insert rather than upsert: the API role may only UPDATE (score, comment), and an upsert's
    // ON CONFLICT DO UPDATE also names the key columns.
    const patch = comment === undefined ? { score } : { score, comment };
    if ((await updateScore(cardId, criterionId, patch)).length > 0) return;
    const { error } = await guard(() => sb.from('scorecard_scores').insert({ scorecard_id: cardId, criterion_id: criterionId, ...patch }));
    if (!error) return;
    if (error.code !== '23505') throw mapPgError(error);
    // Another write created the row between our update and insert: update it now.
    if ((await updateScore(cardId, criterionId, patch)).length === 0) throw new ApiError('forbidden', 'You cannot score on this scorecard');
  };

  return {
    async getSession() {
      return session();
    },
    async signIn(email) {
      const e = email.trim().toLowerCase();
      if (!EMAIL.test(e)) throw new ApiError('invalid', 'Enter a valid email address');
      const redirect = typeof window === 'undefined' ? undefined : window.location.origin + window.location.pathname;
      const { error } = await guard(() => sb.auth.signInWithOtp({ email: e, options: { emailRedirectTo: redirect } }));
      if (error) throw mapAuthError(error);
    },
    async signOut() {
      const { error } = await guard(() => sb.auth.signOut());
      if (error) throw mapAuthError(error);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, s) => {
        // supabase-js holds an internal lock while this callback runs; a listener that calls back into the client
        // synchronously can deadlock. Hand over on the next tick.
        const next = toSession(s?.user);
        setTimeout(() => cb(next), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async claimInvitations() {
      if (!(await session())) return 0;
      return Number(ok(await guard(() => sb.rpc('claim_invitations'))) ?? 0);
    },

    async listEvents() {
      return (ok(await guard(() => sb.from('events').select(EVENT_COLS).order('created_at', { ascending: false }))) as never[]).map(toEventRow);
    },
    async createEvent(i) {
      const data = ok(await guard(() => sb.rpc('create_event', { p_name: i.name, p_starts_on: i.startsOn ?? null, p_ruleset: INDIA_2026 })));
      return toEventRow(firstRow(data));
    },
    async getEvent(id) {
      const row = ok(await guard(() => sb.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()));
      return row ? toEventRow(row) : null;
    },
    async setReleased(eventId, released) {
      const rows = ok(await guard(() => sb.from('events').update({ results_released: released }).eq('id', eventId).select('id'))) as unknown[];
      if (rows.length === 0) throw new ApiError('forbidden', FORBIDDEN);
    },

    async myRoles(eventId) {
      const s = await session();
      if (!s) return [];
      return (ok(await guard(() => sb.from('event_roles').select(ROLE_COLS).eq('event_id', eventId).eq('user_id', s.userId))) as never[]).map(toRoleRow);
    },
    async listRoles(eventId) {
      if (!(await session())) return [];
      return (ok(await guard(() => sb.from('event_roles').select(ROLE_COLS).eq('event_id', eventId))) as never[]).map(toRoleRow);
    },
    async listInvitations(eventId) {
      if (!(await session())) return [];
      return (ok(await guard(() => sb.from('invitations').select(INVITE_COLS).eq('event_id', eventId))) as never[]).map(toInviteRow);
    },
    async invite(eventId, i) {
      ok(await guard(() => sb.from('invitations').insert({
        event_id: eventId, email: i.email.trim().toLowerCase(), role: i.role, panel: i.panel ?? null, team_id: i.teamId ?? null,
      })));
    },
    async removeRole(roleId) {
      await removeById('event_roles', roleId);
    },
    async removeInvitation(inviteId) {
      await removeById('invitations', inviteId);
    },

    async listTeams(eventId) {
      return (ok(await guard(() => sb.from('teams').select(TEAM_COLS).eq('event_id', eventId))) as never[]).map(toTeamRow)
        .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    },
    async createTeam(eventId, i) {
      const row = one(await guard(() => sb.from('teams')
        .insert({ event_id: eventId, number: i.number.trim(), name: i.name.trim(), school: (i.school ?? '').trim() })
        .select(TEAM_COLS).single()));
      return toTeamRow(row);
    },

    async declareConflict(eventId, teamId) {
      // judge_id defaults to auth.uid(). The table has no UPDATE grant, so insert and treat "already declared" as done.
      const { error } = await guard(() => sb.from('judge_conflicts').insert({ event_id: eventId, team_id: teamId }));
      if (error && error.code !== '23505') throw mapPgError(error);
    },
    async myConflicts(eventId) {
      const s = await session();
      if (!s) return [];
      return (ok(await guard(() => sb.from('judge_conflicts').select('team_id').eq('event_id', eventId).eq('judge_id', s.userId))) as { team_id: string }[])
        .map((r) => r.team_id);
    },

    async openCard(eventId, teamId, areaId) {
      const s = await session();
      if (!s) throw new ApiError('unauthenticated', 'Sign in first');
      const existing = await findCard(eventId, teamId, areaId, s.userId);
      if (existing) return toCardRow(existing);
      // panel and judge_id are filled by the database from the ruleset and the session.
      const { error } = await guard(() => sb.from('scorecards').insert({ event_id: eventId, team_id: teamId, area_id: areaId }));
      if (error && error.code !== '23505') throw mapPgError(error);
      const created = await findCard(eventId, teamId, areaId, s.userId);
      if (!created) throw new ApiError('forbidden', 'You cannot score this team in this area');
      return toCardRow(created);
    },
    async saveScore(cardId, criterionId, score, comment) {
      try {
        await writeScore(cardId, criterionId, score, comment);
      } catch (e) {
        // Row-level security hides rows from a signed-out client, which looks like a refusal. It is not one: say so,
        // so a queue never discards a judge's scores because their session lapsed.
        if (e instanceof ApiError && e.code === 'forbidden') {
          // If the re-check itself fails, that error (network/unknown: retried) replaces the forbidden, which would be dropped.
          const s = await session();
          if (s === null) throw new ApiError('unauthenticated', 'Your session has expired. Sign in again.');
        }
        throw e;
      }
    },
    async submitCard(cardId) {
      const rows = ok(await guard(() => sb.from('scorecards').update({ status: 'submitted' }).eq('id', cardId).select('id'))) as unknown[];
      if (rows.length > 0) return;
      // Nothing was updatable. Tell "yours, but already submitted" apart from "not yours or not visible".
      const s = await session();
      const card = ok(await guard(() => sb.from('scorecards').select('id,status,judge_id').eq('id', cardId).maybeSingle())) as { status: string; judge_id: string } | null;
      if (card && s && card.judge_id === s.userId && card.status === 'submitted') {
        throw new ApiError('locked', 'This scorecard has already been submitted');
      }
      throw new ApiError('forbidden', 'You cannot submit this scorecard');
    },
    async reopenCard(cardId, reason) {
      ok(await guard(() => sb.rpc('reopen_scorecard', { p_card: cardId, p_reason: reason })));
    },
    async listCards(eventId) {
      if (!(await session())) return [];
      return (ok(await guard(() => sb.from('scorecards').select(CARD_COLS).eq('event_id', eventId))) as never[]).map(toCardRow);
    },

    async listOverrides(eventId) {
      if (!(await session())) return [];
      return (ok(await guard(() => sb.from('score_overrides').select(OVERRIDE_COLS).eq('event_id', eventId))) as never[]).map(toOverrideRow);
    },
    async setOverride(eventId, teamId, areaId, value, reason) {
      // Same shape as saveScore: only (value, reason) are updatable by the API role.
      const why = reason.trim();
      const rows = ok(await guard(() => sb.from('score_overrides').update({ value, reason: why })
        .eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).select('team_id'))) as unknown[];
      if (rows.length > 0) return;
      const { error } = await guard(() => sb.from('score_overrides').insert({ event_id: eventId, team_id: teamId, area_id: areaId, value, reason: why }));
      if (!error) return;
      if (error.code !== '23505') throw mapPgError(error);
      const again = ok(await guard(() => sb.from('score_overrides').update({ value, reason: why })
        .eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).select('team_id'))) as unknown[];
      if (again.length === 0) throw new ApiError('forbidden', FORBIDDEN);
    },
    async listPenalties(eventId) {
      if (!(await session())) return [];
      return (ok(await guard(() => sb.from('penalties').select(PENALTY_COLS).eq('event_id', eventId))) as never[]).map(toPenaltyRow);
    },
    async addPenalty(eventId, teamId, points, reason) {
      ok(await guard(() => sb.from('penalties').insert({ event_id: eventId, team_id: teamId, points, reason: reason.trim() })));
    },
    async publishSnapshot(eventId, s) {
      // `inputs` goes in but is not selectable, so the returning list names the readable columns explicitly.
      const row = one(await guard(() => sb.from('ranking_snapshots').insert({
        event_id: eventId, ruleset_id: s.rulesetId, input_hash: s.inputHash, inputs: s.inputs, rows: s.rows, released: s.released ?? true,
      }).select(SNAPSHOT_COLS).single()));
      return toSnapshotRow(row);
    },
    async latestSnapshot(eventId) {
      const rows = ok(await guard(() => sb.from('ranking_snapshots').select(SNAPSHOT_COLS).eq('event_id', eventId)
        .order('created_at', { ascending: false }).limit(1))) as never[];
      return rows.length > 0 ? toSnapshotRow(rows[0]) : null;
    },
    async getSnapshotInputs(snapshotId) {
      return ok(await guard(() => sb.rpc('snapshot_inputs', { p_snapshot: snapshotId })));
    },
  };
}
