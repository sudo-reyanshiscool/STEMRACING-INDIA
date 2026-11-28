import type { PassCardData } from '../api/passes';

/** One pass kept on this phone. */
export interface PassRecord {
  passId: string;
  /** Signs entry codes. It cannot be read back out, so the pass cannot be copied off the phone by script. */
  key: CryptoKey;
  card: PassCardData;
  /** Server time minus this phone's clock, in milliseconds, as last measured. */
  offset: number;
  savedAt: number;
  /** The server no longer accepts this phone for the pass: it was reset, moved or removed. */
  revoked?: boolean;
}
export interface PassStore {
  all(): Promise<PassRecord[]>;
  put(record: PassRecord): Promise<void>;
  remove(passId: string): Promise<void>;
}

export function memoryPassStore(initial: PassRecord[] = []): PassStore {
  const rows = new Map(initial.map((r) => [r.passId, r]));
  return {
    async all() { return [...rows.values()]; },
    async put(record) { rows.set(record.passId, record); },
    async remove(passId) { rows.delete(passId); },
  };
}

const DB = 'sri-paddock-pass', STORE = 'passes';
const done = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('storage failed')); });
const settled = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('storage failed')); });

/**
 * The phone's own store. Rejects where the browser cannot keep a signing key (some private windows), so the page can
 * say so before a single-use link is spent on a pass that would be gone on the next visit.
 */
export async function openPassStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<PassStore> {
  if (!factory) throw new Error('no storage');
  const open = factory.open(DB, 1);
  open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'passId' }); };
  const db = await done(open);
  const write = async (work: (store: IDBObjectStore) => void) => { const tx = db.transaction(STORE, 'readwrite'); work(tx.objectStore(STORE)); await settled(tx); };
  const probe = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  await write((s) => { s.put({ passId: ' probe', key: probe }); s.delete(' probe'); });
  return {
    async all() { return (await done(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<PassRecord[]>)).sort((a, b) => a.savedAt - b.savedAt); },
    put: (record) => write((s) => { s.put(record); }),
    remove: (passId) => write((s) => { s.delete(passId); }),
  };
}
