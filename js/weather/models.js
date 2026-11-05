// Modelli di vento e fusione "Auto" (ICON-2I nelle prime ore valide, poi ECMWF). Modulo puro.

import { MODELS } from '../config.js';
import { emptyField } from './grid.js';

/** @typedef {'auto' | 'icon2i' | 'ecmwf' | 'gfs'} ModelChoice */
/** @typedef {'icon2i' | 'ecmwf' | 'gfs'} ModelId */

/** Scelte disponibili nel selettore, in ordine. */
export const MODEL_CHOICES = /** @type {ModelChoice[]} */ (['auto', 'icon2i', 'ecmwf', 'gfs']);

/**
 * Modelli da scaricare per una scelta.
 * @param {ModelChoice} choice
 * @returns {ModelId[]}
 */
export function sourcesFor(choice) {
  return choice === 'auto' ? ['icon2i', 'ecmwf'] : [choice];
}

/**
 * Ultimo istante con almeno un valore valido della variabile.
 * @param {import('./grid.js').WeatherField} field
 * @param {string} name
 * @returns {number} ms UTC, -Infinity se nessun dato
 */
export function lastValidTimeMs(field, name) {
  const arr = field.vars[name];
  const plane = field.grid.nx * field.grid.ny;
  for (let t = field.timesMs.length - 1; t >= 0; t--) {
    for (let i = t * plane, end = i + plane; i < end; i++) {
      if (Number.isFinite(arr[i])) return field.timesMs[t];
    }
  }
  return -Infinity;
}

/**
 * Campo vento con l'indicazione, per ogni istante, del modello usato.
 * @typedef {Object} WindData
 * @property {import('./grid.js').WeatherField} field
 * @property {ModelId[]} sourceByTime modello prevalente per ogni istante di `field.timesMs`
 * @property {Partial<Record<ModelId, import('./grid.js').WeatherField>>} parts campi originali usati
 * @property {number | null} switchMs primo istante servito da ECMWF in Auto (discontinuità), altrimenti null
 */

/**
 * Campo di un singolo modello.
 * @param {ModelId} id
 * @param {import('./grid.js').WeatherField} field
 * @returns {WindData}
 */
export function singleModel(id, field) {
  return { field, sourceByTime: field.timesMs.map(() => id), parts: { [id]: field }, switchMs: null };
}

/**
 * Fusione Auto: per ogni ora ICON-2I se l'ora è entro l'ultima ora valida di ICON-2I,
 * altrimenti ECMWF. Nei punti in cui ICON-2I non ha dato (bordo del dominio) si usa ECMWF.
 * Gli istanti sono quelli di ECMWF (stessa richiesta oraria per entrambi).
 * @param {import('./grid.js').WeatherField | null} icon
 * @param {import('./grid.js').WeatherField} ecmwf
 * @returns {WindData}
 */
export function fuseAuto(icon, ecmwf) {
  if (!icon) return { ...singleModel('ecmwf', ecmwf), parts: { ecmwf } };
  const names = Object.keys(ecmwf.vars);
  const g = ecmwf.grid;
  const plane = g.nx * g.ny;
  const out = emptyField(g, ecmwf.timesMs, names);
  const iconLast = lastValidTimeMs(icon, 'u');
  const iconIndex = new Map(icon.timesMs.map((t, i) => [t, i]));
  /** @type {ModelId[]} */
  const sourceByTime = [];
  let switchMs = null;
  ecmwf.timesMs.forEach((tMs, t) => {
    const ti = iconIndex.get(tMs);
    const useIcon = ti !== undefined && tMs <= iconLast;
    sourceByTime.push(useIcon ? 'icon2i' : 'ecmwf');
    if (!useIcon && switchMs === null && t > 0 && sourceByTime[t - 1] === 'icon2i') switchMs = tMs;
    const off = t * plane;
    for (const name of names) {
      const dst = out.vars[name];
      const e = ecmwf.vars[name];
      if (!useIcon) {
        dst.set(e.subarray(off, off + plane), off);
        continue;
      }
      const ic = icon.vars[name];
      const ioff = ti * plane;
      // u e v vanno presi dallo stesso modello: il punto è "ICON" se u è valido.
      const iu = icon.vars.u;
      for (let i = 0; i < plane; i++) {
        dst[off + i] = Number.isFinite(iu[ioff + i]) ? ic[ioff + i] : e[off + i];
      }
    }
  });
  return { field: out, sourceByTime, parts: { icon2i: icon, ecmwf }, switchMs };
}

/**
 * Nome leggibile di un modello.
 * @param {ModelId} id
 * @returns {string}
 */
export function modelLabel(id) {
  return MODELS[id]?.label ?? id;
}
