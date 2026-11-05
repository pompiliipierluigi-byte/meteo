// Cache dei dati meteo in IndexedDB e regole di aggiornamento.
// Chiave dei campi = (sorgente, griglia, run): si conserva solo il run più recente per sorgente e griglia.
// Nuovo download solo quando è disponibile un run più recente (SPEC §3.4).

import { openKvDb } from '../lib/idb.js';

const DB_NAME = 'meteo';
const DB_VERSION = 1;
const FIELDS = 'fields';
const KV = 'kv';

/** Intervallo minimo tra due controlli di meta.json per la stessa sorgente (ms). */
export const MIN_RECHECK_MS = 30 * 60 * 1000;

/**
 * Campo in cache.
 * @typedef {Object} CachedField
 * @property {string} source 'icon2i' | 'ecmwf' | 'gfs' | 'marine'
 * @property {import('./grid.js').GridSpec} grid
 * @property {number} runMs inizializzazione del run (UTC)
 * @property {number} fetchedMs momento del download
 * @property {number} checkedMs ultimo controllo di disponibilità di un run nuovo
 * @property {number[]} timesMs
 * @property {Record<string, Float32Array>} vars
 */

/** @type {Promise<import('../lib/idb.js').KvDb | null> | null} */
let dbPromise = null;

/** @returns {Promise<import('../lib/idb.js').KvDb | null>} null se IndexedDB non è disponibile */
function db() {
  if (!dbPromise) {
    dbPromise = openKvDb(DB_NAME, DB_VERSION, [FIELDS, KV]).catch((err) => {
      console.warn('Cache meteo non disponibile:', err);
      return null;
    });
  }
  return dbPromise;
}

/**
 * @param {string} source
 * @param {string} gridId
 * @param {number} runMs
 */
const fieldKey = (source, gridId, runMs) => `${source}|${gridId}|${new Date(runMs).toISOString()}`;

/**
 * Campo più recente in cache per sorgente e griglia.
 * @param {string} source
 * @param {string} gridId
 * @returns {Promise<CachedField | null>}
 */
export async function getLatestField(source, gridId) {
  const d = await db();
  if (!d) return null;
  const prefix = `${source}|${gridId}|`;
  const keys = (await d.keys(FIELDS)).filter((k) => k.startsWith(prefix)).sort();
  if (!keys.length) return null;
  return (await d.get(FIELDS, keys[keys.length - 1])) ?? null;
}

/**
 * Salva un campo ed elimina i run precedenti della stessa sorgente e griglia.
 * @param {CachedField} entry
 */
export async function putField(entry) {
  const d = await db();
  if (!d) return;
  const key = fieldKey(entry.source, entry.grid.id, entry.runMs);
  const prefix = `${entry.source}|${entry.grid.id}|`;
  try {
    await d.put(FIELDS, key, entry);
  } catch (err) {
    console.warn('Salvataggio in cache non riuscito:', err);
    return;
  }
  // Si tiene solo l'ultimo run per sorgente e griglia; dei corridoi di rotta solo l'ultimo per sorgente.
  const corridor = entry.grid.id.startsWith('cor');
  for (const k of await d.keys(FIELDS)) {
    if (k === key) continue;
    if (k.startsWith(prefix) || (corridor && k.startsWith(`${entry.source}|cor`))) await d.del(FIELDS, k);
  }
}

/**
 * Aggiorna solo l'istante dell'ultimo controllo.
 * @param {CachedField} entry
 * @param {number} checkedMs
 */
export async function touchField(entry, checkedMs) {
  entry.checkedMs = checkedMs;
  await putField(entry);
}

/**
 * Valore generico (es. maschera mare).
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getKv(key) {
  const d = await db();
  return d ? d.get(KV, key) : undefined;
}

/**
 * @param {string} key
 * @param {any} value
 */
export async function putKv(key, value) {
  const d = await db();
  if (d) await d.put(KV, key, value);
}

/**
 * Run più recente che dovrebbe essere già pubblicato all'istante `nowMs`.
 * @param {number} nowMs
 * @param {number[]} runHoursUtc ore di inizializzazione (UTC)
 * @param {number} availDelayH ritardo tipico di pubblicazione
 * @returns {number} inizializzazione attesa (ms UTC)
 */
export function expectedLatestRunMs(nowMs, runHoursUtc, availDelayH) {
  const hours = [...runHoursUtc].sort((a, b) => a - b);
  const ref = nowMs - availDelayH * 3600e3;
  const day = new Date(ref);
  const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  for (let d = 0; d <= 1; d++) {
    for (let i = hours.length - 1; i >= 0; i--) {
      const run = dayStart - d * 86400e3 + hours[i] * 3600e3;
      if (run <= ref) return run;
    }
  }
  return dayStart - 86400e3;
}

/**
 * Decide cosa fare con la cache di una sorgente.
 * - 'fetch': nessun dato in cache → scaricare;
 * - 'fresh': la cache contiene già il run atteso, o è stata controllata da poco → nessuna rete;
 * - 'check': potrebbe esserci un run nuovo → leggere meta.json e scaricare solo se più recente.
 * @param {{runMs: number, checkedMs: number} | null} entry
 * @param {number} nowMs
 * @param {{runHoursUtc: number[], availDelayH: number}} cfg
 * @returns {'fetch' | 'fresh' | 'check'}
 */
export function cacheDecision(entry, nowMs, cfg) {
  if (!entry) return 'fetch';
  if (entry.runMs >= expectedLatestRunMs(nowMs, cfg.runHoursUtc, cfg.availDelayH)) return 'fresh';
  if (nowMs - entry.checkedMs < MIN_RECHECK_MS) return 'fresh';
  return 'check';
}
