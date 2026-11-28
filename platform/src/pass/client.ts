/**
 * The pass page talks to the database with plain fetch, so a student's phone never loads the sign-in code or the app.
 * It can only reach the few functions that need no account.
 */
export class RpcError extends Error {
  /** The database's error code, when the database answered. 42501 is a refusal. */
  readonly code: string | null;
  readonly status: number;
  /** The request never reached the server. */
  readonly offline: boolean;
  constructor(message: string, info: { code?: string | null; status?: number; offline?: boolean } = {}) {
    super(message);
    this.name = 'RpcError';
    this.code = info.code ?? null; this.status = info.status ?? 0; this.offline = info.offline ?? false;
  }
}
export type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export interface PassConfig { url: string; anonKey: string; schema: string }

export function createRpc(config: PassConfig, fetcher: typeof fetch = (input, init) => fetch(input, init)): Rpc {
  const base = `${config.url.replace(/\/+$/, '')}/rest/v1/rpc/`;
  const headers = { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json', 'Content-Profile': config.schema };
  return async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    let response: Response;
    try { response = await fetcher(base + name, { method: 'POST', headers, body: JSON.stringify(args), cache: 'no-store' }); }
    catch (e) { throw new RpcError(e instanceof Error ? e.message : 'no connection', { offline: true }); }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* not JSON: judged by the status below */ }
    if (!response.ok) {
      const fault = (body ?? {}) as { code?: unknown; message?: unknown };
      throw new RpcError(typeof fault.message === 'string' ? fault.message : `request failed (${response.status})`, { code: typeof fault.code === 'string' ? fault.code : null, status: response.status });
    }
    return body as T;
  };
}

/** Where the database is, from the same public values the app is built with. Null in a build with no backend. */
export function passConfig(): PassConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL, anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey, schema: import.meta.env.VITE_SUPABASE_DB_SCHEMA ?? 'public' } : null;
}
