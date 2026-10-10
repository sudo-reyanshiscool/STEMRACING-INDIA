import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import './styles/platform.css';
import { MemoryApi, createSupabaseApi, localStorageKV, memoryKV, type Api, type KV } from './api';
import { notFound } from './ui/common';
import type { Ctx } from './ui/ctx';
import { DEMO_PERSONAS, seedDemo } from './ui/demo';
import { h } from './ui/dom';
import { errorScreen } from './ui/errorscreen';
import { eventsScreen } from './ui/events';
import { loginScreen } from './ui/login';
import { startRouter, type Route } from './ui/router';
import { QueueHost } from './ui/queuehost';
import { mountShell } from './ui/shell';
import { mountSyncBar } from './ui/syncbar';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
/** With neither value set the app runs on the in-memory backend with sample data. */
const demo = !(url && key);

async function boot(): Promise<void> {
  const shell = mountShell(document.getElementById('app')!);
  const api: Api = demo ? new MemoryApi() : createSupabaseApi(url!, key!);
  if (demo) await seedDemo(api as MemoryApi);

  // One queue (and rejected ledger) per signed-in user, stored under that user's id. A signed-out device has no queue.
  const memory = new Map<string, KV>();
  const kv = (name: string): KV => {
    if (!demo) return localStorageKV(`stem-racing-india-${name}`);
    if (!memory.has(name)) memory.set(name, memoryKV());
    return memory.get(name)!;
  };
  const host = new QueueHost({
    api,
    storage: (userId) => ({ queue: kv(`scores:${userId}`), rejected: kv(`scores-rejected:${userId}`) }),
    lastUser: kv('last-user'),
  });
  await host.track();
  mountSyncBar(shell.syncBar, host); // flushes on 'online' and on an interval, shows status and rejected scores

  let current: Route = { name: 'home' };
  let token = 0;
  let leaves: Array<() => void> = [];
  const ctx: Ctx = {
    api, queue: host, enqueueScore: (i) => host.enqueueScore(i), main: shell.main, demo,
    rerender: () => void render(current),
    onLeave: (fn) => { leaves.push(fn); },
  };

  if (demo) {
    shell.demoBar.hidden = false;
    const select = h('select', { 'aria-label': 'Demo persona' },
      DEMO_PERSONAS.map((p) => h('option', { value: p.email }, p.label)));
    select.addEventListener('change', async () => {
      try {
        await api.signIn(select.value);
        await api.claimInvitations();
        location.hash = '#/';
        ctx.rerender();
      } catch (e) {
        shell.main.replaceChildren(errorScreen(ctx, e));
      }
    });
    shell.demoBar.replaceChildren(h('strong', null, 'Demo mode'), 'Sample data in memory, not saved. View as:', select);
  }

  const signOut = async () => {
    try {
      await api.signOut();
      location.hash = '#/';
      ctx.rerender();
    } catch (e) {
      shell.main.replaceChildren(errorScreen(ctx, e));
    }
  };

  async function render(route: Route): Promise<void> {
    current = route;
    const mine = ++token;
    for (const fn of leaves) {
      try { fn(); } catch (e) { console.error(e); }
    }
    leaves = [];
    try {
      const session = await api.getSession();
      shell.setUser(session, () => void signOut());
      host.setUser(session?.userId ?? null); // idempotent; covers an auth event the adapter did not deliver
      if (session) {
        await api.claimInvitations().catch(() => 0);
        void host.flush(); // a fresh sign-in releases anything that waited for a session
      }
      let node: HTMLElement;
      if (!session && route.name !== 'results') node = loginScreen(ctx);
      else node = await screenFor(route, ctx);
      if (mine !== token) return;
      shell.main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token) return;
      shell.main.replaceChildren(errorScreen(ctx, e));
    }
  }

  api.onAuthChange(() => void render(current));
  startRouter((route) => void render(route));
}

/** Later tasks add one case per screen. */
async function screenFor(route: Route, ctx: Ctx): Promise<HTMLElement> {
  switch (route.name) {
    case 'home': return eventsScreen(ctx);
    default: return notFound('This screen is not built yet.', '#/', 'Back to events');
  }
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  root?.replaceChildren(h('main', { class: 'stack' },
    h('h1', null, 'Something went wrong'),
    h('p', { class: 'alert', role: 'alert' }, 'The app could not start. Reload the page to try again.')));
});
