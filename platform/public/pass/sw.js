/*
 * Keeps the Paddock Pass page on the phone so a pass opens with no signal.
 * Scoped to /pass/ only. The rest of the platform has no worker and this one never touches it.
 * Nothing private is cached here: the pass itself lives in the page's own storage, and database calls are never kept.
 */
const CACHE = 'sri-pass-v1';
const PAGE = '/pass/';
const own = (url) => { try { return new URL(url, self.location.href).origin === self.location.origin; } catch { return false; } };

async function keep(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.filter(own).map(async (url) => {
    if (await cache.match(url)) return;
    try { const response = await fetch(url, { cache: 'reload' }); if (response.ok) await cache.put(url, response); } catch { /* next visit */ }
  }));
}

/* A new copy of the page replaces the saved one only once everything it loads is saved too, so an update can never leave a phone with half a page. */
async function renew() {
  const response = await fetch(PAGE, { cache: 'no-store' });
  if (!response.ok) return;
  const html = await response.clone().text();
  const needs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('//'));
  const cache = await caches.open(CACHE);
  for (const url of needs) {
    if (await cache.match(url)) continue;
    const part = await fetch(url);
    if (!part.ok) return;
    await cache.put(url, part);
  }
  await cache.put(PAGE, response);
}

self.addEventListener('install', (event) => { event.waitUntil(renew().catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sri-pass-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'keep' && Array.isArray(event.data.urls)) event.waitUntil(keep(event.data.urls.filter((u) => typeof u === 'string').slice(0, 80)));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !own(request.url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match(PAGE).then((saved) => {
      const fresh = renew().catch(() => {});
      if (saved) { event.waitUntil(fresh); return saved; }
      return fetch(request);
    }));
    return;
  }
  event.respondWith(caches.match(request).then((saved) => saved || fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy))); }
    return response;
  })));
});
