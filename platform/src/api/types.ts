import type { PanelId, RankRow, Ruleset } from '../engine';

export type Role = 'organiser' | 'chair' | 'lead_judge' | 'judge' | 'scrutineer' | 'race_official' | 'team_manager';
export type Panel = PanelId;
export interface Session { userId: string; email: string }
export interface EventRow { id: string; name: string; startsOn: string | null; ruleset: Ruleset; resultsReleased: boolean }
export interface TeamRow { id: string; eventId: string; number: string; name: string; school: string }
export interface RoleRow { id: string; eventId: string; userId: string; role: Role; panel: Panel | null; teamId: string | null; email: string | null }
export interface InviteRow { id: string; eventId: string; email: string; role: Role; panel: Panel | null; teamId: string | null }
export interface CardRow { id: string; eventId: string; teamId: string; areaId: string; panel: Panel; judgeId: string; status: 'draft' | 'submitted'; reopenedCount: number; scores: Record<string, number>; comments: Record<string, string> }
/** A judge's declared conflict of interest with a team. */
export interface ConflictRow { eventId: string; judgeId: string; teamId: string }
export interface OverrideRow { eventId: string; teamId: string; areaId: string; value: number; reason: string }
export interface PenaltyRow { id: string; eventId: string; teamId: string; points: number; reason: string }
/** What anyone allowed to see a snapshot gets. The inputs are deliberately absent: see Api.getSnapshotInputs. */
export interface SnapshotRow { id: string; eventId: string; createdAt: string; rulesetId: string; inputHash: string; rows: RankRow[]; released: boolean }
export interface NewSnapshot { rulesetId: string; inputHash: string; inputs: unknown; rows: RankRow[]; released?: boolean }
/** 'unauthenticated': no valid session (signed out, token expired). The caller should sign in again; nothing was refused on merit. */
export type ApiErrorCode = 'unauthenticated' | 'forbidden' | 'locked' | 'invalid' | 'duplicate' | 'not-found' | 'network' | 'unknown';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  getSession(): Promise<Session | null>;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  claimInvitations(): Promise<number>;
  listEvents(): Promise<EventRow[]>;
  createEvent(i: { name: string; startsOn?: string }): Promise<EventRow>;
  getEvent(id: string): Promise<EventRow | null>;
  setReleased(eventId: string, released: boolean): Promise<void>;
  myRoles(eventId: string): Promise<RoleRow[]>;
  listRoles(eventId: string): Promise<RoleRow[]>;
  listInvitations(eventId: string): Promise<InviteRow[]>;
  invite(eventId: string, i: { email: string; role: Role; panel?: Panel; teamId?: string }): Promise<void>;
  removeRole(roleId: string): Promise<void>;
  removeInvitation(inviteId: string): Promise<void>;
  listTeams(eventId: string): Promise<TeamRow[]>;
  createTeam(eventId: string, i: { number: string; name: string; school?: string }): Promise<TeamRow>;
  /** 'locked' once the judge has a submitted card for the team, or while results are released. */
  declareConflict(eventId: string, teamId: string): Promise<void>;
  myConflicts(eventId: string): Promise<string[]>;
  /** Every declared conflict the caller may see: the Chair and Organiser see all, a judge only their own. */
  listConflicts(eventId: string): Promise<ConflictRow[]>;
  openCard(eventId: string, teamId: string, areaId: string): Promise<CardRow>;
  /**
   * Upserts one criterion's score. `comment` undefined leaves any existing comment unchanged (a brand-new score row
   * starts with ''); a string, including '', replaces it.
   */
  saveScore(cardId: string, criterionId: string, score: number, comment?: string): Promise<void>;
  submitCard(cardId: string): Promise<void>;
  reopenCard(cardId: string, reason: string): Promise<void>;
  listCards(eventId: string): Promise<CardRow[]>;
  listOverrides(eventId: string): Promise<OverrideRow[]>;
  setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string): Promise<void>;
  listPenalties(eventId: string): Promise<PenaltyRow[]>;
  addPenalty(eventId: string, teamId: string, points: number, reason: string): Promise<void>;
  /** Chair only. 'locked' while results are released. A row that does not exist or is not yours to remove is 'forbidden'. */
  removePenalty(penaltyId: string): Promise<void>;
  publishSnapshot(eventId: string, s: NewSnapshot): Promise<SnapshotRow>;
  latestSnapshot(eventId: string): Promise<SnapshotRow | null>;
  /** The inputs a snapshot was computed from (every judge's cards, overrides, penalties). Chair and Organiser only. */
  getSnapshotInputs(snapshotId: string): Promise<unknown>;
}
