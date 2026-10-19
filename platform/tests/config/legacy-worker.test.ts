import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/sw.js', 'utf8');

function worker(failCacheDelete = false) {
  const listeners = new Map<string, (event: { waitUntil(p: Promise<unknown>): void }) => void>();
  const navigate = vi.fn().mockResolvedValue(undefined);
  const self = {
    addEventListener: (name: string, handler: (event: { waitUntil(p: Promise<unknown>): void }) => void) => listeners.set(name, handler),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    location: { origin: 'https://example.test' },
    clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue([{ navigate }]) },
    registration: { unregister: vi.fn().mockResolvedValue(true) },
  };
  const caches = {
    keys: vi.fn().mockResolvedValue(['workbox-precache-v2-https://example.test/', 'other-feature-cache']),
    delete: failCacheDelete ? vi.fn().mockRejectedValue(new Error('Unavailable')) : vi.fn().mockResolvedValue(true),
  };
  runInNewContext(source, { self, caches, URL, Promise });
  const dispatch = (name: string) => {
    let pending!: Promise<unknown>;
    listeners.get(name)!({ waitUntil: (p) => { pending = p; } });
    return pending;
  };
  return { self, caches, listeners, navigate, dispatch };
}

describe('retiring the legacy offline worker', () => {
  it('activates immediately and replaces cached scrutineering with the Events home', async () => {
    const w = worker();
    await w.dispatch('install'); expect(w.self.skipWaiting).toHaveBeenCalledOnce();
    await w.dispatch('activate');
    expect(w.caches.delete.mock.calls).toEqual([['workbox-precache-v2-https://example.test/']]);
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
    expect(w.self.registration.unregister).toHaveBeenCalledOnce();
    expect(w.navigate).toHaveBeenCalledWith('https://example.test/?app=events-v1#/');
    expect(w.listeners.has('fetch')).toBe(false);
    expect(w.self.clients.claim.mock.invocationCallOrder[0]).toBeLessThan(w.navigate.mock.invocationCallOrder[0]);
    // The worker runs without access to either data store, preserving inspection records.
    expect(source).not.toContain('deleteDatabase');
    expect(source).not.toContain('localStorage.clear');
  });
  it('still unregisters and reloads if deleting an old cache fails', async () => {
    const w = worker(true); await w.dispatch('activate');
    expect(w.self.registration.unregister).toHaveBeenCalledOnce();
    expect(w.navigate).toHaveBeenCalledOnce();
  });
  it('serves the replacement worker without HTTP caching', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.headers).toContainEqual({ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] });
  });
});
