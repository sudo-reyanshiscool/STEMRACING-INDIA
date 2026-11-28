/** Paddock Pass: the digital ID cards for students and team managers. Shapes shared by the app, the pass page and the door. */

export interface PassStream { name: string; index: number }
export interface PassActivity { title: string; kind: string; start: string; end: string | null; location: string }

/** Everything a phone needs to draw one card and keep it right without signal. */
export interface PassCardData {
  passId: string;
  kind: 'student' | 'manager';
  name: string;
  role: string;
  team: { number: string; name: string; school: string };
  event: { id: string; name: string; startsOn: string | null; days: string[] };
  stream: PassStream | null;
  activities: PassActivity[];
  timezone: string;
  /** A small JPEG as base64, or null when there is none yet. */
  portrait: string | null;
  /** Hex. The key behind the sync pulse, shared by every pass at the event. */
  pulseKey: string;
  /** The server's clock when this was made, in milliseconds, so a phone with a wrong clock can correct itself. */
  now: number;
}

/** new: no link made yet. sent: a link is waiting to be opened. claimed: on a phone. */
export type PassStatus = 'new' | 'sent' | 'claimed';
export interface TeamPass {
  id: string;
  kind: 'student' | 'manager';
  memberId: string | null;
  name: string;
  role: string;
  status: PassStatus;
  claimedAt: string | null;
  linkSentAt: string | null;
  portrait: string | null;
  /** The submitted portrait has changed (or was never copied), so the small copy needs remaking. */
  portraitStale: boolean;
  /** A fingerprint of the member's submitted portrait as it was when the passes were read. Sent back with the small copy made from it. */
  sourceHash: string | null;
  /** The signed-in manager's own pass. */
  mine: boolean;
}
export interface TeamPasses {
  now: number;
  team: { id: string; number: string; name: string; school: string };
  event: PassCardData['event'];
  stream: PassStream | null;
  activities: PassActivity[];
  timezone: string;
  pulseKey: string;
  passes: TeamPass[];
}

/** The card for one of a team's passes. */
export function cardFor(team: TeamPasses, pass: TeamPass): PassCardData {
  return { passId: pass.id, kind: pass.kind, name: pass.name, role: pass.role, team: { number: team.team.number, name: team.team.name, school: team.team.school },
    event: team.event, stream: team.stream, activities: team.activities, timezone: team.timezone, portrait: pass.portrait, pulseKey: team.pulseKey, now: team.now };
}

/**
 * genuine: a live code from a phone that holds the pass. replay: that same code was already scanned.
 * expired: a real code, but too old (a screenshot). invalid: the pass exists but this code was not made by it
 * (reset, or forged). wrong_event / unknown: not one of this event's passes.
 * unlisted: only when checking without signal, for a pass issued after the door list was downloaded.
 */
export type PassCheckOutcome = 'genuine' | 'replay' | 'expired' | 'invalid' | 'wrong_event' | 'unknown' | 'unlisted';
export interface PassHolder { name: string; role: string; kind: 'student' | 'manager'; team: { number: string; name: string }; stream: PassStream | null; portrait: string | null }
export interface PassCheckResult {
  result: PassCheckOutcome;
  holder?: PassHolder;
  /** Shown by the team manager on the student's behalf. */
  presenter?: boolean;
  firstSeenToday?: string | null;
  /** Checked on this phone from the door list, not by the server. */
  offline?: boolean;
}

export interface DoorEntry {
  id: string; kind: 'student' | 'manager'; name: string; role: string; team: { number: string; name: string }; stream: PassStream | null;
  /** Hex secrets: the phone that holds the pass, and the manager's phone when the manager shows it. */
  holder: string | null; presenter: string | null; hasPortrait: boolean;
}
export interface DoorList { now: number; timezone: string; pulseKey: string; passes: DoorEntry[] }
/** A check made without signal, waiting to be uploaded. */
export interface QueuedCheck { id: string; passId: string; step: number; result: 'genuine' | 'replay'; presenter: boolean; gate: string; device: string; scannedAt: string }
export interface PassArrivals { day: string; total: number; arrived: Array<{ passId: string; name: string; kind: 'student' | 'manager'; teamNumber: string; teamName: string; firstSeen: string; gate: string }> }
export interface CheckOptions { gate?: string; checkId?: string; device?: string }

/** The link a student opens. The token sits after the #, so it is never sent to the web host. */
export function passLinkUrl(origin: string, passId: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/pass/#${passId}.${token}`;
}
export function parsePassLink(hash: string): { passId: string; token: string } | null {
  const m = /^#?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{64})$/i.exec(hash.trim());
  return m ? { passId: m[1].toLowerCase(), token: m[2].toLowerCase() } : null;
}
