/*
 * Keeps the Paddock Pass page on the phone so a pass opens with no signal.
 * Scoped to /pass/ only. The rest of the platform has no worker and this one never touches it.
 * Nothing private is cached here: the pass itself lives in the page's own storage, and database calls are never kept.
 */
const CACHE = 'sri-pass-v1';
const PAGE = '/pass/';
const own = (url) => { try { return new URL(url, self.location.href).origin === self.location.origin; } catch { return false; } };

const pathOf = (url) => new URL(url, self.location.href).pathname;
/* A built file's name changes whenever its contents do, so a saved copy of one is always right. */
const built = (path) => path.startsWith('/assets/');
const needsOf = (html) => [...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('//'));

async function keep(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(urls.filter(own).map(async (url) => {
    const path = pathOf(url);
    // The page itself is only ever replaced whole, by renew().
    if (path === PAGE) { if (!(await cache.match(PAGE))) await renew().catch(() => {}); return; }
    if (built(path) && await cache.match(url)) return;
    // Everything else (the logo, the fonts) keeps its name when it changes, so it is checked again on each visit.
    try { const response = await fetch(url, { cache: built(path) ? 'reload' : 'no-cache' }); if (response.ok) await cache.put(url, response); } catch { /* next visit */ }
  }));
}

/* Built files from an earlier version go once neither the page that is open nor the page that is saved uses them. */
async function prune(urls) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(PAGE);
  if (!saved) return;
  const wanted = new Set([...urls.filter(own).map(pathOf), ...needsOf(await saved.text())]);
  for (const request of await cache.keys()) {
    const path = pathOf(request.url);
    if (built(path) && !wanted.has(path)) await cache.delete(request);
  }
}

/* True when the saved page and every file it loads are on the phone: only then does the pass open with no signal. */
async function whole() {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(PAGE);
  if (!saved) return false;
  for (const url of needsOf(await saved.text())) if (!(await cache.match(url))) return false;
  return true;
}

/* A new copy of the page replaces the saved one only once everything it loads is saved too, so an update can never leave a phone with half a page. */
async function renew() {
  const response = await fetch(PAGE, { cache: 'no-store' });
  if (!response.ok) return;
  const html = await response.clone().text();
  const needs = needsOf(html);
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
  if (!(event.data && event.data.type === 'keep' && Array.isArray(event.data.urls))) return;
  const urls = event.data.urls.filter((u) => typeof u === 'string').slice(0, 80), port = event.ports && event.ports[0];
  const answer = (saved) => { if (port) port.postMessage({ saved }); };
  event.waitUntil(keep(urls).then(() => prune(urls)).then(whole).then(answer, () => answer(false)));
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
