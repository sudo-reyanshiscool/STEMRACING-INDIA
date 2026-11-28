/**
 * The entry code a pass shows, and the sync pulse.
 *
 * A code is `SRI1.<pass id>.<window>.<mac>`: the window is the time in 30-second steps and the mac is the first eight
 * bytes of HMAC-SHA256 over `SRI1|<pass id>|<window>` with a secret only this phone and the database hold. The database
 * checks it the same way (migration 0059), and a scanner without signal checks it here.
 */
export const STEP_MS = 30_000;
export const PULSE_MS = 8_000;
/** How many shapes and colours the sync pulse chooses between. */
export const PULSE_CHOICES = 6;

const text = new TextEncoder();
const HEX = /^[0-9a-f]+$/i;

export function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) throw new Error('not a hex string');
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The secret as a key that can sign but can never be read back out, so a stored pass cannot be copied off the phone by script. */
export async function importSecret(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexBytes(hex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(key: CryptoKey, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(message)));
}

export const currentStep = (nowMs: number): number => Math.floor(nowMs / STEP_MS);

export async function macFor(key: CryptoKey, passId: string, step: number): Promise<string> {
  return toHex((await sign(key, `SRI1|${passId.toLowerCase()}|${step}`)).subarray(0, 8)).toUpperCase();
}

/** Upper case, digits and dots only, which a QR code stores in its compact alphanumeric mode. */
export function passCode(passId: string, step: number, mac: string): string {
  return `SRI1.${passId.replace(/-/g, '').toUpperCase()}.${step}.${mac.toUpperCase()}`;
}

export async function codeAt(key: CryptoKey, passId: string, nowMs: number): Promise<string> {
  const step = currentStep(nowMs);
  return passCode(passId, step, await macFor(key, passId, step));
}

export interface ParsedCode { passId: string; step: number; mac: string }

/** Null for anything that is not shaped like a pass code. Says nothing about whether the code is genuine. */
export function parsePassCode(scanned: string): ParsedCode | null {
  const m = /^SRI1\.([0-9A-F]{32})\.([0-9]{1,12})\.([0-9A-F]{16})$/.exec(scanned.trim().toUpperCase());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return { passId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, step: Number(m[2]), mac: m[3] };
}

export interface Pulse { k: number; glyph: number; colour: number }

/** The shape and colour every valid pass at the event shows right now. It changes every eight seconds. */
export async function pulseAt(key: CryptoKey, nowMs: number): Promise<Pulse> {
  const k = Math.floor(nowMs / PULSE_MS);
  const digest = await sign(key, `pulse|${k}`);
  return { k, glyph: digest[0] % PULSE_CHOICES, colour: digest[1] % PULSE_CHOICES };
}
