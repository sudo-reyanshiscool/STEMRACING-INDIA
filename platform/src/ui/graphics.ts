import type { TeamRow } from '../api';
import { graphicsFiles, teamPictures, type GraphicsFile, type TeamPictures } from '../api/graphics-feed';
import { errorText, notFound } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { liveRefresh } from './live-refresh';

const APP = 'sri-platform';

/**
 * The graphics control page, inside the event. It is the same page as /graphics/control.html; here the platform hands it
 * the event's records directly and keeps them current, so nothing is downloaded and dropped in by hand.
 */
export async function graphicsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event || !roles.some((r) => r.role === 'organiser' || r.role === 'chair')) {
    return notFound('Graphics control is for organisers and the Chair.', `#/event/${encodeURIComponent(eventId)}`, 'Back to event');
  }
  const page = `${import.meta.env.BASE_URL}graphics/control.html`;
  // The event id keeps each event's place in the show, its picks and its pit timer apart in this browser.
  const src = `${page}?platform=1&event=${encodeURIComponent(eventId)}`;
  const frame = h('iframe', { class: 'graphics-frame', src, title: 'Graphics control', allow: 'fullscreen' });
  const status = h('p', { class: 'small muted', role: 'status' }, 'Connecting the graphics to this event…');
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });

  let alive = true, ready = false, lastChange = 0, picturesFor = 0, pictureTotal = 0, rounds = 0, skipped: string[] = [];
  const sent = new Map<string, GraphicsFile>();
  const pictures: Record<string, TeamPictures> = {};
  const seenTeams = new Set<string>();
  const post = (message: Record<string, unknown>) => {
    try { frame.contentWindow?.postMessage({ app: APP, ...message }, location.origin); } catch (e) { console.error(e); }
  };
  const say = () => {
    if (!alive) return;
    const bits = [ready ? 'Graphics connected.' : 'Waiting for the graphics page…'];
    if (lastChange) bits.push(`Last change sent at ${new Date(lastChange).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`);
    if (pictureTotal) bits.push(`Team pictures: ${picturesFor} of ${pictureTotal} teams checked.`);
    if (skipped.length) bits.push(`Not available to this account: ${skipped.join(', ')}.`);
    status.textContent = bits.join(' ');
  };

  // Pictures are fetched once per team, a few teams at a time, and handed over as each team is ready.
  let fetching = false;
  const fetchPictures = async (teams: TeamRow[]) => {
    const todo = teams.filter((t) => t.number && !seenTeams.has(t.id));
    pictureTotal = teams.length;
    if (fetching || !todo.length) return;
    fetching = true;
    const makeUrl = (bytes: Uint8Array<ArrayBuffer>, mime: string) => URL.createObjectURL(new Blob([bytes], { type: mime }));
    const worker = async () => {
      for (;;) {
        const team = todo.shift();
        if (!team || !alive) return;
        seenTeams.add(team.id);
        try {
          const got = await teamPictures(ctx.api, eventId, team, makeUrl);
          // Only a change is handed over: a picture approved or replaced during the day arrives by itself.
          if (JSON.stringify(got) !== JSON.stringify(pictures[team.number] ?? {})) { pictures[team.number] = got; if (ready) post({ type: 'pictures', pictures: { [team.number]: got } }); }
        } catch (e) { console.error(e); }   // a team without media, or one this account cannot read, just has no pictures
        picturesFor = Math.min(pictureTotal, picturesFor + 1); say();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    fetching = false;
  };

  const refresh = async (all = false) => {
    const built = await graphicsFiles(ctx.api, event);
    if (!alive) return;
    skipped = built.skipped;
    const changed = built.files.filter((f) => sent.get(f.name)?.fingerprint !== f.fingerprint);
    for (const f of changed) sent.set(f.name, f);
    const out = all ? [...sent.values()] : changed;
    if (ready && out.length) { post({ type: 'data', eventName: event.name, files: out.map(({ name, text }) => ({ name, text })) }); lastChange = Date.now(); }
    error.hidden = true; say();
    // Every couple of minutes each team's media is looked at again; pictures already fetched are not downloaded twice.
    if (++rounds % 12 === 0 && !fetching) { seenTeams.clear(); picturesFor = 0; }
    void fetchPictures(built.teams);
  };
  const failed = (e: unknown) => { error.textContent = `The graphics could not be updated: ${errorText(e)}`; error.hidden = false; };

  // The graphics page says when it is listening (again after it is reloaded); it then gets everything.
  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin || e.data?.app !== APP || e.data?.type !== 'ready') return;
    ready = true;
    post({ type: 'data', eventName: event.name, files: [...sent.values()].map(({ name, text }) => ({ name, text })) });
    if (Object.keys(pictures).length) post({ type: 'pictures', pictures });
    lastChange = Date.now(); say();
  };
  window.addEventListener('message', onMessage);
  ctx.onLeave(() => { alive = false; window.removeEventListener('message', onMessage); });
  liveRefresh(ctx, () => refresh(), failed);
  void refresh().catch(failed);

  return h('div', { class: 'graphics-screen stack' },
    h('header', { class: 'graphics-heading' },
      h('div', null,
        h('p', { class: 'eyebrow' }, event.name),
        h('h1', null, 'Graphics'),
        h('p', { class: 'lead' }, 'The big screen, driven from here. Teams, races, results and pictures come straight from this event.')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn--ghost', href: page, target: '_blank', rel: 'noopener' }, 'Open without the platform'))),
    event.resultsReleased ? null : h('p', { class: 'notice' }, 'Results are not released. Winners and standings shown here are visible only on this page and on the big screen you open from it.'),
    error, status, frame);
}
