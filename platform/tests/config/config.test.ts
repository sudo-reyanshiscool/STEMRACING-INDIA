import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toml = readFileSync('supabase/config.toml', 'utf8');
const list = (key: string): string[] => {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
};

describe('local Supabase config', () => {
  it('allows the sign-in link to return to the dev server on localhost and 127.0.0.1, ports 5173 and 5174', () => {
    const allowed = list('additional_redirect_urls');
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of [5173, 5174]) {
        expect(allowed, `${host}:${port}`).toContain(`http://${host}:${port}/`);
      }
    }
  });

  it('keeps PostgREST max_rows at the page size the adapter assumes, or higher', () => {
    const max = Number(toml.match(/^max_rows\s*=\s*(\d+)/m)![1]);
    expect(max).toBeGreaterThanOrEqual(1000);
  });
});
