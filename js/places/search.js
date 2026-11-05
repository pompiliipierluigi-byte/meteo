// Ricerca di località (SPEC §2.14): porti inclusi nell'app (data/places/ports.json, anche offline),
// luoghi salvati dall'utente e, su richiesta, ricerca online con Open-Meteo Geocoding.

import { BBOX } from '../config.js';

/** Endpoint della ricerca online (gratuita, senza chiave). */
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * @typedef {Object} Place
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {'port' | 'saved' | 'online'} kind
 * @property {string} [detail] paese, regione o nota
 * @property {string} [id] luogo salvato
 * @property {boolean} [home] porto base
 */

/**
 * Testo normalizzato per il confronto: minuscole, senza accenti e diacritici (š → s, ë → e).
 * @param {string} s
 */
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Punteggio di corrispondenza (più basso = migliore; null = nessuna).
 * @param {string} q testo normalizzato
 * @param {string[]} names nomi normalizzati
 */
function score(q, names) {
  let best = null;
  for (const n of names) {
    let s = null;
    if (n === q) s = 0;
    else if (n.startsWith(q)) s = 1;
    else if (n.split(' ').some((w) => w.startsWith(q))) s = 2;
    else if (n.includes(q)) s = 3;
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

/**
 * Cerca tra luoghi noti (porti e salvati): prima i salvati, poi per qualità della corrispondenza.
 * @param {string} query
 * @param {{name: string, lat: number, lon: number, aliases?: string[], country?: string}[]} ports
 * @param {Place[]} [saved]
 * @param {number} [limit]
 * @returns {Place[]}
 */
export function searchKnown(query, ports, saved = [], limit = 8) {
  const q = normalize(query);
  if (q.length < 2) return [];
  const hits = [];
  for (const p of saved) {
    const s = score(q, [normalize(p.name)]);
    if (s !== null) hits.push({ s: s - 10, p });
  }
  for (const p of ports) {
    const s = score(q, [p.name, ...(p.aliases ?? [])].map(normalize));
    if (s !== null) hits.push({ s, p: /** @type {Place} */ ({ name: p.name, lat: p.lat, lon: p.lon, kind: 'port', detail: p.country }) });
  }
  hits.sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name, 'it'));
  return hits.slice(0, limit).map((h) => h.p);
}

/**
 * Risultati della ricerca online dentro l'area di lavoro (con margine di 0.3°).
 * @param {any} json risposta di Open-Meteo Geocoding
 * @returns {Place[]}
 */
export function parseGeocoding(json) {
  const m = 0.3;
  return (json?.results ?? [])
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
      && r.latitude >= BBOX.latMin - m && r.latitude <= BBOX.latMax + m
      && r.longitude >= BBOX.lonMin - m && r.longitude <= BBOX.lonMax + m)
    .map((r) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      kind: /** @type {const} */ ('online'),
      detail: [r.admin2 ?? r.admin1, r.country_code].filter(Boolean).join(', '),
    }));
}

/**
 * Ricerca online (una richiesta per ricerca esplicita, mai mentre si scrive: quota).
 * @param {string} query
 * @param {{fetchFn?: typeof fetch, signal?: AbortSignal}} [opts]
 * @returns {Promise<Place[]>}
 */
export async function searchOnline(query, opts = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const p = new URLSearchParams({ name: q, count: '20', language: 'it', format: 'json' });
  let res;
  try {
    res = await (opts.fetchFn ?? fetch)(`${GEOCODING_URL}?${p}`, { signal: opts.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('Ricerca online non disponibile (rete assente?)');
  }
  if (!res.ok) throw new Error(`Ricerca online: HTTP ${res.status}`);
  return parseGeocoding(await res.json());
}

/** @type {Promise<any[]> | null} */
let portsPromise = null;

/** Elenco dei porti (caricato una volta). @returns {Promise<any[]>} */
export function loadPorts() {
  if (!portsPromise) {
    portsPromise = fetch(new URL('../../data/places/ports.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => j.ports)
      .catch((err) => {
        portsPromise = null;
        console.warn('Elenco porti non disponibile:', err);
        return [];
      });
  }
  return portsPromise;
}
