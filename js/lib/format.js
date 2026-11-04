// Formattazione di orari, coordinate e unità per l'interfaccia. Modulo puro.

import { TIMEZONE } from '../config.js';

const dtFormatters = new Map();

/**
 * @param {Intl.DateTimeFormatOptions} opts
 * @returns {Intl.DateTimeFormat}
 */
function dtf(opts) {
  const key = JSON.stringify(opts);
  if (!dtFormatters.has(key)) dtFormatters.set(key, new Intl.DateTimeFormat('it-IT', { timeZone: TIMEZONE, ...opts }));
  return dtFormatters.get(key);
}

/**
 * Data e ora locali (Europe/Rome), es. "mer 04/11 14:00".
 * @param {number} tMs
 * @returns {string}
 */
export function formatDateTime(tMs) {
  const p = Object.fromEntries(dtf({
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(tMs).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Data breve locale, es. "04/11 14:00".
 * @param {number} tMs
 * @returns {string}
 */
export function formatShortDateTime(tMs) {
  const p = Object.fromEntries(dtf({
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(tMs).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Ora locale, es. "14".
 * @param {number} tMs
 * @returns {number}
 */
export function localHour(tMs) {
  return Number(dtf({ hour: '2-digit', hourCycle: 'h23' }).format(tMs));
}

/**
 * Coordinata in gradi e minuti decimali, es. 43°30.25'N.
 * @param {number} value
 * @param {'lat'|'lon'} axis
 * @returns {string}
 */
export function formatDegMin(value, axis) {
  const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.round((abs - deg) * 60 * 100) / 100;
  if (min >= 60) {
    deg += 1;
    min = 0;
  }
  const degStr = String(deg).padStart(axis === 'lat' ? 2 : 3, '0');
  const minStr = min.toFixed(2).padStart(5, '0');
  return `${degStr}°${minStr}'${hemi}`;
}

/**
 * Posizione, es. 43°30.25'N 016°26.10'E.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatLatLon(lat, lon) {
  return `${formatDegMin(lat, 'lat')} ${formatDegMin(lon, 'lon')}`;
}

/**
 * Direzione in gradi interi a tre cifre, es. "045°".
 * @param {number} deg
 * @returns {string}
 */
export function formatDeg(deg) {
  const d = Math.round(((deg % 360) + 360) % 360) % 360;
  return `${String(d).padStart(3, '0')}°`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/**
 * Settore della rosa a 16 punte (italiano: O = ovest), es. "NE".
 * @param {number} deg
 * @returns {string}
 */
export function compass16(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * Numero con decimali fissi, "n.d." se non disponibile.
 * @param {number} x
 * @param {number} digits
 * @returns {string}
 */
export function fmtNum(x, digits) {
  return Number.isFinite(x) ? x.toFixed(digits) : 'n.d.';
}
