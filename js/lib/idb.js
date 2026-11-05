// Involucro minimo di IndexedDB basato su Promise.

/**
 * @param {IDBRequest} req
 * @returns {Promise<any>}
 */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Database con archivi chiave/valore (chiavi esterne, stringhe).
 * @typedef {Object} KvDb
 * @property {(store: string, key: string) => Promise<any>} get
 * @property {(store: string, key: string, value: any) => Promise<void>} put
 * @property {(store: string, key: string) => Promise<void>} del
 * @property {(store: string) => Promise<string[]>} keys
 */

/**
 * Apre (o crea) un database con gli archivi indicati.
 * @param {string} name
 * @param {number} version incrementare quando cambia l'elenco degli archivi
 * @param {string[]} stores
 * @returns {Promise<KvDb>}
 */
export async function openKvDb(name, version, stores) {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB non disponibile');
  const req = indexedDB.open(name, version);
  req.onupgradeneeded = () => {
    const db = req.result;
    for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
  };
  /** @type {IDBDatabase} */
  const db = await done(req);
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  return {
    get: (store, key) => done(tx(store, 'readonly').get(key)),
    put: async (store, key, value) => { await done(tx(store, 'readwrite').put(value, key)); },
    del: async (store, key) => { await done(tx(store, 'readwrite').delete(key)); },
    keys: async (store) => (await done(tx(store, 'readonly').getAllKeys())).map(String),
  };
}
