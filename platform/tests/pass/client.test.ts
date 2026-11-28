import { describe, expect, it, vi } from 'vitest';
import { createRpc, RpcError } from '../../src/pass/client';

const config = { url: 'https://db.example.test/', anonKey: 'anon', schema: 'stem_racing' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the pass page client', () => {
  it('calls a database function with the public key and the right schema', async () => {
    const fetcher = vi.fn(async () => reply(200, { ok: 1 }));
    expect(await createRpc(config, fetcher as never)('claim_pass', { p_pass: 'x' })).toEqual({ ok: 1 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.example.test/rest/v1/rpc/claim_pass');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"p_pass":"x"}');
    expect(init.headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer anon', 'Content-Profile': 'stem_racing', 'Content-Type': 'application/json' });
  });
  it('reports a refusal with the database code', async () => {
    const rpc = createRpc(config, (async () => reply(401, { code: '42501', message: 'pass not valid' })) as never);
    await expect(rpc('pass_card', {})).rejects.toMatchObject({ code: '42501', status: 401, offline: false });
  });
  it('reports no signal as that, not as a refusal', async () => {
    const rpc = createRpc(config, (async () => { throw new TypeError('Failed to fetch'); }) as never);
    const err = await rpc("pass_now").catch((e: unknown) => e) as RpcError;
    expect(err).toBeInstanceOf(RpcError);
    expect(err.offline).toBe(true);
    expect(err.code).toBeNull();
  });
  it('treats a reply that is not JSON as a server fault', async () => {
    const rpc = createRpc(config, (async () => new Response('<html>bad gateway</html>', { status: 502 })) as never);
    await expect(rpc('pass_now')).rejects.toMatchObject({ status: 502, offline: false, code: null });
  });
});
