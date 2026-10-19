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
import { eventHomeScreen } from './ui/event-home';
import { eventsScreen } from './ui/events';
import { loginScreen } from './ui/login';
import { moderationScreen } from './ui/moderation';
import { peopleScreen } from './ui/people';
import { rankingsScreen } from './ui/rankings';
import { resultsScreen } from './ui/results';
import { scorecardScreen } from './ui/scorecard';
import { scoringScreen } from './ui/scoring';
import { parseHash, startRouter, type Route } from './ui/router';
import { QueueHost } from './ui/queuehost';
import { mountShell } from './ui/shell';
import { mountSyncBar } from './ui/syncbar';
import { teamsScreen } from './ui/teams';
import { scoresScreen } from './ui/scores';
import { racingScreen } from './ui/racing';
import { eventNav } from './ui/event-nav';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
/** With neither value set the app runs on the in-memory backend with sample data. */
const demo = new URLSearchParams(location.search).get('demo') === '1' || !(url && key);

async function boot(): Promise<void> {
  const shell = mountShell(document.getElementById('app')!);
  const api: Api = demo ? new MemoryApi() : createSupabaseApi(url!, key!, undefined, { schema: import.meta.env.VITE_SUPABASE_DB_SCHEMA ?? 'public' });
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
  let leaves: Array<() => void | Promise<void>> = [];
  const ctx: Ctx = {
    api, queue: host, enqueueScore: (i) => host.enqueueScore(i), flush: () => host.flush(), main: shell.main, demo,
    rerender: () => void render(current),
    onLeave: (fn) => { leaves.push(fn); },
  };

  let changingSession = false;
  const finishScreen = async () => {
    const outgoing = leaves; leaves = [];
    await Promise.allSettled(outgoing.map((fn) => Promise.resolve().then(fn)));
    await host.flush();
  };
  if (demo) {
    shell.demoBar.hidden = false;
    const select = h('select', { 'aria-label': 'Demo persona' },
      DEMO_PERSONAS.map((p) => h('option', { value: p.email }, p.label)));
    select.addEventListener('change', async () => {
      select.disabled = true; changingSession = true;
      const previous = current;
      try {
        // Save under the outgoing judge's session before choosing another demo role.
        await finishScreen();
        await api.signIn(select.value);
        await api.claimInvitations();
        if ('eventId' in previous && await api.getEvent(previous.eventId)) {
          location.hash = `#/event/${encodeURIComponent(previous.eventId)}`;
        } else location.hash = '#/';
        await render(parseHash(location.hash));
      } catch (e) {
        shell.main.replaceChildren(errorScreen(ctx, e));
      } finally { select.disabled = false; changingSession = false; }
    });
    shell.demoBar.replaceChildren(h('strong', null, 'Demo mode'), 'Sample data in this tab only; not saved or shared across devices. View as:', select);
  } else {
    shell.demoBar.hidden = false;
    shell.demoBar.replaceChildren(h('strong', null, 'Shared workspace'), 'Events and saved scores are shared across signed-in devices.');
  }

  const signOut = async () => {
    try {
      changingSession = true; await finishScreen();
      await api.signOut();
      location.hash = '#/';
      await render({ name: 'home' });
    } catch (e) {
      shell.main.replaceChildren(errorScreen(ctx, e));
    } finally { changingSession = false; }
  };

  async function render(route: Route): Promise<void> {
    current = route;
    const mine = ++token;
    for (const fn of leaves) {
      try { void Promise.resolve(fn()).catch(console.error); } catch (e) { console.error(e); }
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
      if ('eventId' in route && session) {
        const [event, roles] = await Promise.all([api.getEvent(route.eventId), api.myRoles(route.eventId)]);
        if (mine !== token) return;
        if (event) node.prepend(eventNav(event, roles, route.name));
      }
      shell.main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token) return;
      shell.main.replaceChildren(errorScreen(ctx, e));
    }
  }

  api.onAuthChange(() => { if (!changingSession) void render(current); });
  startRouter((route) => void render(route));
}

/** Later tasks add one case per screen. */
async function screenFor(route: Route, ctx: Ctx): Promise<HTMLElement> {
  switch (route.name) {
    case 'home': return eventsScreen(ctx);
    case 'event': return eventHomeScreen(ctx, route.eventId);
    case 'teams': return teamsScreen(ctx, route.eventId);
    case 'people': return peopleScreen(ctx, route.eventId);
    case 'score': return scoringScreen(ctx, route.eventId);
    case 'scorecard': return scorecardScreen(ctx, route.eventId, route.teamId, route.areaId);
    case 'racing': return racingScreen(ctx, route.eventId);
    case 'scores': return scoresScreen(ctx, route.eventId);
    case 'moderate': return moderationScreen(ctx, route.eventId);
    case 'rankings': return rankingsScreen(ctx, route.eventId);
    case 'results': return resultsScreen(ctx, route.eventId);
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
