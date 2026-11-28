import type { Api } from './types';

/**
 * How long an answer may be reused. Only identity-like reads that every page asks for are listed: one navigation
 * used to fetch the same event and roles three or four times, one request after another.
 * Lists that screens poll or compare for conflicts are never reused, only shared while a request is in flight.
 * The database enforces permissions on every request, so a briefly stale role only affects which links are drawn.
 */
const TTL_MS: Record<string, number> = { myRoles: 30_000, getEvent: 5_000, eventBranding: 60_000, getMfaStatus: 60_000 };

/**
 * Never shared or reused, and never treated as a write: the live session, subscriptions, large file bodies, and the
 * big-screen relay, which is sent on every step of a show and changes nothing another read returns. Pass reads carry
 * secrets and door checks happen many times a minute, so neither is kept or allowed to clear what other screens hold.
 */
const PASSTHROUGH = /^(getSession|onAuthChange|download[A-Z].*|showScreenLink|publishShowScreen|teamPasses|passLink|presentPass|checkPass|doorList|doorPortraits|recordPassChecks|passArrivals|passPulseKey|passClock)$/;

const READ_NAMES = new Set([
  'submissionGuideState', 'schedulingState', 'mySchedule', 'submissionState', 'canCreateEvent', 'platformAccess',
  'eventBranding', 'drawLotsState', 'resultMailState', 'previewResultsPacket', 'latestSnapshot', 'publicStandings',
  'releasedResults', 'teamBrandingProfile',
]);
const isRead = (name: string) => READ_NAMES.has(name) || /^(list|get|my)[A-Z]/.test(name);

/** Callers own what they receive: one screen sorting a list in place must not reorder it for another. */
const copy = <T>(value: T): T => (value === null || typeof value !== 'object' ? value : structuredClone(value));

const clearers = new WeakMap<object, () => void>();

/** For an explicit "refresh" action: the next reads go to the server. Does nothing for an Api that is not wrapped. */
export function clearRequestCache(api: Api): void { clearers.get(api)?.(); }

/**
 * Wraps an Api so identical reads issued together become one request, and a few stable reads are reused briefly.
 * Any write, any failure and any change of account discards everything, so a screen always sees its own changes.
 */
export function withRequestCache(source: Api, now: () => number = Date.now): Api {
  const inflight = new Map<string, Promise<unknown>>();
  const stored = new Map<string, { value: unknown; expires: number }>();
  let generation = 0;
  const clear = () => { generation++; inflight.clear(); stored.clear(); };

  const call = (name: string, args: unknown[]): Promise<unknown> =>
    Promise.resolve().then(() => (source as any)[name](...args));

  const read = (name: string, args: unknown[]): Promise<unknown> => {
    let key: string;
    try { key = `${name}:${JSON.stringify(args)}`; } catch { return call(name, args); }
    const hit = stored.get(key);
    if (hit) {
      if (hit.expires > now()) return Promise.resolve(copy(hit.value));
      stored.delete(key);
    }
    const pending = inflight.get(key);
    if (pending) return pending.then(copy);
    const started = generation;
    const request = call(name, args).then((value) => {
      if (started === generation) {
        inflight.delete(key);
        const ttl = TTL_MS[name];
        if (ttl) stored.set(key, { value: copy(value), expires: now() + ttl });
      }
      return value;
    }, (error) => {
      clear();
      throw error;
    });
    inflight.set(key, request);
    return request;
  };

  const write = async (name: string, args: unknown[]): Promise<unknown> => {
    clear();
    try { return await call(name, args); }
    finally { clear(); }
  };

  /** Runs on most navigations and usually claims nothing; only a real claim changes what the account can see. */
  const claim = async (args: unknown[]): Promise<unknown> => {
    try {
      const claimed = await call('claimInvitations', args);
      if (Number(claimed) > 0) clear();
      return claimed;
    } catch (error) { clear(); throw error; }
  };

  try { source.onAuthChange(clear); } catch { /* An adapter without auth events still works, just uncached across accounts. */ }

  const wrappers = new Map<string, unknown>();
  const proxy = new Proxy(source, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      let wrapped = wrappers.get(prop);
      if (!wrapped) {
        if (PASSTHROUGH.test(prop)) wrapped = (...args: unknown[]) => (target as any)[prop](...args);
        else if (prop === 'claimInvitations') wrapped = (...args: unknown[]) => claim(args);
        else if (isRead(prop)) wrapped = (...args: unknown[]) => read(prop, args);
        else wrapped = (...args: unknown[]) => write(prop, args);
        wrappers.set(prop, wrapped);
      }
      return wrapped;
    },
  });
  clearers.set(proxy, clear);
  return proxy;
}
