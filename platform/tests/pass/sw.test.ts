import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The pass page's worker, run here against a stand-in browser: a cache, a network that can be switched off,
 * and the events a browser would send it.
 */
const SOURCE = readFileSync(new URL('../../public/pass/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://events.example.test';
const page = (version: string) => `<!doctype html><html><head><link rel="stylesheet" href="/assets/pass-${version}.css"><script type="module" src="/assets/pass-${version}.js"></script></head><body></body></html>`;

function browser() {
  const site = new Map<string, string>(), store = new Map<string, Response>(), fetched: string[] = [];
  let online = true;
  const path = (key: unknown) => new URL(typeof key === 'string' ? key : (key as Request).url, `${ORIGIN}/pass/sw.js`).pathname;
  const cache = {
    match: async (key: unknown) => store.get(path(key))?.clone(),
    put: async (key: unknown, response: Response) => { store.set(path(key), response); },
    delete: async (key: unknown) => store.delete(path(key)),
    keys: async () => [...store.keys()].map((p) => new Request(ORIGIN + p)),
  };
  const caches = { open: async () => cache, match: cache.match, keys: async () => ['sri-pass-v1'], delete: async () => true };
  const fetch = async (key: unknown) => {
    const p = path(key);
    if (!online) throw new TypeError('Failed to fetch');
    fetched.push(p);
    return site.has(p) ? new Response(site.get(p), { status: 200 }) : new Response('missing', { status: 404 });
  };
  const handlers: Record<string, (event: any) => void> = {};
  const self = { location: { href: `${ORIGIN}/pass/sw.js`, origin: ORIGIN }, addEventListener: (type: string, fn: (event: any) => void) => { handlers[type] = fn; }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetch);
  /** Sends the worker an event and waits for everything it said it would finish. */
  async function send(type: string, more: Record<string, unknown> = {}) {
    const waits: Array<Promise<unknown>> = []; let answer: Promise<Response> | undefined;
    handlers[type]({ ...more, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, respondWith: (p: Promise<Response>) => { answer = p; } });
    const response = answer ? await answer : undefined;
    await Promise.all(waits);
    return response;
  }
  const publish = (version: string, extra: Record<string, string> = {}) => {
    site.set('/pass/', page(version)); site.set(`/assets/pass-${version}.js`, `js ${version}`); site.set(`/assets/pass-${version}.css`, `css ${version}`);
    for (const [p, body] of Object.entries(extra)) site.set(p, body);
  };
  /** What a page tells the worker once it has loaded: everything it used. Resolves with the worker's reply. */
  async function loaded(version: string, others: string[] = []) {
    let reply: unknown;
    await send('message', { data: { type: 'keep', urls: [`${ORIGIN}/pass/`, `${ORIGIN}/assets/pass-${version}.js`, `${ORIGIN}/assets/pass-${version}.css`, ...others.map((o) => ORIGIN + o)] }, ports: [{ postMessage: (m: unknown) => { reply = m; } }] });
    return reply;
  }
  const visit = () => send('fetch', { request: { url: `${ORIGIN}/pass/`, method: 'GET', mode: 'navigate' } });
  return { site, store, fetched, send, publish, loaded, visit, saved: async (p: string) => (await cache.match(p))?.text(), offline: () => { online = false; }, online: () => { online = true; } };
}

describe('the pass page\'s offline worker', () => {
  it('opens the saved page and its files with no network at all', async () => {
    const b = browser();
    b.publish('A');
    await b.send('install');
    b.offline();
    expect(await (await b.visit())!.text()).toBe(page('A'));
    const script = await b.send('fetch', { request: new Request(`${ORIGIN}/assets/pass-A.js`) });
    expect(await script!.text()).toBe('js A');
  });

  it('never swaps in a new page until every file it needs is saved too', async () => {
    const b = browser();
    b.publish('A'); await b.send('install');
    b.site.set('/pass/', page('B'));          // a new version is announced, but its files cannot be fetched yet
    await b.visit();
    expect(await b.saved('/pass/')).toBe(page('A'));
    b.publish('B');
    await b.visit();
    expect(await b.saved('/pass/')).toBe(page('B'));
    expect(await b.saved('/assets/pass-B.js')).toBe('js B');
  });

  it('drops an older version\'s files once neither the open page nor the saved one uses them', async () => {
    const b = browser();
    b.publish('A'); await b.send('install'); await b.loaded('A');
    b.publish('B'); await b.visit();           // B is saved for next time, while this visit still runs A
    await b.loaded('A');
    expect(await b.saved('/assets/pass-A.js')).toBe('js A');
    expect(await b.saved('/assets/pass-B.js')).toBe('js B');
    await b.visit(); await b.loaded('B');      // the next visit runs B: A is finished with
    expect(await b.saved('/assets/pass-A.js')).toBeUndefined();
    expect(await b.saved('/assets/pass-A.css')).toBeUndefined();
    expect(await b.saved('/assets/pass-B.js')).toBe('js B');
  });

  it('refreshes files whose names never change, and keeps the old copy when there is no signal', async () => {
    const b = browser();
    b.publish('A', { '/brand/signifier.png': 'old logo', '/fonts/magistral.woff2': 'font' });
    await b.send('install'); await b.loaded('A', ['/brand/signifier.png', '/fonts/magistral.woff2']);
    expect(await b.saved('/brand/signifier.png')).toBe('old logo');
    b.site.set('/brand/signifier.png', 'new logo');
    await b.loaded('A', ['/brand/signifier.png', '/fonts/magistral.woff2']);
    expect(await b.saved('/brand/signifier.png')).toBe('new logo');
    expect(await b.saved('/fonts/magistral.woff2')).toBe('font');
    b.offline();
    await b.loaded('A', ['/brand/signifier.png', '/fonts/magistral.woff2']);
    expect(await b.saved('/brand/signifier.png')).toBe('new logo');
    // A built file is never fetched twice: its name changes when its contents do.
    expect(b.fetched.filter((p) => p === '/assets/pass-A.js')).toHaveLength(1);
  });

  it('tells the page whether the whole pass page is really saved', async () => {
    const b = browser();
    b.publish('A');
    b.site.delete('/assets/pass-A.css');       // one file cannot be fetched: the page would open unstyled offline
    await b.send('install');
    expect(await b.loaded('A')).toEqual({ saved: false });
    b.publish('A');
    expect(await b.loaded('A')).toEqual({ saved: true });
  });

  it('keeps nothing from outside the site', async () => {
    const b = browser();
    b.publish('A'); await b.send('install');
    await b.send('message', { data: { type: 'keep', urls: ['https://elsewhere.example/x.js', `${ORIGIN}/assets/pass-A.js`] }, ports: [] });
    expect([...b.store.keys()].sort()).toEqual(['/assets/pass-A.css', '/assets/pass-A.js', '/pass/']);
    expect(b.fetched).not.toContain('/x.js');
  });
});
