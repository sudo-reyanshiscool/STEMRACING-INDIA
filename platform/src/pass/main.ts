/**
 * The student's Paddock Pass: a small page of its own at /pass/, with no sign-in and none of the app's code.
 * After the first visit it opens with no network at all.
 */
import '../styles/fonts.css';
import './page.css';
import { createRpc, passConfig } from './client';
import { startPassPage, type OfflineState } from './page';
import { openPassStore } from './store';

const root = document.getElementById('pass')!;
const config = passConfig();

async function start(): Promise<void> {
  if (!config) { root.textContent = 'Paddock Passes are not switched on for this copy of the platform.'; return; }
  const store = await openPassStore().catch(() => null);
  const page = await startPassPage(root, {
    store, rpc: createRpc(config), hash: location.hash, offline: () => kept,
    // The link's token must not linger in the address bar, the history or a shared screenshot.
    clearHash: () => history.replaceState(null, '', location.pathname),
  });
  let checked = Date.now();
  const recheck = () => { if (!document.hidden && Date.now() - checked > 60_000) { checked = Date.now(); void page.refresh(); } };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('online', () => { checked = Date.now(); void page.refresh(); });
  window.addEventListener('hashchange', () => location.reload());   // a second link opened in the same tab
}

/**
 * The worker keeps the page itself. It is told what the page loaded, since the first visit happened before it was in
 * charge, and answers whether the whole page is now on the phone. The page says "works without signal" only then.
 */
async function keepOffline(): Promise<OfflineState> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return 'never';
  await navigator.serviceWorker.register('/pass/sw.js', { scope: '/pass/' });
  const ready = await navigator.serviceWorker.ready;
  if (!ready.active) return 'saving';
  const urls = [location.pathname, ...performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin))];
  const channel = new MessageChannel();
  const answer = new Promise<OfflineState>((resolve) => {
    channel.port1.onmessage = (e) => resolve((e.data as { saved?: boolean } | null)?.saved ? 'ready' : 'saving');
    setTimeout(() => resolve('saving'), 30_000);   // an older worker that does not answer, or a very slow link
  });
  ready.active.postMessage({ type: 'keep', urls: [...new Set(urls)] }, [channel.port2]);
  return answer;
}
const loaded = new Promise<void>((resolve) => { if (document.readyState === 'complete') resolve(); else window.addEventListener('load', () => resolve(), { once: true }); });
const kept: Promise<OfflineState> = loaded.then(keepOffline).catch(() => 'never' as const);

void start();
