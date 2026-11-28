import type { DoorList, PassCheckResult, QueuedCheck } from '../api/passes';
import { currentStep, importSecret, macFor, parsePassCode } from './code';

/** A check this scanner has already made, as far as it matters for spotting a repeat. */
export type SeenScan = Pick<QueuedCheck, 'passId' | 'step' | 'presenter' | 'result' | 'scannedAt'>;
export interface OfflineCheck {
  result: PassCheckResult;
  /** What to upload when signal returns. Null when nothing new was learned. */
  record: Pick<QueuedCheck, 'passId' | 'step' | 'result' | 'presenter'> | null;
}

const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (hex: string) => { let k = keys.get(hex); if (!k) { k = importSecret(hex); keys.set(hex, k); } return k; };
const dayIn = (timezone: string, at: number): string => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(at)); }
  catch { return new Date(at).toISOString().slice(0, 10); }
};

/**
 * Checks a scanned code against the door list on this phone, the way the database would.
 *
 * The list may be hours old, so this never says a pass is fake: a pass that is missing from the list, or that does
 * not match it, may have been issued or sent again since the download. Both read as "unlisted" and need a check online.
 */
export async function verifyOffline(cache: { list: DoorList; portraits: Record<string, string> }, code: string, nowMs: number, seen: SeenScan[] = []): Promise<OfflineCheck> {
  const none = (result: PassCheckResult['result']): OfflineCheck => ({ result: { result, offline: true }, record: null });
  const parsed = parsePassCode(code);
  if (!parsed) return none('unknown');
  const entry = cache.list.passes.find((p) => p.id === parsed.passId);
  if (!entry) return none('unlisted');
  let signer: 'holder' | 'presenter' | null = null;
  for (const who of ['holder', 'presenter'] as const) {
    const secret = entry[who];
    if (secret && await macFor(await keyFor(secret), entry.id, parsed.step) === parsed.mac) { signer = who; break; }
  }
  if (!signer) return none('unlisted');
  if (Math.abs(parsed.step - currentStep(nowMs)) > 1) return none('expired');
  const presenter = signer === 'presenter' && entry.kind === 'student';
  const mine = seen.filter((s) => s.passId === entry.id);
  const prior = mine.filter((s) => s.step === parsed.step && s.presenter === presenter).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))[0];
  const today = dayIn(cache.list.timezone, nowMs);
  const firstSeenToday = mine.filter((s) => s !== prior && s.result === 'genuine' && dayIn(cache.list.timezone, Date.parse(s.scannedAt)) === today).map((s) => s.scannedAt).sort()[0] ?? null;
  // The very same code again is how a passed-back screenshot looks, unless it is this scanner reading it twice.
  const same = !!prior && prior.result === 'genuine' && nowMs - Date.parse(prior.scannedAt) <= 5000;
  const result = !prior || same ? 'genuine' : 'replay';
  return {
    result: { result, offline: true, presenter, firstSeenToday,
      holder: { name: entry.name, role: entry.role, kind: entry.kind, team: entry.team, stream: entry.stream, portrait: cache.portraits[entry.id] ?? null } },
    record: same ? null : { passId: entry.id, step: parsed.step, result, presenter },
  };
}
