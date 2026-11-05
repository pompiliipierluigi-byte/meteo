// Servizio meteo del thread principale: maschera mare, caricamento dei modelli e dell'onda
// con cache prima della rete (SPEC §3.4).

import { BBOX, HORIZON_H, MARINE, MODELS, PANORAMIC_STEP_DEG } from '../config.js';
import { makeGrid, gridPoint, maskedIndices, fillNearest } from './grid.js';
import { SEA_MASK_GRID_ID, SEA_MASK_BITS } from './sea-mask.js';
import {
  fetchPoints, fetchLastRunMs, windField, waveField, WIND_VARS, WAVE_VARS, WAVE_FIELD_VARS,
} from './openmeteo.js';
import { getLatestField, putField, touchField, cacheDecision, expectedLatestRunMs } from './cache.js';
import { sourcesFor, fuseAuto, singleModel } from './models.js';

/**
 * Esito del caricamento di una sorgente.
 * @typedef {Object} Loaded
 * @property {import('./cache.js').CachedField} entry
 * @property {boolean} fromCache
 * @property {Error | null} error errore di rete se si è ripiegato sulla cache
 */

/**
 * Dati vento pronti per la mappa.
 * @typedef {import('./models.js').WindData & {
 *   runs: Partial<Record<import('./models.js').ModelId, number>>,
 *   fetchedMs: number,
 *   stale: Error | null,
 * }} WindResult
 */

/**
 * Dati onda pronti per la mappa.
 * @typedef {{field: import('./grid.js').WeatherField, runMs: number, fetchedMs: number, stale: Error | null}} WaveResult
 */

export class WeatherService extends EventTarget {
  constructor() {
    super();
    this.grid = makeGrid(BBOX, PANORAMIC_STEP_DEG, `pan${PANORAMIC_STEP_DEG}`);
    /** @type {Uint8Array | null} */
    this.mask = null;
    /** @type {Map<string, Promise<Loaded>>} caricamenti in corso, per non duplicarli */
    this.pending = new Map();
  }

  /**
   * @param {string} label
   * @param {number} done
   * @param {number} total
   */
  progress(label, done, total, waitMs = 0) {
    this.dispatchEvent(new CustomEvent('progress', { detail: { label, done, total, waitMs } }));
  }

  /**
   * Maschera dei punti da scaricare (mare + punti costieri), precalcolata dalla linea di costa
   * Natural Earth (js/weather/sea-mask.js): nessuna richiesta di rete.
   * @returns {Promise<Uint8Array>}
   */
  async ensureMask() {
    if (!this.mask) {
      if (SEA_MASK_GRID_ID !== this.grid.id || SEA_MASK_BITS.length !== this.grid.nx * this.grid.ny) {
        throw new Error('Maschera mare non coerente con la griglia: rigenerarla (tools/seamask)');
      }
      this.mask = Uint8Array.from(SEA_MASK_BITS, (c) => (c === '1' ? 1 : 0));
    }
    return this.mask;
  }

  /**
   * Scarica una sorgente sui punti indicati.
   * @param {string} source 'marine' o id modello
   * @param {number[]} indices
   * @param {number} [runMs] run noto (da meta.json)
   */
  async download(source, indices, runMs) {
    const isMarine = source === 'marine';
    const cfg = isMarine ? MARINE : MODELS[source];
    const points = indices.map((i) => gridPoint(this.grid, i % this.grid.nx, Math.floor(i / this.grid.nx)));
    const label = cfg.label;
    let done = 0;
    this.progress(label, 0, points.length);
    const raw = await fetchPoints(isMarine ? 'marine' : 'forecast', points, isMarine ? WAVE_VARS : WIND_VARS, {
      model: isMarine ? undefined : MODELS[source].api,
      onProgress: (d, t) => {
        done = d;
        this.progress(label, d, t);
      },
      onWait: (ms) => this.progress(label, done, points.length, ms),
    });
    const trimmed = trimTimes(raw);
    const field = isMarine ? waveField(this.grid, indices, trimmed) : windField(this.grid, indices, trimmed);
    const now = Date.now();
    const run = Number.isFinite(runMs) ? runMs : expectedLatestRunMs(now, cfg.runHoursUtc, cfg.availDelayH);
    /** @type {import('./cache.js').CachedField} */
    const cached = {
      source, grid: this.grid, runMs: run, fetchedMs: now, checkedMs: now,
      timesMs: field.timesMs, vars: field.vars,
    };
    return { raw: trimmed, field, cached };
  }

  /**
   * Carica una sorgente: cache se aggiornata, altrimenti rete solo se c'è un run più recente.
   * @param {string} source
   * @param {{force?: boolean}} [opts] force: controlla subito la disponibilità di un run nuovo
   * @returns {Promise<Loaded>}
   */
  load(source, opts = {}) {
    const key = `${source}|${opts.force ? 'f' : ''}`;
    if (!this.pending.has(key)) {
      const p = this.loadNow(source, opts).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return /** @type {Promise<Loaded>} */ (this.pending.get(key));
  }

  /**
   * @param {string} source
   * @param {{force?: boolean}} opts
   * @returns {Promise<Loaded>}
   */
  async loadNow(source, opts) {
    const isMarine = source === 'marine';
    const cfg = isMarine ? MARINE : MODELS[source];
    const cached = await getLatestField(source, this.grid.id);
    const now = Date.now();
    let decision = cacheDecision(cached, now, cfg);
    if (opts.force && decision === 'fresh' && cached) decision = 'check';
    if (decision === 'fresh' && cached) return { entry: cached, fromCache: true, error: null };
    try {
      const mask = await this.ensureMask();
      let runMs = NaN;
      try {
        runMs = await fetchLastRunMs(isMarine ? 'marine' : 'forecast', cfg.meta);
      } catch (err) {
        if (cached) throw err;
      }
      if (cached && Number.isFinite(runMs) && runMs <= cached.runMs) {
        await touchField(cached, now);
        return { entry: cached, fromCache: true, error: null };
      }
      const indices = maskedIndices(this.grid, mask);
      const { field, cached: entry } = await this.download(source, indices, runMs);
      if (isMarine) fillNearest(field, WAVE_FIELD_VARS, mask, 2);
      await putField(entry);
      return { entry, fromCache: false, error: null };
    } catch (err) {
      if (cached) return { entry: cached, fromCache: true, error: /** @type {Error} */ (err) };
      throw err;
    }
  }

  /**
   * Vento per la scelta di modello indicata (Auto = ICON-2I + ECMWF).
   * @param {import('./models.js').ModelChoice} choice
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<WindResult>}
   */
  async getWind(choice, opts = {}) {
    const ids = sourcesFor(choice);
    /** @type {Partial<Record<import('./models.js').ModelId, Loaded>>} */
    const loaded = {};
    for (const id of ids) {
      try {
        loaded[id] = await this.load(id, opts);
      } catch (err) {
        // In Auto ICON-2I è facoltativo: senza, si usa solo ECMWF.
        // Ma un errore di quota o di rete vale per tutti: inutile riprovare con ECMWF.
        if (choice === 'auto' && id === 'icon2i' && !err?.quota && !/raggiungibile/.test(err?.message ?? '')) {
          console.warn('ICON-2I non disponibile:', err);
          continue;
        }
        throw err;
      }
    }
    const asField = (/** @type {Loaded} */ l) => ({ grid: l.entry.grid, timesMs: l.entry.timesMs, vars: l.entry.vars });
    const data = choice === 'auto'
      ? fuseAuto(loaded.icon2i ? asField(loaded.icon2i) : null, asField(/** @type {Loaded} */ (loaded.ecmwf)))
      : singleModel(choice, asField(/** @type {Loaded} */ (loaded[choice])));
    const parts = Object.values(loaded);
    return {
      ...data,
      runs: Object.fromEntries(Object.entries(loaded).map(([id, l]) => [id, l.entry.runMs])),
      fetchedMs: Math.min(...parts.map((l) => l.entry.fetchedMs)),
      stale: parts.find((l) => l.error)?.error ?? null,
    };
  }

  /**
   * Onda (totale, da vento, swell).
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<WaveResult>}
   */
  async getWaves(opts = {}) {
    const l = await this.load('marine', opts);
    return {
      field: { grid: l.entry.grid, timesMs: l.entry.timesMs, vars: l.entry.vars },
      runMs: l.entry.runMs,
      fetchedMs: l.entry.fetchedMs,
      stale: l.error,
    };
  }
}

/**
 * Tiene solo gli istanti da un'ora prima di adesso fino all'orizzonte (+1 h per l'interpolazione).
 * @param {{timesMs: number[], series: Record<string, (number|null)[][]>}} raw
 */
function trimTimes(raw) {
  const now = Date.now();
  const from = Math.floor(now / 3600e3) * 3600e3 - 3600e3;
  const to = from + (HORIZON_H + 2) * 3600e3;
  const keep = raw.timesMs.map((t, i) => (t >= from && t <= to ? i : -1)).filter((i) => i >= 0);
  if (keep.length === raw.timesMs.length) return raw;
  const series = Object.fromEntries(Object.entries(raw.series).map(([v, perPoint]) => [
    v, perPoint.map((s) => keep.map((i) => s[i])),
  ]));
  return { timesMs: keep.map((i) => raw.timesMs[i]), series };
}
