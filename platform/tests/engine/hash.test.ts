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
