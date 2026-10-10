const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True only when the URL really points at this machine. Parsed, not pattern-matched: `http://localhost:@evil.example/`
 * starts with "localhost" but its host is evil.example.
 */
export function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && HOSTS.has(u.hostname.toLowerCase());
}
