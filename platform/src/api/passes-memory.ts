import { currentStep, importSecret, macFor, parsePassCode, toHex } from '../pass/code';
import { teamActivities, type ScheduleDoc } from '../scheduling';
import type { TeamMemberPortrait } from './compulsory-assets';
import type { CheckOptions, DoorList, PassArrivals, PassCardData, PassCheckResult, PassHolder, PassStream, QueuedCheck, TeamPass, TeamPasses } from './passes';
import { ApiError, type EventRow, type TeamRow } from './types';

/** What the in-memory passes need to know about the rest of the in-memory backend. */
export interface PassHost {
  userId(): string | null;
  /** Organisers and the Chair, never spectators. */
  staff(eventId: string): boolean;
  manages(eventId: string, teamId: string): boolean;
  /** Any role at the event other than team manager or spectator. */
  eventStaff(eventId: string): boolean;
  /** Undefined for a deleted or unknown event. */
  event(eventId: string): EventRow | undefined;
  team(eventId: string, teamId: string): TeamRow | undefined;
  members(eventId: string, teamId: string): TeamMemberPortrait[];
  managers(eventId: string, teamId: string): string[];
  schedule(eventId: string): ScheduleDoc | null;
}

interface Pass {
  id: string; eventId: string; teamId: string; kind: 'student' | 'manager'; memberId: string | null; userId: string | null; holderName: string;
  nameKey: string; sourceHash: string; portrait: string | null; portraitHash: string | null; token: string | null; holder: string | null; presenter: string | null;
  linkSentAt: string | null; claimedAt: string | null; created: number;
  /** When a student pass was first found without its member. Kept a week in case the member is being corrected. */
  orphanedAt: number | null;
}
interface Check extends QueuedCheck { eventId: string }

const forbidden = (message = 'Passes are for the team and event organisers') => new ApiError('forbidden', message);
const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const uuid = () => crypto.randomUUID();
const nameKey = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
const tidy = (n: string) => n.trim().replace(/\s+/g, ' ');
/** A short fingerprint of a picture, standing in for the database's md5. */
const fingerprint = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return `${text.length.toString(16)}-${h.toString(16)}`; };

const ORPHAN_DAYS = 7;

/** An in-memory copy of the rules in migrations 0059 and 0060, for tests and the offline showcase. */
export class MemoryPasses {
  private passes: Pass[] = [];
  private checks: Check[] = [];
  private pulse = new Map<string, string>();
  private seq = 0;
  constructor(private host: PassHost, private now: () => number = Date.now) {}

  private pulseKey(eventId: string): string {
    if (!this.pulse.has(eventId)) this.pulse.set(eventId, randomHex(32));
    return this.pulse.get(eventId)!;
  }
  private teamAccess(eventId: string, teamId: string): void {
    if (!this.host.userId() || !this.host.event(eventId) || !this.host.team(eventId, teamId) || !(this.host.staff(eventId) || this.host.manages(eventId, teamId))) throw forbidden();
  }
  private guard(passId: string): Pass {
    const p = this.passes.find((x) => x.id === passId);
    if (!p) throw forbidden();
    this.teamAccess(p.eventId, p.teamId);
    this.follow(p.eventId);
    return p;
  }
  private doorAccess(eventId: string): void {
    if (!this.host.userId() || !this.host.event(eventId) || !this.host.staff(eventId)) throw forbidden('Door checks are for event organisers');
  }
  private holderOf(p: Pass): { name: string; role: string } | null {
    if (p.kind === 'manager') return this.host.managers(p.eventId, p.teamId).includes(p.userId!) ? { name: p.holderName, role: 'Team Manager' } : null;
    const m = this.host.members(p.eventId, p.teamId).find((x) => x.id === p.memberId);
    return m ? { name: tidy(m.name), role: m.role.trim() } : null;
  }
  private streamOf(eventId: string, teamId: string): PassStream | null {
    const doc = this.host.schedule(eventId);
    const streamId = doc?.allocations.find((a) => a.teamId === teamId)?.streamId;
    const index = doc ? doc.streams.findIndex((s) => s.id === streamId) : -1;
    return doc && index >= 0 ? { name: doc.streams[index].name, index } : null;
  }
  private schedule(eventId: string, teamId: string): Pick<PassCardData, 'stream' | 'activities' | 'timezone'> & { days: string[] } {
    const doc = this.host.schedule(eventId);
    if (!doc) return { stream: null, activities: [], timezone: 'Asia/Kolkata', days: [] };
    return { stream: this.streamOf(eventId, teamId), timezone: doc.timezone, days: doc.days.map((d) => d.date).sort(),
      activities: teamActivities(doc, teamId).map((a) => ({ title: a.title, kind: a.kind, start: a.start, end: a.end, location: a.location ?? '' })) };
  }
  private card(p: Pass): PassCardData {
    const h = this.holderOf(p)!, e = this.host.event(p.eventId)!, t = this.host.team(p.eventId, p.teamId)!, s = this.schedule(p.eventId, p.teamId);
    return { passId: p.id, kind: p.kind, name: h.name, role: h.role, team: { number: t.number, name: t.name, school: t.school }, event: { id: e.id, name: e.name, startsOn: e.startsOn, days: s.days },
      stream: s.stream, activities: s.activities, timezone: s.timezone, portrait: p.portrait, pulseKey: this.pulseKey(p.eventId), now: this.now() };
  }
  private sync(eventId: string, teamId: string, opened = true): void {
    const members = this.host.members(eventId, teamId), live = new Set(members.map((m) => m.id));
    const mine = () => this.passes.filter((p) => p.eventId === eventId && p.teamId === teamId);
    for (const m of members) {
      const hash = fingerprint(m.photoBase64 ?? ''), key = nameKey(m.name);
      const existing = mine().find((p) => p.kind === 'student' && p.memberId === m.id);
      if (existing) { existing.nameKey = key; existing.sourceHash = hash; existing.orphanedAt = null; continue; }
      const orphans = mine().filter((p) => p.kind === 'student' && !live.has(p.memberId!));
      const hit = orphans.find((p) => !!m.photoBase64 && p.sourceHash === hash) ?? orphans.find((p) => key !== '' && p.nameKey === key);
      if (hit) { hit.memberId = m.id; hit.nameKey = key; hit.sourceHash = hash; hit.orphanedAt = null; }
      else this.passes.push({ id: uuid(), eventId, teamId, kind: 'student', memberId: m.id, userId: null, holderName: '', nameKey: key, sourceHash: hash, portrait: null, portraitHash: null,
        token: null, holder: null, presenter: null, linkSentAt: null, claimedAt: null, created: ++this.seq, orphanedAt: null });
    }
    const managers = this.host.managers(eventId, teamId);
    for (const userId of managers) if (!mine().some((p) => p.kind === 'manager' && p.userId === userId))
      this.passes.push({ id: uuid(), eventId, teamId, kind: 'manager', memberId: null, userId, holderName: '', nameKey: '', sourceHash: '', portrait: null, portraitHash: null,
        token: null, holder: null, presenter: null, linkSentAt: null, claimedAt: null, created: ++this.seq, orphanedAt: null });
    // A pass whose member has gone is refused from now on. One that reached a phone, or has a link out, is kept a week.
    const now = this.now(), orphan = (p: Pass) => p.kind === 'student' && !live.has(p.memberId!);
    for (const p of mine()) if (orphan(p) && p.orphanedAt === null) p.orphanedAt = now;
    // A manager who is removed takes with them whatever they were showing on the team's behalf.
    if (mine().some((p) => p.kind === 'manager' && !managers.includes(p.userId!))) for (const p of mine()) if (p.kind === 'student') p.presenter = null;
    const gone = new Set(mine().filter((p) => (p.kind === 'student'
      ? orphan(p) && ((p.holder === null && p.token === null) || now - p.orphanedAt! > ORPHAN_DAYS * 86_400_000) : opened && !managers.includes(p.userId!))).map((p) => p.id));
    this.passes = this.passes.filter((p) => !gone.has(p.id));
    this.checks = this.checks.filter((c) => !gone.has(c.passId));
  }
  /** The database brings passes in line whenever a team's members or managers change. Here that happens on the way in. */
  private follow(eventId: string): void {
    for (const key of new Set(this.passes.filter((p) => p.eventId === eventId).map((p) => p.teamId))) if (this.host.team(eventId, key)) this.sync(eventId, key, false);
  }

  async teamPasses(eventId: string, teamId: string): Promise<TeamPasses> {
    this.teamAccess(eventId, teamId); this.sync(eventId, teamId);
    const e = this.host.event(eventId)!, t = this.host.team(eventId, teamId)!, s = this.schedule(eventId, teamId), order = this.host.members(eventId, teamId).map((m) => m.id);
    const rows = this.passes.filter((p) => p.eventId === eventId && p.teamId === teamId && this.holderOf(p))
      .sort((a, b) => a.kind.localeCompare(b.kind) || order.indexOf(a.memberId ?? '') - order.indexOf(b.memberId ?? '') || a.created - b.created);
    const passes: TeamPass[] = rows.map((p) => { const h = this.holderOf(p)!; return { id: p.id, kind: p.kind, memberId: p.memberId, name: h.name, role: h.role,
      status: p.holder ? 'claimed' : p.token ? 'sent' : 'new', claimedAt: p.claimedAt, linkSentAt: p.linkSentAt, portrait: p.portrait,
      portraitStale: p.kind === 'student' && (p.portrait === null || p.portraitHash !== p.sourceHash), sourceHash: p.kind === 'student' ? p.sourceHash : null, mine: p.kind === 'manager' && p.userId === this.host.userId() }; });
    return { now: this.now(), team: { id: t.id, number: t.number, name: t.name, school: t.school }, event: { id: e.id, name: e.name, startsOn: e.startsOn, days: s.days },
      stream: s.stream, activities: s.activities, timezone: s.timezone, pulseKey: this.pulseKey(eventId), passes };
  }
  async setPassPortrait(passId: string, jpeg: string, source?: string | null): Promise<void> {
    const p = this.guard(passId);
    if (p.kind === 'manager' && p.userId !== this.host.userId() && !this.host.staff(p.eventId)) throw forbidden('A manager adds their own portrait');
    let bytes: string;
    try { bytes = atob(jpeg); } catch { throw new ApiError('invalid', 'The portrait must be a JPEG'); }
    if (bytes.length < 4 || bytes.length > 65536 || !bytes.startsWith('\xff\xd8\xff')) throw new ApiError('invalid', 'The portrait must be a JPEG of at most 64 KB');
    p.portrait = jpeg; p.portraitHash = source ?? p.sourceHash;
  }
  async setManagerPassName(passId: string, name: string): Promise<void> {
    const p = this.guard(passId), n = tidy(name);
    if (p.kind !== 'manager' || n.length < 1 || n.length > 100) throw new ApiError('invalid', 'Enter the manager’s name, up to 100 characters');
    if (p.userId !== this.host.userId() && !this.host.staff(p.eventId)) throw forbidden('A manager names their own pass');
    p.holderName = n;
  }
  async passLink(passId: string): Promise<string> {
    const p = this.guard(passId);
    if (p.kind === 'manager' && p.userId !== this.host.userId() && !this.host.staff(p.eventId)) throw forbidden('A manager sends their own pass to their own phone');
    if (p.kind === 'manager' && !p.holderName) throw new ApiError('invalid', 'Add the manager’s name to the pass first');
    p.token = randomHex(32); p.holder = null; p.claimedAt = null; p.linkSentAt = new Date(this.now()).toISOString();
    return p.token;
  }
  async resetPass(passId: string): Promise<void> {
    const p = this.guard(passId);
    p.token = null; p.holder = null; p.presenter = null; p.claimedAt = null; p.linkSentAt = null;
  }
  async presentPass(passId: string): Promise<string> {
    const p = this.guard(passId);
    if (p.kind === 'manager' && !p.holderName) throw new ApiError('invalid', 'Add the manager’s name to the pass first');
    // Everyone allowed to show a pass shares one secret, so a second person, or a reload, does not stop the first.
    p.presenter ??= randomHex(32);
    return p.presenter;
  }
  /** What the student's phone does with its link. No account is involved. */
  async claimPass(passId: string, token: string): Promise<{ secret: string; card: PassCardData }> {
    const found = this.passes.find((x) => x.id === passId);
    if (found) this.follow(found.eventId);
    const p = this.passes.find((x) => x.id === passId && x.token !== null && x.token === token);
    if (!p || !this.host.event(p.eventId) || !this.holderOf(p)) throw new ApiError('forbidden', 'pass link not valid');
    p.holder = randomHex(32); p.token = null; p.claimedAt = new Date(this.now()).toISOString();
    return { secret: p.holder, card: this.card(p) };
  }
  private async signer(p: Pass, step: number, mac: string): Promise<'holder' | 'presenter' | null> {
    for (const who of ['holder', 'presenter'] as const) { const secret = p[who]; if (secret && await macFor(await importSecret(secret), p.id, step) === mac.toUpperCase()) return who; }
    return null;
  }
  async passCard(passId: string, step: number, mac: string): Promise<PassCardData> {
    const found = this.passes.find((x) => x.id === passId);
    if (found) this.follow(found.eventId);
    const p = this.passes.find((x) => x.id === passId);
    if (!p || Math.abs(step - currentStep(this.now())) > 1 || !this.host.event(p.eventId) || !this.holderOf(p) || !(await this.signer(p, step, mac))) throw new ApiError('forbidden', 'pass not valid');
    return this.card(p);
  }
  private holder(p: Pass): PassHolder {
    const h = this.holderOf(p)!, t = this.host.team(p.eventId, p.teamId)!;
    return { ...h, kind: p.kind, team: { number: t.number, name: t.name }, stream: this.streamOf(p.eventId, p.teamId), portrait: p.portrait };
  }
  private today(eventId: string, at: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.host.schedule(eventId)?.timezone ?? 'Asia/Kolkata' }).format(new Date(at));
  }
  async checkPass(eventId: string, code: string, options: CheckOptions = {}): Promise<PassCheckResult> {
    this.doorAccess(eventId); this.follow(eventId);
    const parsed = parsePassCode(code);
    const p = parsed && this.passes.find((x) => x.id === parsed.passId);
    if (!parsed || !p) return { result: 'unknown' };
    if (p.eventId !== eventId) return { result: 'wrong_event' };
    const who = await this.signer(p, parsed.step, parsed.mac);
    if (!this.holderOf(p) || !who) return { result: 'invalid' };
    if (Math.abs(parsed.step - currentStep(this.now())) > 1) return { result: 'expired' };
    const presenter = who === 'presenter' && p.kind === 'student', device = options.device ?? '', now = this.now();
    const prior = this.checks.filter((c) => c.passId === p.id && c.step === parsed.step && c.presenter === presenter).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))[0];
    const earlier = this.checks.filter((c) => c.passId === p.id && c.result === 'genuine' && c !== prior && this.today(eventId, Date.parse(c.scannedAt)) === this.today(eventId, now)).map((c) => c.scannedAt).sort()[0] ?? null;
    const same = !!prior && prior.result === 'genuine' && prior.device === device && Date.parse(prior.scannedAt) > now - 5000;
    const result = !prior || same ? 'genuine' : 'replay';
    if (!same) this.checks.push({ id: options.checkId ?? uuid(), eventId, passId: p.id, step: parsed.step, result, presenter, gate: (options.gate ?? '').trim().slice(0, 40), device, scannedAt: new Date(now).toISOString() });
    return { result, presenter, firstSeenToday: earlier, holder: this.holder(p) };
  }
  private listed(eventId: string): Pass[] {
    return this.passes.filter((p) => p.eventId === eventId && this.holderOf(p)).sort((a, b) => this.host.team(eventId, a.teamId)!.number.localeCompare(this.host.team(eventId, b.teamId)!.number) || a.kind.localeCompare(b.kind) || a.created - b.created);
  }
  async doorList(eventId: string): Promise<DoorList> {
    this.doorAccess(eventId); this.follow(eventId);
    return { now: this.now(), timezone: this.host.schedule(eventId)?.timezone ?? 'Asia/Kolkata', pulseKey: this.pulseKey(eventId),
      passes: this.listed(eventId).map((p) => { const h = this.holder(p); return { id: p.id, kind: p.kind, name: h.name, role: h.role, team: h.team, stream: h.stream, holder: p.holder, presenter: p.presenter, hasPortrait: p.portrait !== null }; }) };
  }
  async doorPortraits(eventId: string, after: string | null = null): Promise<Array<{ id: string; portrait: string }>> {
    this.doorAccess(eventId);
    return this.passes.filter((p) => p.eventId === eventId && p.portrait !== null && (after === null || p.id > after)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 40).map((p) => ({ id: p.id, portrait: p.portrait! }));
  }
  async recordPassChecks(eventId: string, checks: QueuedCheck[]): Promise<number> {
    this.doorAccess(eventId);
    if (!Array.isArray(checks) || checks.length > 500) throw new ApiError('invalid', 'Send up to 500 checks at a time');
    let added = 0;
    for (const c of checks) {
      if (!this.passes.some((p) => p.id === c.passId && p.eventId === eventId) || !['genuine', 'replay'].includes(c.result) || this.checks.some((x) => x.id === c.id)) continue;
      this.checks.push({ ...c, eventId, scannedAt: new Date(Math.min(Date.parse(c.scannedAt), this.now())).toISOString() }); added++;
    }
    return added;
  }
  async passArrivals(eventId: string): Promise<PassArrivals> {
    this.doorAccess(eventId); this.follow(eventId);
    const day = this.today(eventId, this.now()), listed = this.listed(eventId);
    const arrived = listed.flatMap((p) => {
      const first = this.checks.filter((c) => c.passId === p.id && c.result === 'genuine' && this.today(eventId, Date.parse(c.scannedAt)) === day).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))[0];
      if (!first) return [];
      const h = this.holder(p);
      return [{ passId: p.id, name: h.name, kind: p.kind, teamNumber: h.team.number, teamName: h.team.name, firstSeen: first.scannedAt, gate: first.gate }];
    }).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
    return { day, total: listed.length, arrived };
  }
  async passPulseKey(eventId: string): Promise<string> {
    if (!this.host.userId() || !this.host.event(eventId) || !this.host.eventStaff(eventId)) throw forbidden('The pass reference is for event staff');
    return this.pulseKey(eventId);
  }
}
