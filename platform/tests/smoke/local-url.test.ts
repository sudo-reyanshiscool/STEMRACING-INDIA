import { describe, expect, it } from 'vitest';
import { isLocalUrl } from './local-url';

describe('isLocalUrl (the smoke test must never run against a hosted project)', () => {
  it('accepts only localhost, 127.0.0.1 and [::1] hosts', () => {
    for (const u of ['http://localhost:54321', 'http://127.0.0.1:55321', 'http://[::1]:54321', 'https://localhost', 'http://LOCALHOST:1']) {
      expect(isLocalUrl(u), u).toBe(true);
    }
  });

  it('rejects look-alikes, userinfo tricks, other schemes and junk', () => {
    for (const u of [
      'http://localhost:@evil.example/', 'http://localhost@evil.example', 'http://evil.example/localhost', 'http://localhost.evil.example',
      'http://127.0.0.1.evil.example', 'https://abcd.supabase.co', 'ftp://localhost', 'localhost:54321', '', 'not a url', 'http://localhostx',
      'http://127.0.0.2:54321', 'http://0.0.0.0:54321', 'javascript:localhost',
    ]) expect(isLocalUrl(u), u).toBe(false);
    expect(isLocalUrl(undefined)).toBe(false);
  });
});
