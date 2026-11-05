// Maree per una località (SPEC §2.13): livello del mare previsto da Open-Meteo Marine
// (`sea_level_height_msl`: marea astronomica + effetto di vento e pressione, modello a ~8 km).
// Cache locale prima della rete (6 h); alte e basse maree dai massimi e minimi della serie oraria.

import { fetchPoints } from './openmeteo.js';

const CACHE_PREFIX = 'meteo.tide.';
const CACHE_TTL_MS = 6 * 3600e3;
const CACHE_MAX = 20;

/**
 * Alte e basse maree: estremi locali della serie, istante e livello raffinati con una parabola sui tre
 * punti; scartati gli estremi di ampiezza < `minRangeM` rispetto al precedente (rumore).
 * @param {number[]} timesMs
 * @param {number[]} levelsM
 * @param {number} [minRangeM]
 * @returns {{t: number, levelM: number, kind: 'high' | 'low'}[]}
 */
export function tideExtremes(timesMs, levelsM, minRangeM = 0.03) {
  /** @type {{t: number, levelM: number, kind: 'high' | 'low'}[]} */
  const out = [];
  for (let i = 1; i + 1 < levelsM.length; i++) {
    const a = levelsM[i - 1];
    const b = levelsM[i];
    const c = levelsM[i + 1];
    if (![a, b, c].every(Number.isFinite)) continue;
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    // Vertice della parabola per (−1, a), (0, b), (1, c).
    const den = a - 2 * b + c;
    const x = den !== 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
    // Correzione limitata: con vicini molto asimmetrici la parabola esagera.
    const maxAdj = 0.5 * Math.min(Math.abs(a - b), Math.abs(c - b));
    const level = b + Math.max(-maxAdj, Math.min(maxAdj, -((a - c) * x) / 4));
    const dt = (timesMs[i + 1] - timesMs[i - 1]) / 2;
    const e = { t: Math.round(timesMs[i] + x * dt), levelM: level, kind: /** @type {'high' | 'low'} */ (high ? 'high' : 'low') };
    const prev = out[out.length - 1];
    if (prev && prev.kind === e.kind) {
      // Due massimi (o minimi) di fila: si tiene il più marcato.
      if ((e.kind === 'high') === (e.levelM > prev.levelM)) out[out.length - 1] = e;
      continue;
    }
    if (prev && Math.abs(e.levelM - prev.levelM) < minRangeM) continue;
    out.push(e);
  }
  return out;
}

/**
 * @typedef {Object} TideData
 * @property {number} lat punto del modello (cella di mare più vicina)
 * @property {number} lon
 * @property {number[]} timesMs
 * @property {number[]} levelsM livello rispetto al livello medio del mare (m), NaN se mancante
 * @property {number} fetchedMs
 */

/** @param {number} lat @param {number} lon */
const keyOf = (lat, lon) => `${CACHE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}`;

/**
 * Livello del mare previsto (5–6 giorni) per un punto.
 * @param {number} lat
 * @param {number} lon
 * @param {{fetchFn?: typeof fetch, force?: boolean, storage?: Storage | null}} [opts]
 * @returns {Promise<TideData>}
 */
export async function getTide(lat, lon, opts = {}) {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const key = keyOf(Math.round(lat * 20) / 20, Math.round(lon * 20) / 20);
  if (!opts.force && storage) {
    try {
      const hit = JSON.parse(storage.getItem(key) ?? 'null');
      if (hit && Date.now() - hit.fetchedMs < CACHE_TTL_MS) return { ...hit, levelsM: hit.levelsM.map((v) => (v === null ? NaN : v)) };
    } catch { /* cache illeggibile: si scarica di nuovo */ }
  }
  const raw = await fetchPoints('marine', [{ lat, lon }], ['sea_level_height_msl'], { fetchFn: opts.fetchFn });
  const series = raw.series.sea_level_height_msl[0] ?? [];
  const now = Date.now();
  // Da 6 ore fa in poi: la pagina parte da oggi.
  const from = now - 30 * 3600e3;
  const keep = raw.timesMs.map((t, i) => (t >= from ? i : -1)).filter((i) => i >= 0);
  /** @type {TideData} */
  const data = {
    lat,
    lon,
    timesMs: keep.map((i) => raw.timesMs[i]),
    levelsM: keep.map((i) => (series[i] === null || series[i] === undefined ? NaN : series[i])),
    fetchedMs: now,
  };
  if (storage) {
    try {
      storage.setItem(key, JSON.stringify({ ...data, levelsM: data.levelsM.map((v) => (Number.isFinite(v) ? v : null)) }));
      prune(storage);
    } catch { /* spazio esaurito: niente cache */ }
  }
  if (!data.levelsM.some(Number.isFinite)) throw new Error('Marea non disponibile per questo punto (fuori dal modello o vicino a costa).');
  return data;
}

/** @returns {Storage | null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Tiene al massimo CACHE_MAX località in cache (le più recenti). @param {Storage} storage */
function prune(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  if (keys.length <= CACHE_MAX) return;
  const aged = keys.map((k) => {
    try {
      return [k, JSON.parse(storage.getItem(k) ?? '{}').fetchedMs ?? 0];
    } catch {
      return [k, 0];
    }
  }).sort((a, b) => a[1] - b[1]);
  for (const [k] of aged.slice(0, keys.length - CACHE_MAX)) storage.removeItem(k);
}
