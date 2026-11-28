import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeAt, currentStep, importSecret, macFor, parsePassCode, passCode, pulseAt, PULSE_MS, STEP_MS } from '../../src/pass/code';

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const PASS = '11111111-2222-4333-8444-555555555555';

describe('entry codes', () => {
  it('signs the pass and window exactly as the database does', async () => {
    const key = await importSecret(SECRET);
    // The same inputs are asserted against the SQL hmac_sha256 in tests/sql/paddock-passes.test.ts.
    const expected = createHmac('sha256', Buffer.from(SECRET, 'hex')).update(`SRI1|${PASS}|58000000`).digest('hex').slice(0, 16).toUpperCase();
    expect(await macFor(key, PASS, 58000000)).toBe(expected);
    expect(await macFor(key, PASS.toUpperCase(), 58000000)).toBe(expected);
    expect(await macFor(key, PASS, 58000001)).not.toBe(expected);
  });

  it('keeps the secret unreadable once imported', async () => {
    const key = await importSecret(SECRET);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await expect(importSecret('xyz')).rejects.toThrow();
  });

  it('writes and reads the code format', async () => {
    const code = passCode(PASS, 58000000, 'abcdef0123456789');
    expect(code).toBe('SRI1.11111111222243338444555555555555.58000000.ABCDEF0123456789');
    expect(code).toMatch(/^[0-9A-Z.]+$/);
    expect(parsePassCode(code)).toEqual({ passId: PASS, step: 58000000, mac: 'ABCDEF0123456789' });
    expect(parsePassCode(`  ${code.toLowerCase()}\n`)).toEqual({ passId: PASS, step: 58000000, mac: 'ABCDEF0123456789' });
    for (const bad of ['', 'hello', 'SRI2.11111111222243338444555555555555.1.ABCDEF0123456789', 'SRI1.1111.1.ABCDEF0123456789', 'SRI1.11111111222243338444555555555555.x.ABCDEF0123456789',
      'SRI1.11111111222243338444555555555555.1.ABC', 'https://example.test/SRI1.11111111222243338444555555555555.1.ABCDEF0123456789'])
      expect(parsePassCode(bad)).toBeNull();
  });

  it('changes the code every thirty seconds and not before', async () => {
    const key = await importSecret(SECRET);
    const t = 1_800_000_000_000;
    expect(currentStep(t)).toBe(Math.floor(t / STEP_MS));
    const a = await codeAt(key, PASS, t), b = await codeAt(key, PASS, t + STEP_MS - 1 - (t % STEP_MS)), c = await codeAt(key, PASS, t + STEP_MS);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(parsePassCode(c)!.step).toBe(parsePassCode(a)!.step + 1);
  });
});

describe('sync pulse', () => {
  it('is the same for everyone holding the key, and steady inside a window', async () => {
    const key = await importSecret(SECRET), again = await importSecret(SECRET), other = await importSecret('ff'.repeat(32));
    const t = 1_800_000_000_000 - (1_800_000_000_000 % PULSE_MS);
    const digest = createHmac('sha256', Buffer.from(SECRET, 'hex')).update(`pulse|${t / PULSE_MS}`).digest();
    expect(await pulseAt(key, t)).toEqual({ k: t / PULSE_MS, glyph: digest[0] % 6, colour: digest[1] % 6 });
    expect(await pulseAt(again, t + PULSE_MS - 1)).toEqual(await pulseAt(key, t));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) { const p = await pulseAt(key, t + i * PULSE_MS); seen.add(`${p.glyph}:${p.colour}`); }
    expect(seen.size).toBeGreaterThan(10);   // it really moves
    let differs = 0;
    for (let i = 0; i < 20; i++) { const a = await pulseAt(key, t + i * PULSE_MS), b = await pulseAt(other, t + i * PULSE_MS); if (a.glyph !== b.glyph || a.colour !== b.colour) differs++; }
    expect(differs).toBeGreaterThan(10);     // another event's passes are out of step
  });
});
