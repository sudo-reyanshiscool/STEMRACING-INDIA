import type { DoorList, QueuedCheck } from '../api/passes';

/** Everything a scanner needs to check passes with no signal. It holds pass secrets and portraits, so it does not stay long. */
export interface DoorCache {
  eventId: string;
  list: DoorList;
  /** Small JPEGs as base64, by pass id. */
  portraits: Record<string, string>;
  downloadedAt: number;
  /** Server time minus this phone's clock when the list was downloaded. */
  offset: number;
}
export interface DoorStore {
  /** Null when there is none, or it is more than three days old (and it is then deleted). */
  load(eventId: string): Promise<DoorCache | null>;
  save(cache: DoorCache): Promise<void>;
  /** Removes the door list for one event, or for all of them. Checks waiting to upload are kept: they hold no secrets. */
  clear(eventId?: string): Promise<void>;
  queued(eventId: string): Promise<QueuedCheck[]>;
  enqueue(eventId: string, check: QueuedCheck): Promise<void>;
  dequeue(eventId: string, ids: string[]): Promise<void>;
}
export const DOOR_LIST_DAYS = 3;
const stale = (cache: DoorCache, now: number) => now - cache.downloadedAt > DOOR_LIST_DAYS * 86_400_000;

export function memoryDoorStore(now: () => number = Date.now): DoorStore {
  const lists = new Map<string, DoorCache>(), checks: Array<QueuedCheck & { eventId: string }> = [];
  return {
    async load(eventId) { const c = lists.get(eventId); if (c && stale(c, now())) { lists.delete(eventId); return null; } return c ?? null; },
    async save(cache) { lists.set(cache.eventId, cache); },
    async clear(eventId) { if (eventId) lists.delete(eventId); else lists.clear(); },
    async queued(eventId) { return checks.filter((c) => c.eventId === eventId).map(({ eventId: _e, ...check }) => check); },
    async enqueue(eventId, check) { checks.push({ ...check, eventId }); },
    async dequeue(eventId, ids) { for (let i = checks.length - 1; i >= 0; i--) if (checks[i].eventId === eventId && ids.includes(checks[i].id)) checks.splice(i, 1); },
  };
}

const DB = 'sri-door-check', LISTS = 'lists', CHECKS = 'checks';
const done = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('storage failed')); });
const settled = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('storage failed')); });

export async function openDoorStore(factory: IDBFactory | undefined = globalThis.indexedDB, now: () => number = Date.now): Promise<DoorStore> {
  if (!factory) throw new Error('no storage');
  const open = factory.open(DB, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'eventId' });
    if (!db.objectStoreNames.contains(CHECKS)) db.createObjectStore(CHECKS, { keyPath: 'id' }).createIndex('event', 'eventId');
  };
  const db = await done(open);
  const write = async (name: string, work: (store: IDBObjectStore) => void) => { const tx = db.transaction(name, 'readwrite'); work(tx.objectStore(name)); await settled(tx); };
  const read = <T>(name: string, ask: (store: IDBObjectStore) => IDBRequest<T>) => done(ask(db.transaction(name).objectStore(name)));
  return {
    async load(eventId) {
      const cache = await read<DoorCache | undefined>(LISTS, (s) => s.get(eventId));
      if (cache && stale(cache, now())) { await write(LISTS, (s) => { s.delete(eventId); }); return null; }
      return cache ?? null;
    },
    save: (cache) => write(LISTS, (s) => { s.put(cache); }),
    clear: (eventId) => write(LISTS, (s) => { if (eventId) s.delete(eventId); else s.clear(); }),
    async queued(eventId) {
      const rows = await read<Array<QueuedCheck & { eventId: string }>>(CHECKS, (s) => s.index('event').getAll(eventId));
      return rows.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt)).map(({ eventId: _e, ...check }) => check);
    },
    enqueue: (eventId, check) => write(CHECKS, (s) => { s.put({ ...check, eventId }); }),
    dequeue: (_eventId, ids) => write(CHECKS, (s) => { for (const id of ids) s.delete(id); }),
  };
}

/** Called on sign-out: door lists hold pass secrets, so they leave the phone with the organiser's session. */
export async function wipeDoorLists(): Promise<void> {
  try { await (await openDoorStore()).clear(); } catch { /* nothing stored, or storage is off */ }
}
