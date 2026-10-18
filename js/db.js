// IndexedDB storage. Stores: clients, events (days embedded), blobs (photos + files),
// tombstones (deleted ids, so merging a backup doesn't resurrect them), meta (settings).

const NAME = 'francosound-invoicer', VERSION = 1;
const STORES = [['clients', 'id'], ['events', 'id'], ['blobs', 'id'], ['tombstones', 'id'], ['meta', 'key']];
let dbp;

function open() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      for (const [s, keyPath] of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}

export const getAll = s => tx(s, 'readonly', st => st.getAll());
export const get = (s, k) => tx(s, 'readonly', st => st.get(k));
export const put = (s, v) => tx(s, 'readwrite', st => st.put(v));
export const rawDel = (s, k) => tx(s, 'readwrite', st => st.delete(k));
export const clear = s => tx(s, 'readwrite', st => st.clear());

export const tombstone = (id, store) => put('tombstones', { id, store, at: Date.now() });
export async function del(s, k) {
  await rawDel(s, k);
  await tombstone(k, s);
}

export const uid = () => crypto.randomUUID?.() ??
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
