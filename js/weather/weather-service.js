// Servizio meteo del thread principale: maschera mare, caricamento dei modelli e dell'onda
// con cache prima della rete (SPEC §3.4).

import { BBOX, HORIZON_H, MARINE, MODELS, PANORAMIC_STEP_DEG } from '../config.js';
import { makeGrid, gridPoint, maskedIndices, fillNearest } from './grid.js';
import { SEA_MASK_GRID_ID, SEA_MASK_BITS } from './sea-mask.js';
import {
  fetchPoints, fetchLastRunMs, windField, waveField, routeMarineField, sstField,
  WIND_VARS, WAVE_VARS, WAVE_FIELD_VARS, CURRENT_VARS, ROUTE_MARINE_VARS, SST_VARS,
} from './openmeteo.js';
import { corridorGrid } from './corridor.js';
import { distanceNm } from '../routing/geo.js';

/** Ore sicuramente coperte da ICON-2I a partire da adesso (72 h dal run, meno il ritardo di pubblicazione). */
const ICON_SAFE_HORIZON_H = 54;

/**
 * Sorgenti di dati: modelli di vento, onda della mappa, correnti della mappa, marino del corridoio.
 * @param {string} source
 */
function sourceSpec(source) {
  if (source === 'marine') return { kind: 'marine', vars: WAVE_VARS, build: waveField, fill: WAVE_FIELD_VARS, cfg: MARINE };
  if (source === 'currents') return { kind: 'marine', vars: CURRENT_VARS, build: routeMarineField, fill: ['cur_u', 'cur_v'], cfg: { ...MARINE, label: 'Correnti' } };
  if (source === 'sst') return { kind: 'marine', vars: SST_VARS, build: sstField, fill: ['sst'], cfg: { ...MARINE, label: 'Temperatura del mare' } };
  if (source === 'route-marine') return { kind: 'marine', vars: ROUTE_MARINE_VARS, build: routeMarineField, fill: null, cfg: MARINE };
  const m = MODELS[source];
  if (!m) throw new Error(`Sorgente sconosciuta: ${source}`);
  return { kind: 'forecast', vars: WIND_VARS, build: windField, fill: null, cfg: m, model: m.api };
}
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
  async download(source, indices, runMs, grid = this.grid) {
    const spec = sourceSpec(source);
    const cfg = spec.cfg;
    const points = indices.map((i) => gridPoint(grid, i % grid.nx, Math.floor(i / grid.nx)));
    const label = cfg.label;
    let done = 0;
    this.progress(label, 0, points.length);
    const raw = await fetchPoints(spec.kind, points, spec.vars, {
      model: spec.model,
      onProgress: (d, t) => {
        done = d;
        this.progress(label, d, t);
      },
      onWait: (ms) => this.progress(label, done, points.length, ms),
    });
    const trimmed = trimTimes(raw);
    const field = spec.build(grid, indices, trimmed);
    const now = Date.now();
    const run = Number.isFinite(runMs) ? runMs : expectedLatestRunMs(now, cfg.runHoursUtc, cfg.availDelayH);
    /** @type {import('./cache.js').CachedField} */
    const cached = {
      source, grid, runMs: run, fetchedMs: now, checkedMs: now,
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
  load(source, opts = {}, area = null) {
    const key = `${source}|${area?.grid.id ?? ''}|${opts.force ? 'f' : ''}`;
    if (!this.pending.has(key)) {
      const p = this.loadNow(source, opts, area).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return /** @type {Promise<Loaded>} */ (this.pending.get(key));
  }

  /**
   * @param {string} source
   * @param {{force?: boolean}} opts
   * @returns {Promise<Loaded>}
   */
  async loadNow(source, opts, area = null) {
    const spec = sourceSpec(source);
    const cfg = spec.cfg;
    const grid = area?.grid ?? this.grid;
    const cached = await getLatestField(source, grid.id);
    const now = Date.now();
    let decision = cacheDecision(cached, now, cfg);
    if (opts.force && decision === 'fresh' && cached) decision = 'check';
    if (decision === 'fresh' && cached) return { entry: cached, fromCache: true, error: null };
    try {
      const mask = area ? null : await this.ensureMask();
      let runMs = NaN;
      try {
        runMs = await fetchLastRunMs(spec.kind, cfg.meta);
      } catch (err) {
        if (cached) throw err;
      }
      if (cached && Number.isFinite(runMs) && runMs <= cached.runMs) {
        await touchField(cached, now);
        return { entry: cached, fromCache: true, error: null };
      }
      const indices = area ? area.indices : maskedIndices(this.grid, /** @type {Uint8Array} */ (mask));
      const { field, cached: entry } = await this.download(source, indices, runMs, grid);
      if (spec.fill && mask) fillNearest(field, spec.fill, mask, 2);
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
   * Temperatura superficiale del mare sulla griglia della mappa (scaricata solo se il layer è attivo).
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<WaveResult>}
   */
  async getSst(opts = {}) {
    const l = await this.load('sst', opts);
    return {
      field: { grid: l.entry.grid, timesMs: l.entry.timesMs, vars: l.entry.vars },
      runMs: l.entry.runMs,
      fetchedMs: l.entry.fetchedMs,
      stale: l.error,
    };
  }

  /**
   * Correnti superficiali sulla griglia della mappa (scaricate solo se il layer è attivo).
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<WaveResult>}
   */
  async getCurrents(opts = {}) {
    const l = await this.load('currents', opts);
    return {
      field: { grid: l.entry.grid, timesMs: l.entry.timesMs, vars: l.entry.vars },
      runMs: l.entry.runMs,
      fetchedMs: l.entry.fetchedMs,
      stale: l.error,
    };
  }

  /**
   * Meteo fine del corridoio di una rotta: vento del modello scelto (Auto = fusione) e onda + corrente.
   * @param {import('./models.js').ModelChoice} choice
   * @param {{lat: number, lon: number}[]} route partenza, waypoint, arrivo
   * @param {{stepDeg?: number, marginNm?: number, departMs?: number}} [opts]
   * @returns {Promise<{wind: import('./models.js').WindData & {runs: Record<string, number>}, marine: import('./grid.js').WeatherField | null, grid: import('./grid.js').GridSpec, points: number}>}
   */
  async getCorridor(choice, route, opts = {}) {
    const marginNm = opts.marginNm ?? 12;
    const area = corridorGrid(route, { stepDeg: opts.stepDeg ?? 0.1, marginNm });
    // Onda e correnti: il modello marino ha ~8 km di risoluzione, basta una griglia più larga.
    const marineArea = corridorGrid(route, { stepDeg: 0.2, marginNm });
    let ids = sourcesFor(choice);
    // Auto: se la traversata stimata finisce entro l'orizzonte di ICON-2I, ECMWF non serve (quota).
    if (choice === 'auto') {
      let dist = 0;
      for (let i = 0; i + 1 < route.length; i++) dist += distanceNm(route[i].lat, route[i].lon, route[i + 1].lat, route[i + 1].lon);
      const estEndMs = (opts.departMs ?? Date.now()) + ((1.6 * dist) / 4 + 3) * 3600e3;
      if (estEndMs <= Date.now() + ICON_SAFE_HORIZON_H * 3600e3) ids = ['icon2i'];
    }
    /** @type {Record<string, Loaded>} */
    const loaded = {};
    for (const id of ids) {
      try {
        loaded[id] = await this.load(id, {}, area);
      } catch (err) {
        if (choice === 'auto' && id === 'icon2i' && !err?.quota && !/raggiungibile/.test(err?.message ?? '')) continue;
        throw err;
      }
    }
    const asField = (/** @type {Loaded} */ l) => ({ grid: l.entry.grid, timesMs: l.entry.timesMs, vars: l.entry.vars });
    if (choice === 'auto' && !loaded.icon2i && !loaded.ecmwf) {
      // ICON-2I non disponibile e ECMWF non scaricato: si ripiega su ECMWF.
      loaded.ecmwf = await this.load('ecmwf', {}, area);
    }
    const wind = choice === 'auto'
      ? (loaded.ecmwf ? fuseAuto(loaded.icon2i ? asField(loaded.icon2i) : null, asField(loaded.ecmwf)) : singleModel('icon2i', asField(loaded.icon2i)))
      : singleModel(choice, asField(loaded[choice]));
    let marine = null;
    try {
      marine = asField(await this.load('route-marine', {}, marineArea));
    } catch (err) {
      // Senza onda e correnti il routing funziona lo stesso (velocità senza deriva, nessun avviso onda).
      console.warn('Onda/correnti del corridoio non disponibili:', err);
    }
    return {
      wind: { ...wind, runs: Object.fromEntries(Object.entries(loaded).map(([id, l]) => [id, l.entry.runMs])) },
      marine,
      grid: area.grid,
      points: area.indices.length,
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
