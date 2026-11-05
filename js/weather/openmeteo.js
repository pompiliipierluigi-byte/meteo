// Client Open-Meteo (Forecast e Marine): richieste multi-punto a blocchi e conversione in griglie.

import { OPEN_METEO } from '../config.js';
import { emptyField, windToUV } from './grid.js';
import { createRateLimiter } from './rate-limit.js';

/** Limitatore condiviso da tutte le richieste dati della pagina. */
const limiter = createRateLimiter({ budget: OPEN_METEO.callsPerMinute, windowMs: 60e3 });

/**
 * Peso in quota di una richiesta: un'unità per punto, moltiplicata per ogni blocco di 10 variabili.
 * @param {number} nPoints
 * @param {number} nVars
 * @returns {number}
 */
export function requestWeight(nPoints, nVars) {
  return nPoints * Math.max(1, Math.ceil(nVars / 10));
}

/** Variabili vento richieste alla Forecast API. */
export const WIND_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];

/** Variabili onda richieste alla Marine API (9: peso in quota = 1 per punto). */
export const WAVE_VARS = [
  'wave_height', 'wave_direction', 'wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
];

/**
 * Tipi d'onda: prefisso API → prefisso delle variabili del campo.
 * Per ciascuno il campo contiene `<p>_h` (m), `<p>_per` (s), `<p>_dx`, `<p>_dy`
 * (versore della direzione di provenienza: sin, cos), così la direzione si interpola come vettore.
 */
export const WAVE_KINDS = { wave: 'wave', wind_wave: 'wwave', swell_wave: 'swell' };

/** Variabili del campo vento. */
export const WIND_FIELD_VARS = ['u', 'v', 'gust'];

/** Variabili del campo onda. */
export const WAVE_FIELD_VARS = Object.values(WAVE_KINDS).flatMap((p) => [`${p}_h`, `${p}_per`, `${p}_dx`, `${p}_dy`]);

/** Variabili marine per il corridoio di routing: onda totale e corrente (5: peso 1 per punto). */
export const ROUTE_MARINE_VARS = ['wave_height', 'wave_direction', 'wave_period', 'ocean_current_velocity', 'ocean_current_direction'];

/** Variabili correnti per il layer sulla mappa. */
export const CURRENT_VARS = ['ocean_current_velocity', 'ocean_current_direction'];

/** Temperatura superficiale del mare (°C) per il layer sulla mappa. */
export const SST_VARS = ['sea_surface_temperature'];

/** km/h → nodi (la Marine API dà le correnti in km/h). */
export const KMH_TO_KN = 1 / 1.852;

/** Errore dell'API, con messaggio leggibile e flag di quota. */
export class OpenMeteoError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, quota?: boolean}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.status = info.status;
    this.quota = Boolean(info.quota);
  }
}

/**
 * URL di una richiesta multi-punto.
 * @param {'forecast'|'marine'} kind
 * @param {{lat: number, lon: number}[]} points
 * @param {string[]} variables
 * @param {{model?: string, forecastDays?: number}} [opts]
 * @returns {string}
 */
export function buildUrl(kind, points, variables, opts = {}) {
  const base = kind === 'marine' ? OPEN_METEO.marineUrl : OPEN_METEO.forecastUrl;
  const p = new URLSearchParams();
  p.set('latitude', points.map((pt) => pt.lat).join(','));
  p.set('longitude', points.map((pt) => pt.lon).join(','));
  p.set('hourly', variables.join(','));
  p.set('timezone', 'GMT');
  p.set('timeformat', 'unixtime');
  p.set('forecast_days', String(opts.forecastDays ?? OPEN_METEO.forecastDays));
  // Celle di mare: per il vento evita il punto di terra più vicino (valori ridotti dall'orografia).
  p.set('cell_selection', 'sea');
  if (kind === 'forecast') {
    p.set('wind_speed_unit', 'kn');
    if (opts.model) p.set('models', opts.model);
  }
  // Le virgole restano leggibili (Open-Meteo le accetta anche codificate).
  return `${base}?${p.toString().replaceAll('%2C', ',')}`;
}

/**
 * Serie orarie per punto da una risposta (oggetto singolo o array per più punti).
 * @param {any} json
 * @param {string[]} variables
 * @returns {{timesMs: number[], series: Record<string, (number|null)[][]>}}
 */
export function parseResponse(json, variables) {
  if (json && json.error) throw new OpenMeteoError(`Open-Meteo: ${json.reason || 'errore'}`);
  const list = Array.isArray(json) ? json : [json];
  if (!list.length || !list[0].hourly) throw new OpenMeteoError('Open-Meteo: risposta senza dati orari');
  const timesMs = list[0].hourly.time.map((s) => s * 1000);
  /** @type {Record<string, (number|null)[][]>} */
  const series = {};
  for (const v of variables) {
    series[v] = list.map((loc) => {
      const arr = loc.hourly?.[v];
      return Array.isArray(arr) ? arr : new Array(timesMs.length).fill(null);
    });
  }
  return { timesMs, series };
}

/**
 * Scarica le serie di più punti, a blocchi in sequenza (rispetto della quota).
 * @param {'forecast'|'marine'} kind
 * @param {{lat: number, lon: number}[]} points
 * @param {string[]} variables
 * @param {{model?: string, fetchFn?: typeof fetch, onProgress?: (done: number, total: number) => void,
 *   onWait?: (waitMs: number) => void, signal?: AbortSignal, limiter?: import('./rate-limit.js').RateLimiter}} [opts]
 * @returns {Promise<{timesMs: number[], series: Record<string, (number|null)[][]>}>}
 */
export async function fetchPoints(kind, points, variables, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const lim = opts.limiter ?? limiter;
  const size = OPEN_METEO.chunkSize;
  /** @type {number[]} */
  let timesMs = [];
  /** @type {Record<string, (number|null)[][]>} */
  const series = Object.fromEntries(variables.map((v) => [v, []]));
  for (let i = 0; i < points.length; i += size) {
    if (i > 0 && OPEN_METEO.chunkPauseMs) await new Promise((r) => setTimeout(r, OPEN_METEO.chunkPauseMs));
    const chunk = points.slice(i, i + size);
    const url = buildUrl(kind, chunk, variables, { model: opts.model });
    const weight = requestWeight(chunk.length, variables.length);
    let json;
    for (let attempt = 0; ; attempt++) {
      await lim.acquire(weight, opts.onWait);
      let res;
      try {
        res = await fetchFn(url, { signal: opts.signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new OpenMeteoError('Open-Meteo non raggiungibile (rete assente?)');
      }
      if (res.ok) {
        json = await res.json();
        break;
      }
      let reason = `HTTP ${res.status}`;
      try { reason = (await res.json()).reason || reason; } catch { /* corpo non JSON */ }
      // Quota al minuto: si attende la finestra successiva e si riprova lo stesso blocco.
      if (res.status === 429 && /minut/i.test(reason) && attempt < OPEN_METEO.maxMinuteRetries) {
        lim.saturate();
        continue;
      }
      throw new OpenMeteoError(`Open-Meteo: ${reason}`, { status: res.status, quota: res.status === 429 });
    }
    const part = parseResponse(json, variables);
    if (i === 0) timesMs = part.timesMs;
    for (const v of variables) series[v].push(...part.series[v]);
    opts.onProgress?.(Math.min(i + size, points.length), points.length);
  }
  return { timesMs, series };
}

/** @param {number|null|undefined} x */
const num = (x) => (x === null || x === undefined ? NaN : x);

/**
 * Campo vento (u, v, raffica) dalle serie scaricate.
 * @param {import('./grid.js').GridSpec} grid
 * @param {number[]} indices indice di griglia di ciascun punto
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} data
 * @returns {import('./grid.js').WeatherField}
 */
export function windField(grid, indices, data) {
  const f = emptyField(grid, data.timesMs, WIND_FIELD_VARS);
  const plane = grid.nx * grid.ny;
  const { u, v, gust } = f.vars;
  const sp = data.series.wind_speed_10m;
  const dir = data.series.wind_direction_10m;
  const gu = data.series.wind_gusts_10m;
  indices.forEach((idx, k) => {
    for (let t = 0; t < data.timesMs.length; t++) {
      const s = num(sp[k][t]);
      const d = num(dir[k][t]);
      const o = t * plane + idx;
      if (Number.isFinite(s) && Number.isFinite(d)) {
        const c = windToUV(s, d);
        u[o] = c.u;
        v[o] = c.v;
      }
      gust[o] = num(gu[k][t]);
    }
  });
  return f;
}

/**
 * Campo onda (totale, da vento, swell) dalle serie scaricate.
 * @param {import('./grid.js').GridSpec} grid
 * @param {number[]} indices
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} data
 * @returns {import('./grid.js').WeatherField}
 */
export function waveField(grid, indices, data) {
  const f = emptyField(grid, data.timesMs, WAVE_FIELD_VARS);
  const plane = grid.nx * grid.ny;
  for (const [api, p] of Object.entries(WAVE_KINDS)) {
    const hS = data.series[`${api}_height`];
    const dS = data.series[`${api}_direction`];
    const pS = data.series[`${api}_period`];
    const h = f.vars[`${p}_h`];
    const per = f.vars[`${p}_per`];
    const dx = f.vars[`${p}_dx`];
    const dy = f.vars[`${p}_dy`];
    indices.forEach((idx, k) => {
      for (let t = 0; t < data.timesMs.length; t++) {
        const o = t * plane + idx;
        h[o] = num(hS[k][t]);
        per[o] = num(pS[k][t]);
        const d = num(dS[k][t]);
        if (Number.isFinite(d)) {
          const r = (d * Math.PI) / 180;
          dx[o] = Math.sin(r);
          dy[o] = Math.cos(r);
        }
      }
    });
  }
  return f;
}

/**
 * URL del file statico con le informazioni sull'ultimo run di un modello.
 * @param {'forecast'|'marine'} kind
 * @param {string} metaId
 * @returns {string}
 */
export function metaUrl(kind, metaId) {
  const host = kind === 'marine' ? 'marine-api.open-meteo.com' : 'api.open-meteo.com';
  return `https://${host}/data/${metaId}/static/meta.json`;
}

/**
 * Inizializzazione dell'ultimo run disponibile (ms UTC), da meta.json.
 * @param {'forecast'|'marine'} kind
 * @param {string} metaId
 * @param {{fetchFn?: typeof fetch, signal?: AbortSignal}} [opts]
 * @returns {Promise<number>}
 */
export async function fetchLastRunMs(kind, metaId, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  let res;
  try {
    res = await fetchFn(metaUrl(kind, metaId), { signal: opts.signal, cache: 'no-store' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new OpenMeteoError('Open-Meteo non raggiungibile (rete assente?)');
  }
  if (!res.ok) throw new OpenMeteoError(`Open-Meteo meta.json: HTTP ${res.status}`, { status: res.status });
  const json = await res.json();
  const s = Number(json.last_run_initialisation_time);
  if (!Number.isFinite(s) || s <= 0) throw new OpenMeteoError('Open-Meteo meta.json: run non indicato');
  return s * 1000;
}

/**
 * Campo marino per il routing: onda totale (wave_h, wave_per, wave_dx, wave_dy) e corrente
 * (cur_u, cur_v in nodi, verso cui va: est, nord). Le variabili assenti restano NaN.
 * @param {import('./grid.js').GridSpec} grid
 * @param {number[]} indices
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} data
 * @returns {import('./grid.js').WeatherField}
 */
/**
 * Campo temperatura del mare (°C).
 * @param {import('./grid.js').GridSpec} grid
 * @param {number[]} indices
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} data
 * @returns {import('./grid.js').WeatherField}
 */
export function sstField(grid, indices, data) {
  const f = emptyField(grid, data.timesMs, ['sst']);
  const plane = grid.nx * grid.ny;
  const s = data.series.sea_surface_temperature;
  indices.forEach((idx, k) => {
    for (let t = 0; t < data.timesMs.length; t++) f.vars.sst[t * plane + idx] = num(s?.[k]?.[t]);
  });
  return f;
}

/**
 * Campo marino del corridoio (onda totale e corrente).
 * @param {import('./grid.js').GridSpec} grid
 * @param {number[]} indices
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} data
 * @returns {import('./grid.js').WeatherField}
 */
export function routeMarineField(grid, indices, data) {
  const f = emptyField(grid, data.timesMs, ['wave_h', 'wave_per', 'wave_dx', 'wave_dy', 'cur_u', 'cur_v']);
  const plane = grid.nx * grid.ny;
  const S = data.series;
  const at = (name, k, t) => num(S[name]?.[k]?.[t]);
  indices.forEach((idx, k) => {
    for (let t = 0; t < data.timesMs.length; t++) {
      const o = t * plane + idx;
      f.vars.wave_h[o] = at('wave_height', k, t);
      f.vars.wave_per[o] = at('wave_period', k, t);
      const d = at('wave_direction', k, t);
      if (Number.isFinite(d)) {
        f.vars.wave_dx[o] = Math.sin((d * Math.PI) / 180);
        f.vars.wave_dy[o] = Math.cos((d * Math.PI) / 180);
      }
      const sp = at('ocean_current_velocity', k, t);
      const cd = at('ocean_current_direction', k, t);
      if (Number.isFinite(sp) && Number.isFinite(cd)) {
        const kn = sp * KMH_TO_KN;
        f.vars.cur_u[o] = kn * Math.sin((cd * Math.PI) / 180);
        f.vars.cur_v[o] = kn * Math.cos((cd * Math.PI) / 180);
      }
    }
  });
  return f;
}
