export type Route =
  | { name: 'home' }
  | { name: 'event'; eventId: string }
  | { name: 'car'; carId: string }
  | { name: 'summary'; carId: string }
  | { name: 'compare'; teamId: string };

const HOME: Route = { name: 'home' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter((p) => p !== '');
  const id = (i: number): string | undefined => {
    const raw = parts[i];
    if (!raw) return undefined;
    try { return decodeURIComponent(raw); } catch { return undefined; }
  };
  if (parts[0] === 'event' && id(1) && parts.length === 2) return { name: 'event', eventId: id(1)! };
  if (parts[0] === 'car' && id(1) && parts.length === 2) return { name: 'car', carId: id(1)! };
  if (parts[0] === 'car' && id(1) && parts[2] === 'summary' && parts.length === 3) return { name: 'summary', carId: id(1)! };
  if (parts[0] === 'team' && id(1) && parts[2] === 'compare' && parts.length === 3) return { name: 'compare', teamId: id(1)! };
  return HOME;
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'event': return `#/event/${encodeURIComponent(r.eventId)}`;
    case 'car': return `#/car/${encodeURIComponent(r.carId)}`;
    case 'summary': return `#/car/${encodeURIComponent(r.carId)}/summary`;
    case 'compare': return `#/team/${encodeURIComponent(r.teamId)}/compare`;
  }
}

export function startRouter(onRoute: (r: Route) => void): void {
  const run = () => onRoute(parseHash(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
