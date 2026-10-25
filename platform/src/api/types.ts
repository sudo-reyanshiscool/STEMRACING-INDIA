import type {TeamFile,TeamFileInput} from './team-files';
import type { RacingSetup, RacingSetupInput } from '../racing/competition';
import type { TeamContact, ResultMailState, ResultsPacket, ResultMailSelection } from './result-mail';
import type {DrawLotsState,TeamNumberAssignment,JudgeLotAssignment} from './draw-lots';
import type { RaceHeat, RaceInput, TimingState, TimingPair } from '../racing';
import type { PanelId, RankRow, Ruleset } from '../engine';
import type { CardReview, FeedbackRow, NominationRow } from './review';

export type OrganiserScope = 'competition' | 'platform';
export interface PlatformAccess {
  viewerId?: string | null; ownerId?: string;
  kind: 'admin' | OrganiserScope | null;
  ownerEmail: string;
  canManage: boolean;
  organisers: Array<{userId: string; name?: string; emailHidden?: boolean; contactRestricted?: boolean; email: string | null; scope: 'admin' | OrganiserScope; permanent: boolean}>;
  invitations: Array<{id: string; email: string; scope: OrganiserScope; emailStatus: EmailStatus}>;
}
export type Role = 'organiser' | 'chair' | 'lead_judge' | 'judge' | 'scrutineer' | 'race_official' | 'team_manager';
export type Panel = PanelId;
export interface Session { userId: string; email: string }
export interface EventRow { id: string; name: string; startsOn: string | null; ruleset: Ruleset; resultsReleased: boolean }
export interface TeamRow { id: string; eventId: string; number: string; name: string; school: string }
export interface NewTeam { number: string; name: string; school?: string; managerEmail?: string }
export interface RoleRow { name?: string; id: string; eventId: string; userId: string; role: Role; panel: Panel | null; teamId: string | null; email: string | null }
export type EmailStatus = 'not_sent' | 'sending' | 'sent' | 'failed';
export interface InviteRow { name?: string; id: string; eventId: string; email: string; role: Role; panel: Panel | null; teamId: string | null; emailStatus?: EmailStatus; emailSentAt?: string | null; emailFailure?: 'provider' | 'rate_limit' | null }
export interface CardRow { id: string; eventId: string; teamId: string; areaId: string; panel: Panel; judgeId: string; status: 'draft' | 'submitted'; reopenedCount: number; scores: Record<string, number>; comments: Record<string, string> }
/** A judge's declared conflict of interest with a team. */
export interface JudgeExemption { eventId: string; judgeId: string; teamId: string; reason: string }
export interface ConflictRow { eventId: string; judgeId: string; teamId: string }
export interface OverrideRow { eventId: string; teamId: string; areaId: string; value: number; reason: string }
export interface PenaltyRow { id: string; eventId: string; teamId: string; points: number; reason: string }
export interface BroadcastEmail {
  id: string;
  eventId: string;
  senderId: string | null;
  senderEmail: string | null;
  audienceType: 'all_judges' | 'panel' | 'specific_judges' | 'emails';
  panel: Panel | null;
  recipientCount: number;
  subject: string;
  category: string | null;
  body: string;
  buttonText: string | null;
  buttonUrl: string | null;
  createdAt: string;
}
export interface NewBroadcastInput {
  audienceType: 'all_judges' | 'panel' | 'specific_judges' | 'emails';
  panel?: Panel | null;
  judgeIds?: string[];
  customEmails?: string[];
  subject: string;
  category?: string;
  body: string;
  buttonText?: string;
  buttonUrl?: string;
}
/** What anyone allowed to see a snapshot gets. The inputs are deliberately absent: see Api.getSnapshotInputs. */
export interface PublicStandings { createdAt: string; rows: Array<Pick<RankRow, 'rank' | 'teamId' | 'number' | 'name' | 'total' | 'tied'>> }
export interface SnapshotRow { id: string; eventId: string; createdAt: string; rulesetId: string; inputHash: string; rows: RankRow[]; released: boolean }
export interface NewSnapshot { rulesetId: string; inputHash: string; inputs: unknown; rows: RankRow[] }

export interface MfaFactor {
  id: string;
  factorType: 'totp';
  status: 'verified' | 'unverified';
  friendlyName?: string;
  createdAt?: string;
}

export interface MfaEnrollResult {
  id: string;
  factorType: 'totp';
  totp: {
    qrCode: string;
    secret: string;
    uri: string;
  };
}

export interface MfaStatus {
  enabled: boolean;
  factors: MfaFactor[];
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
}

/** 'unauthenticated': no valid session (signed out, token expired). The caller should sign in again; nothing was refused on merit. */
export type ApiErrorCode = 'unauthenticated' | 'forbidden' | 'locked' | 'invalid' | 'duplicate' | 'conflict' | 'email-delivery' | 'rate-limited' | 'invalid-auth' | 'not-found' | 'network' | 'unknown';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

import type { Car, Inspection, Measurements } from '../technical';

export interface TeamConcern {
  id: string; eventId: string; teamId: string; panel: Panel; message: string;
  status: 'open' | 'resolved'; response: string; createdAt: string;
}
export interface InspectionScope {revision: number; articles: string[] | null; locked: boolean}
export interface Api {
  listTeamFiles(eventId: string): Promise<TeamFile[]>;
  uploadTeamFile(eventId: string, teamId: string, revision: number, input: TeamFileInput): Promise<void>;
  downloadTeamFile(eventId: string, id: string): Promise<TeamFile & {base64:string}>;
  getInspectionScope(eventId: string): Promise<InspectionScope>;
  saveInspectionScope(eventId: string, revision: number, articles: string[] | null): Promise<InspectionScope>;
  queueRaceFollowup(eventId: string, id: string, revision: number, mode: 'swap' | 'rerun'): Promise<RaceHeat>;
  listTeamConcerns(eventId: string): Promise<TeamConcern[]>;
  submitTeamConcern(eventId: string, teamId: string, panel: Panel, message: string): Promise<void>;
  resolveTeamConcern(eventId: string, id: string, response: string): Promise<void>;
  getSession(): Promise<Session | null>;
  signIn(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  verifyEmailLink(tokenHash: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  getMfaStatus(): Promise<MfaStatus>;
  enrollTotp(friendlyName?: string): Promise<MfaEnrollResult>;
  verifyTotp(factorId: string, code: string): Promise<void>;
  unenrollTotp(factorId: string): Promise<void>;
  claimInvitations(): Promise<number>;
  listEvents(): Promise<EventRow[]>;
  canCreateEvent(): Promise<boolean>;
  platformAccess(): Promise<PlatformAccess>;
  inviteOrganiser(email: string, scope: OrganiserScope): Promise<void>;
  removeOrganiser(userId: string): Promise<void>;
  withdrawOrganiserInvitation(invitationId: string): Promise<void>;
  createEvent(i: { name: string; startsOn?: string }): Promise<EventRow>;
  /** Restorable deletion; confirmation must exactly match the event's current name. Organisers only. */
  deleteEvent(eventId: string, confirmation: string): Promise<void>;
  listDeletedEvents(): Promise<EventRow[]>;
  restoreEvent(eventId: string): Promise<void>;
  getEvent(id: string): Promise<EventRow | null>;
  setReleased(eventId: string, released: boolean): Promise<void>;
  myRoles(eventId: string): Promise<RoleRow[]>;
  listRoles(eventId: string): Promise<RoleRow[]>;
  listInvitations(eventId: string): Promise<InviteRow[]>;
  invite(eventId: string, i: { name?: string; email: string; role: Role; panel?: Panel; teamId?: string }): Promise<void>;
  /** null teams means the entire panel; selected team ids replace only that panel's scope. */
  listJudgeExemptions(eventId: string): Promise<JudgeExemption[]>;
  setJudgeExemption(eventId: string, userId: string, teamId: string, exempt: boolean, reason?: string): Promise<void>;
  setJudgeAssignment(eventId: string, userId: string, panel: Panel, teamIds: string[] | null): Promise<void>;
  setJudgeName(eventId: string, userId: string, name: string): Promise<void>;
  removeRole(roleId: string): Promise<void>;
  removeInvitation(inviteId: string): Promise<void>;
  sendInvitation(inviteId: string): Promise<void>;
  queueReactionRaces(eventId: string): Promise<void>;
  getRacingSetup(eventId: string): Promise<RacingSetup>;
  saveRacingSetup(eventId: string, revision: number, input: RacingSetupInput): Promise<RacingSetup>;
  listRaces(eventId: string): Promise<RaceHeat[]>;
  saveRace(eventId: string, id: string, revision: number, input: RaceInput): Promise<RaceHeat>;
  getTiming(eventId: string): Promise<TimingState | null>;
  pairTiming(eventId: string): Promise<TimingPair>;
  listTeams(eventId: string): Promise<TeamRow[]>;
  drawLotsState(eventId:string):Promise<DrawLotsState>;
  applyTeamNumberDraw(eventId:string,version:string,assignments:TeamNumberAssignment[]):Promise<void>;
  applyJudgeDraw(eventId:string,version:string,panel:Panel,assignments:JudgeLotAssignment[]):Promise<void>;
  createTeam(eventId: string, i: NewTeam): Promise<TeamRow>;
  listTeamContacts(eventId: string): Promise<TeamContact[]>;
  setTeamContact(eventId: string, teamId: string, email: string): Promise<void>;
  resultMailState(eventId: string): Promise<ResultMailState>;
  saveAward(eventId: string, title: string, teamId: string): Promise<void>;
  removeAward(awardId: string): Promise<void>;
  confirmAwards(eventId: string): Promise<void>;
  previewResultsPacket(eventId: string, teamId: string): Promise<ResultsPacket>;
  sendTeamResults(eventId: string, teamId: string, selection: ResultMailSelection): Promise<'sent' | 'already_sent'>;
  acknowledgeResultRetry(eventId: string, teamId: string, selection: ResultMailSelection): Promise<void>;
  /** Chair/Organiser only. Exact team number required; submitted cards and released results block deletion. */
  deleteTeam(eventId: string, teamId: string, confirmation: string): Promise<void>;
  /** All rows are validated and inserted together. Duplicate numbers reject the entire batch. */
  importTeams(eventId: string, teams: NewTeam[]): Promise<TeamRow[]>;
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
  getReview(cardId: string): Promise<CardReview>;
  saveReview(cardId: string, review: CardReview): Promise<void>;
  listFeedback(eventId: string): Promise<FeedbackRow[]>;
  /** Submitted nominations visible to the Chair and the corresponding panel lead only. */
  listNominations(eventId: string): Promise<NominationRow[]>;
  submitCard(cardId: string): Promise<void>;
  reopenCard(cardId: string, reason: string): Promise<void>;
  listCards(eventId: string): Promise<CardRow[]>;
  listOverrides(eventId: string): Promise<OverrideRow[]>;
  setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string): Promise<void>;
  /** Chair only. 'locked' while results are released; no such override (or not yours to remove) is 'forbidden'. */
  removeOverride(eventId: string, teamId: string, areaId: string): Promise<void>;
  listPenalties(eventId: string): Promise<PenaltyRow[]>;
  addPenalty(eventId: string, teamId: string, points: number, reason: string): Promise<void>;
  /** Chair only. 'locked' while results are released. A row that does not exist or is not yours to remove is 'forbidden'. */
  removePenalty(penaltyId: string): Promise<void>;
  publishSnapshot(eventId: string, s: NewSnapshot): Promise<SnapshotRow>;
  latestSnapshot(eventId: string): Promise<SnapshotRow | null>;
  publicStandings(eventId: string): Promise<PublicStandings | null>;
  releasedResults(eventId: string): Promise<SnapshotRow | null>;
  /** The inputs a snapshot was computed from (every judge's cards, overrides, penalties). Chair and Organiser only. */
  getSnapshotInputs(snapshotId: string): Promise<unknown>;
  listInspections(eventId: string): Promise<Inspection[]>;
  getInspection(eventId: string, teamId: string, car: Car): Promise<Inspection | null>;
  saveInspection(eventId: string, teamId: string, car: Car, measurements: Measurements, notes?: Record<string, string>): Promise<Inspection>;
  submitInspection(inspectionId: string): Promise<void>;
  reopenInspection(inspectionId: string, reason: string): Promise<void>;
  listBroadcasts(eventId: string): Promise<BroadcastEmail[]>;
  sendBroadcast(eventId: string, input: NewBroadcastInput): Promise<BroadcastEmail>;
}
