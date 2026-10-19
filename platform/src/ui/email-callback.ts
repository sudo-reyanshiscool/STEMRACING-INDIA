/** Email tokens stay in the fragment and in memory; never store or log them as application data. */
export type EmailCallback = { kind: 'confirm'; tokenHash: string } | { kind: 'invalid' } | { kind: 'legacy' } | null;

export function readEmailCallback(hash: string): EmailCallback {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.has('error') || params.has('error_code') || params.has('error_description')) return { kind: 'invalid' };
  if (params.has('token_hash')) {
    const tokenHash = params.get('token_hash') ?? '';
    return params.get('type') === 'email' && /^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash)
      ? { kind: 'confirm', tokenHash } : { kind: 'invalid' };
  }
  // Leave older Supabase access/refresh-token links untouched until the SDK finishes initialization.
  if (params.has('access_token') || params.has('refresh_token') || params.has('code')) return { kind: 'legacy' };
  return null;
}

export function clearEmailCallback(): void {
  history.replaceState(history.state, '', location.pathname + location.search + '#/');
}
