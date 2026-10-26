import {validateEventLogos,type EventLogos,type NewEvent} from './event-branding';
import {SUBMISSION_GUIDE_VERSION,SUBMISSION_GUIDE_DURATION,type SubmissionGuideState} from './submission-guide';
import {emptySchedule,validateSchedule,teamActivities,type ScheduleDoc,type ScheduleState} from '../scheduling';
import {PORTFOLIOS,submissionRow,validateSubmissionRules,type SubmissionRule} from './submissions';
import {FILE_PANEL, validateTeamFile, type TeamFile, type TeamFileInput} from './team-files';
import {validatePhotoUpload, extractDimensions} from './team-photos';
import {DEFAULT_SAMPLE_CUTOUT} from './sample-cutout';
import {
  type CompulsoryAssetKey,
  type TeamColours,
  type TeamMemberPortrait,
  type StoredCompulsoryFile,
  type TeamCompulsoryAssets,
  validateTeamColours,
  validateMemberPortraits,
  validateCompulsoryFile,
  computeCompulsoryAssetStatus,
} from './compulsory-assets';
import { defaultRacingSetup, validateSetup, reactionPairings, type RacingSetup, type RacingSetupInput } from '../racing/competition';
import { rerunEligible, followupInput, raceRecorded, validateRace, type RaceHeat, type RaceInput, type TimingState } from '../racing';
import { validateScores, type Area } from '../engine';
import { INDIA_2026 } from '../rulesets';
import type {ResultsPacket, ResultMailState, EventAward, TeamContact, ResultMailSelection} from './result-mail';
import { validManagerEmail, cleanTeam, MAX_IMPORT_TEAMS } from './team-input';
import { INDIA_TECHNICAL } from '../technical';
import type { InspectionScope, TeamConcern, OrganiserScope, PlatformAccess, NewTeam, TeamPhoto, TeamPhotoUploadInput, TeamPhotoHistoryItem, BroadcastPhoto, PhotoProcessingStatus } from './types';
import type {DrawLotsState,TeamNumberAssignment,JudgeLotAssignment} from './draw-lots';
import { blankReview, validateReview, type CardReview, type FeedbackRow, type NominationRow } from './review';
import {
  ApiError, type Api, type BroadcastEmail, type CardRow, type ConflictRow, type EventRow, type InviteRow,
  type MfaEnrollResult, type MfaFactor, type MfaStatus, type NewBroadcastInput, type NewSnapshot, type OverrideRow, type Panel,
  type PenaltyRow, type Role, type RoleRow, type Session, type SnapshotRow, type TeamRow,
} from './types';
import type { Car, Inspection, InspectionStatus, Measurements } from '../technical';

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

/** An authorised, read-only export used to start a disposable presentation. */
export interface ShowcaseSeed {
  event: EventRow;
  teams: TeamRow[];
  roles: RoleRow[];
  invitations: InviteRow[];
  cards: CardRow[];
  feedback: FeedbackRow[];
  nominations: NominationRow[];
  conflicts: ConflictRow[];
  exemptions: Array<{eventId:string;judgeId:string;teamId:string;reason:string}>;
  overrides: OverrideRow[];
  penalties: PenaltyRow[];
  inspections: Inspection[];
  races: RaceHeat[];
  racingSetup: RacingSetup;
  broadcasts: BroadcastEmail[];
  contacts: TeamContact[];
  mail: ResultMailState;
  snapshot: SnapshotRow;
  snapshotInputs: unknown;
}

/**
 * An in-memory backend mirroring the database permissions.
 * Used by tests. Where several rules could fail at once, permission is checked first.
 */
export class MemoryApi implements Api {
  private schedules=new Map<string,ScheduleState>();
  async schedulingState(eventId:string) {
    this.require(eventId,'organiser','chair','spectator');
    const state=copy(this.schedules.get(eventId)??{revision:0,draft:emptySchedule(),published:null,publishedAt:null,issues:[],history:[]});
    state.issues=validateSchedule(state.draft,this.teams.filter(t=>t.eventId===eventId));return {...state,judgeExemptions:this.exemptions.filter(x=>x.eventId===eventId&&this.visibleIdentity(x.judgeId,null)).map(x=>({teamId:x.teamId,judgeName:this.roles.find(r=>r.userId===x.judgeId)?.name??'Assigned judge',reason:x.reason}))};
  }
  async saveSchedule(eventId:string,revision:number,document:ScheduleDoc) {
    this.require(eventId,'organiser','chair');
    const state=await this.schedulingState(eventId);if(state.revision!==revision)throw new ApiError('conflict','Schedule changed; reload before saving');
    const issues=validateSchedule(document,this.teams.filter(t=>t.eventId===eventId));
    if(issues.some(i=>['capacity','duplicate','allocation'].includes(i.code)))throw new ApiError('invalid','Stream allocations are invalid or exceed capacity');
    state.draft=copy(document);state.revision++;state.issues=issues;state.history.unshift({revision:state.revision,action:'save',at:new Date().toISOString()});this.schedules.set(eventId,state);
  }
  async publishSchedule(eventId:string,revision:number) {
    this.require(eventId,'organiser','chair');const state=await this.schedulingState(eventId);
    if(state.revision!==revision)throw new ApiError('conflict','Save and review the current draft before publishing');
    if(state.issues.some(i=>i.severity==='error'))throw new ApiError('locked','Resolve blocking schedule errors before publication');
    state.published=copy(state.draft);state.publishedAt=new Date().toISOString();state.revision++;state.history.unshift({revision:state.revision,action:'publish',at:state.publishedAt});this.schedules.set(eventId,state);
  }
  async mySchedule(eventId:string) {
    this.require(eventId,'team_manager');const state=this.schedules.get(eventId),doc=state?.published;
    return {timezone:doc?.timezone??'Asia/Kolkata',publishedAt:state?.publishedAt??null,teams:this.teams.filter(t=>t.eventId===eventId&&this.rolesOf(eventId).some(r=>r.role==='team_manager'&&r.teamId===t.id)).map(t=>({teamId:t.id,stream:doc?.streams.find(s=>doc.allocations.some(a=>a.teamId===t.id&&a.streamId===s.id))?.name??null,activities:doc?teamActivities(doc,t.id).map(a=>({...copy(a),teamIds:a.scope==='teams'?[t.id]:[],resourceNames:a.resourceIds.map(id=>doc.resources.find(r=>r.id===id)?.name??'Resource')})):[]}))};
  }
  private guideProgress = new Map<string, {watched: number; at: number; complete: boolean}>();
  async submissionGuideState(eventId: string): Promise<SubmissionGuideState> {
    this.require(eventId,'organiser','chair','team_manager');
    const progress = this.guideProgress.get(this.me!.userId);
    return {version:SUBMISSION_GUIDE_VERSION,duration:SUBMISSION_GUIDE_DURATION,watchedSeconds:progress?.watched??0,complete:progress?.complete??false,required:!this.has(eventId,'organiser','chair')&&this.me!.email.trim().toLowerCase()!=='supercharged@british-school.org'};
  }
  async recordSubmissionGuideProgress(eventId: string, position: number): Promise<SubmissionGuideState> {
    await this.submissionGuideState(eventId);
    if (!Number.isFinite(position) || position<0 || position>SUBMISSION_GUIDE_DURATION) throw new ApiError('invalid','Invalid guide position');
    const id=this.me!.userId, now=Date.now();
    const progress=this.guideProgress.get(id)??{watched:0,at:now,complete:false};
    if (!progress.complete && position>=progress.watched && position-progress.watched<=Math.min((now-progress.at)/1000,15)+0.5) {
      progress.at=Math.max(now,progress.at+(position-progress.watched)*1000);progress.watched=position;progress.complete=position>=SUBMISSION_GUIDE_DURATION-0.001;
    }
    this.guideProgress.set(id,progress);
    return this.submissionGuideState(eventId);
  }
  private async requireSubmissionGuide(eventId:string) {
    const state=await this.submissionGuideState(eventId);
    if(state.required&&!state.complete)throw new ApiError('guide-required','Watch the full submission guide before uploading.');
  }
  private submissionRules=new Map<string,{revision:number;rules:SubmissionRule[]}>();
  private submittedTimes=new Map<string,string>();
  private submissionRows(eventId:string) {
    const state=this.submissionRules.get(eventId)??{revision:0,rules:PORTFOLIOS.map(kind=>({kind,deadline:null,pointsPerHour:5}))};
    const time=this.released(eventId)?Date.parse(this.snapshots.filter(s=>s.eventId===eventId).at(-1)?.createdAt??new Date().toISOString()):Date.now();
    return {...copy(state),rows:this.teams.filter(t=>t.eventId===eventId).flatMap(t=>state.rules.map(r=>submissionRow(t.id,r,this.submittedTimes.get(`${eventId}:${t.id}:${r.kind}`)??null,time)))};
  }
  async sendSubmissionConfirmation(eventId:string,teamId:string,kind:import('./submissions').PortfolioKind,revision:number) {
    this.require(eventId,'organiser','chair','team_manager');
    if(!this.has(eventId,'organiser','chair')&&!this.rolesOf(eventId).some(r=>r.role==='team_manager'&&r.teamId===teamId))throw new ApiError('forbidden','Only your own team');
    if(!this.teamFiles.some(f=>f.eventId===eventId&&f.teamId===teamId&&f.kind===kind&&f.revision===revision))throw new ApiError('locked','Successful portfolio upload required');
  }
  async submissionState(eventId:string) {
    this.require(eventId,'organiser','chair','spectator','team_manager');
    const state=this.submissionRows(eventId);
    if(!this.has(eventId,'organiser','chair','spectator'))state.rows=state.rows.filter(row=>this.rolesOf(eventId).some(r=>r.role==='team_manager'&&r.teamId===row.teamId));
    return state;
  }
  async saveSubmissionRules(eventId:string,revision:number,rules:SubmissionRule[]) {
    this.require(eventId,'organiser','chair');this.frozen(eventId,'submission rules');validateSubmissionRules(rules);
    if((this.submissionRules.get(eventId)?.revision??0)!==revision)throw new ApiError('conflict','Submission rules changed. Reload and try again.');
    this.submissionRules.set(eventId,{revision:revision+1,rules:copy(rules)});this.version++;
  }
  private checkSubmissionPenalties(eventId:string,inputs:unknown) {
    if(!this.submissionRules.get(eventId)?.rules.some(r=>r.deadline))return;
    const norm=(rows:Array<{teamId:string;points:number}>)=>JSON.stringify(rows.map(r=>({teamId:r.teamId,points:r.points})).sort((a,b)=>a.teamId.localeCompare(b.teamId)||a.points-b.points));
    const actual=(inputs as {penalties?:Array<{teamId:string;points:number}>})?.penalties??[];
    if(norm([...this.penalties.filter(p=>p.eventId===eventId),...this.automaticPenalties(eventId)])!==norm(actual))throw new ApiError('locked','Submission penalties changed; refresh and publish rankings again.');
  }
  private automaticPenalties(eventId:string) {return this.submissionRows(eventId).rows.filter(r=>r.points>0).map(r=>({id:`submission:${r.teamId}:${r.kind}`,eventId,teamId:r.teamId,points:r.points,reason:`Automatic submission penalty · ${r.kind}`}));}
  private showcaseMode = false;
  private teamFiles: Array<TeamFile & {base64:string}> = [];
  private readsTeamFile(file: TeamFile): boolean {
    if(this.has(file.eventId,'organiser','chair','spectator'))return true;
    if(this.rolesOf(file.eventId).some(r=>r.role==='team_manager' && r.teamId===file.teamId))return true;
    if(this.conflicted(file.eventId,file.teamId)||this.exemptions.some(x=>x.eventId===file.eventId&&x.teamId===file.teamId&&x.judgeId===this.me?.userId))return false;
    const panel=FILE_PANEL[file.kind];
    return panel===null ? this.rolesOf(file.eventId).some(r=>r.role!=='team_manager') : this.canScore(file.eventId,panel,file.teamId)||this.rolesOf(file.eventId).some(r=>r.role==='lead_judge'&&r.panel===panel);
  }
  async listTeamFiles(eventId:string) {
    this.require(eventId,'organiser','chair','spectator','judge','lead_judge','scrutineer','race_official','team_manager');
    return copy(this.teamFiles.filter(f=>f.eventId===eventId&&this.readsTeamFile(f)).map(({base64,...metadata})=>metadata));
  }
  async uploadTeamFile(eventId:string,teamId:string,revision:number,input:TeamFileInput) {
    this.require(eventId,'organiser','chair','team_manager');this.frozen(eventId,'team files');this.teamOrThrow(eventId,teamId);
    if(!this.has(eventId,'organiser','chair')&&!this.rolesOf(eventId).some(r=>r.role==='team_manager'&&r.teamId===teamId))throw new ApiError('forbidden','Only your own team');
    await this.requireSubmissionGuide(eventId);
    const size=validateTeamFile(input),old=this.teamFiles.find(f=>f.eventId===eventId&&f.teamId===teamId&&f.kind===input.kind);
    if((old?.revision??0)!==revision)throw new ApiError('conflict','File changed');
    const file={...copy(input),name:input.name.trim(),id:old?.id??nid('file'),eventId,teamId,size,revision:revision+1,updatedAt:new Date().toISOString()};
    this.teamFiles=this.teamFiles.filter(f=>f.id!==file.id);this.teamFiles.push(file);
    const key=`${eventId}:${teamId}:${input.kind}`;if(input.kind!=='logo'&&!this.submittedTimes.has(key))this.submittedTimes.set(key,file.updatedAt);this.version++;
  }
  async downloadTeamFile(eventId:string,id:string) {
    const file=this.teamFiles.find(f=>f.eventId===eventId&&f.id===id);
    if(!file||!this.readsTeamFile(file))throw new ApiError('forbidden','File unavailable');return copy(file);
  }
  private scopes = new Map<string, InspectionScope>();
  async getInspectionScope(eventId: string): Promise<InspectionScope> {
    this.require(eventId,'organiser','chair','spectator','judge','lead_judge','scrutineer','race_official','team_manager');
    return copy({...this.scopes.get(eventId)??{revision:0,articles:null},locked:this.inspections.some(i=>i.eventId===eventId)});
  }
  async saveInspectionScope(eventId: string, revision: number, articles: string[] | null) {
    this.require(eventId,'organiser','chair');this.frozen(eventId,'inspection setup');
    const old=await this.getInspectionScope(eventId);
    if(old.locked) throw new ApiError('locked','Inspection scope is pinned once inspections begin');
    if(old.revision!==revision) throw new ApiError('conflict','Scope changed');
    if(articles!==null && (!Array.isArray(articles)||!articles.length||new Set(articles).size!==articles.length||articles.some(a=>!INDIA_TECHNICAL.rules.some(r=>r.article===a)))) throw new ApiError('invalid','Select valid regulations');
    const value={revision:revision+1,articles:copy(articles),locked:false};this.scopes.set(eventId,value);return copy(value);
  }
  private concerns: TeamConcern[] = [];
  async listTeamConcerns(eventId: string) {
    this.require(eventId, 'organiser', 'chair', 'spectator', 'team_manager');
    const staff = this.has(eventId, 'organiser', 'chair', 'spectator');
    const teams = this.rolesOf(eventId).filter(r => r.role === 'team_manager').map(r => r.teamId);
    return copy(this.concerns.filter(c => c.eventId === eventId && (staff || teams.includes(c.teamId))).slice().reverse());
  }
  async submitTeamConcern(eventId: string, teamId: string, panel: Panel, message: string) {
    this.require(eventId, 'team_manager');
    if (!this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId)) throw new ApiError('forbidden', 'Only your own team');
    this.teamOrThrow(eventId, teamId);
    if (!PANELS.includes(panel)) throw new ApiError('invalid', 'Invalid panel');
    message = this.text(message, 'Concern', 4000);
    this.concerns.push({id: nid('concern'), eventId, teamId, panel, message, status: 'open', response: '', createdAt: new Date().toISOString()});
  }
  async resolveTeamConcern(eventId: string, id: string, response: string) {
    this.require(eventId, 'organiser', 'chair');
    const concern = this.concerns.find(c => c.id === id && c.eventId === eventId);
    if (!concern) throw new ApiError('invalid', 'Concern not found');
    response = this.text(response, 'Response', 4000);
    if (concern.status !== 'open') throw new ApiError('locked', 'Already resolved');
    concern.response = response; concern.status = 'resolved';
  }

  /** This instance has no reference to the shared backend or persistent browser storage. */
  static forShowcase(source: ShowcaseSeed): MemoryApi {
    const seed = copy(source);
    const api = new MemoryApi();
    api.me = { userId: `showcase:${crypto.randomUUID()}`, email: 'presenter@showcase.invalid' };
    api.events = [{ ...seed.event, resultsReleased: false }];
    api.teams = seed.teams;
    api.roles = [...seed.roles, {
      id: nid('showcase-role'), eventId: seed.event.id, userId: api.me.userId,
      email: api.me.email, name: 'Showcase presenter', role: 'organiser', panel: null, teamId: null,
    }];
    api.invites = seed.invitations;
    api.cards = seed.cards;
    for (const {cardId, ...feedback} of seed.feedback) api.reviews.set(cardId, { ...blankReview(), ...feedback });
    for (const n of seed.nominations) {
      const review = api.reviews.get(n.cardId) ?? blankReview();
      review.nominations = n.nominations;
      api.reviews.set(n.cardId, review);
    }
    api.conflicts = seed.conflicts;
    api.exemptions = seed.exemptions;
    api.overrides = seed.overrides;
    api.penalties = seed.penalties;
    api.inspections = seed.inspections;
    api.races = seed.races;
    api.racingSetups.set(seed.event.id, seed.racingSetup);
    api.broadcasts = seed.broadcasts;
    for (const contact of seed.contacts) api.contacts.set(contact.teamId, contact);
    api.awards = seed.mail.awards.map(a => ({ ...a, eventId: seed.event.id }));
    api.mailSettings.set(seed.event.id, { confirmed: seed.mail.confirmed, version: seed.mail.version ?? nid('showcase-awards') });
    api.snapshots = [{ ...seed.snapshot, released: true }];
    api.snapshotInputs.set(seed.snapshot.id, seed.snapshotInputs);
    api.snapshotVersion.set(seed.snapshot.id, api.version);
    api.showcaseMode = true;

    // Seed demo photos for showcase teams so Media Assets & Broadcast graphics are populated immediately
    seed.teams.forEach((t, i) => {
      const approved = i < 16;
      const processing = i === 16;
      api.teamPhotos.push({
        id: `showcase-photo-${t.id}`,
        teamId: t.id,
        eventId: seed.event.id,
        revision: 1,
        version: 1,
        originalName: `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_team_photo.jpg`,
        originalMime: 'image/jpeg',
        originalSize: 4200000,
        originalWidth: 3840,
        originalHeight: 2160,
        originalPath: `team-photos/${seed.event.id}/${t.id}/v1/original.jpg`,
        originalBase64: DEFAULT_SAMPLE_CUTOUT,
        processedPath: approved ? `team-photos/${seed.event.id}/${t.id}/v1/cutout.png` : null,
        processedSize: approved ? 1800000 : null,
        processedWidth: approved ? 3840 : null,
        processedHeight: approved ? 2160 : null,
        processedBase64: approved ? DEFAULT_SAMPLE_CUTOUT : undefined,
        approvedPath: approved ? `team-photos/${seed.event.id}/${t.id}/v1/approved.png` : null,
        approvedSize: approved ? 1800000 : null,
        approvedWidth: approved ? 3840 : null,
        approvedHeight: approved ? 2160 : null,
        approvedBase64: approved ? DEFAULT_SAMPLE_CUTOUT : undefined,
        processingStatus: approved ? 'completed' : (processing ? 'processing' : 'pending'),
        approvalStatus: approved ? 'approved' : 'pending',
        processingError: null,
        retryCount: 0,
        mediaConsent: true,
        uploadedAt: new Date().toISOString(),
        processedAt: approved ? new Date().toISOString() : null,
        approvedAt: approved ? new Date().toISOString() : null,
        approvedBy: approved ? api.me?.userId ?? null : null,
        correctionNotes: null,
        hasOriginal: true,
        hasProcessed: approved,
        hasApproved: approved,
      });

      api.compulsoryAssets.set(`${seed.event.id}:${t.id}`, {
        eventId: seed.event.id,
        teamId: t.id,
        teamLogo: {
          name: 'team_logo.svg',
          mime: 'image/svg+xml',
          size: 14500,
          updatedAt: new Date().toISOString(),
        },
        carRenderFL: {
          name: 'car_render_front_left.png',
          mime: 'image/png',
          size: 2450000,
          width: 3840,
          height: 2160,
          base64: DEFAULT_SAMPLE_CUTOUT,
          updatedAt: new Date().toISOString(),
        },
        carRenderFR: {
          name: 'car_render_front_right.png',
          mime: 'image/png',
          size: 2420000,
          width: 3840,
          height: 2160,
          base64: DEFAULT_SAMPLE_CUTOUT,
          updatedAt: new Date().toISOString(),
        },
        carModel3D: {
          name: 'competition_car_v2.obj',
          mime: 'model/obj',
          size: 420000,
          updatedAt: new Date().toISOString(),
        },
        modelMaterials: {
          name: 'materials_and_textures.zip',
          mime: 'application/zip',
          size: 1850000,
          updatedAt: new Date().toISOString(),
        },
        officialPhoto: api.teamPhotos.find(p => p.teamId === t.id),
        teamColours: {
          primary: '#E6007E',
          secondary: '#312783',
          accent: '#FCBC00',
        },
        memberPortraits: [
          { id: `mem-1-${t.id}`, name: 'Aarav Sharma', role: 'Team Principal & Strategy', fileName: 'aarav_sharma.jpg', photoBase64: DEFAULT_SAMPLE_CUTOUT, photoMime: 'image/jpeg', updatedAt: new Date().toISOString() },
          { id: `mem-2-${t.id}`, name: 'Ananya Patel', role: 'Lead Design Engineer', fileName: 'ananya_patel.jpg', photoBase64: DEFAULT_SAMPLE_CUTOUT, photoMime: 'image/jpeg', updatedAt: new Date().toISOString() },
          { id: `mem-3-${t.id}`, name: 'Rohan Mehta', role: 'Aerodynamicist & Manufacturing', fileName: 'rohan_mehta.jpg', photoBase64: DEFAULT_SAMPLE_CUTOUT, photoMime: 'image/jpeg', updatedAt: new Date().toISOString() },
          { id: `mem-4-${t.id}`, name: 'Diya Iyer', role: 'Graphics & Telemetry Analyst', fileName: 'diya_iyer.jpg', photoBase64: DEFAULT_SAMPLE_CUTOUT, photoMime: 'image/jpeg', updatedAt: new Date().toISOString() },
        ],
      });
    });

    return api;
  }
  private me: Session | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  private events: EventRow[] = [];
  private deletedEvents = new Set<string>();
  private roles: RoleRow[] = [];
  private invites: InviteRow[] = [];
  private teams: TeamRow[] = [];
  private compulsoryAssets = new Map<string, Partial<TeamCompulsoryAssets>>();
  private exemptions: {eventId:string;judgeId:string;teamId:string;reason:string}[]=[];
  private conflicts: { eventId: string; judgeId: string; teamId: string }[] = [];
  private cards: CardRow[] = [];
  private races: RaceHeat[] = [];
  private racingSetups = new Map<string,RacingSetup>();
  private broadcasts: BroadcastEmail[] = [];
  private timing = new Map<string, TimingState>();
  private reviews = new Map<string, CardReview>();
  private overrides: OverrideRow[] = [];
  private penalties: PenaltyRow[] = [];
  private snapshots: SnapshotRow[] = [];
  private inspections: Inspection[] = [];
  private globalOrganisers: Array<{userId:string;email:string;scope:OrganiserScope;permanent:false;name?:string;identityRestricted?:boolean;contactRestricted?:boolean}>=[];
  private organiserInvites: PlatformAccess['invitations']=[];
  private globalManager() { return this.me?.email==='reyanshg11111@gmail.com' || this.globalOrganisers.some(r=>r.userId===this.me?.userId && r.scope==='platform'); }
  private visibleIdentity(userId:string,email?:string|null) {return this.me?.email==='reyanshg11111@gmail.com'||(!this.globalOrganisers.some(p=>p.identityRestricted&&(p.userId===userId||p.email===email))&&!this.organiserInvites.some(i=>i.identityRestricted&&i.email===email));}
  private requireGlobal() { if(!this.globalManager()) throw new ApiError('forbidden','Only Platform Organisers can manage organiser access'); }
  async platformAccess(): Promise<PlatformAccess> {
    return copy({kind:this.me?.email==='reyanshg11111@gmail.com'?'admin':this.globalOrganisers.find(r=>r.userId===this.me?.userId)?.scope??null,
      ownerEmail:'reyanshg11111@gmail.com',canManage:this.globalManager(),
      viewerId:this.me?.userId??null,ownerId:'user:reyanshg11111@gmail.com',organisers:(this.globalManager()||this.globalOrganisers.some(p=>p.userId===this.me?.userId&&p.scope==='spectator'))?[{userId:'user:reyanshg11111@gmail.com',email:'reyanshg11111@gmail.com',scope:'admin',permanent:true},...this.globalOrganisers.filter(p=>!p.identityRestricted||this.me?.email==='reyanshg11111@gmail.com')]:[],
      invitations:this.globalManager()?this.organiserInvites.filter(i=>this.me?.email==='reyanshg11111@gmail.com'||(!i.identityRestricted&&i.scope!=='spectator')):[]});
  }
  async inviteOrganiser(email: string,scope: OrganiserScope,options?:{name?:string;hidden?:boolean}) {
    this.requireGlobal();email=email.trim().toLowerCase();
    if((options?.hidden||scope==='spectator')&&this.me?.email!=='reyanshg11111@gmail.com')throw new ApiError('forbidden','Only Platform Admin');
    if(options?.hidden&&!options.name?.trim())throw new ApiError('invalid','Name required for hidden account');
    if(!EMAIL.test(email)||!['competition','platform','spectator'].includes(scope))throw new ApiError('invalid','Choose a valid email and scope');
    if(email==='reyanshg11111@gmail.com')throw new ApiError('forbidden','The permanent platform administrator cannot be changed');
    if(this.organiserInvites.some(i=>i.email===email)||this.globalOrganisers.some(i=>i.email===email))throw new ApiError('duplicate','Organiser already invited or assigned');
    this.organiserInvites.push({id:nid('organiser-invite'),email,scope,emailStatus:'sent',name:options?.name?.trim()??'',identityRestricted:options?.hidden??false});
  }
  async setOrganiserVisibility(userId:string,name:string,hidden:boolean) {
    if(this.me?.email!=='reyanshg11111@gmail.com')throw new ApiError('forbidden','Only Platform Admin');
    const person=this.globalOrganisers.find(p=>p.userId===userId);
    if(!person||name.trim().length>100||(hidden&&!name.trim()))throw new ApiError('invalid','Choose a valid organiser and name');
    person.name=name.trim();person.identityRestricted=hidden;person.contactRestricted=hidden;
  }
  async removeOrganiser(userId:string) {
    this.requireGlobal();if(userId==='user:reyanshg11111@gmail.com')throw new ApiError('forbidden','The permanent platform administrator cannot be removed');
    const person=this.globalOrganisers.find(r=>r.userId===userId);if((person?.identityRestricted||person?.scope==='spectator')&&this.me?.email!=='reyanshg11111@gmail.com')throw new ApiError('forbidden','Only Platform Admin');
    this.globalOrganisers=this.globalOrganisers.filter(r=>r.userId!==userId);
  }
  async withdrawOrganiserInvitation(id:string) { this.requireGlobal();const invitation=this.organiserInvites.find(i=>i.id===id);if((invitation?.identityRestricted||invitation?.scope==='spectator')&&this.me?.email!=='reyanshg11111@gmail.com')throw new ApiError('forbidden','Only Platform Admin');this.organiserInvites=this.organiserInvites.filter(i=>i.id!==id); }
  private contacts=new Map<string,TeamContact>();
  private awards:Array<EventAward & {eventId:string}>=[];
  private mailSettings=new Map<string,{confirmed:boolean;version:string}>();
  private mailDeliveries:Array<ResultMailState['deliveries'][number] & {eventId:string;snapshotId:string;version:string}>=[];
  async listTeamContacts(eventId:string) {this.require(eventId,'chair','organiser','spectator');return copy([...this.contacts.values()].filter(c=>this.teams.some(t=>t.id===c.teamId && t.eventId===eventId)));}
  private storeContact(eventId:string,teamId:string,email:string) {
    if(!email){this.contacts.delete(teamId);return;}
    this.contacts.set(teamId,{teamId,managerEmail:email});
    if(!this.roles.some(r=>r.eventId===eventId && r.teamId===teamId && r.role==='team_manager' && r.email===email) && !this.invites.some(i=>i.eventId===eventId && i.teamId===teamId && i.role==='team_manager' && i.email===email))this.invites.push({id:nid('invite'),eventId,teamId,email,role:'team_manager',panel:null,emailStatus:'not_sent'});
  }
  async setTeamContact(eventId:string,teamId:string,email:string) {
    this.require(eventId,'chair','organiser');this.teamOrThrow(eventId,teamId);email=email.trim().toLowerCase();
    if(email && !validManagerEmail(email))throw new ApiError('invalid','Enter a valid manager email');
    this.storeContact(eventId,teamId,email);
  }
  async resultMailState(eventId:string):Promise<ResultMailState> {
    this.require(eventId,'chair','organiser','spectator');const setting=this.mailSettings.get(eventId);const snapshot=this.snapshots.filter(s=>s.eventId===eventId).at(-1);
    return copy({confirmed:setting?.confirmed??false,version:setting?.version??null,snapshotId:snapshot?.id??null,awards:this.awards.filter(a=>a.eventId===eventId).map(({id,title,teamId})=>({id,title,teamId})),deliveries:this.mailDeliveries.filter(d=>d.eventId===eventId && d.snapshotId===snapshot?.id && d.version===setting?.version).map(({teamId,email,status,sentAt})=>({teamId,email,status,sentAt}))});
  }
  async saveAward(eventId:string,title:string,teamId:string) {
    this.require(eventId,'chair','organiser');this.teamOrThrow(eventId,teamId);title=this.text(title,'Award title',120);
    const existing=this.awards.find(a=>a.eventId===eventId && a.title.toLowerCase()===title.toLowerCase());
    if(existing)existing.teamId=teamId;else this.awards.push({id:nid('award'),eventId,title,teamId});
    this.mailSettings.set(eventId,{confirmed:false,version:this.mailSettings.get(eventId)?.version??nid('awards-version')});
  }
  async removeAward(id:string) {const a=this.awards.find(a=>a.id===id);if(!a)throw new ApiError('forbidden','Award unavailable');this.require(a.eventId,'chair','organiser');this.awards=this.awards.filter(x=>x.id!==id);this.mailSettings.set(a.eventId,{confirmed:false,version:this.mailSettings.get(a.eventId)?.version??nid('awards-version')});}
  async confirmAwards(eventId:string) {this.require(eventId,'chair','organiser');const old=this.mailSettings.get(eventId);this.mailSettings.set(eventId,{confirmed:true,version:old?.confirmed?old.version:nid('awards-version')});}
  async previewResultsPacket(eventId:string,teamId:string):Promise<ResultsPacket> {
    this.require(eventId,'chair','organiser','spectator');const event=this.eventOrThrow(eventId),team=this.teamOrThrow(eventId,teamId);const snapshot=this.snapshots.filter(s=>s.eventId===eventId).at(-1);const row=snapshot?.rows.find(r=>r.teamId===teamId);
    if(!snapshot||!row)throw new ApiError('locked','Publish a ranking containing this team first');
    return copy({branding:await this.eventBranding(eventId),released:event.resultsReleased,awardsConfirmed:this.mailSettings.get(eventId)?.confirmed??false,eventName:event.name,eventId,snapshotId:snapshot.id,createdAt:snapshot.createdAt,ruleset:event.ruleset,team,teamResult:row,
      standings:snapshot.rows.map(({rank,teamId,number,name,total})=>({rank,teamId,number,name,total,school:this.teams.find(t=>t.id===teamId)?.school??''})),
      benchmarks:Object.fromEntries([...event.ruleset.areas.map(a=>a.id),'__total'].flatMap(key=>{
        const values=snapshot.rows.map(r=>key==='__total'?r.total:r.areas[key]).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);
        return values.length?[[key,{low:values[0],median:(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2,high:values.at(-1)!}]]:[];
      })),
      races:this.races.filter(r=>r.eventId===eventId).flatMap(r=>[r.lane1,r.lane2].flatMap((lane,i)=>lane.teamId===teamId&&lane.status!=='pending'?[{number:r.number,label:r.label,phase:r.phase,lane:i+1,car:lane.car,status:lane.status,totalMs:lane.totalMs,reactionMs:lane.reactionMs}]:[])),
      awards:this.awards.filter(a=>a.eventId===eventId).map(a=>{const t=this.teamOrThrow(eventId,a.teamId);return {title:a.title,teamNumber:t.number,teamName:t.name,teamSchool:t.school};}),
      cards:this.cards.filter(c=>c.eventId===eventId && c.teamId===teamId && c.status==='submitted').map(c=>{const r=this.reviews.get(c.id);return {areaId:c.areaId,scores:c.scores,feedback:{overall:r?.overall??'',strengths:r?.strengths??'',improvements:r?.improvements??''}};}),
      penalties:[...this.penalties.filter(p=>p.eventId===eventId),...this.automaticPenalties(eventId)].filter(p=>p.teamId===teamId).map(({points,reason})=>({points,reason})),
      inspections:this.inspections.filter(i=>i.eventId===eventId && i.teamId===teamId && i.status==='submitted').map(i=>({car:i.car,rulesetId:i.rulesetId,selectedArticles:i.selectedArticles,measurements:i.measurements as ResultsPacket['inspections'][number]['measurements']}))});
  }
  async sendTeamResults(eventId:string,teamId:string,selection:ResultMailSelection):Promise<'sent'|'already_sent'> {
    this.require(eventId,'chair','organiser');if(!this.released(eventId))throw new ApiError('locked','Release results first');
    const settings=this.mailSettings.get(eventId);if(!settings?.confirmed)throw new ApiError('locked','Confirm awards first');
    const contact=this.contacts.get(teamId);if(!contact)throw new ApiError('invalid','Add a manager email');
    const packet=await this.previewResultsPacket(eventId,teamId);
    if(selection.snapshotId!==packet.snapshotId||selection.awardsVersion!==settings.version||selection.email!==contact.managerEmail)throw new ApiError('locked','Results or recipient changed; review again');
    if(this.mailDeliveries.some(d=>d.snapshotId===packet.snapshotId && d.version===settings.version && d.teamId===teamId && d.email===contact.managerEmail && d.status==='sent'))return 'already_sent';
    this.mailDeliveries.push({eventId,teamId,snapshotId:packet.snapshotId,version:settings.version,email:contact.managerEmail,status:'sent',sentAt:new Date().toISOString()});return 'sent';
  }
  async acknowledgeResultRetry(eventId:string,teamId:string,selection:ResultMailSelection) {this.require(eventId,'chair','organiser');const d=this.mailDeliveries.find(d=>d.eventId===eventId&&d.teamId===teamId&&d.snapshotId===selection.snapshotId&&d.version===selection.awardsVersion&&d.email===selection.email);if(!d||d.status!=='uncertain')throw new ApiError('locked','No unconfirmed delivery');d.status='failed';}
  private creatorAllowlist = new Set<string>();
  private inspectionHistory: Array<{
    id: string; inspectionId: string; changedBy: string; changedAt: string;
    previousMeasurements: Measurements; previousStatus: InspectionStatus; reason: string; revision: number;
  }> = [];
  /**
   * Counts every change to what a ranking counts (card submitted or reopened, override set or removed, penalty added or
   * removed, team added). A snapshot remembers the value it was published at: the database compares timestamps and counts
   * to the same end (release_results()).
   */
  private version = 0;
  private snapshotVersion = new Map<string, number>();
  /** Snapshot inputs live apart from the rows so no read path can leak them by accident. */
  private snapshotInputs = new Map<string, unknown>();
  private mfaFactors = new Map<string, Array<{ id: string; factorType: 'totp'; status: 'verified' | 'unverified'; friendlyName?: string; createdAt: string; secret: string; uri: string }>>();
  private mfaAssurance = new Map<string, { current: 'aal1' | 'aal2'; next: 'aal1' | 'aal2' }>();

  // ---- session
  async getSession() { return this.me ? { ...this.me } : null; }
  async signIn(email: string) {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new ApiError('invalid', 'Enter a valid email address');
    const userId = `user:${e}`;
    this.setSession({ userId, email: e });
    const factors = this.mfaFactors.get(userId) ?? [];
    const hasVerified = factors.some((f) => f.status === 'verified');
    this.mfaAssurance.set(userId, { current: 'aal1', next: hasVerified ? 'aal2' : 'aal1' });
  }
  async verifyEmailCode(_email: string, _code: string) { throw new ApiError('invalid-auth', 'Demo mode does not issue email codes'); }
  async verifyEmailLink(_tokenHash: string) { throw new ApiError('invalid-auth', 'Demo mode does not issue email links'); }
  async signOut() {
    if (this.me) this.mfaAssurance.delete(this.me.userId);
    this.setSession(null);
  }
  onAuthChange(cb: (s: Session | null) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  async getMfaStatus(): Promise<MfaStatus> {
    if (!this.me) return { enabled: false, factors: [], currentLevel: null, nextLevel: null };
    const factors = (this.mfaFactors.get(this.me.userId) ?? []).map((f) => ({
      id: f.id,
      factorType: f.factorType,
      status: f.status,
      friendlyName: f.friendlyName,
      createdAt: f.createdAt,
    }));
    const verified = factors.filter((f) => f.status === 'verified');
    const level = this.mfaAssurance.get(this.me.userId) ?? { current: 'aal1', next: verified.length > 0 ? 'aal2' : 'aal1' };
    return {
      enabled: verified.length > 0,
      factors,
      currentLevel: level.current,
      nextLevel: level.next,
    };
  }
  async enrollTotp(friendlyName?: string): Promise<MfaEnrollResult> {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    const userId = this.me.userId;
    const userFactors = this.mfaFactors.get(userId) ?? [];
    const cleaned = userFactors.filter((f) => f.status === 'verified');
    const id = `factor_${Math.random().toString(36).slice(2, 10)}`;
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = `otpauth://totp/STEM%20Racing%20India:${encodeURIComponent(this.me.email)}?secret=${secret}&issuer=STEM%20Racing%20India`;
    const qrCode = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200"><rect width="100" height="100" fill="#fff"/><rect x="10" y="10" width="30" height="30" fill="#000"/><rect x="60" y="10" width="30" height="30" fill="#000"/><rect x="10" y="60" width="30" height="30" fill="#000"/><rect x="45" y="45" width="10" height="10" fill="#000"/></svg>`;
    cleaned.push({
      id,
      factorType: 'totp',
      status: 'unverified',
      friendlyName: friendlyName?.trim() || 'Authenticator App',
      createdAt: new Date().toISOString(),
      secret,
      uri,
    });
    this.mfaFactors.set(userId, cleaned);
    return {
      id,
      factorType: 'totp',
      totp: {
        qrCode,
        secret,
        uri,
      },
    };
  }
  async verifyTotp(factorId: string, code: string): Promise<void> {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    const token = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) {
      throw new ApiError('invalid', 'Enter a 6-digit verification code');
    }
    const userId = this.me.userId;
    const userFactors = this.mfaFactors.get(userId) ?? [];
    let factor = factorId ? userFactors.find((f) => f.id === factorId) : userFactors.find((f) => f.status === 'verified');
    if (!factor && !factorId && userFactors.length > 0) factor = userFactors[0];
    if (!factor) throw new ApiError('not-found', 'Factor not found');
    if (token === '000000') {
      throw new ApiError('invalid-auth', 'Invalid authenticator code. Check your app and try again.');
    }
    factor.status = 'verified';
    this.mfaAssurance.set(userId, { current: 'aal2', next: 'aal2' });
  }
  async unenrollTotp(factorId: string): Promise<void> {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    const userId = this.me.userId;
    const userFactors = this.mfaFactors.get(userId) ?? [];
    const next = userFactors.filter((f) => f.id !== factorId);
    this.mfaFactors.set(userId, next);
    if (!next.some((f) => f.status === 'verified')) {
      this.mfaAssurance.set(userId, { current: 'aal1', next: 'aal1' });
    }
  }
  private setSession(s: Session | null) {
    this.me = s;
    this.listeners.forEach((l) => l(s));
  }
  /** Signing in here stands for a verified address; invitations go only to the signed-in user's own email, once. */
  async claimInvitations() {
    if (!this.me) return 0;
    const me = this.me;
    const globals=this.organiserInvites.filter(i=>i.email===me.email);
    for(const i of globals) if(me.email!=='reyanshg11111@gmail.com') {
      const old=this.globalOrganisers.find(r=>r.userId===me.userId);
      if(old) {if(old.scope!=='platform')old.scope=i.scope;}
      else this.globalOrganisers.push({userId:me.userId,email:me.email,scope:i.scope,permanent:false,name:i.name,identityRestricted:i.identityRestricted,contactRestricted:i.identityRestricted});
    }
    this.organiserInvites=this.organiserInvites.filter(i=>!globals.includes(i));
    const mine = this.invites.filter((i) => i.email === me.email && !this.deletedEvents.has(i.eventId));
    for (const i of mine) {
      const dupe = this.roles.some((r) => r.eventId === i.eventId && r.userId === me.userId && r.role === i.role && r.panel === i.panel && r.teamId === i.teamId);
      if (!dupe) this.roles.push({ id: nid('role'), eventId: i.eventId, userId: me.userId, role: i.role, panel: i.panel, teamId: i.teamId, email: me.email, ...(i.name?{name:i.name}:{}) });
    }
    for(const i of mine) if(i.name) this.roles.filter(r=>r.eventId===i.eventId && r.userId===me.userId).forEach(r=>{r.name=i.name;});
    this.invites = this.invites.filter((i) => !mine.includes(i));
    return mine.length+globals.length;
  }

  // ---- helpers
  private rolesOf(eventId: string): RoleRow[] {
    if(!this.me || this.deletedEvents.has(eventId) || !this.events.some(e=>e.id===eventId))return [];
    if(this.globalOrganisers.some(r=>r.userId===this.me?.userId&&r.scope==='spectator'))return [{id:`spectator:${eventId}`,eventId,userId:this.me.userId,email:this.me.email,role:'spectator' as const,panel:null,teamId:null}];
    const rows=this.roles.filter(r=>r.eventId===eventId && r.userId===this.me!.userId);
    if(this.globalManager() || rows.some(r=>r.role==='organiser')) for(const role of ['organiser','chair'] as const) {
      if(role==='organiser' && !this.globalManager())continue;
      if(!rows.some(r=>r.role===role))rows.push({id:`effective:${eventId}:${this.me.userId}:${role}`,eventId,userId:this.me.userId,email:this.me.email,role,panel:null,teamId:null});
    }
    return rows;
  }
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
  setCreatorAllowlist(emails: string[]): void {
    this.creatorAllowlist = new Set(emails.map((e) => e.trim().toLowerCase()));
  }
  async canCreateEvent(): Promise<boolean> {
    if (!this.me) return false;
    if(this.globalOrganisers.some(r=>r.userId===this.me?.userId&&r.scope==='spectator'))return false;
    if (this.globalManager() || this.globalOrganisers.some(r=>r.userId===this.me!.userId&&r.scope!=='spectator')) return true;
    if (this.events.some((e) => !this.deletedEvents.has(e.id) && this.roles.some((r) => r.eventId === e.id && r.userId === this.me!.userId && r.role === 'organiser'))) {
      return true;
    }
    if (this.creatorAllowlist.has(this.me.email.toLowerCase())) return true;
    return false;
  }
  private eventLogoSets=new Map<string,EventLogos>();
  async eventBranding(eventId:string){const e=await this.getEvent(eventId);if(!e)throw new ApiError('forbidden','Event branding unavailable');return {level:e.competitionLevel??null,logos:copy(this.eventLogoSets.get(eventId)??null)};}
  async createEvent(i:NewEvent) {
    if (!this.me) throw new ApiError('unauthenticated', 'Sign in first');
    if (!(await this.canCreateEvent())) throw new ApiError('forbidden', 'Only organisers can create events');
    if(i.competitionLevel&&!['regional','national'].includes(i.competitionLevel))throw new ApiError('invalid','Choose Regional finals or National finals.');
    if(i.competitionLevel==='regional'&&i.logos)throw new ApiError('invalid','Regional events use the supplied regional logo.');
    const logos=i.competitionLevel==='national'?validateEventLogos(i.logos!):null;
    const name = this.text(i.name, 'Event name', 120);
    if (i.startsOn !== undefined) {
      const d = new Date(`${i.startsOn}T00:00:00Z`);
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(i.startsOn) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === i.startsOn;
      if (!ok) throw new ApiError('invalid', 'Start date must be a valid date (YYYY-MM-DD)');
    }
    const ev: EventRow = { ...(i.competitionLevel?{competitionLevel:i.competitionLevel}:{}),id: nid('event'), name, startsOn: i.startsOn ?? null, ruleset: copy(INDIA_2026), resultsReleased: false };
    if(logos)this.eventLogoSets.set(ev.id,copy(logos));
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
    return !!this.me && (this.globalManager() || this.roles.some((r) => r.eventId === eventId && r.userId === this.me!.userId && r.role === 'organiser'));
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
    if(this.racingSetups.has(eventId)) {
      const inputs=this.snapshotInputs.get(latest.id) as {racingIssues?:string[]}|undefined;
      if(!inputs?.racingIssues || inputs.racingIssues.length)throw new ApiError('locked','Finish racing setup and bracket before release');
    }
    this.checkSubmissionPenalties(eventId,this.snapshotInputs.get(latest.id));
    ev.resultsReleased = true;
  }

  // ---- roles and invitations
  async myRoles(eventId: string) { return copy(this.rolesOf(eventId)); }
  async listRoles(eventId: string) {
    return copy((this.has(eventId, 'chair', 'organiser', 'spectator') ? this.roles.filter((r) => r.eventId === eventId) : this.rolesOf(eventId)).filter(r=>this.visibleIdentity(r.userId,r.email)));
  }
  async listInvitations(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser', 'spectator') ? this.invites.filter((i) => i.eventId === eventId&&this.visibleIdentity('',i.email)) : []);
  }
  async invite(eventId: string, i: { name?: string; email: string; role: Role; panel?: Panel; teamId?: string }) {
    if (i.role === 'organiser') {
      this.require(eventId, 'organiser');
    } else {
      this.require(eventId, 'chair', 'organiser');
    }
    const email = (typeof i.email === 'string' ? i.email : '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new ApiError('invalid', 'Enter a valid email address');
    if (!ROLES.includes(i.role)) throw new ApiError('invalid', 'Choose a role');
    const isJudge = JUDGE_ROLES.includes(i.role);
    const name=(i.name??'').trim();
    if(name.length>100 || (isJudge && !name))throw new ApiError('invalid','Enter the judge’s name (up to 100 characters)');
    if (isJudge !== (i.panel !== undefined)) throw new ApiError('invalid', isJudge ? 'Choose a judging panel' : 'Only judges have a panel');
    if (i.panel !== undefined && !PANELS.includes(i.panel)) throw new ApiError('invalid', 'Choose a judging panel');
    if ((i.role === 'team_manager' && i.teamId === undefined) || (i.role !== 'judge' && i.role !== 'team_manager' && i.teamId !== undefined)) throw new ApiError('invalid', i.role === 'team_manager' ? 'Choose a team' : 'Only team managers have a team');
    if (i.teamId !== undefined && !this.teams.some((t) => t.id === i.teamId && t.eventId === eventId)) {
      throw new ApiError('invalid', 'That team is not part of this event');
    }
    const panel = i.panel ?? null;
    const teamId = i.teamId ?? null;
    if (this.invites.some((x) => x.eventId === eventId && x.email === email && x.role === i.role && x.panel === panel && x.teamId === teamId)) {
      throw new ApiError('duplicate', 'That person is already invited for this role');
    }
    this.invites.push({ id: nid('invite'), eventId, ...(name?{name}:{}), email, role: i.role, panel, teamId, emailStatus: 'sent', emailSentAt: new Date().toISOString(), emailFailure: null });
  }
  async listJudgeExemptions(eventId: string) {
    return copy(this.exemptions.filter(x=>x.eventId===eventId && !this.deletedEvents.has(eventId) && (this.has(eventId,'chair','organiser') || x.judgeId===this.me?.userId)));
  }
  async setJudgeExemption(eventId: string,userId: string,teamId: string,exempt: boolean,reason='') {
    this.require(eventId,'chair','organiser');this.teamOrThrow(eventId,teamId);
    if(!this.roles.some(r=>r.eventId===eventId && r.userId===userId) || reason.length>1000)throw new ApiError('invalid','Choose an event member and team');
    if(exempt && this.cards.some(c=>c.eventId===eventId && c.judgeId===userId && c.teamId===teamId && c.status==='submitted'))throw new ApiError('locked','Reopen submitted scorecards before exemption');
    this.exemptions=this.exemptions.filter(x=>x.eventId!==eventId || x.judgeId!==userId || x.teamId!==teamId);
    if(exempt)this.exemptions.push({eventId,judgeId:userId,teamId,reason:reason.trim()});
  }
  async setJudgeAssignment(eventId: string, userId: string, panel: Panel, teamIds: string[] | null) {
    this.require(eventId,'chair','organiser');
    const person=this.roles.find(r=>r.eventId===eventId && r.userId===userId);
    if(!person || !this.eventOrThrow(eventId).ruleset.areas.some(a=>a.kind==='scorecard' && a.panel===panel)) throw new ApiError('invalid','Choose an event member and panel');
    if(teamIds===null)teamIds=this.teams.filter(t=>t.eventId===eventId).map(t=>t.id);
    if(teamIds!==null && (!teamIds.length || teamIds.length>1000 || teamIds.some(t=>!this.teams.some(x=>x.id===t && x.eventId===eventId)))) throw new ApiError('invalid','Choose teams in this event');
    if(teamIds?.some(t=>this.conflicts.some(c=>c.eventId===eventId && c.judgeId===userId && c.teamId===t))) throw new ApiError('invalid','Judge has a declared conflict');
    const wanted=[...new Set(teamIds)];
    this.roles=this.roles.filter(r=>r.eventId!==eventId || r.userId!==userId || r.role!=='judge' || r.panel!==panel || (r.teamId!==null&&wanted.includes(r.teamId)));
    for(const teamId of wanted) if(!this.roles.some(r=>r.eventId===eventId && r.userId===userId && r.role==='judge' && r.panel===panel && r.teamId===teamId)) {
      this.roles.push({id:nid('role'),eventId,userId,role:'judge',panel,teamId,email:person.email,...(person.name?{name:person.name}:{})});
    }
  }
  private canScore(eventId: string, panel: Panel, teamId: string) {
    return (this.has(eventId,'organiser','chair') || this.rolesOf(eventId).some(r=>r.role==='judge' && r.panel===panel && r.teamId===teamId)) && !this.exemptions.some(x=>x.eventId===eventId && x.judgeId===this.me?.userId && x.teamId===teamId);
  }
  async drawLotsState(eventId:string):Promise<DrawLotsState>{
    this.require(eventId,'organiser','chair','spectator');
    const cards=this.cards.filter(c=>c.eventId===eventId);
    const state={teams:this.teams.filter(t=>t.eventId===eventId),roles:this.roles.filter(r=>r.eventId===eventId&&this.visibleIdentity(r.userId,r.email)),conflicts:this.conflicts.filter(c=>c.eventId===eventId),exemptions:this.exemptions.filter(x=>x.eventId===eventId),released:this.released(eventId),
      numberingLocked:this.released(eventId)||!!cards.length||this.inspections.some(i=>i.eventId===eventId)||this.races.some(r=>r.eventId===eventId)||this.snapshots.some(s=>s.eventId===eventId),lockedPanels:[...new Set([...cards.map(c=>c.panel),...(this.inspections.some(i=>i.eventId===eventId)?['scrutineering' as Panel]:[])])]};
    // Presentation copies can demonstrate setup draws without clearing their completed results.
    if (this.showcaseMode) { state.numberingLocked = state.released; state.lockedPanels = []; }
    return copy({...state,version:JSON.stringify(state)});
  }
  async applyTeamNumberDraw(eventId:string,version:string,assignments:TeamNumberAssignment[]){
    const state=await this.drawLotsState(eventId),n=state.teams.length;
    if(state.numberingLocked)throw new ApiError('locked','Numbering is locked after scoring or racing starts');
    if(version!==state.version)throw new ApiError('conflict','Draw data changed');
    const valid=Array.from({length:n},(_,i)=>String(i+1).padStart(3,'0'));
    if(!n||n>1000||assignments.length!==n||new Set(assignments.map(a=>a.teamId)).size!==n||new Set(assignments.map(a=>a.number)).size!==n||assignments.some(a=>!state.teams.some(t=>t.id===a.teamId)||!valid.includes(a.number)||(!this.showcaseMode&&state.teams.some(t=>t.id===a.teamId&&t.name.trim().toUpperCase()==='SUPERCHARGED'&&a.number!=='001'))))throw new ApiError('invalid','Invalid team number draw');
    for(const a of assignments)this.teams.find(t=>t.id===a.teamId)!.number=a.number;
    this.version++;
  }
  async applyJudgeDraw(eventId:string,version:string,panel:Panel,assignments:JudgeLotAssignment[]){
    const state=await this.drawLotsState(eventId),all=assignments.flatMap(a=>a.teamIds),n=state.teams.length;
    if(state.released||state.lockedPanels.includes(panel))throw new ApiError('locked','This panel has started judging');
    if(version!==state.version)throw new ApiError('conflict','Draw data changed');
    const sizes=assignments.map(a=>a.teamIds.length);
    if(!n||n>1000||!assignments.length||assignments.length>n||new Set(assignments.map(a=>a.judgeId)).size!==assignments.length||all.length!==n||new Set(all).size!==n||Math.max(...sizes)-Math.min(...sizes)>1||assignments.some(a=>!state.roles.some(r=>r.role==='judge'&&r.panel===panel&&r.userId===a.judgeId)||a.teamIds.some(id=>!state.teams.some(t=>t.id===id)||state.conflicts.some(c=>c.judgeId===a.judgeId&&c.teamId===id)||state.exemptions.some(x=>x.judgeId===a.judgeId&&x.teamId===id))))throw new ApiError('invalid','Invalid or conflicted judge draw');
    const next=this.roles.filter(r=>r.eventId!==eventId||r.role!=='judge'||r.panel!==panel||!assignments.some(a=>a.judgeId===r.userId));
    for(const a of assignments){const old=state.roles.find(r=>r.role==='judge'&&r.panel===panel&&r.userId===a.judgeId)!;for(const teamId of a.teamIds)next.push({...old,id:nid('role'),teamId});}
    this.roles=next;
  }
  async setJudgeName(eventId:string,userId:string,name:string) {
    this.require(eventId,'chair','organiser');name=this.text(name,'Judge name',100);
    const rows=this.roles.filter(r=>r.eventId===eventId && r.userId===userId);
    if(!rows.length)throw new ApiError('invalid','Invite this person first');
    rows.forEach(r=>{r.name=name;});
  }
  async removeRole(roleId: string) {
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) return;
    if (r.role === 'organiser') {
      this.require(r.eventId, 'organiser');
      const orgs = this.roles.filter((x) => x.eventId === r.eventId && x.role === 'organiser');
      if(r.userId==='user:reyanshg11111@gmail.com')throw new ApiError('forbidden','The permanent platform administrator cannot be removed');
      if (orgs.length <= 1 && !this.globalManager()) throw new ApiError('locked', 'An event must have at least one organiser');
    } else {
      this.require(r.eventId, 'chair', 'organiser');
    }
    this.roles = this.roles.filter((x) => x.id !== roleId);
  }
  async sendInvitation(inviteId: string) {
    const global=this.organiserInvites.find(i=>i.id===inviteId);
    if(global){this.requireGlobal();global.emailStatus='sent';return;}
    const invite=this.invites.find(i=>i.id===inviteId);
    if(!invite)throw new ApiError('not-found','Invitation no longer pending');
    this.require(invite.eventId,'chair','organiser');
    invite.emailStatus='sent';invite.emailSentAt=new Date().toISOString();invite.emailFailure=null;
  }
  async removeInvitation(inviteId: string) {
    const i = this.invites.find((x) => x.id === inviteId);
    if (!i) return;
    this.require(i.eventId, 'chair', 'organiser');
    this.invites = this.invites.filter((x) => x.id !== inviteId);
  }

  async queueReactionRaces(eventId:string) {
    this.require(eventId,'chair','organiser');this.frozen(eventId,'races');
    if(this.races.some(r=>r.eventId===eventId&&r.phase==='reaction')||this.racingSetups.get(eventId)?.reactionComplete)throw new ApiError('locked','Reaction racing already queued or locked');
    const ids=this.teams.filter(t=>t.eventId===eventId).sort((a,b)=>a.number.localeCompare(b.number)).map(t=>t.id);
    if(ids.length<1)throw new ApiError('invalid','At least one team required');
    for(const input of reactionPairings(ids))await this.saveRace(eventId,crypto.randomUUID(),0,input);
  }
  async getRacingSetup(eventId: string): Promise<RacingSetup> {
    this.require(eventId,'organiser','chair','spectator','judge','lead_judge','scrutineer','race_official');
    return copy({...this.racingSetups.get(eventId) ?? defaultRacingSetup(),version:JSON.stringify({setup:this.racingSetups.get(eventId),races:this.races.filter(r=>r.eventId===eventId),inspections:this.inspections.filter(i=>i.eventId===eventId)})});
  }
  async saveRacingSetup(eventId:string,revision:number,input:RacingSetupInput):Promise<RacingSetup> {
    this.require(eventId,'organiser','chair');this.frozen(eventId,'racing setup');
    const old=this.racingSetups.get(eventId) ?? defaultRacingSetup();
    if(old.revision!==revision)throw new ApiError('conflict','Racing setup changed');
    const error=validateSetup(input);if(error)throw new ApiError('invalid',error);
    input.seeds.forEach(id=>this.teamOrThrow(eventId,id));
    const races=this.races.filter(r=>r.eventId===eventId);
    if(input.reactionComplete && (races.some(r=>r.phase==='reaction' && (r.lane1.status==='pending'||r.lane2.status==='pending')) || this.teams.filter(t=>t.eventId===eventId).some(t=>(['A','B'] as const).some(car=>(['lane1','lane2'] as const).some(lane=>!races.some(r=>r.phase==='reaction'&&r[lane].teamId===t.id&&r[lane].car===car))))))throw new ApiError('locked','Finish reaction races for every team first');
    if(races.some(r=>r.bracket) && (JSON.stringify(input.seeds)!==JSON.stringify(old.seeds)||!input.reactionComplete))throw new ApiError('locked','Bracket seeds are locked');
    this.racingSetups.set(eventId,{...(old.scoring?{scoring:copy(old.scoring)}:{}),...copy(input),revision:revision+1,version:''});this.version++;
    return this.getRacingSetup(eventId);
  }
  async listRaces(eventId: string) {
    const roles = this.rolesOf(eventId);
    return copy(roles.length && (roles.some(r => r.role !== 'team_manager') || this.released(eventId)) ? this.races.filter(r => r.eventId === eventId) : []);
  }
  private raceFollowups = new Set<string>();
  async queueRaceFollowup(eventId: string, id: string, revision: number, mode: 'swap' | 'rerun') {
    this.require(eventId,'organiser','chair','race_official'); this.frozen(eventId,'races');
    const previous = this.races.find(r=>r.eventId===eventId && r.id===id);
    if(!previous || previous.revision!==revision) throw new ApiError('conflict','Reload the source heat');
    if(!['swap','rerun'].includes(mode) || (mode==='swap' && previous.bracket) || (mode==='rerun' && !rerunEligible(previous))) throw new ApiError('invalid','This heat is not eligible');
    const key=`${id}:${mode}`;
    if(this.raceFollowups.has(key)) throw new ApiError('duplicate','Follow-up already queued');
    this.raceFollowups.add(key);
    try {const row=await this.saveRace(eventId,crypto.randomUUID(),0,followupInput(previous,mode));
      const stored=this.races.find(r=>r.id===row.id)!;stored.parentHeat=id;stored.followupKind=mode;return copy(stored);
    }catch(err){this.raceFollowups.delete(key);throw err;}
  }
  async saveRace(eventId: string, id: string, revision: number, input: RaceInput) {
    this.require(eventId, 'organiser', 'chair', 'race_official');
    this.frozen(eventId, 'race results');
    const previous = this.races.find(r => r.eventId === eventId && r.id === id);
    if ((previous?.revision ?? 0) !== revision) throw new ApiError('conflict', 'Race changed on another device');
    const setup = this.racingSetups.get(eventId);
    if(setup?.reactionComplete && input.phase==='reaction')throw new ApiError('locked','Reopen reaction racing setup before editing');
    if(JSON.stringify(previous?.bracket??null)!==JSON.stringify(input.bracket??null) && previous)throw new ApiError('locked','Bracket identity is fixed');
    if(input.bracket && (!setup?.seeds.includes(input.lane1.teamId)||!setup.seeds.includes(input.lane2.teamId)))throw new ApiError('invalid','Approve seeds first');
    if(input.bracket && !previous) {
      const prior=this.races.filter(r=>r.eventId===eventId&&r.bracket?.round===input.bracket!.round&&r.bracket.slot===input.bracket!.slot).sort((a,b)=>b.number-a.number)[0];
      if(prior&&[prior.lane1,prior.lane2].some(l=>l.status==='dnf'||l.status==='pending'))throw new ApiError('locked','Pending or DNF match requires review');
    }
    if(input.bracket && this.races.some(r=>r.eventId===eventId && r.id!==id && r.bracket?.round===input.bracket!.round && r.bracket.slot===input.bracket!.slot && r.number>(previous?.number??0) && (r.lane1.status==='pending'||r.lane2.status==='pending')))throw new ApiError('locked','Open the existing pending attempt');
    const error = validateRace(input);
    if (error) throw new ApiError('invalid', error);
    this.teamOrThrow(eventId, input.lane1.teamId); this.teamOrThrow(eventId, input.lane2.teamId);
    if (previous && raceRecorded(previous) && input.note.trim().length < 5) throw new ApiError('invalid', 'Give a correction reason');
    if (input.sourceRunId && this.races.some(r => r.eventId === eventId && r.id !== id && r.sourceRunId === input.sourceRunId)) throw new ApiError('duplicate', 'This track run was already saved');
    const row: RaceHeat = { ...(previous?.parentHeat?{parentHeat:previous.parentHeat,followupKind:previous.followupKind}:{}), ...copy(input), label: input.label.trim(), note: input.note.trim(), id, eventId, number: previous?.number ?? 1 + Math.max(0, ...this.races.filter(r => r.eventId === eventId).map(r => r.number)), revision: revision + 1, updatedAt: new Date().toISOString() };
    this.races = this.races.filter(r => r.id !== id); this.races.push(row); this.version++;
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
  async createTeam(eventId: string, i: NewTeam) {
    this.require(eventId, 'chair', 'organiser');
    if(this.racingSetups.get(eventId)?.reactionComplete)throw new ApiError('locked','Racing roster is locked');
    const cleaned=cleanTeam(i);
    const number = this.text(i.number, 'Team number', 12);
    const name = this.text(i.name, 'Team name', 80);
    const school = (i.school ?? '').trim();
    if (school.length > 120) throw new ApiError('invalid', 'School must be 120 characters or fewer');
    if (this.teams.some((t) => t.eventId === eventId && normNumber(t.number) === normNumber(number))) {
      throw new ApiError('duplicate', `Team number ${number} is already used in this event`);
    }
    const team: TeamRow = { id: nid('team'), eventId, number, name, school };
    this.teams.push(team);
    if(cleaned.managerEmail)this.storeContact(eventId,team.id,cleaned.managerEmail);
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
    if(this.racingSetups.get(eventId)?.seeds.includes(teamId))throw new ApiError('locked','Seeded teams cannot be deleted');
    if (this.races.some(r => (r.lane1.teamId === teamId || r.lane2.teamId === teamId) && raceRecorded(r))) throw new ApiError('locked', 'Recorded races prevent team deletion');
    this.races = this.races.filter(r => r.lane1.teamId !== teamId && r.lane2.teamId !== teamId);
    // Match the database's cascades, after every guard passes, with no partial deletion.
    for (const card of this.cards.filter((c) => c.teamId === teamId)) this.reviews.delete(card.id);
    this.cards = this.cards.filter((c) => c.teamId !== teamId);
    this.roles = this.roles.filter((r) => r.teamId !== teamId);
    this.invites = this.invites.filter((i) => i.teamId !== teamId);
    this.conflicts = this.conflicts.filter((c) => c.teamId !== teamId);
    this.exemptions = this.exemptions.filter((x) => x.teamId !== teamId);
    this.overrides = this.overrides.filter((o) => o.teamId !== teamId);
    this.penalties = this.penalties.filter((p) => p.teamId !== teamId);
    this.teams = this.teams.filter((t) => t.id !== teamId);
    this.contacts.delete(teamId);this.awards=this.awards.filter(a=>a.teamId!==teamId);
    this.version += 1;
  }

  async importTeams(eventId: string, inputs: NewTeam[]) {
    this.require(eventId, 'chair', 'organiser');
    if(this.racingSetups.get(eventId)?.reactionComplete)throw new ApiError('locked','Racing roster is locked');
    this.eventOrThrow(eventId);
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_IMPORT_TEAMS) throw new ApiError('invalid', 'Import between 1 and 1000 teams');
    const teams = inputs.map(cleanTeam);
    const numbers = new Set(this.teams.filter((t) => t.eventId === eventId).map((t) => normNumber(t.number)));
    for (const team of teams) {
      if (numbers.has(normNumber(team.number))) throw new ApiError('duplicate', 'A team number is already used');
      numbers.add(normNumber(team.number));
    }
    // No await between validation and insertion: a batch can never be partially imported.
    const rows = teams.map(({managerEmail:_,...t}) => ({ ...t, id: nid('team'), eventId }));
    this.teams.push(...rows);
    teams.forEach((t,i)=>{if(t.managerEmail)this.storeContact(eventId,rows[i].id,t.managerEmail);}); this.version += rows.length;
    return copy(rows);
  }

  // ---- conflicts and scorecards
  async declareConflict(eventId: string, teamId: string) {
    this.require(eventId, ...JUDGE_ROLES, 'organiser', 'chair');
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
    const staff = this.has(eventId, 'chair', 'organiser', 'spectator');
    return this.conflicts.filter((c) => c.eventId === eventId && (staff || c.judgeId === this.me!.userId))
      .map((c) => ({ eventId: c.eventId, judgeId: c.judgeId, teamId: c.teamId }));
  }
  private conflicted(eventId: string, teamId: string) {
    return this.conflicts.some((c) => c.eventId === eventId && c.teamId === teamId && !!this.me && c.judgeId === this.me.userId);
  }
  private myCard(cardId: string) {
    if(this.globalOrganisers.some(r=>r.userId===this.me?.userId&&r.scope==='spectator'))throw new ApiError('forbidden','Read-only account');
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
    const isPanelJudge = this.canScore(eventId,area.panel as Panel,teamId);
    if (!isPanelJudge) throw new ApiError('forbidden', 'You do not judge this panel');
    if (this.conflicted(eventId, teamId)) throw new ApiError('forbidden', 'You declared a conflict of interest with this team');
    this.frozen(eventId, 'scorecards');
    const card: CardRow = { id: nid('card'), eventId, teamId, areaId, panel: area.panel as Panel, judgeId: me!, status: 'draft', reopenedCount: 0, scores: {}, comments: {} };
    if (this.showcaseMode) {
      const template = this.cards.find(c => c.eventId === eventId && c.teamId === teamId && c.areaId === areaId && c.status === 'submitted');
      if (template) {
        card.scores = copy(template.scores);
        card.comments = copy(template.comments);
        this.reviews.set(card.id, copy(this.reviews.get(template.id) ?? blankReview()));
      }
    }
    this.cards.push(card);
    return copy(card);
  }
  async saveScore(cardId: string, criterionId: string, score: number, comment?: string) {
    const card = this.myCard(cardId);
    this.frozen(card.eventId, 'scorecards');
    if (!this.canScore(card.eventId,card.panel,card.teamId)) throw new ApiError('forbidden','This team is not assigned to you');
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
    if (!this.canScore(card.eventId,card.panel,card.teamId) || this.conflicted(card.eventId, card.teamId)) {
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
    return c.judgeId === this.me?.userId || this.has(c.eventId, 'chair','spectator')
      || this.rolesOf(c.eventId).some((r) => r.role === 'lead_judge' && r.panel === c.panel);
  }
  async saveReview(cardId: string, review: CardReview) {
    const card = this.myCard(cardId);
    if (!this.canScore(card.eventId,card.panel,card.teamId) || this.conflicted(card.eventId, card.teamId)) {
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
      && (this.has(eventId, 'chair','spectator') || this.rolesOf(eventId).some((r) => r.role === 'lead_judge' && r.panel === c.panel)))
      .map((c) => ({ cardId: c.id, teamId: c.teamId, panel: c.panel, judgeId: c.judgeId, nominations: copy(this.reviews.get(c.id)?.nominations ?? []) }));
  }
  async reopenCard(cardId: string, reason: string) {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) throw new ApiError('not-found', 'Scorecard not found');
    if(!this.has(card.eventId,'chair')&&!this.rolesOf(card.eventId).some(r=>r.role==='lead_judge'&&r.panel===card.panel))throw new ApiError('forbidden','Only the Chair or panel Lead Judge can reopen a scorecard');
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
    const staff = this.has(eventId, 'chair', 'organiser', 'spectator');
    const released = this.released(eventId);
    const mine = this.rolesOf(eventId);
    const leadPanels = mine.filter((r) => r.role === 'lead_judge').map((r) => r.panel);
    const canSeeSpecification=mine.some(r=>r.role!=='team_manager');
    const managed = mine.filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy(this.cards.filter((c) => c.eventId === eventId && (
      staff || c.judgeId === me || leadPanels.includes(c.panel)
      || (c.status === 'submitted' && ((c.panel==='scrutineering' && canSeeSpecification) || (released && managed.includes(c.teamId))))
    )));
  }

  // ---- overrides, penalties, snapshots
  async listOverrides(eventId: string) {
    return copy(this.has(eventId, 'chair', 'organiser', 'spectator') ? this.overrides.filter((o) => o.eventId === eventId) : []);
  }
  async setOverride(eventId: string, teamId: string, areaId: string, value: number, reason: string) {
    this.require(eventId, 'chair');
    this.frozen(eventId, 'overrides');
    const area = this.area(eventId, areaId);
    if (!area || area.kind !== 'scorecard') throw new ApiError('invalid', 'Overrides apply to scorecard areas only');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > area.max) throw new ApiError('invalid', `Override must be between 0 and ${area.max}`);
    if (!oneDecimal(value)) throw new ApiError('invalid', 'Override can have at most one decimal place');
    const why = (typeof reason === 'string' ? reason : '').trim();
    if (!this.showcaseMode && why.length < 3) throw new ApiError('invalid', 'A reason is required');
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
    if (this.has(eventId, 'chair', 'organiser', 'spectator')) return copy([...this.penalties.filter((p) => p.eventId === eventId),...this.automaticPenalties(eventId)]);
    const managed = this.rolesOf(eventId).filter((r) => r.role === 'team_manager').map((r) => r.teamId);
    return copy([...this.penalties.filter((p) => p.eventId === eventId&&this.released(eventId)),...this.automaticPenalties(eventId)].filter(p=>managed.includes(p.teamId)));
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
    this.checkSubmissionPenalties(eventId,s.inputs);
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
    const staff = this.has(eventId, 'chair', 'organiser', 'spectator');
    const visible = this.snapshots.filter((s) => s.eventId === eventId && staff);
    return visible.length === 0 ? null : copy(visible[visible.length - 1]);
  }
  async publicStandings(eventId: string) {
    if(!this.released(eventId))return null;
    const latest=this.snapshots.filter(s=>s.eventId===eventId && s.released).at(-1);
    return latest?{createdAt:latest.createdAt,rows:latest.rows.map(({rank,teamId,number,name,total,tied})=>({rank,teamId,number,name,total,tied}))}:null;
  }
  async releasedResults(eventId: string) {
    if(!this.released(eventId))return null;
    const managed=this.rolesOf(eventId).filter(r=>r.role==='team_manager').map(r=>r.teamId);
    if(!managed.length)return null;
    const snapshots=this.snapshots.filter(s=>s.eventId===eventId && s.released);const latest=snapshots.at(-1);
    return latest?{...copy(latest),rows:copy(latest.rows.filter(r=>managed.includes(r.teamId)))}:null;
  }
  async getSnapshotInputs(snapshotId: string) {
    const s = this.snapshots.find((x) => x.id === snapshotId);
    // An unknown id is indistinguishable from a forbidden one, as in snapshot_inputs().
    if (!s || !this.has(s.eventId, 'chair', 'organiser', 'spectator')) throw new ApiError('forbidden', 'Snapshot inputs are restricted to the Chair and Organiser');
    return copy(this.snapshotInputs.get(snapshotId));
  }
  async listInspections(eventId: string) {
    if (this.rolesOf(eventId).length === 0) throw new ApiError('forbidden', 'You do not have permission to do that');
    const isStaff = this.has(eventId, 'chair', 'organiser', 'spectator');
    const isReleased = this.events.find((e) => e.id === eventId)?.resultsReleased ?? false;
    const isJudgeOrStaff = this.rolesOf(eventId).some((r) => r.role === 'judge' || r.role === 'scrutineer' || r.role === 'lead_judge' || r.role === 'chair' || r.role === 'organiser' || r.role==='spectator');
    const myTeams = new Set(this.rolesOf(eventId).filter((r) => r.role === 'team_manager' && r.teamId).map((r) => r.teamId!));

    return copy(this.inspections.filter((i) => {
      if (i.eventId !== eventId) return false;
      if (isStaff || i.inspectorId === this.me?.userId) return true;
      if (i.status === 'submitted') {
        if (isJudgeOrStaff) return true;
        if (isReleased && myTeams.has(i.teamId)) return true;
      }
      return false;
    }));
  }
  async getInspection(eventId: string, teamId: string, car: Car) {
    if (this.rolesOf(eventId).length === 0) throw new ApiError('forbidden', 'You do not have permission to do that');
    const found = this.inspections.find((i) => i.eventId === eventId && i.teamId === teamId && i.car === car);
    if (!found) return null;
    const isStaff = this.has(eventId, 'chair', 'organiser', 'spectator');
    const isReleased = this.events.find((e) => e.id === eventId)?.resultsReleased ?? false;
    const isJudgeOrStaff = this.rolesOf(eventId).some((r) => r.role === 'judge' || r.role === 'scrutineer' || r.role === 'lead_judge' || r.role === 'chair' || r.role === 'organiser' || r.role==='spectator');
    const myTeams = new Set(this.rolesOf(eventId).filter((r) => r.role === 'team_manager' && r.teamId).map((r) => r.teamId!));
    if (isStaff || found.inspectorId === this.me?.userId) return copy(found);
    if (found.status === 'submitted') {
      if (isJudgeOrStaff) return copy(found);
      if (isReleased && myTeams.has(found.teamId)) return copy(found);
    }
    return null;
  }
  async saveInspection(eventId: string, teamId: string, car: Car, measurements: Measurements, notes?: Record<string, string>) {
    this.teamOrThrow(eventId, teamId);
    this.frozen(eventId, 'inspections');
    const isInspector = this.has(eventId, 'chair', 'organiser', 'scrutineer') ||
      (this.canScore(eventId,'scrutineering',teamId)&&!this.conflicted(eventId,teamId));
    if (!isInspector) throw new ApiError('forbidden', 'You cannot inspect this team');
    let insp = this.inspections.find((i) => i.eventId === eventId && i.teamId === teamId && i.car === car);
    const now = new Date().toISOString();
    if (!insp) {
      insp = {
        id: nid('insp'),
        eventId,
        teamId,
        car,
        inspectorId: this.me!.userId,
        status: 'in_progress',
        rulesetId: 'india-nationals-2026-technical',
        selectedArticles: this.scopes.get(eventId)?.articles??null,
        measurements: copy(measurements),
        notes: notes ? copy(notes) : {},
        startedAt: now,
        submittedAt: null,
        updatedAt: now,
        revision: 1,
      };
      this.inspections.push(insp);
    } else {
      if (insp.status === 'submitted') throw new ApiError('locked', 'Inspection is already submitted');
      insp.measurements = copy(measurements);
      if (notes) insp.notes = copy(notes);
      insp.updatedAt = now;
      insp.revision += 1;
    }
    return copy(insp);
  }
  async submitInspection(inspectionId: string) {
    const insp = this.inspections.find((i) => i.id === inspectionId);
    if (!insp) throw new ApiError('not-found', 'Inspection not found');
    this.frozen(insp.eventId, 'inspections');
    const canSubmit = (insp.inspectorId === this.me?.userId && (this.has(insp.eventId,'scrutineer')||(this.canScore(insp.eventId,'scrutineering',insp.teamId)&&!this.conflicted(insp.eventId,insp.teamId)))) || this.has(insp.eventId, 'chair', 'organiser');
    if (!canSubmit) throw new ApiError('forbidden', 'You cannot submit this inspection');
    if (insp.status === 'submitted') throw new ApiError('duplicate', 'Already submitted');
    this.inspectionHistory.push({
      id: nid('insphist'),
      inspectionId,
      changedBy: this.me!.userId,
      changedAt: new Date().toISOString(),
      previousMeasurements: copy(insp.measurements),
      previousStatus: insp.status,
      reason: '',
      revision: insp.revision,
    });
    insp.status = 'submitted';
    insp.submittedAt = new Date().toISOString();
    insp.updatedAt = insp.submittedAt;
    insp.revision += 1;
    this.version += 1;
  }
  async reopenInspection(inspectionId: string, reason: string) {
    const insp = this.inspections.find((i) => i.id === inspectionId);
    if (!insp) throw new ApiError('not-found', 'Inspection not found');
    this.frozen(insp.eventId, 'inspections');
    if (!this.has(insp.eventId, 'chair', 'organiser')) throw new ApiError('forbidden', 'Only Chair or Organiser can reopen an inspection');
    if (insp.status !== 'submitted') throw new ApiError('invalid', 'Only submitted inspections can be reopened');
    const why = (typeof reason === 'string' ? reason : '').trim();
    if (!why) throw new ApiError('invalid', 'A reason is required to reopen an inspection');
    this.inspectionHistory.push({
      id: nid('insphist'),
      inspectionId,
      changedBy: this.me!.userId,
      changedAt: new Date().toISOString(),
      previousMeasurements: copy(insp.measurements),
      previousStatus: insp.status,
      reason: why,
      revision: insp.revision,
    });
    insp.status = 'reopened';
    insp.updatedAt = new Date().toISOString();
    insp.revision += 1;
    this.version += 1;
  }
  async listBroadcasts(eventId: string): Promise<BroadcastEmail[]> {
    if (!this.has(eventId, 'chair', 'organiser', 'spectator')) {
      throw new ApiError('forbidden', 'Broadcasts are restricted to the Chair and Organiser');
    }
    return copy(this.broadcasts.filter((b) => b.eventId === eventId));
  }
  async sendBroadcast(eventId: string, input: NewBroadcastInput): Promise<BroadcastEmail> {
    if (!this.has(eventId, 'chair', 'organiser')) {
      throw new ApiError('forbidden', 'Only Chair or Organiser can send broadcasts');
    }
    const subject = (input.subject ?? '').trim();
    if (!subject) throw new ApiError('invalid', 'Subject is required');
    const body = (input.body ?? '').trim();
    if (!body) throw new ApiError('invalid', 'Body is required');

    let recipientCount = 0;
    if (input.audienceType === 'all_judges') {
      const judges = this.rolesOf(eventId).filter((r) => r.role === 'judge' || r.role === 'lead_judge');
      const uniqueEmails = new Set(judges.map((j) => j.email).filter(Boolean));
      for (const inv of this.invites.filter((i) => i.eventId === eventId && (i.role === 'judge' || i.role === 'lead_judge'))) {
        uniqueEmails.add(inv.email);
      }
      recipientCount = uniqueEmails.size;
    } else if (input.audienceType === 'panel') {
      const judges = this.rolesOf(eventId).filter((r) => (r.role === 'judge' || r.role === 'lead_judge') && r.panel === input.panel);
      const uniqueEmails = new Set(judges.map((j) => j.email).filter(Boolean));
      for (const inv of this.invites.filter((i) => i.eventId === eventId && (i.role === 'judge' || i.role === 'lead_judge') && i.panel === input.panel)) {
        uniqueEmails.add(inv.email);
      }
      recipientCount = uniqueEmails.size;
    } else if (input.audienceType === 'specific_judges') {
      const ids = new Set(input.judgeIds ?? []);
      const judges = this.rolesOf(eventId).filter((r) => ids.has(r.userId));
      recipientCount = new Set(judges.map((j) => j.email).filter(Boolean)).size;
    } else if (input.audienceType === 'emails') {
      const emails = new Set((input.customEmails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)));
      recipientCount = emails.size;
    }

    const broadcast: BroadcastEmail = {
      id: nid('bcast'),
      eventId,
      senderId: this.me?.userId ?? null,
      senderEmail: this.me?.email ?? null,
      audienceType: input.audienceType,
      panel: input.panel ?? null,
      recipientCount,
      subject,
      category: input.category?.trim() || null,
      body,
      buttonText: input.buttonText?.trim() || null,
      buttonUrl: input.buttonUrl?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    this.broadcasts.push(broadcast);
    return copy(broadcast);
  }

  private teamPhotos: Array<TeamPhoto & { originalBase64: string; processedBase64?: string; approvedBase64?: string }> = [];
  private teamPhotoHistory: Array<TeamPhotoHistoryItem & { approvedBase64: string }> = [];
  private photoJobs: Array<{ id: string; eventId: string; teamId: string; photoId: string; version: number; status: PhotoProcessingStatus; attempts: number; maxAttempts: number; scheduledAt: string; error?: string }> = [];

  async listTeamPhotos(eventId: string): Promise<TeamPhoto[]> {
    this.require(eventId, 'organiser', 'chair', 'spectator', 'team_manager');
    const isStaff = this.has(eventId, 'organiser', 'chair', 'spectator');
    const managedTeams = this.rolesOf(eventId).filter(r => r.role === 'team_manager').map(r => r.teamId);
    return copy(this.teamPhotos
      .filter(p => p.eventId === eventId && (isStaff || managedTeams.includes(p.teamId)))
      .map(({ originalBase64, processedBase64, approvedBase64, ...rest }) => ({
        ...rest,
        hasOriginal: true,
        hasProcessed: !!processedBase64,
        hasApproved: !!approvedBase64,
      })));
  }

  async downloadTeamPhoto(eventId: string, teamId: string, which: 'original' | 'processed' | 'approved') {
    this.require(eventId, 'organiser', 'chair', 'spectator', 'team_manager', 'judge', 'lead_judge', 'scrutineer', 'race_official');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');

    if (which === 'original') {
      const isStaff = this.has(eventId, 'organiser', 'chair');
      const isMgr = this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId);
      if (!isStaff && !isMgr) throw new ApiError('forbidden', 'Only event staff or your team may access the original photograph');
      return {
        teamId,
        which,
        mime: p.originalMime,
        name: p.originalName,
        size: p.originalSize,
        width: p.originalWidth ?? undefined,
        height: p.originalHeight ?? undefined,
        base64: p.originalBase64,
      };
    } else if (which === 'processed') {
      const isStaff = this.has(eventId, 'organiser', 'chair', 'spectator');
      const isMgr = this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId);
      if (!isStaff && !isMgr) throw new ApiError('forbidden', 'Access denied');
      if (!p.processedBase64) throw new ApiError('not-found', 'Processed cutout not ready');
      return {
        teamId,
        which,
        mime: 'image/png',
        name: `${p.originalName.replace(/\.[^.]+$/, '')}-cutout.png`,
        size: p.processedSize ?? 0,
        width: p.processedWidth ?? undefined,
        height: p.processedHeight ?? undefined,
        base64: p.processedBase64,
      };
    } else {
      const isStaff = this.has(eventId, 'organiser', 'chair', 'spectator');
      const isMgr = this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId);
      const isMember = this.rolesOf(eventId).length > 0 || this.released(eventId);
      if (!isStaff && !isMgr && !isMember) throw new ApiError('forbidden', 'Access denied');
      if (p.approvalStatus !== 'approved' || !p.approvedBase64) throw new ApiError('not-found', 'Approved photograph unavailable');
      return {
        teamId,
        which,
        mime: 'image/png',
        name: `${p.originalName.replace(/\.[^.]+$/, '')}-approved.png`,
        size: p.approvedSize ?? 0,
        width: p.approvedWidth ?? undefined,
        height: p.approvedHeight ?? undefined,
        base64: p.approvedBase64,
      };
    }
  }

  async uploadTeamPhoto(eventId: string, teamId: string, revision: number, input: TeamPhotoUploadInput) {
    this.require(eventId, 'organiser', 'chair', 'team_manager');
    this.frozen(eventId, 'team photographs');
    this.teamOrThrow(eventId, teamId);
    const isStaff = this.has(eventId, 'organiser', 'chair');
    const isMgr = this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId);
    if (!isStaff && !isMgr) throw new ApiError('forbidden', 'Only your team or event staff may upload team photographs');

    await this.requireSubmissionGuide(eventId);
    const { size, mime } = validatePhotoUpload(input);
    const existing = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if ((existing?.revision ?? 0) !== revision) throw new ApiError('conflict', 'Photograph was modified; reload');

    const binary = atob(input.base64);
    const dims = extractDimensions(binary);if(!dims)throw new ApiError('invalid','Invalid photograph dimensions.');
    const curVer = (existing?.version ?? 0) + 1;
    const curRev = (existing?.revision ?? 0) + 1;
    const photoId = existing?.id ?? nid('photo');

    const photoRow: TeamPhoto & { originalBase64: string; processedBase64?: string; approvedBase64?: string } = {
      id: photoId,
      eventId,
      teamId,
      revision: curRev,
      version: curVer,
      originalName: input.name.trim(),
      originalMime: mime,
      originalSize: size,
      originalWidth: dims.width,
      originalHeight: dims.height,
      originalPath: `team-photos/${eventId}/${teamId}/v${curVer}/original.${mime === 'image/png' ? 'png' : 'jpg'}`,
      originalBase64: input.base64,
      processedPath: null,
      processedSize: null,
      processedWidth: null,
      processedHeight: null,
      approvedPath: null,
      approvedSize: null,
      approvedWidth: null,
      approvedHeight: null,
      processingStatus: 'pending',
      approvalStatus: 'pending',
      processingError: null,
      retryCount: 0,
      mediaConsent: true,
      uploadedAt: new Date().toISOString(),
      processedAt: null,
      approvedAt: null,
      approvedBy: null,
      correctionNotes: null,
      hasOriginal: true,
      hasProcessed: false,
      hasApproved: false,
    };

    this.teamPhotos = this.teamPhotos.filter(p => !(p.eventId === eventId && p.teamId === teamId));
    this.teamPhotos.push(photoRow);

    const jobId = nid('job');
    this.photoJobs.push({
      id: jobId,
      eventId,
      teamId,
      photoId,
      version: curVer,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date().toISOString(),
    });

    this.version++;
    return { photoId, revision: curRev, version: curVer, status: 'pending' };
  }

  async queuePhotoProcessing(eventId: string, teamId: string) {
    this.require(eventId, 'organiser', 'chair');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');
    p.processingStatus = 'pending';
    p.processingError = null;
    p.retryCount++;
    const jobId = nid('job');
    this.photoJobs.push({
      id: jobId,
      eventId,
      teamId,
      photoId: p.id,
      version: p.version,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date().toISOString(),
    });
    this.version++;
    return { jobId, status: 'pending' };
  }

  async queueBulkPhotoProcessing(eventId: string, teamIds?: string[]) {
    this.require(eventId, 'organiser', 'chair');
    const targetPhotos = this.teamPhotos.filter(p =>
      p.eventId === eventId &&
      (!teamIds || !teamIds.length || teamIds.includes(p.teamId)) &&
      (teamIds && teamIds.length > 0 || ['pending', 'failed'].includes(p.processingStatus))
    );
    for (const p of targetPhotos) {
      p.processingStatus = 'pending';
      p.processingError = null;
      p.retryCount++;
      this.photoJobs.push({
        id: nid('job'),
        eventId,
        teamId: p.teamId,
        photoId: p.id,
        version: p.version,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date().toISOString(),
      });
    }
    this.version++;
    return { queued: targetPhotos.length };
  }

  async completePhotoProcessing(jobId: string, status: 'completed' | 'failed', cutoutBase64?: string, error?: string): Promise<boolean> {
    const job = this.photoJobs.find(j => j.id === jobId);
    if (!job) return false;
    this.require(job.eventId,'organiser','chair');this.frozen(job.eventId,'photo processing');
    const p = this.teamPhotos.find(p => p.id === job.photoId);
    if (!p||p.version!==job.version||!['pending','processing'].includes(job.status)) return false;

    if (status === 'completed') {
      if(!cutoutBase64)throw new ApiError('invalid','Processed PNG required');
      const b64=cutoutBase64;validatePhotoUpload({name:'cutout.png',mime:'image/png',base64:b64,mediaConsent:true});
      const dims=extractDimensions(atob(b64));if(!dims)throw new ApiError('invalid','Invalid processed PNG');
      p.processedPath = `team-photos/${job.eventId}/${job.teamId}/v${job.version}/processed.png`;
      p.processedBase64 = b64;
      p.processedSize = Math.floor(b64.length * 0.75);
      p.processedWidth = dims.width;
      p.processedHeight = dims.height;
      p.processingStatus = 'completed';
      p.processedAt = new Date().toISOString();
      p.processingError = null;
      p.hasProcessed = true;
    } else {
      p.processingStatus = 'failed';
      p.processingError = error ?? 'Background removal failed';
    }
    job.status=status;job.error=error;this.version++;
    return true;
  }

  async approveTeamPhoto(eventId: string, teamId: string, notes?: string) {
    this.require(eventId, 'organiser', 'chair');this.frozen(eventId,'team photographs');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');
    if (!p.processedBase64 && !p.approvedBase64) throw new ApiError('locked', 'Cannot approve before background removal');

    if (p.approvedBase64) {
      this.teamPhotoHistory.push({
        id: nid('hist'),
        eventId,
        teamId,
        version: p.version,
        approvedPath: p.approvedPath ?? '',
        approvedSize: p.approvedSize ?? 0,
        approvedWidth: p.approvedWidth,
        approvedHeight: p.approvedHeight,
        approvedAt: p.approvedAt ?? new Date().toISOString(),
        approvedBy: p.approvedBy,
        correctionNotes: p.correctionNotes,
        approvedBase64: p.approvedBase64,
      });
    }

    const b64 = p.processedBase64 ?? p.approvedBase64!;
    p.approvedPath = `team-photos/${eventId}/${teamId}/v${p.version}/approved.png`;
    p.approvedBase64 = b64;
    p.approvedSize = p.processedSize ?? Math.floor(b64.length * 0.75);
    p.approvedWidth = p.processedWidth ?? p.originalWidth;
    p.approvedHeight = p.processedHeight ?? p.originalHeight;
    p.approvalStatus = 'approved';
    p.approvedAt = new Date().toISOString();
    p.approvedBy = this.me?.userId ?? null;
    p.correctionNotes = notes ?? null;
    p.hasApproved = true;
    this.version++;
    return { teamId, approvalStatus: 'approved', approvedAt: p.approvedAt };
  }

  async rejectTeamPhoto(eventId: string, teamId: string, reason?: string) {
    this.require(eventId, 'organiser', 'chair');this.frozen(eventId,'team photographs');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');
    p.approvalStatus = 'rejected';
    p.correctionNotes = reason ?? null;
    this.version++;
    return { teamId, approvalStatus: 'rejected' };
  }

  async uploadCorrectedTeamPhoto(eventId: string, teamId: string, input: { base64: string; notes?: string }) {
    this.require(eventId, 'organiser', 'chair');this.frozen(eventId,'team photographs');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');

    if (p.approvedBase64) {
      this.teamPhotoHistory.push({
        id: nid('hist'),
        eventId,
        teamId,
        version: p.version,
        approvedPath: p.approvedPath ?? '',
        approvedSize: p.approvedSize ?? 0,
        approvedWidth: p.approvedWidth,
        approvedHeight: p.approvedHeight,
        approvedAt: p.approvedAt ?? new Date().toISOString(),
        approvedBy: p.approvedBy,
        correctionNotes: p.correctionNotes,
        approvedBase64: p.approvedBase64,
      });
    }

    p.approvedPath = `team-photos/${eventId}/${teamId}/v${p.version}/manual-approved.png`;
    p.approvedBase64 = input.base64;
    p.approvedSize = Math.floor(input.base64.length * 0.75);
    p.approvedWidth = p.originalWidth;
    p.approvedHeight = p.originalHeight;
    p.approvalStatus = 'approved';
    p.approvedAt = new Date().toISOString();
    p.approvedBy = this.me?.userId ?? null;
    p.correctionNotes = input.notes ?? 'Manually corrected cutout';
    p.hasApproved = true;
    this.version++;
    return { teamId, approvalStatus: 'approved', isManual: true };
  }

  async restoreTeamPhotoVersion(eventId: string, teamId: string, historyId: string) {
    this.require(eventId, 'organiser', 'chair');this.frozen(eventId,'team photographs');
    const p = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    if (!p) throw new ApiError('not-found', 'Photograph not found');
    const h = this.teamPhotoHistory.find(h => h.id === historyId && h.eventId === eventId && h.teamId === teamId);
    if (!h) throw new ApiError('not-found', 'Historical version not found');

    if (p.approvedBase64) {
      this.teamPhotoHistory.push({
        id: nid('hist'),
        eventId,
        teamId,
        version: p.version,
        approvedPath: p.approvedPath ?? '',
        approvedSize: p.approvedSize ?? 0,
        approvedWidth: p.approvedWidth,
        approvedHeight: p.approvedHeight,
        approvedAt: p.approvedAt ?? new Date().toISOString(),
        approvedBy: p.approvedBy,
        correctionNotes: p.correctionNotes,
        approvedBase64: p.approvedBase64,
      });
    }

    p.approvedPath = h.approvedPath;
    p.approvedBase64 = h.approvedBase64;
    p.approvedSize = h.approvedSize;
    p.approvedWidth = h.approvedWidth;
    p.approvedHeight = h.approvedHeight;
    p.approvalStatus = 'approved';
    p.approvedAt = new Date().toISOString();
    p.approvedBy = this.me?.userId ?? null;
    p.correctionNotes = `Restored from version ${h.version}`;
    this.version++;
    return { teamId, restoredVersion: h.version, approvalStatus: 'approved' };
  }

  async listTeamPhotoHistory(eventId: string, teamId: string): Promise<TeamPhotoHistoryItem[]> {
    this.require(eventId, 'organiser', 'chair', 'spectator');
    return copy(this.teamPhotoHistory
      .filter(h => h.eventId === eventId && h.teamId === teamId)
      .map(({ approvedBase64, ...rest }) => rest));
  }

  async deleteTeamPhoto(eventId: string, teamId: string): Promise<void> {
    this.require(eventId, 'organiser', 'chair', 'team_manager');
    this.frozen(eventId, 'team photographs');
    const isStaff = this.has(eventId, 'organiser', 'chair');
    const isMgr = this.rolesOf(eventId).some(r => r.role === 'team_manager' && r.teamId === teamId);
    if (!isStaff && !isMgr) throw new ApiError('forbidden', 'Only your team or event staff may delete team photographs');

    this.teamPhotos = this.teamPhotos.filter(p => !(p.eventId === eventId && p.teamId === teamId));
    this.teamPhotoHistory = this.teamPhotoHistory.filter(h => !(h.eventId === eventId && h.teamId === teamId));
    this.photoJobs = this.photoJobs.filter(j => !(j.eventId === eventId && j.teamId === teamId));
    this.version++;
  }

  async getBroadcastTeamPhoto(eventId: string, teamId: string): Promise<BroadcastPhoto> {
    this.mediaAccess(eventId,teamId);
    const team = this.teams.find(t => t.eventId === eventId && t.id === teamId);
    if (!team) throw new ApiError('not-found', 'Team not found');

    const photo = this.teamPhotos.find(p => p.eventId === eventId && p.teamId === teamId);
    const isApproved = !!(photo && photo.approvalStatus === 'approved' && photo.approvedBase64);
    const logoFile = this.teamFiles.find(f => f.eventId === eventId && f.teamId === teamId && f.kind === 'logo');

    return {
      teamId: team.id,
      teamNumber: team.number,
      teamName: team.name,
      school: team.school,
      isApprovedPhoto: isApproved,
      photoBase64: isApproved ? photo!.approvedBase64! : null,
      photoWidth: isApproved ? photo!.approvedWidth : null,
      photoHeight: isApproved ? photo!.approvedHeight : null,
      logoBase64: logoFile ? logoFile.base64 : null,
      logoMime: logoFile ? logoFile.mime : null,
    };
  }

  private mediaAccess(eventId:string,teamId:string,write=false) {
    this.require(eventId,...(write?['organiser','chair','team_manager'] as const:['organiser','chair','spectator','team_manager'] as const));
    this.teamOrThrow(eventId,teamId);
    if(!this.has(eventId,'organiser','chair','spectator')&&!this.rolesOf(eventId).some(r=>r.role==='team_manager'&&r.teamId===teamId))throw new ApiError('forbidden','Only your own team');
    if(write)this.frozen(eventId,'team media');
  }
  async getCompulsoryAssets(eventId:string,teamId:string):Promise<TeamCompulsoryAssets> {
    this.mediaAccess(eventId,teamId);
    const raw=copy(this.compulsoryAssets.get(`${eventId}:${teamId}`)??{});
    const logo=this.teamFiles.find(f=>f.eventId===eventId&&f.teamId===teamId&&f.kind==='logo');
    raw.teamLogo=logo?{name:logo.name,mime:logo.mime,size:logo.size,revision:logo.revision,updatedAt:logo.updatedAt}:undefined;
    const photo=this.teamPhotos.find(p=>p.eventId===eventId&&p.teamId===teamId);raw.officialPhoto=photo?copy(photo):undefined;
    return computeCompulsoryAssetStatus(eventId,teamId,raw);
  }
  private mediaRevision(current:Partial<TeamCompulsoryAssets>,revision?:number) {
    if(revision!==undefined&&revision!==(current.revision??0))throw new ApiError('conflict','Media changed. Reload before saving.');
  }
  async saveTeamColours(eventId:string,teamId:string,colours:TeamColours,revision?:number) {
    this.mediaAccess(eventId,teamId,true);await this.requireSubmissionGuide(eventId);
    const key=`${eventId}:${teamId}`,current=this.compulsoryAssets.get(key)??{};
    this.mediaRevision(current,revision);const valid=validateTeamColours(colours);
    this.compulsoryAssets.set(key,{...current,teamColours:valid,revision:(current.revision??0)+1});this.version++;return copy(valid);
  }
  async saveTeamMemberPortraits(eventId:string,teamId:string,members:TeamMemberPortrait[],revision?:number) {
    this.mediaAccess(eventId,teamId,true);await this.requireSubmissionGuide(eventId);
    const key=`${eventId}:${teamId}`,current=this.compulsoryAssets.get(key)??{};
    this.mediaRevision(current,revision);const valid=validateMemberPortraits(members);
    this.compulsoryAssets.set(key,{...current,memberPortraits:valid,revision:(current.revision??0)+1});this.version++;return copy(valid);
  }
  async uploadCompulsoryAsset(eventId:string,teamId:string,assetKey:CompulsoryAssetKey,file:{name:string;mime:string;base64:string},revision?:number):Promise<StoredCompulsoryFile> {
    this.mediaAccess(eventId,teamId,true);await this.requireSubmissionGuide(eventId);
    const checked=validateCompulsoryFile(assetKey,file);
    if(assetKey==='team_logo'){
      const old=this.teamFiles.find(f=>f.eventId===eventId&&f.teamId===teamId&&f.kind==='logo');
      await this.uploadTeamFile(eventId,teamId,revision??old?.revision??0,{...file,kind:'logo'});return this.downloadCompulsoryAsset(eventId,teamId,assetKey);
    }
    const key=`${eventId}:${teamId}`,current=this.compulsoryAssets.get(key)??{};
    const field=({car_render_fl:'carRenderFL',car_render_fr:'carRenderFR',car_model_3d:'carModel3D',model_materials:'modelMaterials'} as const)[assetKey as 'car_render_fl'];
    const old=current[field];if(revision!==undefined&&revision!==(old?.revision??0))throw new ApiError('conflict','File changed. Reload before saving.');
    const stored={...file,...checked,revision:(old?.revision??0)+1,updatedAt:new Date().toISOString()};
    this.compulsoryAssets.set(key,{...current,[field]:stored});this.version++;return copy(stored);
  }
  async downloadCompulsoryAsset(eventId:string,teamId:string,assetKey:CompulsoryAssetKey):Promise<StoredCompulsoryFile> {
    this.mediaAccess(eventId,teamId);
    if(assetKey==='team_logo'){
      const f=this.teamFiles.find(f=>f.eventId===eventId&&f.teamId===teamId&&f.kind==='logo');
      if(f)return copy({name:f.name,mime:f.mime,size:f.size,revision:f.revision,updatedAt:f.updatedAt,base64:f.base64});
    }
    const field=({car_render_fl:'carRenderFL',car_render_fr:'carRenderFR',car_model_3d:'carModel3D',model_materials:'modelMaterials'} as const)[assetKey as 'car_render_fl'];
    const f=field?this.compulsoryAssets.get(`${eventId}:${teamId}`)?.[field]:undefined;
    if(!f)throw new ApiError('not-found','Media file unavailable');return copy(f);
  }
  async deleteCompulsoryAsset(eventId:string,teamId:string,assetKey:CompulsoryAssetKey) {
    this.mediaAccess(eventId,teamId,true);
    if(assetKey==='team_logo')this.teamFiles=this.teamFiles.filter(f=>!(f.eventId===eventId&&f.teamId===teamId&&f.kind==='logo'));
    else if(assetKey==='official_photo')await this.deleteTeamPhoto(eventId,teamId);
    else {
      const field=({car_render_fl:'carRenderFL',car_render_fr:'carRenderFR',car_model_3d:'carModel3D',model_materials:'modelMaterials',team_colours:'teamColours',member_portraits:'memberPortraits'} as const)[assetKey as 'car_render_fl'];
      if(!field)throw new ApiError('invalid','Invalid media category');
      const key=`${eventId}:${teamId}`,current=this.compulsoryAssets.get(key)??{};delete current[field];
      if(assetKey==='team_colours'||assetKey==='member_portraits')current.revision=(current.revision??0)+1;
      this.compulsoryAssets.set(key,current);
    }
    this.version++;
  }
}
