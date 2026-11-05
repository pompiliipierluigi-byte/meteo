// Preparazione di un calcolo di rotta: polare con correttivi, campionatore meteo, terra; poi isocrone.
// Modulo puro, usato dal worker (e dai test senza browser).

import { sailSpeed } from '../boats/polar.js';
import { createSampler } from './interp.js';
import { computeRoute } from './isochrone.js';
import { BBOX } from '../config.js';

/**
 * Richiesta di calcolo, come arriva al worker (solo dati clonabili).
 * @typedef {Object} RouteRequest
 * @property {{lat: number, lon: number}[]} route partenza, waypoint, arrivo
 * @property {number} departMs
 * @property {{full: import('../boats/polar.js').Polar, white?: import('../boats/polar.js').Polar | null}} polars
 * @property {'full' | 'white'} sails set di vele scelto per il calcolo
 * @property {import('../boats/polar.js').Corrections} corrections
 * @property {{mode: 'speed'|'vmg', thresholdKn: number, speedKn: number, nearLand: boolean, nearLandNm: number}} motor
 * @property {{twsKn: number|null, gustKn: number|null, waveM: number|null}} limits
 * @property {number} coastMarginNm
 * @property {number} coastWarningNm
 * @property {number} waveWarningM
 * @property {boolean} [keepIsochrones]
 */

/**
 * Velocità massima a vela della polare con i correttivi (per la potatura e il passo fine).
 * @param {(twa: number, tws: number) => number} speed
 * @param {number[]} tws
 */
export function maxSpeed(speed, tws) {
  let m = 0;
  for (const w of tws) for (let a = 0; a <= 180; a += 5) m = Math.max(m, speed(a, w));
  return m;
}

/**
 * Tabella precalcolata della velocità a vela (TWA ogni 1°, TWS ogni 0.5 kn fino a 60 kn), interpolata
 * bilinearmente: il routing la interroga milioni di volte.
 * @param {(twa: number, tws: number) => number} speed
 * @returns {(twaDeg: number, twsKn: number) => number}
 */
export function speedTable(speed) {
  const dTws = 0.5;
  const nTws = 121;
  const nTwa = 181;
  const tab = new Float32Array(nTws * nTwa);
  for (let j = 0; j < nTws; j++) for (let a = 0; a < nTwa; a++) tab[j * nTwa + a] = speed(a, j * dTws);
  return (twaDeg, twsKn) => {
    let a = ((twaDeg % 360) + 360) % 360;
    if (a > 180) a = 360 - a;
    const w = Math.min(Math.max(twsKn, 0), (nTws - 1) * dTws) / dTws;
    const a0 = Math.min(Math.floor(a), nTwa - 2);
    const j0 = Math.min(Math.floor(w), nTws - 2);
    const ta = a - a0;
    const tw = w - j0;
    const r0 = j0 * nTwa + a0;
    const r1 = r0 + nTwa;
    return (tab[r0] * (1 - ta) + tab[r0 + 1] * ta) * (1 - tw) + (tab[r1] * (1 - ta) + tab[r1 + 1] * ta) * tw;
  };
}

/**
 * Esegue il calcolo.
 * @param {RouteRequest} req
 * @param {{wind: import('../weather/grid.js').WeatherField, marine?: import('../weather/grid.js').WeatherField | null}} weather
 * @param {ReturnType<typeof import('./land.js').createLandIndex> | null} land
 * @param {{onProgress?: (f: number) => void, isCancelled?: () => boolean}} [hooks]
 */
export function runRoute(req, weather, land, hooks = {}) {
  const exact = (twa, tws) => sailSpeed(req.polars, req.sails, twa, tws, req.corrections);
  const speed = speedTable(exact);
  return computeRoute({
    route: req.route,
    departMs: req.departMs,
    sailSpeed: speed,
    maxSailKn: Math.max(maxSpeed(exact, req.polars.full.tws), req.motor.speedKn),
    sampler: createSampler(weather),
    land,
    motor: req.motor,
    limits: req.limits,
    coastMarginNm: req.coastMarginNm,
    coastWarningNm: req.coastWarningNm,
    waveWarningM: req.waveWarningM,
    splitTwaDeg: req.corrections.splitTwaDeg,
    bbox: { latMin: BBOX.latMin - 0.2, latMax: BBOX.latMax + 0.2, lonMin: BBOX.lonMin - 0.2, lonMax: BBOX.lonMax + 0.2 },
    keepIsochrones: req.keepIsochrones,
    onProgress: hooks.onProgress,
    isCancelled: hooks.isCancelled,
  });
}

/**
 * Tasselli della costa (id "lat_lon") che coprono un rettangolo.
 * @param {{latMin: number, latMax: number, lonMin: number, lonMax: number}} b
 * @returns {string[]}
 */
export function tilesFor(b) {
  const ids = [];
  for (let lat = Math.floor(b.latMin); lat <= Math.floor(b.latMax); lat++) {
    for (let lon = Math.floor(b.lonMin); lon <= Math.floor(b.lonMax); lon++) ids.push(`${lat}_${lon}`);
  }
  return ids;
}

/**
 * Rettangolo di un campo meteo (corridoio).
 * @param {import('../weather/grid.js').GridSpec} g
 */
export function gridBounds(g) {
  return { latMin: g.lat0, latMax: g.lat0 + (g.ny - 1) * g.dLat, lonMin: g.lon0, lonMax: g.lon0 + (g.nx - 1) * g.dLon };
}
