export type Route =
  | { name: 'home' }
  | { name: 'event'; eventId: string }
  | { name: 'teams'; eventId: string }
  | { name: 'people'; eventId: string }
  | { name: 'draw'; eventId: string }
  | { name: 'score'; eventId: string }
  | { name: 'scores'; eventId: string }
  | { name: 'racing'; eventId: string }
  | { name: 'scorecard'; eventId: string; teamId: string; areaId: string }
  | { name: 'inspection'; eventId: string; teamId: string; car: 'A' | 'B' }
  | { name: 'moderate'; eventId: string }
  | { name: 'rankings'; eventId: string }
  | { name: 'results'; eventId: string }
  | { name: 'communications'; eventId: string };

const HOME: Route = { name: 'home' };
const SECTIONS = ['teams', 'people', 'draw', 'communications', 'score', 'scores', 'moderate', 'rankings', 'results', 'racing'] as const;

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  let decoded: string[];
  try {
    decoded = parts.map((p) => decodeURIComponent(p));
  } catch {
    return HOME;
  }
  if (decoded[0] !== 'event' || !decoded[1]) return HOME;
  const eventId = decoded[1];
  if (decoded.length === 2) return { name: 'event', eventId };
  const section = decoded[2] as (typeof SECTIONS)[number];
  if (decoded.length === 3 && (SECTIONS as readonly string[]).includes(section)) return { name: section, eventId };
  if (decoded.length === 5 && decoded[2] === 'score' && decoded[3] && decoded[4]) {
    return { name: 'scorecard', eventId, teamId: decoded[3], areaId: decoded[4] };
  }
  if (decoded.length === 5 && decoded[2] === 'inspection' && decoded[3] && (decoded[4] === 'A' || decoded[4] === 'B')) {
    return { name: 'inspection', eventId, teamId: decoded[3], car: decoded[4] as 'A' | 'B' };
  }
  return HOME;
}

const e = encodeURIComponent;

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'event': return `#/event/${e(r.eventId)}`;
    case 'scorecard': return `#/event/${e(r.eventId)}/score/${e(r.teamId)}/${e(r.areaId)}`;
    case 'inspection': return `#/event/${e(r.eventId)}/inspection/${e(r.teamId)}/${e(r.car)}`;
    default: return `#/event/${e(r.eventId)}/${r.name}`;
  }
}

export function startRouter(onRoute: (r: Route) => void): void {
  const run = () => onRoute(parseHash(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
