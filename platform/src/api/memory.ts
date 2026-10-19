import { raceRecorded, validateRace, type RaceHeat, type RaceInput, type TimingState } from '../racing';
import { validateScores, type Area } from '../engine';
import { INDIA_2026 } from '../rulesets';
import { cleanTeam, MAX_IMPORT_TEAMS } from './team-input';
import type { NewTeam } from './types';
import { blankReview, validateReview, type CardReview, type FeedbackRow, type NominationRow } from './review';
import {
  ApiError, type Api, type CardRow, type ConflictRow, type EventRow, type InviteRow, type NewSnapshot, type OverrideRow, type Panel,
  type PenaltyRow, type Role, type RoleRow, type Session, type SnapshotRow, type TeamRow,
} from './types';

let seq = 0;
const nid = (prefix: string) => `${prefix}-${++seq}`;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const JUDGE_ROLES: Role[] = ['judge', 'lead_judge'];
const PANELS: Panel[] = ['scrutineering', 'design_engineering', 'project_management', 'enterprise', 'verbal'];
const ROLES: Role[] = ['organiser', 'chair', 'lead_judge', 'judge', 'scrutineer', 'race_official', 'team_manager'];
/** The database's unique index on (event, lower(btrim(number))): trim and case-fold, nothing else. */
const normNumber = (n: string) => n.trim().toLowerCase();
const EMAIL = /^[^@\s]+@[^@\s]+$/;
/** numeric(5,1) columns: the value must be representable with one decimal place. */
const oneDecimal = (n: number) => Number.isFinite(n) && Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;

/**
 * A complete in-memory backend with the same rules as the database (migrations 0001 to 0003).
 * Used by tests and demo mode. Where several rules could fail at once, permission is checked first.
 */
export class MemoryApi implements Api {
  private me: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  private events: EventRow[] = [];
  private deletedEvents = new Set<string>();
  private roles: RoleRow[] = [];
  private invites: InviteRow[] = [];
  private teams: TeamRow[] = [];
  private conflicts: { eventId: string; judgeId: string; teamId: string }[] = [];
  private cards: CardRow[] = [];
  private races: RaceHeat[] = [];
  private timing = new Map<string, TimingState>();
  private reviews = new Map<string, CardReview>();
  private overrides: OverrideRow[] = [];
  private penalties: PenaltyRow[] = [];
  private snapshots: SnapshotRow[] = [];
  /**
   * Counts every change to what a ranking counts (card submitted or reopened, override set or removed, penalty added or
   * removed, team added). A snapshot remembers the value it was published at: the database compares timestamps and counts
   * to the same end (release_results()).
   */
  private version = 0;
  private snapshotVersion = new Map<string, number>();
  /** Snapshot inputs live apart from the rows so no read path can leak them by accident. */
  private snapshotInputs = new Map<string, unknown>();

  // ---- session
  async getSession() { return this.me ? { ...this.me } : null; }
  async signIn(email: string) {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new ApiError('invalid', 'Enter a valid email address');
    this.setSession({ userId: `user:${e}`, email: e });
  }
  async signOut() { this.setSession(null); }
  onAuthChange(cb: (s: Session | null) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private setSession(s: Session | null) {
    this.me = s;
    this.listeners.forEach((l) => l(s));
  }
  /** Signing in here stands for a verified address; invitations go only to the signed-in user's own email, once. */
  async claimInvitations() {
    if (!this.me) return 0;
    const me = this.me;
    const mine = this.invites.filter((i) => i.email === me.email && !this.deletedEvents.has(i.eventId));
    for (const i of mine) {
      const dupe = this.roles.some((r) => r.eventId === i.eventId && r.userId === me.userId && r.role === i.role && r.panel === i.panel && r.teamId === i.teamId);
      if (!dupe) this.roles.push({ id: nid('role'), eventId: i.eventId, userId: me.userId, role: i.role, panel: i.panel, teamId: i.teamId, email: me.email });
    }
    this.invites = this.invites.filter((i) => !mine.includes(i));
    return mine.length;
  }

  // ---- helpers
  private rolesOf(eventId: string) { return this.deletedEvents.has(eventId) ? [] : this.roles.filter((r) => r.eventId === eventId && !!this.me && r.userId === this.me.userId); }
  private has(eventId: string, ...roles: Role[]) { return this.rolesOf(eventId).some((r) => roles.includes(r.role)); }
  private require(eventId: string, ...roles: Role[]) {
    if (!this.has(eventId, ...roles)) throw new ApiError('forbidden', 'You do not have permission to do that');
  }
  private eventOrThrow(eventId: string) {
    const e = this.events.find((x) => x.id === eventId);
    if (!e || this.deletedEvents.has(eventId)) throw new ApiError('not-found', 'Event not found');
    return e;
  }
  private released(eventId: string) { return !this.deletedEvents.has(eventId) && (this.events.find((e) => e.id === eventId)?.resultsReleased ?? false); }
  private area(eventId: string, areaId: string): Area | undefined {
    return this.eventOrThrow(eventId).ruleset.areas.find((a) => a.id === areaId);
  }
  private teamOrThrow(eventId: string, teamId: string) {
    const t = this.teams.find((x) => x.id === teamId && x.eventId === eventId);
    if (!t) throw new ApiError('not-found', 'Team not found');
    return t;
  }
  private text(v: string, label: string, max: number) {
    const t = (typeof v === 'string' ? v : '').trim();
    if (t.length === 0) throw new ApiError('invalid', `${label} is required`);
    if (t.length > max) throw new ApiError('invalid', `${label} must be ${max} characters or fewer`);
    return t;
  }
  private frozen(eventId: string, what: string) {
    this.eventOrThrow(eventId);
    if (this.released(eventId)) throw new ApiError('locked', `Results are released; withdraw the release before changing ${what}`);
  }

  // ---- events
  async listEvents() {
    return copy(this.events.filter((e) => !this.deletedEvents.has(e.id) && (e.resultsReleased || this.rolesOf(e.id).length > 0)));
  }
  async createEvent(i: { name: string; startsOn?: string }) {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    const name = this.text(i.name, 'Event name', 120);
    if (i.startsOn !== undefined) {
      const d = new Date(`${i.startsOn}T00:00:00Z`);
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(i.startsOn) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === i.startsOn;
      if (!ok) throw new ApiError('invalid', 'Start date must be a valid date (YYYY-MM-DD)');
    }
    const ev: EventRow = { id: nid('event'), name, startsOn: i.startsOn ?? null, ruleset: copy(INDIA_2026), resultsReleased: false };
    this.events.push(ev);
    this.roles.push({ id: nid('role'), eventId: ev.id, userId: this.me.userId, role: 'organiser', panel: null, teamId: null, email: this.me.email });
    return copy(ev);
  }
  async getEvent(id: string) {
    const e = this.events.find((x) => x.id === id);
    if (!e || this.deletedEvents.has(id) || !(e.resultsReleased || this.rolesOf(id).length > 0)) return null;
    return copy(e);
  }
  private organiserOf(eventId: string) {
    return !!this.me && this.roles.some((r) => r.eventId === eventId && r.userId === this.me!.userId && r.role === 'organiser');
  }
  async deleteEvent(eventId: string, confirmation: string) {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    if (!this.organiserOf(eventId)) throw new ApiError('forbidden', 'Only organisers can delete an event');
    const event = this.events.find((e) => e.id === eventId)!;
    if (confirmation !== event.name) throw new ApiError('invalid', 'The event name does not match');
    this.deletedEvents.add(eventId);
  }
  async listDeletedEvents() {
    return copy(this.events.filter((e) => this.deletedEvents.has(e.id) && this.organiserOf(e.id)));
  }
  async restoreEvent(eventId: string) {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    if (!this.organiserOf(eventId)) throw new ApiError('forbidden', 'Only organisers can restore an event');
    this.deletedEvents.delete(eventId);
  }
  async setReleased(eventId: string, released: boolean) {
    this.require(eventId, 'chair', 'organiser');
    this.require(eventId, 'chair'); // release_results() and withdraw_results() are the Chair's alone
    const ev = this.eventOrThrow(eventId);
    if (!released) {
      ev.resultsReleased = false;
      return;
    }
    if (ev.resultsReleased) return;
    const latest = this.snapshots.filter((s) => s.eventId === eventId).at(-1);
    if (!latest || !latest.released) throw new ApiError('locked', 'Publish a ranking before releasing it');
    if (this.snapshotVersion.get(latest.id) !== this.version) {
      throw new ApiError('locked', 'The published ranking is out of date. Publish it again before releasing.');
    }
    ev.resultsReleased = true;
  }

  // ---- roles and invitations
  async myRoles(eventId: string) { return copy(this.rolesOf(eventId)); }
  async listRoles(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.roles.filter((r) => r.eventId === eventId) : this.rolesOf(eventId));
  }
  async listInvitations(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.invites.filter((i) => i.eventId === eventId) : []);
  }
  async invite(eventId: string, i: { email: string; role: Role; panel?: Panel; teamId?: string }) {
    this.require(eventId, 'chair', 'organiser');
    const email = (typeof i.email === 'string' ? i.email : '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ApiError('invalid', 'Enter a valid email address');
    if (!ROLES.includes(i.role)) throw new ApiError('invalid', 'Choose a role');
    const isJudge = JUDGE_ROLES.includes(i.role);
    if (isJudge !== (i.panel !== undefined)) throw new ApiError('invalid', isJudge ? 'Choose a judging panel' : 'Only judges have a panel');
    if (i.panel !== undefined && !PANELS.includes(i.panel)) throw new ApiError('invalid', 'Choose a judging panel');
    if ((i.role === 'team_manager') !== (i.teamId !== undefined)) throw new ApiError('invalid', i.role === 'team_manager' ? 'Choose a team' : 'Only team managers have a team');
    if (i.teamId !== undefined && !this.teams.some((t) => t.id === i.teamId && t.eventId === eventId)) {
      throw new ApiError('invalid', 'That team is not part of this event');
    }
    const panel = i.panel ?? null;
    const teamId = i.teamId ?? null;
    if (this.invites.some((x) => x.eventId === eventId && x.email === email && x.role === i.role && x.panel === panel && x.teamId === teamId)) {
      throw new ApiError('duplicate', 'That person is already invited for this role');
    }
    this.invites.push({ id: nid('invite'), eventId, email, role: i.role, panel, teamId });
  }
  async removeRole(roleId: string) {
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) return;
    this.require(r.eventId, 'chair', 'organiser');
    this.roles = this.roles.filter((x) => x.id !== roleId);
  }
  async removeInvitation(inviteId: string) {
    const i = this.invites.find((x) => x.id === inviteId);
    if (!i) return;
    this.require(i.eventId, 'chair', 'organiser');
    this.invites = this.invites.filter((x) => x.id !== inviteId);
  }

  async listRaces(eventId: string) {
    const roles = this.rolesOf(eventId);
    return copy(roles.length && (roles.some(r => r.role !== 'team_manager') || this.released(eventId)) ? this.races.filter(r => r.eventId === eventId) : []);
  }
  async saveRace(eventId: string, id: string, revision: number, input: RaceInput) {
    this.require(eventId, 'organiser', 'chair', 'race_official');
    this.frozen(eventId, 'race results');
    const previous = this.races.find(r => r.eventId === eventId && r.id === id);
    if ((previous?.revision ?? 0) !== revision) throw new ApiError('conflict', 'Race changed on another device');
    const error = validateRace(input);
    if (error) throw new ApiError('invalid', error);
    this.teamOrThrow(eventId, input.lane1.teamId); this.teamOrThrow(eventId, input.lane2.teamId);
    if (previous && raceRecorded(previous) && input.note.trim().length < 5) throw new ApiError('invalid', 'Give a correction reason');
    if (input.sourceRunId && this.races.some(r => r.eventId === eventId && r.id !== id && r.sourceRunId === input.sourceRunId)) throw new ApiError('duplicate', 'This track run was already saved');
    const row: RaceHeat = { ...copy(input), label: input.label.trim(), note: input.note.trim(), id, eventId, number: previous?.number ?? 1 + Math.max(0, ...this.races.filter(r => r.eventId === eventId).map(r => r.number)), revision: revision + 1, updatedAt: new Date().toISOString() };
    this.races = this.races.filter(r => r.id !== id); this.races.push(row);
    return copy(row);
  }
  async getTiming(eventId: string) {
    return this.rolesOf(eventId).some(r => r.role !== 'team_manager') ? copy(this.timing.get(eventId) ?? null) : null;
  }
  async pairTiming(eventId: string) {
    this.require(eventId, 'organiser', 'chair', 'race_official'); this.frozen(eventId, 'track connection');
    const state: TimingState = { connectionId: nid('connection'), expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(), lastSeenAt: null, payload: null };
    this.timing.set(eventId, state);
    return { token: 'demo-only', connectionId: state.connectionId, expiresAt: state.expiresAt };
  }

  // ---- teams
  async listTeams(eventId: string) {
    const mine = this.rolesOf(eventId);
    const staff = mine.some((r) => r.role !== 'team_manager');
    const managed = mine.filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    const released = this.released(eventId);
    return copy(this.teams.filter((t) => t.eventId === eventId && (released || staff || managed.includes(t.id))));
  }
  async createTeam(eventId: string, i: { number: string; name: string; school?: string }) {
    this.require(eventId, 'chair', 'organiser');
    const number = this.text(i.number, 'Team number', 12);
    const name = this.text(i.name, 'Team name', 80);
    const school = (i.school ?? '').trim();
    if (school.length > 120) throw new ApiError('invalid', 'School must be 120 characters or fewer');
    if (this.teams.some((t) => t.eventId === eventId && normNumber(t.number) === normNumber(number))) {
      throw new ApiError('duplicate', `Team number ${number} is already used in this event`);
    }
    const team: TeamRow = { id: nid('team'), eventId, number, name, school };
    this.teams.push(team);
    this.version += 1;
    return copy(team);
  }

  async deleteTeam(eventId: string, teamId: string, confirmation: string) {
    this.require(eventId, 'chair', 'organiser');
    this.frozen(eventId, 'teams');
    const team = this.teamOrThrow(eventId, teamId);
    if (confirmation !== team.number) throw new ApiError('invalid', 'The team number does not match');
    if (this.cards.some((c) => c.teamId === teamId && c.status === 'submitted')) {
      throw new ApiError('locked', 'Ask the Chair to reopen submitted scorecards before deleting this team');
    }
    if (this.races.some(r => (r.lane1.teamId === teamId || r.lane2.teamId === teamId) && raceRecorded(r))) throw new ApiError('locked', 'Recorded races prevent team deletion');
    this.races = this.races.filter(r => r.lane1.teamId !== teamId && r.lane2.teamId !== teamId);
    // Match the database's cascades, after every guard passes, with no partial deletion.
    for (const card of this.cards.filter((c) => c.teamId === teamId)) this.reviews.delete(card.id);
    this.cards = this.cards.filter((c) => c.teamId !== teamId);
    this.roles = this.roles.filter((r) => r.teamId !== teamId);
    this.invites = this.invites.filter((i) => i.teamId !== teamId);
    this.conflicts = this.conflicts.filter((c) => c.teamId !== teamId);
    this.overrides = this.overrides.filter((o) => o.teamId !== teamId);
    this.penalties = this.penalties.filter((p) => p.teamId !== teamId);
    this.teams = this.teams.filter((t) => t.id !== teamId);
    this.version += 1;
  }

  async importTeams(eventId: string, inputs: NewTeam[]) {
    this.require(eventId, 'chair', 'organiser');
    this.eventOrThrow(eventId);
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_IMPORT_TEAMS) throw new ApiError('invalid', 'Import between 1 and 1000 teams');
    const teams = inputs.map(cleanTeam);
    const numbers = new Set(this.teams.filter((t) => t.eventId === eventId).map((t) => normNumber(t.number)));
    for (const team of teams) {
      if (numbers.has(normNumber(team.number))) throw new ApiError('duplicate', 'A team number is already used');
      numbers.add(normNumber(team.number));
    }
    // No await between validation and insertion: a batch can never be partially imported.
    const rows = teams.map((t) => ({ ...t, id: nid('team'), eventId }));
    this.teams.push(...rows); this.version += rows.length;
    return copy(rows);
  }

  // ---- conflicts and scorecards
  async declareConflict(eventId: string, teamId: string) {
    this.require(eventId, ...JUDGE_ROLES);
    this.teamOrThrow(eventId, teamId);
    const judgeId = this.me!.userId;
    if (this.released(eventId)) throw new ApiError('locked', 'Results are released, so a conflict can no longer be declared');
    if (this.cards.some((c) => c.eventId === eventId && c.teamId === teamId && c.judgeId === judgeId && c.status === 'submitted')) {
      throw new ApiError('locked', 'You have already submitted a scorecard for this team; ask the Chair');
    }
    if (!this.conflicts.some((c) => c.eventId === eventId && c.judgeId === judgeId && c.teamId === teamId)) this.conflicts.push({ eventId, judgeId, teamId });
  }
  async myConflicts(eventId: string) {
    if (this.deletedEvents.has(eventId)) return [];
    return this.conflicts.filter((c) => c.eventId === eventId && !!this.me && c.judgeId === this.me.userId).map((c) => c.teamId);
  }
  async listConflicts(eventId: string): Promise<ConflictRow[]> {
    if (!this.me || this.deletedEvents.has(eventId)) return [];
    const staff = this.has(eventId, 'chair', 'organiser');
    return this.conflicts.filter((c) => c.eventId === eventId && (staff || c.judgeId === this.me!.userId))
      .map((c) => ({ eventId: c.eventId, judgeId: c.judgeId, teamId: c.teamId }));
  }
  private conflicted(eventId: string, teamId: string) {
    return this.conflicts.some((c) => c.eventId === eventId && c.teamId === teamId && !!this.me && c.judgeId === this.me.userId);
  }
  private myCard(cardId: string) {
    const c = this.cards.find((x) => x.id === cardId);
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    if (!c || c.judgeId !== this.me.userId) throw new ApiError('forbidden', 'That scorecard is not yours');
    return c;
  }
  /** Returns the judge's own card for this team and area, creating it the first time. One card per judge, team and area. */
  async openCard(eventId: string, teamId: string, areaId: string) {
    const area = this.area(eventId, areaId);
    if (!area || area.kind !== 'scorecard' || area.panel === null) throw new ApiError('invalid', 'That area is not scored on a scorecard');
    this.teamOrThrow(eventId, teamId);
    const me = this.me?.userId;
    // Reading a card you already own is not judging: it stays readable after release or a later conflict.
    const existing = this.cards.find((c) => c.eventId === eventId && c.teamId === teamId && c.areaId === areaId && c.judgeId === me);
    if (existing) return copy(existing);
    const isPanelJudge = this.rolesOf(eventId).some((r) => r.role === 'judge' && r.panel === area.panel);
    if (!isPanelJudge) throw new ApiError('forbidden', 'You do not judge this panel');
    if (this.conflicted(eventId, teamId)) throw new ApiError('forbidden', 'You declared a conflict of interest with this team');
    this.frozen(eventId, 'scorecards');
    const card: CardRow = { id: nid('card'), eventId, teamId, areaId, panel: area.panel as Panel, judgeId: me!, status: 'draft', reopenedCount: 0, scores: {}, comments: {} };
    this.cards.push(card);
    return copy(card);
  }
  async saveScore(cardId: string, criterionId: string, score: number, comment?: string) {
    const card = this.myCard(cardId);
    this.frozen(card.eventId, 'scorecards');
    if (card.status === 'submitted') throw new ApiError('locked', 'This scorecard has been submitted');
    if (this.conflicted(card.eventId, card.teamId)) throw new ApiError('forbidden', 'You declared a conflict of interest with this team');
    const area = this.area(card.eventId, card.areaId)!;
    const problems = validateScores(area, { [criterionId]: score }, { complete: false });
    if (problems.length > 0) throw new ApiError('invalid', problems[0].message);
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000)) throw new ApiError('invalid', 'Comments must be 1000 characters or fewer');
    card.scores[criterionId] = score;
    // undefined leaves an existing comment alone (a new score row starts with ''); any string, including '', sets it.
    if (comment !== undefined) card.comments[criterionId] = comment;
    else if (!(criterionId in card.comments)) card.comments[criterionId] = '';
  }
  async submitCard(cardId: string) {
    const card = this.myCard(cardId);
    this.frozen(card.eventId, 'scorecards');
    if (card.status === 'submitted') throw new ApiError('locked', 'This scorecard has already been submitted');
    const area = this.area(card.eventId, card.areaId)!;
    if (!this.rolesOf(card.eventId).some((r) => r.role === 'judge' && r.panel === card.panel) || this.conflicted(card.eventId, card.teamId)) {
      throw new ApiError('forbidden', 'You cannot submit this scorecard');
    }
    const problems = validateScores(area, card.scores, { complete: true });
    if (problems.length > 0) throw new ApiError('invalid', problems[0].message);
    card.status = 'submitted';
    this.version += 1;
  }
  async getReview(cardId: string): Promise<CardReview> {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card || !(await this.listCards(card.eventId)).some((c) => c.id === cardId)) throw new ApiError('forbidden', 'That scorecard is not available');
    const review = copy(this.reviews.get(cardId) ?? blankReview());
    if (!this.canReadPrivate(card)) {
      review.criterionNotes = {}; review.internalNotes = ''; review.nominations = [];
    }
    return review;
  }
  private canReadPrivate(c: CardRow) {
    return c.judgeId === this.me?.userId || this.has(c.eventId, 'chair')
      || this.rolesOf(c.eventId).some((r) => r.role === 'lead_judge' && r.panel === c.panel);
  }
  async saveReview(cardId: string, review: CardReview) {
    const card = this.myCard(cardId);
    if (!this.rolesOf(card.eventId).some((r) => r.role === 'judge' && r.panel === card.panel) || this.conflicted(card.eventId, card.teamId)) {
      throw new ApiError('forbidden', 'You cannot edit this scorecard');
    }
    this.frozen(card.eventId, 'feedback');
    if (card.status !== 'draft') throw new ApiError('locked', 'This scorecard has been submitted');
    this.reviews.set(cardId, validateReview(review, this.area(card.eventId, card.areaId)!));
  }
  async listFeedback(eventId: string): Promise<FeedbackRow[]> {
    return (await this.listCards(eventId)).filter((c) => this.reviews.has(c.id)).map((c) => {
      const r = this.reviews.get(c.id)!;
      return { cardId: c.id, overall: r.overall, strengths: r.strengths, improvements: r.improvements };
    });
  }
  async listNominations(eventId: string): Promise<NominationRow[]> {
    return this.cards.filter((c) => c.eventId === eventId && c.status === 'submitted'
      && (this.has(eventId, 'chair') || this.rolesOf(eventId).some((r) => r.role === 'lead_judge' && r.panel === c.panel)))
      .map((c) => ({ cardId: c.id, teamId: c.teamId, panel: c.panel, judgeId: c.judgeId, nominations: copy(this.reviews.get(c.id)?.nominations ?? []) }));
  }
  async reopenCard(cardId: string, reason: string) {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) throw new ApiError('not-found', 'Scorecard not found');
    this.require(card.eventId, 'chair');
    if ((typeof reason === 'string' ? reason : '').trim().length < 3) throw new ApiError('invalid', 'A reason is required to reopen a scorecard');
    if (this.released(card.eventId)) throw new ApiError('locked', 'Results are released; withdraw the release before reopening a scorecard');
    if (card.status !== 'submitted') throw new ApiError('locked', 'That scorecard is not submitted');
    card.status = 'draft';
    card.reopenedCount += 1;
    this.version += 1;
  }
  async listCards(eventId: string) {
    if (!this.me || this.deletedEvents.has(eventId)) return [];
    const me = this.me.userId;
    const staff = this.has(eventId, 'chair', 'organiser');
    const released = this.released(eventId);
    const mine = this.rolesOf(eventId);
    const leadPanels = mine.filter((r) => r.role === 'lead_judge').map((r) => r.panel);
    const managed = mine.filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy(this.cards.filter((c) => c.eventId === eventId && (
      staff || c.judgeId === me || leadPanels.includes(c.panel)
      || (c.status === 'submitted' && released && managed.includes(c.teamId))
    )));
  }

  // ---- overrides, penalties, snapshots
  async listOverrides(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser') ? this.overrides.filter((o) => o.eventId === eventId) : []);
  }
  async setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string) {
    this.require(eventId, 'chair');
    this.frozen(eventId, 'overrides');
    const area = this.area(eventId, areaId);
    if (!area || area.kind !== 'scorecard') throw new ApiError('invalid', 'Overrides apply to scorecard areas only');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > area.max) throw new ApiError('invalid', `Override must be between 0 and ${area.max}`);
    if (!oneDecimal(value)) throw new ApiError('invalid', 'Override can have at most one decimal place');
    const why = (typeof reason === 'string' ? reason : '').trim();
    if (why.length < 3) throw new ApiError('invalid', 'A reason is required');
    this.teamOrThrow(eventId, teamId);
    const v = Math.round(value * 10) / 10;
    const existing = this.overrides.find((o) => o.eventId === eventId && o.teamId === teamId && o.areaId === areaId);
    if (existing) { existing.value = v; existing.reason = why; }
    else this.overrides.push({ eventId, teamId, areaId, value: v, reason: why });
    this.version += 1;
  }
  async removeOverride(eventId: string, teamId: string, areaId: string) {
    const o = this.overrides.find((x) => x.eventId === eventId && x.teamId === teamId && x.areaId === areaId);
    // As row-level security: a missing row and a row you may not delete look the same.
    if (!o || !this.has(eventId, 'chair')) throw new ApiError('forbidden', 'You do not have permission to do that');
    this.frozen(eventId, 'overrides');
    this.overrides = this.overrides.filter((x) => x !== o);
    this.version += 1;
  }
  async listPenalties(eventId: string) {
    if (this.has(eventId, 'chair', 'organiser')) return copy(this.penalties.filter((p) => p.eventId === eventId));
    if (!this.released(eventId)) return [];
    const managed = this.rolesOf(eventId).filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy(this.penalties.filter((p) => p.eventId === eventId && managed.includes(p.teamId)));
  }
  async addPenalty(eventId: string, teamId: string, points: number, reason: string) {
    this.require(eventId, 'chair');
    this.frozen(eventId, 'penalties');
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0 || points > 100) throw new ApiError('invalid', 'Penalty points must be above 0 and at most 100');
    if (!oneDecimal(points)) throw new ApiError('invalid', 'Penalty points can have at most one decimal place');
    const why = (typeof reason === 'string' ? reason : '').trim();
    if (why.length < 3) throw new ApiError('invalid', 'A reason is required');
    this.teamOrThrow(eventId, teamId);
    this.penalties.push({ id: nid('penalty'), eventId, teamId, points: Math.round(points * 10) / 10, reason: why });
    this.version += 1;
  }
  async removePenalty(penaltyId: string) {
    const p = this.penalties.find((x) => x.id === penaltyId);
    // As row-level security: a missing row and a row you may not delete look the same.
    if (!p || !this.has(p.eventId, 'chair')) throw new ApiError('forbidden', 'You do not have permission to do that');
    this.frozen(p.eventId, 'penalties');
    this.penalties = this.penalties.filter((x) => x.id !== penaltyId);
    this.version += 1;
  }
  async publishSnapshot(eventId: string, s: NewSnapshot) {
    this.require(eventId, 'chair');
    const ev = this.eventOrThrow(eventId);
    if (!/^[0-9a-f]{64}$/.test(s.inputHash)) throw new ApiError('invalid', 'The snapshot hash is malformed');
    if (s.rulesetId !== ev.ruleset.id) throw new ApiError('invalid', 'The snapshot ruleset does not match the ruleset pinned to the event');
    if (typeof s.inputs !== 'object' || s.inputs === null || Array.isArray(s.inputs)) throw new ApiError('invalid', 'Snapshot inputs must be an object');
    if (!Array.isArray(s.rows)) throw new ApiError('invalid', 'Snapshot rows must be a list');
    const row: SnapshotRow = {
      id: nid('snapshot'), eventId, createdAt: new Date().toISOString(), rulesetId: s.rulesetId,
      inputHash: s.inputHash, rows: copy(s.rows), released: true,
    };
    this.snapshots.push(row);
    this.snapshotVersion.set(row.id, this.version);
    this.snapshotInputs.set(row.id, copy(s.inputs));
    return copy(row);
  }
  async latestSnapshot(eventId: string) {
    const staff = this.has(eventId, 'chair', 'organiser');
    const visible = this.snapshots.filter((s) => s.eventId === eventId && (staff || (s.released && this.released(eventId))));
    return visible.length === 0 ? null : copy(visible[visible.length - 1]);
  }
  async getSnapshotInputs(snapshotId: string) {
    const s = this.snapshots.find((x) => x.id === snapshotId);
    // An unknown id is indistinguishable from a forbidden one, as in snapshot_inputs().
    if (!s || !this.has(s.eventId, 'chair', 'organiser')) throw new ApiError('forbidden', 'Snapshot inputs are restricted to the Chair and Organiser');
    return copy(this.snapshotInputs.get(snapshotId));
  }
}
