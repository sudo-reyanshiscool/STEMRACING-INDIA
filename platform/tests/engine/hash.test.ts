import { describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256Fallback, sha256Hex } from '../../src/engine/hash';

describe('canonicalJson', () => {
  it('is independent of key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('keeps array order and distinguishes values', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
  it('drops undefined object members like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('canonicalJson refuses values that would collapse', () => {
  it('throws on NaN and Infinity', () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson([Infinity])).toThrow();
    expect(() => canonicalJson(-Infinity)).toThrow();
  });
  it('throws on bigint, symbol and function values (top level, array element)', () => {
    expect(() => canonicalJson({ a: 1n })).toThrow();
    expect(() => canonicalJson({ a: Symbol('x') })).toThrow();
    expect(() => canonicalJson([() => 1])).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
  it('drops function members like undefined members', () => {
    expect(canonicalJson({ a: 1, f: () => 1, u: undefined })).toBe('{"a":1}');
  });
  it('rejects non-plain objects instead of serialising them as {}', () => {
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson({ a: new Map([[1, 2]]) })).toThrow();
    expect(() => canonicalJson([new Set([1])])).toThrow();
    expect(() => canonicalJson(/x/)).toThrow();
  });
  it('accepts null-prototype objects', () => {
    const o = Object.create(null) as Record<string, number>;
    o.a = 1;
    expect(canonicalJson(o)).toBe('{"a":1}');
  });
  it('rejects undefined array elements and sparse holes rather than conflating them with null', () => {
    expect(() => canonicalJson([1, undefined])).toThrow();
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3])).toThrow();
    expect(canonicalJson([1, null, 3])).toBe('[1,null,3]');
  });
  it('detects cycles but allows a shared (non-cyclic) reference', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/cycl|circular/i);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalJson(arr)).toThrow(/cycl|circular/i);
    const shared = { x: 1 };
    expect(canonicalJson({ p: shared, q: shared })).toBe('{"p":{"x":1},"q":{"x":1}}');
  });
});

describe('sha256', () => {
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  it('the built-in fallback matches the known SHA-256 vectors', () => {
    for (const [input, output] of vectors) expect(sha256Fallback(input), input).toBe(output);
  });
  it('sha256Hex agrees with the fallback, including for non-ASCII text and long input', async () => {
    for (const t of ['abc', 'स्टेम रेसिंग 🚗', 'x'.repeat(10_000)]) expect(await sha256Hex(t)).toBe(sha256Fallback(t));
  });
  it('falls back when crypto.subtle is unavailable (plain http origins)', async () => {
    vi.stubGlobal('crypto', {});
    try {
      expect(await sha256Hex('abc')).toBe(vectors[1][1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('is 64 lowercase hex characters', async () => {
    expect(await sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
