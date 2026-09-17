// IndexedDB "dm" v2. Two stores: one meta record per vault (at most MAX_VAULTS of them), one
// record per sealed entry, each entry stamped with the id of the vault it belongs to.
// v1 held exactly one vault under the id 'vault'; that record is kept as-is and its entries are
// stamped on upgrade, so a v1 install becomes a one-vault v2 install without a rewrite.
// WebKit can report IDB as unavailable for a moment after a cold launch, so open()
// is wrapped in a timeout with backoff before the app decides storage is missing.

const NAME = 'dm';
const VERSION = 2;
export const MAX_VAULTS = 3;
const LEGACY_ID = 'vault';
const OPEN_TIMEOUT = 4000;
const OPEN_TRIES = 4;

let dbp = null;

export class StorageUnavailable extends Error {
  constructor(detail) { super('storage unavailable'); this.detail = detail; }
}

function openOnce() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(NAME, VERSION);
    } catch (err) {
      reject(new StorageUnavailable(`indexedDB.open -> ${err.name}`));
      return;
    }
    const timer = setTimeout(() => reject(new StorageUnavailable('indexedDB.open -> timeout')), OPEN_TIMEOUT);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (ev.oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'id' });
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('seq', 'seq', { unique: false });
      }
      if (ev.oldVersion < 2) {
        const entries = req.transaction.objectStore('entries');
        entries.createIndex('vaultId', 'vaultId', { unique: false });
        entries.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return;
          if (!c.value.vaultId) c.update({ ...c.value, vaultId: LEGACY_ID });
          c.continue();
        };
      }
    };
    req.onblocked = () => { /* another tab holds an older version; the timeout will fire */ };
    req.onerror = () => { clearTimeout(timer); reject(new StorageUnavailable(`indexedDB.open -> ${req.error && req.error.name}`)); };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
  });
}

export async function db() {
  if (dbp) return dbp;
  dbp = (async () => {
    let last;
    for (let i = 0; i < OPEN_TRIES; i++) {
      try {
        return await openOnce();
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 150 * 2 ** i));
      }
    }
    dbp = null;
    throw last;
  })();
  return dbp;
}

/**
 * Wait for BOTH the request's result and the transaction committing, never whichever lands
 * first: resolving on completion alone hands back undefined whenever the value has not been
 * assigned yet, which reads as "there is no vault" and is how a read silently loses a vault.
 * fn is called synchronously — an IndexedDB transaction goes inactive once the task that
 * created it finishes, so deferring the first request by even a tick can abort it.
 */
function tx(store, mode, fn) {
  return db().then((d) => {
    const t = d.transaction(store, mode);
    const committed = new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('transaction failed'));
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
    const value = Promise.resolve(fn(t.objectStore(store)));
    committed.catch(() => {});        // reported through the combined promise below
    value.catch(() => {});
    return Promise.all([value, committed]).then(([v]) => v);
  });
}

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export const allMeta = () => tx('meta', 'readonly', (s) => request(s.getAll()))
  .then((rows) => rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
export const getMeta = (id) => tx('meta', 'readonly', (s) => request(s.get(id)));
export const putMeta = (meta) => tx('meta', 'readwrite', (s) => request(s.put(meta)));
export const allEntries = (vaultId) => tx('entries', 'readonly',
  (s) => request(s.index('vaultId').getAll(vaultId)))
  .then((rows) => rows.sort((a, b) => a.seq - b.seq));
export const deleteEntry = (id) => tx('entries', 'readwrite', (s) => request(s.delete(id)));

// The vault id is stamped here and nowhere else, so no caller can write an orphan entry.
export const putEntry = (vaultId, e) => tx('entries', 'readwrite',
  (s) => request(s.put({ ...e, vaultId })));

/** Write many entries in one transaction — a restore is all-or-nothing. */
export const putEntries = (vaultId, rows) => tx('entries', 'readwrite',
  (s) => Promise.all(rows.map((e) => request(s.put({ ...e, vaultId })))));

function bothStores(fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(['meta', 'entries'], 'readwrite');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
    fn(t.objectStore('meta'), t.objectStore('entries'));
  }));
}

/** Delete one vault's entries inside an open transaction, leaving the other vaults alone. */
function deleteOwn(entries, vaultId) {
  entries.index('vaultId').openKeyCursor(vaultId).onsuccess = (e) => {
    const c = e.target.result;
    if (!c) return;
    entries.delete(c.primaryKey);
    c.continue();
  };
}

/** Replace one vault's entries atomically. Used by the passphrase re-key. */
export const replaceAll = (meta, entries) => bothStores((m, es) => {
  deleteOwn(es, meta.id);
  for (const e of entries) es.put({ ...e, vaultId: meta.id });
  m.put(meta);
});

/** Remove one vault and everything sealed into it. The others are untouched. */
export const removeVault = (vaultId) => bothStores((m, es) => {
  deleteOwn(es, vaultId);
  m.delete(vaultId);
});

/** Cheap structural check so a corrupt vault fails loudly instead of half-working. */
export function metaLooksValid(m) {
  return !!m && typeof m.id === 'string' && m.id.length > 0 && m.v === 1
    && m.pkC instanceof Uint8Array && m.pkC.length === 32
    && m.pkPq instanceof Uint8Array && m.pkPq.length === 1184
    && m.kdf && m.kdf.algo === 'argon2id'
    && Number.isInteger(m.kdf.m) && Number.isInteger(m.kdf.t) && Number.isInteger(m.kdf.p)
    && m.kdf.salt instanceof Uint8Array && m.kdf.salt.length === 16
    && m.norm === 'NFKD';
}

export function entryLooksValid(e) {
  return !!e
    && e.id instanceof Uint8Array && e.id.length === 16
    && Number.isInteger(e.seq) && e.seq >= 1
    && Number.isInteger(e.day)
    && e.ephPub instanceof Uint8Array && e.ephPub.length === 32
    && e.ctPq instanceof Uint8Array && e.ctPq.length === 1088
    && e.nonce instanceof Uint8Array && e.nonce.length === 12
    && e.ct instanceof Uint8Array && [1024, 4096, 16384].includes(e.ct.length - 16);
}

export async function persist() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function persisted() {
  if (!navigator.storage || !navigator.storage.persisted) return false;
  try { return await navigator.storage.persisted(); } catch { return false; }
}
