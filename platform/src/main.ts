import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import './styles/platform.css';
import { MemoryApi, ScoreQueue, createSupabaseApi, localStorageKV, memoryKV, type Api } from './api';
import { notFound } from './ui/common';
import type { Ctx } from './ui/ctx';
import { DEMO_PERSONAS, seedDemo } from './ui/demo';
import { h } from './ui/dom';
import { eventsScreen } from './ui/events';
import { loginScreen } from './ui/login';
import { startRouter, type Route } from './ui/router';
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

  // Never send (or consume) scores without a session: they wait on the device and are reported as "signed out".
  const queue = new ScoreQueue(api, demo ? memoryKV() : localStorageKV('stem-racing-india-score-queue'), Date.now, {
    canSend: async () => (await api.getSession()) !== null,
    rejectedKv: demo ? memoryKV() : localStorageKV('stem-racing-india-score-rejected'),
  });
  mountSyncBar(shell.syncBar, queue); // flushes on 'online' and on an interval, and shows status and rejected scores
  void queue.flush();

  let current: Route = { name: 'home' };
  let token = 0;
  let leaves: Array<() => void> = [];
  const ctx: Ctx = {
    api, queue, main: shell.main, demo,
    rerender: () => void render(current),
    onLeave: (fn) => { leaves.push(fn); },
  };

  if (demo) {
    shell.demoBar.hidden = false;
    const select = h('select', { 'aria-label': 'Demo persona' },
      DEMO_PERSONAS.map((p) => h('option', { value: p.email }, p.label)));
    select.addEventListener('change', async () => {
      await api.signIn(select.value);
      await api.claimInvitations();
      location.hash = '#/';
      ctx.rerender();
    });
    shell.demoBar.replaceChildren(h('strong', null, 'Demo mode'), 'Sample data in memory, not saved. View as:', select);
  }

  const signOut = async () => { await api.signOut(); location.hash = '#/'; ctx.rerender(); };

  async function render(route: Route): Promise<void> {
    current = route;
    const mine = ++token;
    leaves.forEach((fn) => fn());
    leaves = [];
    try {
      const session = await api.getSession();
      shell.setUser(session, () => void signOut());
      if (session) {
        await api.claimInvitations().catch(() => 0);
        void queue.flush(); // a fresh sign-in releases anything that waited for a session
      }
      let node: HTMLElement;
      if (!session && route.name !== 'results') node = loginScreen(ctx);
      else node = await screenFor(route, ctx);
      if (mine !== token) return;
      shell.main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch {
      if (mine !== token) return;
      shell.main.replaceChildren(h('h1', null, 'Something went wrong'), h('p', { class: 'alert', role: 'alert' }, 'Could not load this screen. Go back and try again.'), h('a', { href: '#/' }, 'Back to events'));
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

void boot();
