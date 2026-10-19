/* Retire the offline scrutineering worker previously served at this address.
 * Keep this file at /sw.js so existing installations can update to it.
 * Inspection records in IndexedDB and localStorage are deliberately untouched.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.allSettled(names.filter((name) => name.startsWith('workbox-precache-')).map((name) => caches.delete(name)));
    // Replace the old cache-first controller before refreshing its open pages.
    // This worker has no fetch handler, so requests now go to the current deployment.
    await self.clients.claim();
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    // A fresh URL also bypasses an HTTP-cached copy of the old HTML.
    const home = new URL('/?app=events-v1#/', self.location.origin).href;
    await Promise.allSettled(windows.map((client) => client.navigate(home)));
  })());
});
