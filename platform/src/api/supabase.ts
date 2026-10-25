import type { RaceHeat, RaceLane, TimingPair, TimingState } from '../racing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { INDIA_2026 } from '../rulesets';
import {
  firstRow, mapAuthError, mapPgError, toBroadcastRow, toCardRow, toConflictRow, toEventRow, toInspectionRow, toInviteRow, toOverrideRow, toPenaltyRow, toRoleRow, toSnapshotRow,
  toTeamRow,
} from './mappers';
import type { ResultMailState, ResultsPacket } from './result-mail';
import type { Api, MfaEnrollResult, MfaFactor, MfaStatus, PlatformAccess, Session } from './types';
import { ApiError } from './types';
import { blankReview } from './review';

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
const CARD_COLS = 'id,event_id,team_id,area_id,panel,judge_id,status,reopened_count,scorecard_scores(criterion_id,score,comment)';
const OVERRIDE_COLS = 'event_id,team_id,area_id,value,reason';
const PENALTY_COLS = 'id,event_id,team_id,points,reason';
const SNAPSHOT_COLS = 'id,event_id,created_at,ruleset_id,input_hash,rows,released';
const INSPECTION_COLS = 'id,event_id,team_id,car,inspector_id,status,ruleset_id,selected_articles,measurements,notes,started_at,submitted_at,updated_at,revision';

/** PostgREST caps every response at `max_rows` (1000 by default) and says nothing when it cuts a list off. */
export const PAGE_SIZE = 1000;

/** What a Postgres uuid looks like in text. Used only to answer "no such event" without asking the server. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMAIL = /^[^@\s]+@[^@\s]+$/;
/** Fixed text for the server's refusal to release a ranking that no longer matches what is counted. */
export const OUT_OF_DATE = 'The published ranking is out of date. Publish it again before releasing.';
const FORBIDDEN = 'You do not have permission to do that';

/** `client` lets tests pass an already signed-in client; the app passes none and gets a persistent-session client. */
export function createSupabaseApi(url: string, anonKey: string, client?: SupabaseClient<any, any, any>, options?: SupabaseApiOptions): Api {
  return createApiFromClient(client ?? createClient(url, anonKey, { db: { schema: options?.schema ?? 'public' }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } }), options);
}

export interface SupabaseApiOptions {
  /** A dedicated schema lets STEM Racing share a Supabase project safely with another app. */
  schema?: string;
  /** Rows per request. Must not exceed the server's max_rows, or a short page is mistaken for the last one. */
  pageSize?: number;
}

/** The adapter over an existing client. Split from createSupabaseApi so tests can drive it with a scripted client. */
export function createApiFromClient(sb: SupabaseClient<any, any, any>, options: SupabaseApiOptions = {}): Api {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
    u ? { userId: u.id, email: (u.email ?? '').toLowerCase() } : null;
  // Closures, not `this`: the returned object can be destructured safely.
  const session = async () => toSession((await guard(() => sb.auth.getSession())).data.session?.user);

  const updateScore = async (cardId: string, criterionId: string, patch: { score: number; comment?: string }) =>
    ok(await guard(() => sb.from('scorecard_scores').update(patch).eq('scorecard_id', cardId).eq('criterion_id', criterionId).select('criterion_id'))) as unknown[];

  const findCard = async (eventId: string, teamId: string, areaId: string, judgeId: string) =>
    ok(await guard(() => sb.from('scorecards').select(CARD_COLS).eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).eq('judge_id', judgeId).maybeSingle()));

  /**
   * Every row of a list, page by page, until a short page. `build` must carry a total order (a unique key last), or
   * rows could repeat or be skipped between pages. RLS applies to each page as to any request.
   */
  const pages = async <T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: Failure }>): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const rows = ok(await guard(() => build(from, from + pageSize - 1))) as T[];
      out.push(...rows);
      if (rows.length < pageSize) return out;
    }
  };

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

  const sendInvitation = async (invitationId: string) => {
    try {
      const {data,error}=await sb.functions.invoke('send-invitation',{body:{invitationId}});
      if(error){
        const status=(error as {context?:{status?:number}}).context?.status;
        if(status===401)throw new ApiError('unauthenticated','Sign in again');
        if(status===403)throw new ApiError('forbidden','Cannot send this invitation');
        if(status===429)throw new ApiError('rate-limited','Email rate limit');
        throw new ApiError('email-delivery','Invitation saved; delivery unconfirmed');
      }
      if(data?.status!=='sent')throw new ApiError('email-delivery','Delivery unconfirmed');
    } catch(error){if(error instanceof ApiError)throw error;throw new ApiError('email-delivery','Invitation saved; email request failed');}
  };
  const raceRow = (r: any): RaceHeat => {
    const lane = (n: number): RaceLane => ({ teamId: r[`lane${n}_team`], car: r[`lane${n}_car`], status: r[`lane${n}_status`], totalMs: r[`lane${n}_total_ms`], reactionMs: r[`lane${n}_reaction_ms`] });
    return { ...(r.parent_heat?{parentHeat:r.parent_heat,followupKind:r.followup_kind}:{}), bracket: r.bracket_round == null ? null : {round:r.bracket_round,slot:r.bracket_slot}, id: r.id, eventId: r.event_id, number: r.heat_number, label: r.label, phase: r.phase, lane1: lane(1), lane2: lane(2), note: r.note, source: r.source, sourceRunId: r.source_run_id, revision: r.revision, updatedAt: r.updated_at };
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
    async verifyEmailCode(email, code) {
      const e = email.trim().toLowerCase();
      const token = code.replace(/\s/g, '');
      if (!EMAIL.test(e) || !/^\d{6,10}$/.test(token)) throw new ApiError('invalid', 'Enter your email and verification code');
      const { data, error } = await guard(() => sb.auth.verifyOtp({ email: e, token, type: 'email' }));
      if (error) throw mapAuthError(error);
      if (!data.session) throw new ApiError('invalid-auth', 'Verification did not establish a session');
    },
    async verifyEmailLink(tokenHash) {
      if (!/^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash)) throw new ApiError('invalid-auth', 'Invalid email link');
      const { data, error } = await guard(() => sb.auth.verifyOtp({ token_hash: tokenHash, type: 'email' }));
      if (error) throw mapAuthError(error);
      if (!data.session) throw new ApiError('invalid-auth', 'Verification did not establish a session');
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
    async getMfaStatus(): Promise<MfaStatus> {
      const sess = await session();
      if (!sess) return { enabled: false, factors: [], currentLevel: null, nextLevel: null };
      const [levelRes, factorsRes] = await Promise.all([
        guard(() => sb.auth.mfa.getAuthenticatorAssuranceLevel()),
        guard(() => sb.auth.mfa.listFactors()),
      ]);
      const factors: MfaFactor[] = (factorsRes.data?.all ?? [])
        .filter((f) => f.factor_type === 'totp')
        .map((f) => ({
          id: f.id,
          factorType: 'totp' as const,
          status: f.status as 'verified' | 'unverified',
          friendlyName: f.friendly_name,
          createdAt: f.created_at,
        }));
      const verifiedFactors = factors.filter((f) => f.status === 'verified');
      return {
        enabled: verifiedFactors.length > 0,
        factors,
        currentLevel: (levelRes.data?.currentLevel ?? null) as 'aal1' | 'aal2' | null,
        nextLevel: (levelRes.data?.nextLevel ?? null) as 'aal1' | 'aal2' | null,
      };
    },
    async enrollTotp(friendlyName?: string): Promise<MfaEnrollResult> {
      const sess = await session();
      if (!sess) throw new ApiError('unauthenticated', 'Sign in first');

      const factorsRes = await guard(() => sb.auth.mfa.listFactors());
      const unverified = (factorsRes.data?.all ?? []).filter((f) => f.factor_type === 'totp' && f.status === 'unverified');
      for (const f of unverified) {
        await guard(() => sb.auth.mfa.unenroll({ factorId: f.id })).catch(() => {});
      }

      const { data, error } = await guard(() =>
        sb.auth.mfa.enroll({
          factorType: 'totp',
          issuer: 'STEM Racing India',
          friendlyName: friendlyName?.trim() || 'Authenticator App',
        })
      );
      if (error) throw mapAuthError(error);
      if (!data || data.type !== 'totp') throw new ApiError('unknown', 'Failed to enroll authenticator');

      return {
        id: data.id,
        factorType: 'totp',
        totp: {
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
          uri: data.totp.uri,
        },
      };
    },
    async verifyTotp(factorId: string, code: string): Promise<void> {
      const token = code.replace(/\s/g, '');
      if (!/^\d{6}$/.test(token)) {
        throw new ApiError('invalid', 'Enter a 6-digit verification code');
      }
      let targetFactorId = factorId;
      if (!targetFactorId) {
        const factorsRes = await guard(() => sb.auth.mfa.listFactors());
        const verified = (factorsRes.data?.all ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
        if (!verified) throw new ApiError('not-found', 'No verified authenticator app found');
        targetFactorId = verified.id;
      }
      const { error } = await guard(() => sb.auth.mfa.challengeAndVerify({ factorId: targetFactorId, code: token }));
      if (error) {
        if (error.code === 'invalid_grant' || /invalid/i.test(error.message)) {
          throw new ApiError('invalid-auth', 'Invalid authenticator code. Check your app and try again.');
        }
        throw mapAuthError(error);
      }
    },
    async unenrollTotp(factorId: string): Promise<void> {
      const { error } = await guard(() => sb.auth.mfa.unenroll({ factorId }));
      if (error) throw mapAuthError(error);
    },
    async claimInvitations() {
      if (!(await session())) return 0;
      return Number(ok(await guard(() => sb.rpc('claim_invitations'))) ?? 0);
    },

    async listEvents() {
      return (await pages<never>((a, b) => sb.from('events').select(EVENT_COLS).order('created_at', { ascending: false }).order('id').range(a, b))).map(toEventRow);
    },
    async canCreateEvent() {
      if (!(await session())) return false;
      const res = await guard(() => sb.rpc('can_create_event'));
      if (res.error) return false;
      return Boolean(res.data);
    },
    async platformAccess() {
      if (!(await session())) return {kind:null,ownerEmail:'',canManage:false,organisers:[],invitations:[]};
      return ok(await guard(() => sb.rpc('platform_access'))) as PlatformAccess;
    },
    async inviteOrganiser(email, scope) {
      const id = ok(await guard(() => sb.rpc('invite_organiser', {p_email: email.trim().toLowerCase(), p_scope: scope}))) as string;
      await sendInvitation(id);
    },
    async removeOrganiser(userId) { ok(await guard(() => sb.rpc('remove_organiser', {p_user: userId}))); },
    async withdrawOrganiserInvitation(id) { ok(await guard(() => sb.rpc('withdraw_organiser_invitation', {p_invitation: id}))); },
    async createEvent(i) {
      const data = ok(await guard(() => sb.rpc('create_event', { p_name: i.name, p_starts_on: i.startsOn ?? null, p_ruleset: INDIA_2026 })));
      return toEventRow(firstRow(data));
    },
    async deleteEvent(eventId, confirmation) {
      ok(await guard(() => sb.rpc('delete_event', { p_event: eventId, p_confirmation: confirmation })));
    },
    async listDeletedEvents() {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.rpc('list_deleted_events').order('created_at', { ascending: false }).order('id').range(a, b))).map(toEventRow);
    },
    async restoreEvent(eventId) {
      ok(await guard(() => sb.rpc('restore_event', { p_event: eventId })));
    },
    async getEvent(id) {
      // A hand-typed or stale link can carry anything; Postgres would answer 22P02 for a non-UUID. Not a UUID, not found.
      if (!UUID.test(id)) return null;
      const row = ok(await guard(() => sb.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()));
      return row ? toEventRow(row) : null;
    },
    async setReleased(eventId, released) {
      // The database decides: release_results() checks the latest snapshot against what is counted, and the Chair's
      // direct update of results_released is not granted at all.
      try {
        if (released) ok(await guard(() => sb.rpc('release_results', { p_event: eventId })));
        else ok(await guard(() => sb.rpc('withdraw_results', { p_event: eventId })));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'locked' && /out of date/i.test(e.message)) throw new ApiError('locked', OUT_OF_DATE);
        throw e;
      }
    },

    async myRoles(eventId) {
      const s = await session();
      if (!s) return [];
      return (await pages<never>((a, b) => sb.rpc('effective_event_roles', {p_event: eventId}).order('id').range(a, b))).map(toRoleRow);
    },
    async listRoles(eventId) {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.rpc('list_event_people',{p_event:eventId}).order('id').range(a, b))).map(toRoleRow);
    },
    async listInvitations(eventId) {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.rpc('list_event_invitations',{p_event:eventId}).order('id').range(a, b))).map(toInviteRow);
    },
    async invite(eventId, i) {
      const row=firstRow(one(await guard(() => sb.from('invitations').insert({
        event_id: eventId, display_name: (i.name ?? '').trim(), email: i.email.trim().toLowerCase(), role: i.role, panel: i.panel ?? null, team_id: i.teamId ?? null,
      }).select('id').single())));
      await sendInvitation(row.id);
    },
    async listJudgeExemptions(eventId) {
      if (!(await session())) return [];
      const rows=await pages<any>((a,b)=>sb.from('judge_exemptions').select('event_id,judge_id,team_id,reason').eq('event_id',eventId).order('judge_id').order('team_id').range(a,b));
      return rows.map(r=>({eventId:r.event_id,judgeId:r.judge_id,teamId:r.team_id,reason:r.reason}));
    },
    async setJudgeExemption(eventId,userId,teamId,exempt,reason='') {
      ok(await guard(()=>sb.rpc('set_judge_exemption',{p_event:eventId,p_user:userId,p_team:teamId,p_exempt:exempt,p_reason:reason})));
    },
    async setJudgeAssignment(eventId, userId, panel, teamIds) {
      ok(await guard(() => sb.rpc('set_judge_assignment', {p_event:eventId,p_user:userId,p_panel:panel,p_teams:teamIds})));
    },
    async setJudgeName(eventId, userId, name) {
      ok(await guard(() => sb.rpc('set_judge_name', {p_event:eventId,p_user:userId,p_name:name})));
    },
    async removeRole(roleId) {
      await removeById('event_roles', roleId);
    },
    sendInvitation,
    async removeInvitation(inviteId) {
      await removeById('invitations', inviteId);
    },

    async queueReactionRaces(eventId) { ok(await guard(() => sb.rpc('queue_reaction_races',{p_event:eventId}))); },
    async getRacingSetup(eventId) { return ok(await guard(() => sb.rpc('racing_state',{p_event:eventId}))); },
    async saveRacingSetup(eventId, revision, input) { return ok(await guard(() => sb.rpc('save_racing_setup',{p_event:eventId,p_revision:revision,p_input:input}))); },
    async listRaces(eventId) {
      if (!(await session())) return [];
      return (await pages<any>((a,b) => sb.from('race_heats').select('*').eq('event_id',eventId).order('heat_number').order('id').range(a,b))).map(raceRow);
    },
    async queueRaceFollowup(eventId,id,revision,mode) {return raceRow(firstRow(ok(await guard(()=>sb.rpc('queue_race_followup',{p_event:eventId,p_id:id,p_revision:revision,p_mode:mode})))));},
    async saveRace(eventId, id, revision, input) { return raceRow(firstRow(ok(await guard(() => sb.rpc('save_race', {p_event:eventId,p_id:id,p_revision:revision,p_input:input}))))); },
    async getTiming(eventId) { return ok(await guard(() => sb.rpc('race_timing_state',{p_event:eventId}))) as TimingState | null; },
    async pairTiming(eventId) { return ok(await guard(() => sb.rpc('pair_race_timing',{p_event:eventId}))) as TimingPair; },
    async listTeamFiles(eventId) {return await pages<any>((a,b)=>sb.rpc('list_team_files',{p_event:eventId}).order('id').range(a,b));},
    async uploadTeamFile(eventId,teamId,revision,input) {ok(await guard(()=>sb.rpc('upload_team_file',{p_event:eventId,p_team:teamId,p_revision:revision,p_input:input})));},
    async downloadTeamFile(eventId,id) {return ok(await guard(()=>sb.rpc('download_team_file',{p_event:eventId,p_id:id})));},
    async getInspectionScope(eventId) {return ok(await guard(()=>sb.rpc('inspection_scope',{p_event:eventId})));},
    async saveInspectionScope(eventId, revision, articles) {return ok(await guard(()=>sb.rpc('save_inspection_scope',{p_event:eventId,p_revision:revision,p_articles:articles})));},
    async listTeamConcerns(eventId) {
      return await pages<any>((a, b) => sb.rpc('list_team_concerns', {p_event: eventId}).order('createdAt', {ascending: false}).order('id').range(a,b));
    },
    async submitTeamConcern(eventId, teamId, panel, message) {
      ok(await guard(() => sb.rpc('submit_team_concern', {p_event:eventId,p_team:teamId,p_panel:panel,p_message:message})));
    },
    async resolveTeamConcern(eventId, id, response) {
      ok(await guard(() => sb.rpc('resolve_team_concern', {p_event:eventId,p_id:id,p_response:response})));
    },
    async listTeams(eventId) {
      return (await pages<never>((a, b) => sb.from('teams').select(TEAM_COLS).eq('event_id', eventId).order('id').range(a, b))).map(toTeamRow)
        .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    },
    async drawLotsState(eventId){
      const s=ok(await guard(()=>sb.rpc('draw_lots_state',{p_event:eventId}))) as any;
      return {...s,teams:s.teams.map(toTeamRow),roles:s.roles.map(toRoleRow),conflicts:s.conflicts.map(toConflictRow),exemptions:s.exemptions.map((x:any)=>({eventId:x.event_id,judgeId:x.judge_id,teamId:x.team_id,reason:x.reason}))};
    },
    async applyTeamNumberDraw(eventId,version,assignments){ok(await guard(()=>sb.rpc('apply_team_number_draw',{p_event:eventId,p_version:version,p_assignments:assignments})));},
    async applyJudgeDraw(eventId,version,panel,assignments){ok(await guard(()=>sb.rpc('apply_judge_draw',{p_event:eventId,p_version:version,p_panel:panel,p_assignments:assignments})));},
    async createTeam(eventId, i) {
      const rows = ok(await guard(() => sb.rpc('import_teams', {p_event:eventId,p_teams:[i]}))) as Record<string,any>[];
      return toTeamRow(firstRow(rows));
    },
    async listTeamContacts(eventId) {
      return (await pages<any>((a,b)=>sb.from('team_contacts').select('team_id,manager_email').eq('event_id',eventId).order('team_id').range(a,b))).map(r=>({teamId:r.team_id,managerEmail:r.manager_email}));
    },
    async setTeamContact(eventId,teamId,email) {ok(await guard(()=>sb.rpc('set_team_contact',{p_event:eventId,p_team:teamId,p_email:email})));},
    async resultMailState(eventId) {return ok(await guard(()=>sb.rpc('result_mail_state',{p_event:eventId}))) as ResultMailState;},
    async saveAward(eventId,title,teamId) {ok(await guard(()=>sb.rpc('save_event_award',{p_event:eventId,p_title:title,p_team:teamId})));},
    async removeAward(id) {ok(await guard(()=>sb.rpc('remove_event_award',{p_award:id})));},
    async confirmAwards(eventId) {ok(await guard(()=>sb.rpc('confirm_event_awards',{p_event:eventId})));},
    async previewResultsPacket(eventId,teamId) {return ok(await guard(()=>sb.rpc('team_results_packet',{p_event:eventId,p_team:teamId}))) as ResultsPacket;},
    async sendTeamResults(eventId,teamId,selection) {
      const {data,error}=await guard(()=>sb.functions.invoke('send-results',{body:{eventId,teamId,...selection}}));
      if(error) {
        const status=(error as {context?:{status?:number}}).context?.status;
        if(status===401)throw new ApiError('unauthenticated','Sign in again');
        if(status===403)throw new ApiError('forbidden','Event staff access required');
        if(status===409)throw new ApiError('locked','Results or delivery status changed; review the recipient list again');
        throw new ApiError('email-delivery','The results email could not be confirmed. Check its delivery status before retrying.');
      }
      if(data?.status!=='sent' && data?.status!=='already_sent')throw new ApiError('email-delivery','Results delivery is not confirmed');
      return data.status;
    },
    async acknowledgeResultRetry(eventId,teamId,selection) {ok(await guard(()=>sb.rpc('acknowledge_result_email_retry',{p_event:eventId,p_team:teamId,p_snapshot:selection.snapshotId,p_awards_version:selection.awardsVersion,p_email:selection.email})));},
    async deleteTeam(eventId, teamId, confirmation) {
      ok(await guard(() => sb.rpc('delete_team', { p_event: eventId, p_team: teamId, p_confirmation: confirmation })));
    },
    async importTeams(eventId, teams) {
      const rows = ok(await guard(() => sb.rpc('import_teams', { p_event: eventId, p_teams: teams })));
      return (rows as Record<string, any>[]).map(toTeamRow);
    },

    async declareConflict(eventId, teamId) {
      // judge_id defaults to auth.uid(). The table has no UPDATE grant, so insert and treat "already declared" as done.
      const { error } = await guard(() => sb.from('judge_conflicts').insert({ event_id: eventId, team_id: teamId }));
      if (error && error.code !== '23505') throw mapPgError(error);
    },
    async myConflicts(eventId) {
      const s = await session();
      if (!s) return [];
      return (await pages<{ team_id: string }>((a, b) => sb.from('judge_conflicts').select('team_id').eq('event_id', eventId).eq('judge_id', s.userId).order('team_id').range(a, b)))
        .map((r) => r.team_id);
    },

    async listConflicts(eventId) {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.from('judge_conflicts').select('event_id,judge_id,team_id').eq('event_id', eventId)
        .order('judge_id').order('team_id').range(a, b))).map(toConflictRow);
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
    async getReview(cardId) {
      const [feedback, notes] = await Promise.all([
        guard(() => sb.from('scorecard_feedback').select('overall,strengths,improvements').eq('scorecard_id', cardId).maybeSingle()),
        guard(() => sb.from('scorecard_private_reviews').select('criterion_notes,internal_notes,nominations').eq('scorecard_id', cardId).maybeSingle()),
      ]);
      const f = ok(feedback);
      const n = ok(notes);
      return { ...blankReview(), ...(f ?? {}), criterionNotes: n?.criterion_notes ?? {}, internalNotes: n?.internal_notes ?? '', nominations: n?.nominations ?? [] };
    },
    async saveReview(cardId, review) {
      ok(await guard(() => sb.rpc('save_card_review', { p_card: cardId, p_review: review })));
    },
    async listFeedback(eventId) {
      const rows = await pages<Record<string, any>>((a, b) => sb.from('scorecard_feedback')
        .select('scorecard_id,overall,strengths,improvements,scorecards!inner(event_id)').eq('scorecards.event_id', eventId).order('scorecard_id').range(a, b));
      return rows.map((r) => ({ cardId: r.scorecard_id, overall: r.overall, strengths: r.strengths, improvements: r.improvements }));
    },
    async listNominations(eventId) {
      const s = await session();
      if (!s) return [];
      const roles = await pages<Record<string, any>>((a, b) => sb.rpc('list_event_people',{p_event:eventId}).eq('user_id', s.userId).order('id').range(a, b));
      const chair = roles.some((r) => r.role === 'chair');
      const panels = roles.filter((r) => r.role === 'lead_judge').map((r) => r.panel);
      if (!chair && panels.length === 0) return [];
      const rows = await pages<Record<string, any>>((a, b) => sb.from('scorecard_private_reviews')
        .select('scorecard_id,nominations,scorecards!inner(event_id,team_id,panel,judge_id,status)')
        .eq('scorecards.event_id', eventId).eq('scorecards.status', 'submitted').order('scorecard_id').range(a, b));
      return rows.filter((r) => chair || panels.includes(r.scorecards.panel)).map((r) => ({
        cardId: r.scorecard_id, teamId: r.scorecards.team_id, panel: r.scorecards.panel,
        judgeId: r.scorecards.judge_id, nominations: r.nominations,
      }));
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
      return (await pages<never>((a, b) => sb.from('scorecards').select(CARD_COLS).eq('event_id', eventId).order('id').range(a, b))).map(toCardRow);
    },

    async listOverrides(eventId) {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.from('score_overrides').select(OVERRIDE_COLS).eq('event_id', eventId).order('team_id').order('area_id').range(a, b))).map(toOverrideRow);
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
    async removeOverride(eventId, teamId, areaId) {
      const rows = ok(await guard(() => sb.from('score_overrides').delete()
        .eq('event_id', eventId).eq('team_id', teamId).eq('area_id', areaId).select('team_id'))) as unknown[];
      if (rows.length === 0) throw new ApiError('forbidden', `${FORBIDDEN}, or it no longer exists`);
    },
    async listPenalties(eventId) {
      if (!(await session())) return [];
      return (await pages<never>((a, b) => sb.from('penalties').select(PENALTY_COLS).eq('event_id', eventId).order('id').range(a, b))).map(toPenaltyRow);
    },
    async addPenalty(eventId, teamId, points, reason) {
      ok(await guard(() => sb.from('penalties').insert({ event_id: eventId, team_id: teamId, points, reason: reason.trim() })));
    },
    async removePenalty(penaltyId) {
      await removeById('penalties', penaltyId);
    },
    async publishSnapshot(eventId, s) {
      // `inputs` goes in but is not selectable, so the returning list names the readable columns explicitly.
      const row = one(await guard(() => sb.from('ranking_snapshots').insert({
        event_id: eventId, ruleset_id: s.rulesetId, input_hash: s.inputHash, inputs: s.inputs, rows: s.rows,
      }).select(SNAPSHOT_COLS).single()));
      return toSnapshotRow(row);
    },
    async publicStandings(eventId) {
      const data=ok(await guard(()=>sb.rpc('public_standings',{p_event:eventId})));
      return data ?? null;
    },
    async releasedResults(eventId) {
      if (!(await session())) return null;
      const data=ok(await guard(()=>sb.rpc('released_results',{p_event:eventId})));
      return data ? toSnapshotRow(firstRow(data)) : null;
    },
    async latestSnapshot(eventId) {
      if (!(await session())) return null;
      const rows = ok(await guard(() => sb.from('ranking_snapshots').select(SNAPSHOT_COLS).eq('event_id', eventId)
        .order('created_at', { ascending: false }).limit(1))) as never[];
      return rows.length > 0 ? toSnapshotRow(rows[0]) : null;
    },
    async getSnapshotInputs(snapshotId) {
      return ok(await guard(() => sb.rpc('snapshot_inputs', { p_snapshot: snapshotId })));
    },
    async listInspections(eventId) {
      if (!(await session())) return [];
      const rows = ok(await guard(() => sb.from('technical_inspections').select(INSPECTION_COLS).eq('event_id', eventId))) as never[];
      return rows.map(toInspectionRow);
    },
    async getInspection(eventId, teamId, car) {
      if (!(await session())) return null;
      const rows = ok(await guard(() => sb.from('technical_inspections').select(INSPECTION_COLS).eq('event_id', eventId).eq('team_id', teamId).eq('car', car).limit(1))) as never[];
      return rows.length > 0 ? toInspectionRow(rows[0]) : null;
    },
    async saveInspection(eventId, teamId, car, measurements, notes) {
      const payload: Record<string, unknown> = {
        event_id: eventId,
        team_id: teamId,
        car,
        ruleset_id: 'india-nationals-2026-technical',
        measurements,
        notes: notes ?? {},
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await guard(() => sb.from('technical_inspections').insert(payload).select(INSPECTION_COLS).single());
      if (!error && data) return toInspectionRow(data);
      if (error && error.code !== '23505') throw mapPgError(error);
      const updated = one(await guard(() => sb.from('technical_inspections')
        .update({ measurements, notes: notes ?? {}, updated_at: new Date().toISOString() })
        .eq('event_id', eventId).eq('team_id', teamId).eq('car', car).select(INSPECTION_COLS).single()));
      return toInspectionRow(updated);
    },
    async submitInspection(inspectionId) {
      ok(await guard(() => sb.rpc('submit_inspection', { p_inspection: inspectionId })));
    },
    async reopenInspection(inspectionId, reason) {
      ok(await guard(() => sb.rpc('reopen_inspection', { p_inspection: inspectionId, p_reason: reason })));
    },
    async listBroadcasts(eventId) {
      if (!(await session())) return [];
      const rows = ok(await guard(() => sb.from('broadcast_emails').select('*').eq('event_id', eventId).order('created_at', { ascending: false }))) as never[];
      return rows.map(toBroadcastRow);
    },
    async sendBroadcast(eventId, input) {
      const sess = await session();
      if (!sess) throw new ApiError('unauthenticated', 'Sign in first');
      const { data, error } = await sb.functions.invoke('send-broadcast', {
        body: { eventId, ...input },
      });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 401) throw new ApiError('unauthenticated', 'Sign in again');
        if (status === 403) throw new ApiError('forbidden', 'Only Chair or Organiser can send broadcasts');
        if (status === 429) throw new ApiError('rate-limited', 'Email rate limit exceeded');
        throw new ApiError('email-delivery', error.message || 'Failed to send broadcast');
      }
      return toBroadcastRow(data);
    },
  };
}
