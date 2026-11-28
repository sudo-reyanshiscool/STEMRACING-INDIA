import {spectatorOnly,spectatorReadScreen} from './ui/spectator';
import { judgePageAllowed } from './ui/judge-access';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import './styles/platform.css';
import './styles/passes.css';
import { localStorageKV, memoryKV } from './api/queue';
import type { Api } from './api/types';
import { createSupabaseApi } from './api/supabase';
import { withRequestCache } from './api/cached';
import { loadShowcase, exitShowcaseHref } from './api/showcase';
import { mountShowcaseBar } from './ui/showcase';
import { notFound, codeText, errorText } from './ui/common';
import type { Ctx } from './ui/ctx';
import { h } from './ui/dom';
import { errorScreen } from './ui/errorscreen';
import { readEmailCallback, clearEmailCallback } from './ui/email-callback';
import { emailConfirmScreen } from './ui/email-confirm';
import { loginScreen } from './ui/login';
import { mfaChallengeScreen } from './ui/mfa-challenge';
import { startRouter, type Route } from './ui/router';
import { QueueHost } from './ui/queuehost';
import { mountShell } from './ui/shell';
import { mountSyncBar } from './ui/syncbar';
import { eventNav } from './ui/event-nav';
import { shownInHideMode } from './ui/hide-mode';

/**
 * Each screen is its own file on the network, fetched when first opened. The sign-in page no longer waits for
 * every organiser tool, and the PDF and zip libraries only load when something is exported.
 */
const SCREENS = {
  events: () => import('./ui/events'),
  security: () => import('./ui/security'),
  eventHome: () => import('./ui/event-home'),
  teams: () => import('./ui/teams'),
  people: () => import('./ui/people'),
  scheduling: () => import('./ui/scheduling'),
  submissions: () => import('./ui/submissions'),
  teamBranding: () => import('./ui/team-branding'),
  teamFiles: () => import('./ui/team-files'),
  mediaAssets: () => import('./ui/media-assets'),
  teamFeedback: () => import('./ui/team-feedback'),
  communications: () => import('./ui/communications'),
  scoring: () => import('./ui/scoring'),
  drawLots: () => import('./ui/draw-lots'),
  scorecard: () => import('./ui/scorecard'),
  inspection: () => import('./ui/inspection'),
  racing: () => import('./ui/racing'),
  graphics: () => import('./ui/graphics'),
  scores: () => import('./ui/scores'),
  moderation: () => import('./ui/moderation'),
  rankings: () => import('./ui/rankings'),
  results: () => import('./ui/results'),
  passes: () => import('./ui/passes'),
  door: () => import('./ui/door'),
};

/** Once the first page is up, fetch the rest quietly so later pages open instantly, including on a dropped connection. */
function warmScreens(): void {
  const run = () => { for (const load of Object.values(SCREENS)) void load().catch(() => undefined); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

// A page left open across a deployment asks for files that no longer exist. Reload once to pick up the new ones.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'stem-racing-india-reloaded-at';
  try {
    if (!navigator.onLine || Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return; }
  event.preventDefault();
  location.reload();
});

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The demo sign-in: the six-team example event in memory, entered from the sign-in screen with no account.
 * It never reads or writes the shared backend. Always on in `npm run dev` and when no backend is configured;
 * a build that does have a backend offers it only when VITE_DEMO_LOGIN=1.
 */
const demoLogin = import.meta.env.DEV || import.meta.env.VITE_DEMO_LOGIN === '1' || !url || !key;

async function boot(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const preview = demoLogin ? query.get('preview') : null;
  if ((!url || !key) && preview === null) {
    // With no backend to sign in to, the demo is the whole site.
    location.replace(`${location.pathname}?preview=signed-out${location.hash}`);
    return;
  }

  const callback = readEmailCallback(location.hash);
  let showEmailCode = false;
  let emailToken = callback?.kind === 'confirm' ? callback.tokenHash : null;
  let authError = callback?.kind === 'invalid' ? codeText('invalid-auth') : undefined;
  if (callback && callback.kind !== 'legacy') clearEmailCallback();
  const shell = mountShell(document.getElementById('app')!);
  // In the demo nothing below ever holds a connection to the shared backend.
  const sharedApi: Api | null = preview === null && url && key
    ? withRequestCache(createSupabaseApi(url, key, undefined, { schema: import.meta.env.VITE_SUPABASE_DB_SCHEMA ?? 'public' })) : null;
  let api = sharedApi as Api;
  const showcaseId = preview !== null ? 'design-preview' : query.get('showcase');
  const showcase = showcaseId !== null;
  if (showcase) {
    shell.setLoading(true);shell.setBranding(null);
    try {
      if (preview !== null || !sharedApi) {
        api = await (await import('./api/design-preview')).loadDesignPreview(preview ?? 'signed-out');
      } else {
        const owner = await sharedApi.getSession();
        api = await loadShowcase(sharedApi, showcaseId, query.get('examples') === '6');
        // An expired/shared sign-in must not leave a private presentation on screen.
        sharedApi.onAuthChange(session => {
          if (session?.userId !== owner?.userId) location.replace(exitShowcaseHref(location.pathname));
        });
      }
      mountShowcaseBar(shell.showcaseBar, preview !== null);
    } catch (e) {
      shell.main.replaceChildren(h('div', { class: 'stack' }, h('h1', null, 'Showcase unavailable'),
        h('p', { class: 'alert', role: 'alert' }, errorText(e)),
        h('a', { href: exitShowcaseHref(location.pathname) }, 'Back to saved event')));
      shell.setLoading(false);
      return; // Never fall back to the shared write API while showing a showcase URL.
    }
  }

  // One queue (and rejected ledger) per signed-in user, stored under that user's id. A signed-out device has no queue.
  const host = new QueueHost({
    api,
    storage: (userId) => showcase ? { queue: memoryKV(), rejected: memoryKV() } : ({ queue: localStorageKV(`stem-racing-india-scores:${userId}`), rejected: localStorageKV(`stem-racing-india-scores-rejected:${userId}`) }),
    lastUser: showcase ? memoryKV() : localStorageKV('stem-racing-india-last-user'),
    ...(showcase ? { locks: null } : {}),
  });
  await host.track();
  if (callback?.kind === 'legacy') {
    if (!(await api.getSession())) authError = codeText('invalid-auth');
    clearEmailCallback();
  }
  mountSyncBar(shell.syncBar, host); // flushes on 'online' and on an interval, shows status and rejected scores

  let current: Route = { name: 'home' };
  let token = 0;
  let leaves: Array<() => void | Promise<void>> = [];
  const ctx: Ctx = {
    api, queue: host, enqueueScore: (i) => host.enqueueScore(i), flush: () => host.flush(), main: shell.main, demo: showcase,
    rerender: () => void render(current),
    onLeave: (fn) => { leaves.push(fn); },
  };

  let changingSession = false;
  let claimedFor: string | null = null, claimedAt = 0;
  const finishScreen = async () => {
    const outgoing = leaves; leaves = [];
    await Promise.allSettled(outgoing.map((fn) => Promise.resolve().then(fn)));
    await host.flush();
  };

  const signOut = async () => {
    if (showcase && preview === null) { location.assign(exitShowcaseHref(location.pathname)); return; }
    try {
      changingSession = true; await finishScreen();
      // A saved door list holds pass secrets, so it leaves this device with the session.
      await import('./pass/door-store').then((m) => m.wipeDoorLists()).catch(() => undefined);
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
    shell.setLoading(true);shell.setBranding(null);
    for (const fn of leaves) {
      try { void Promise.resolve(fn()).catch(console.error); } catch (e) { console.error(e); }
    }
    leaves = [];
    try {
      const session = await api.getSession();
      shell.setUser(session, () => void signOut(), showcase && preview === null);
      host.setUser(session?.userId ?? null); // idempotent; covers an auth event the adapter did not deliver
      // The owner's hide mode: event pages other than the Test Event are not shown, nor is their menu.
      const hidden = session && !showcase ? api.getOwnerHideMode().catch(() => false) : Promise.resolve(false);
      const mfa = session ? await api.getMfaStatus().catch(() => null) : null;
      const requiresMfa = session && mfa && mfa.nextLevel === 'aal2' && mfa.currentLevel !== 'aal2';
      if (session && !requiresMfa) {
        if (claimedFor !== session.userId) {
          // The first page after sign-in waits: what this account may open depends on its invitations.
          try { await api.claimInvitations(); claimedFor = session.userId; claimedAt = Date.now(); } catch { /* Tried again on the next page. */ }
        } else if (Date.now() - claimedAt > 30_000) {
          // Later pages do not wait. A new invitation shows from the next page onwards.
          claimedAt = Date.now();
          void api.claimInvitations().catch(() => 0);
        }
        void host.flush(); // a fresh sign-in releases anything that waited for a session
      }
      // Asked for alongside the screen, which needs the same event and roles; the two share one request each.
      const hiddenEvent = 'eventId' in route && !shownInHideMode(route.eventId) && await hidden;
      const meta = 'eventId' in route && !hiddenEvent
        ? Promise.all([api.getEvent(route.eventId), api.myRoles(route.eventId)]).then(async ([event, roles]) =>
          ({ event, roles, branding: event?.competitionLevel ? await api.eventBranding(event.id) : null }))
        : null;
      meta?.catch(() => undefined);
      let node: HTMLElement;
      let nav: Parameters<typeof shell.setNav>[0] = null;
      if (emailToken) node = emailConfirmScreen(ctx, emailToken, () => {
        emailToken = null; authError = undefined; void render({ name: 'home' });
      }, () => { emailToken = null; authError = undefined; showEmailCode = true; void render({ name: 'home' }); });
      else if (!session && route.name !== 'results') node = loginScreen(ctx, { authError, showCode: showEmailCode, demo: demoLogin, demoOnly: preview !== null });
      else if (requiresMfa && route.name !== 'results') {
        const factorId = mfa?.factors.find((f) => f.status === 'verified')?.id;
        node = mfaChallengeScreen(ctx, {
          factorId,
          onSuccess: () => {
            void host.flush();
            void render(route);
          },
          onCancel: () => void signOut(),
        });
      }
      else if (hiddenEvent) node = notFound('This event is hidden while hide mode is on.', '#/', 'Back to events');
      else node = await screenFor(route, ctx);
      if (mine !== token) return;
      if (meta) {
        const { event, roles, branding } = await meta;
        if (mine !== token) return;
        if (event) {
          if (event.competitionLevel) shell.setBranding(branding);
          if (session) nav = { event, nav: eventNav(event, roles, route.name), focus: FOCUS_SCREENS.includes(route.name) };
        }
      }
      shell.setNav(nav);
      shell.main.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token) return;
      shell.setNav(null);
      shell.main.replaceChildren(errorScreen(ctx, e));
    } finally {
      if (mine === token) shell.setLoading(false);
    }
  }

  api.onAuthChange(() => {
    // Remove the outgoing account's private DOM before fetching the next account's page.
    token++; shell.setNav(null); shell.main.replaceChildren();
    if (!changingSession) void render(current);
  });
  startRouter((route) => void render(route));
  warmScreens();
}

/** Screens that need the full width of the window: the event menu folds into a button above them. */
const FOCUS_SCREENS: Route['name'][] = ['scorecard', 'inspection', 'graphics'];

async function screenFor(route: Route, ctx: Ctx): Promise<HTMLElement> {
  if ('eventId' in route) {
    const roles = await ctx.api.myRoles(route.eventId);
    if (spectatorOnly(roles)) {
      if(['teams','people','draw','communications','team-feedback'].includes(route.name))return spectatorReadScreen(ctx,route.eventId,route.name);
      if(['score','scorecard'].includes(route.name))return notFound('Platform Spectators can view scorecards under Scores, but cannot judge or edit them.',`#/event/${encodeURIComponent(route.eventId)}/scores`,'View scores');
    }
    if (!judgePageAllowed(roles,route.name)) return notFound('Your judge workspace includes Event, My scorecards, Scores and Results.',`#/event/${encodeURIComponent(route.eventId)}`,'Back to event');
  }
  switch (route.name) {
    case 'home': return (await SCREENS.events()).eventsScreen(ctx);
    case 'security': return (await SCREENS.security()).securityScreen(ctx);
    case 'event': return (await SCREENS.eventHome()).eventHomeScreen(ctx, route.eventId);
    case 'teams': return (await SCREENS.teams()).teamsScreen(ctx, route.eventId);
    case 'people': return (await SCREENS.people()).peopleScreen(ctx, route.eventId);
    case 'schedule': return (await SCREENS.scheduling()).schedulingScreen(ctx,route.eventId);
    case 'my-schedule': return (await SCREENS.scheduling()).myScheduleScreen(ctx,route.eventId);
    case 'submissions': return (await SCREENS.submissions()).submissionsScreen(ctx,route.eventId);
    case 'branding': return (await SCREENS.teamBranding()).teamBrandingScreen(ctx,route.eventId);
    case 'team-files': return (await SCREENS.teamFiles()).teamFilesScreen(ctx,route.eventId);
    case 'media': return (await SCREENS.mediaAssets()).mediaAssetsScreen(ctx, route.eventId);
    case 'team-feedback': return (await SCREENS.teamFeedback()).teamFeedbackScreen(ctx, route.eventId);
    case 'communications': return (await SCREENS.communications()).communicationsScreen(ctx, route.eventId);
    case 'score': return (await SCREENS.scoring()).scoringScreen(ctx, route.eventId);
    case 'draw': return (await SCREENS.drawLots()).drawLotsScreen(ctx,route.eventId);
    case 'scorecard': return (await SCREENS.scorecard()).scorecardScreen(ctx, route.eventId, route.teamId, route.areaId);
    case 'inspection': return (await SCREENS.inspection()).inspectionScreen(ctx, route.eventId, route.teamId, route.car);
    case 'racing': return (await SCREENS.racing()).racingScreen(ctx, route.eventId);
    case 'graphics': return (await SCREENS.graphics()).graphicsScreen(ctx, route.eventId);
    case 'scores': return (await SCREENS.scores()).scoresScreen(ctx, route.eventId);
    case 'moderate': return (await SCREENS.moderation()).moderationScreen(ctx, route.eventId);
    case 'rankings': return (await SCREENS.rankings()).rankingsScreen(ctx, route.eventId);
    case 'results': return (await SCREENS.results()).resultsScreen(ctx, route.eventId);
    case 'passes': return (await SCREENS.passes()).passesScreen(ctx, route.eventId);
    case 'door': return (await SCREENS.door()).doorScreen(ctx, route.eventId);
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
