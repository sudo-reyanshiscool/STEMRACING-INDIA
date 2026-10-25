import {schedulingScreen,myScheduleScreen} from './ui/scheduling';
import {submissionsScreen} from './ui/submissions';
import {spectatorOnly,spectatorReadScreen} from './ui/spectator';
import { judgePageAllowed } from './ui/judge-access';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/components.css';
import './styles/platform.css';
import { createSupabaseApi, localStorageKV, memoryKV, type Api } from './api';
import { loadShowcase, exitShowcaseHref } from './api/showcase';
import { mountShowcaseBar } from './ui/showcase';
import { notFound, codeText, errorText } from './ui/common';
import type { Ctx } from './ui/ctx';
import { h } from './ui/dom';
import { errorScreen } from './ui/errorscreen';
import { eventHomeScreen } from './ui/event-home';
import { eventsScreen } from './ui/events';
import { readEmailCallback, clearEmailCallback } from './ui/email-callback';
import { emailConfirmScreen } from './ui/email-confirm';
import { loginScreen } from './ui/login';
import { moderationScreen } from './ui/moderation';
import { peopleScreen } from './ui/people';
import { teamFilesScreen } from './ui/team-files';
import { teamFeedbackScreen } from './ui/team-feedback';
import { communicationsScreen } from './ui/communications';
import { rankingsScreen } from './ui/rankings';
import { resultsScreen } from './ui/results';
import { scorecardScreen } from './ui/scorecard';
import { inspectionScreen } from './ui/inspection';
import { scoringScreen } from './ui/scoring';
import { mfaChallengeScreen } from './ui/mfa-challenge';
import { securityScreen } from './ui/security';
import {drawLotsScreen} from './ui/draw-lots';
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

async function boot(): Promise<void> {
  if (!url || !key) {
    throw new Error('Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are missing.');
  }

  const callback = readEmailCallback(location.hash);
  let showEmailCode = false;
  let emailToken = callback?.kind === 'confirm' ? callback.tokenHash : null;
  let authError = callback?.kind === 'invalid' ? codeText('invalid-auth') : undefined;
  if (callback && callback.kind !== 'legacy') clearEmailCallback();
  const shell = mountShell(document.getElementById('app')!);
  const sharedApi: Api = createSupabaseApi(url, key, undefined, { schema: import.meta.env.VITE_SUPABASE_DB_SCHEMA ?? 'public' });
  let api: Api = sharedApi;
  const showcaseId = new URLSearchParams(location.search).get('showcase');
  const showcase = showcaseId !== null;
  if (showcase) {
    shell.setLoading(true);
    try {
      const owner = await sharedApi.getSession();
      api = await loadShowcase(sharedApi, showcaseId, new URLSearchParams(location.search).get('examples') === '6');
      // An expired/shared sign-in must not leave a private presentation on screen.
      sharedApi.onAuthChange(session => {
        if (session?.userId !== owner?.userId) location.replace(exitShowcaseHref(location.pathname));
      });
      mountShowcaseBar(shell.showcaseBar);
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
  const finishScreen = async () => {
    const outgoing = leaves; leaves = [];
    await Promise.allSettled(outgoing.map((fn) => Promise.resolve().then(fn)));
    await host.flush();
  };

  const signOut = async () => {
    if (showcase) { location.assign(exitShowcaseHref(location.pathname)); return; }
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
    shell.setLoading(true);
    for (const fn of leaves) {
      try { void Promise.resolve(fn()).catch(console.error); } catch (e) { console.error(e); }
    }
    leaves = [];
    try {
      const session = await api.getSession();
      shell.setUser(session, () => void signOut(), showcase);
      host.setUser(session?.userId ?? null); // idempotent; covers an auth event the adapter did not deliver
      const mfa = session ? await api.getMfaStatus().catch(() => null) : null;
      const requiresMfa = session && mfa && mfa.nextLevel === 'aal2' && mfa.currentLevel !== 'aal2';
      if (session && !requiresMfa) {
        await api.claimInvitations().catch(() => 0);
        void host.flush(); // a fresh sign-in releases anything that waited for a session
      }
      let node: HTMLElement;
      if (emailToken) node = emailConfirmScreen(ctx, emailToken, () => {
        emailToken = null; authError = undefined; void render({ name: 'home' });
      }, () => { emailToken = null; authError = undefined; showEmailCode = true; void render({ name: 'home' }); });
      else if (!session && route.name !== 'results') node = loginScreen(ctx, { authError, showCode: showEmailCode });
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
    } finally {
      if (mine === token) shell.setLoading(false);
    }
  }

  api.onAuthChange(() => {
    // Remove the outgoing account's private DOM before fetching the next account's page.
    token++; shell.main.replaceChildren();
    if (!changingSession) void render(current);
  });
  startRouter((route) => void render(route));
}

/** Later tasks add one case per screen. */
async function screenFor(route: Route, ctx: Ctx): Promise<HTMLElement> {
  if('eventId' in route && spectatorOnly(await ctx.api.myRoles(route.eventId))) {
    if(['teams','people','draw','communications','team-feedback'].includes(route.name))return spectatorReadScreen(ctx,route.eventId,route.name);
    if(['score','scorecard'].includes(route.name))return notFound('Platform Spectators can view scorecards under Scores, but cannot judge or edit them.',`#/event/${encodeURIComponent(route.eventId)}/scores`,'View scores');
  }
  if('eventId' in route && !judgePageAllowed(await ctx.api.myRoles(route.eventId),route.name)) return notFound('Your judge workspace includes Event, My scorecards, Scores and Results.',`#/event/${encodeURIComponent(route.eventId)}`,'Back to event');
  switch (route.name) {
    case 'home': return eventsScreen(ctx);
    case 'security': return securityScreen(ctx);
    case 'event': return eventHomeScreen(ctx, route.eventId);
    case 'teams': return teamsScreen(ctx, route.eventId);
    case 'people': return peopleScreen(ctx, route.eventId);
    case 'schedule': return schedulingScreen(ctx,route.eventId);
    case 'my-schedule': return myScheduleScreen(ctx,route.eventId);
    case 'submissions': return submissionsScreen(ctx,route.eventId);
    case 'team-files': return teamFilesScreen(ctx,route.eventId);
    case 'team-feedback': return teamFeedbackScreen(ctx, route.eventId);
    case 'communications': return communicationsScreen(ctx, route.eventId);
    case 'score': return scoringScreen(ctx, route.eventId);
    case 'draw': return drawLotsScreen(ctx,route.eventId);
    case 'scorecard': return scorecardScreen(ctx, route.eventId, route.teamId, route.areaId);
    case 'inspection': return inspectionScreen(ctx, route.eventId, route.teamId, route.car);
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
