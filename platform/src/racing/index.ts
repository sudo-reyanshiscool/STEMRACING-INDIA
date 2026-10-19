export type RaceStatus = 'pending' | 'finished' | 'dnf' | 'dns' | 'false_start';
export interface RaceLane { teamId: string; car: 'A' | 'B'; status: RaceStatus; totalMs: number | null; reactionMs: number | null }
export interface RaceInput { label: string; phase: 'reaction' | 'knockout'; lane1: RaceLane; lane2: RaceLane; note: string; source: 'manual' | 'denford'; sourceRunId: string | null }
export interface RaceHeat extends RaceInput { id: string; eventId: string; number: number; revision: number; updatedAt: string }
export interface TimingState { connectionId: string; expiresAt: string; lastSeenAt: string | null; payload: Record<string, unknown> | null }
export interface TimingPair { token: string; connectionId: string; expiresAt: string }
export const STATUS_LABEL: Record<RaceStatus, string> = { pending: 'Awaiting run', finished: 'Finished', dnf: 'DNF', dns: 'DNS', false_start: 'False start' };
export const blankLane = (teamId = ''): RaceLane => ({ teamId, car: 'A', status: 'pending', totalMs: null, reactionMs: null });
export const raceRecorded = (r: RaceInput) => r.lane1.status !== 'pending' || r.lane2.status !== 'pending';
/** Parse exact milliseconds, never silently round a fourth decimal place. */
export function parseSeconds(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(value.trim())) return null;
  const [seconds, fraction = ''] = value.trim().split('.');
  return Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
}
export const seconds = (ms: number | null) => ms === null ? '—' : (ms / 1000).toFixed(3);
export function validateRace(r: RaceInput): string | null {
  if (!r || !['reaction', 'knockout'].includes(r.phase) || !r.label?.trim() || r.label.trim().length > 100) return 'Choose a race phase and a label of 1–100 characters.';
  if (typeof r.note !== 'string' || r.note.length > 1000 || !['manual', 'denford'].includes(r.source)) return 'Check the race notes and entry source.';
  if (r.source === 'manual' ? r.sourceRunId !== null : !r.sourceRunId || r.sourceRunId.length > 160) return 'The track run reference is missing or invalid.';
  if (!r.lane1?.teamId || !r.lane2?.teamId || r.lane1.teamId === r.lane2.teamId) return 'Choose two different teams.';
  for (const [index, lane] of [r.lane1, r.lane2].entries()) {
    if (!['A', 'B'].includes(lane.car) || !Object.hasOwn(STATUS_LABEL, lane.status)) return `Check the car and status for lane ${index + 1}.`;
    if (lane.status === 'finished') {
      if (!Number.isInteger(lane.totalMs) || !Number.isInteger(lane.reactionMs) || lane.totalMs! <= 0 || lane.totalMs! >= 1_000_000 || lane.reactionMs! < 0 || lane.reactionMs! >= lane.totalMs!) return `Lane ${index + 1}: enter a total time greater than the reaction time, to 3 decimal places.`;
    } else if (lane.totalMs !== null || lane.reactionMs !== null) return `Lane ${index + 1}: only a finished run can have official times.`;
  }
  return null;
}
export function outcome(r: RaceInput): string {
  const a = r.lane1, b = r.lane2;
  if (a.status === 'pending' || b.status === 'pending') return 'Awaiting both lanes';
  if (a.status !== 'finished' && b.status !== 'finished') return 'No winner · review / rerun';
  if (a.status !== 'finished') return 'Lane 2 wins';
  if (b.status !== 'finished') return 'Lane 1 wins';
  return a.totalMs === b.totalMs ? 'Tie · rerun required' : a.totalMs! < b.totalMs! ? 'Lane 1 wins' : 'Lane 2 wins';
}
/** Best reaction-race times only. No points or knockout advancement are inferred. */
export function raceStandings(races: RaceHeat[]) {
  const teams = new Map<string, { teamId: string; runs: number; totalMs: number | null; carMs: number | null }>();
  for (const r of races.filter((r) => r.phase === 'reaction')) for (const lane of [r.lane1, r.lane2]) {
    const row = teams.get(lane.teamId) ?? { teamId: lane.teamId, runs: 0, totalMs: null, carMs: null };
    if (lane.status !== 'pending') row.runs++;
    if (lane.status === 'finished') { row.totalMs = Math.min(row.totalMs ?? Infinity, lane.totalMs!); row.carMs = Math.min(row.carMs ?? Infinity, lane.totalMs! - lane.reactionMs!); }
    teams.set(lane.teamId, row);
  }
  return [...teams.values()].sort((a, b) => (a.totalMs ?? Infinity) - (b.totalMs ?? Infinity) || a.teamId.localeCompare(b.teamId));
}
export interface DenfordLane { status: Exclude<RaceStatus, 'pending'> | 'reaction_only'; totalMs: number | null; reactionMs: number | null }
export interface DenfordResult { raceId: string; lane1: DenfordLane; lane2: DenfordLane }
const measurement = (v: unknown): number | null => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && !/^\d+$/.test(v)) return null;
  const n = Number(v); return Number.isSafeInteger(n) && n >= 0 && n <= 99999 ? n : null;
};
/** StartGate v1.9: integer milliseconds; sentinels are statuses, never times. */
export function parseDenford(payload: Record<string, unknown> | null): DenfordResult | null {
  if (!payload || !['string', 'number'].includes(typeof payload.raceid)) return null;
  const raceId = String(payload.raceid);
  if (!/^\d{1,20}$/.test(raceId) || /^0+$/.test(raceId)) return null;
  if (/STARTING|LIGHTS OUT|ABORTED/i.test(String(payload.racestatus ?? ''))) return null;
  const lane = (n: number): DenfordLane | null => {
    const reactionMs = measurement(payload[`player${n}TriggerTime`]);
    const totalMs = measurement(payload[`player${n}CombinedTime`]);
    const carMs = measurement(payload[`player${n}RaceTime`]);
    const fields = [reactionMs, totalMs, carMs];
    for (const [sentinel, status] of [[99997, 'false_start'], [99998, 'dns'], [99999, 'dnf']] as const) {
      if (fields.includes(sentinel)) return { status, totalMs: null, reactionMs: null };
    }
    if (reactionMs === null || totalMs === null || carMs === null) return null;
    if (totalMs > 0 && totalMs < 99997 && totalMs > reactionMs && carMs > 0 && carMs < 99997 && totalMs === reactionMs + carMs) return { status: 'finished', totalMs, reactionMs };
    if (reactionMs > 0 && reactionMs < 99997 && totalMs === 0 && carMs === 0) return { status: 'reaction_only', totalMs: null, reactionMs };
    return null;
  };
  const a = lane(1), b = lane(2);
  return a && b ? { raceId, lane1: a, lane2: b } : null;
}
