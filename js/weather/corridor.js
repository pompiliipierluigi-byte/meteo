// Griglia di corridoio per il routing (SPEC §3.4): passo fine solo intorno alla rotta.
// Per ogni tratto (partenza → waypoint → … → arrivo) un'ellisse con fuochi agli estremi; la griglia
// tiene i punti dentro almeno un'ellisse. Modulo puro.

import { distanceNm } from '../routing/geo.js';

/** Massimo di punti per sorgente: oltre si allarga il passo (quota Open-Meteo). */
export const CORRIDOR_MAX_POINTS = 600;

/**
 * @param {{lat: number, lon: number}[]} route partenza, waypoint, arrivo (almeno 2 punti)
 * @param {{stepDeg?: number, marginNm?: number, maxPoints?: number}} [opts]
 * @returns {{grid: import('./grid.js').GridSpec, indices: number[], stepDeg: number}}
 */
export function corridorGrid(route, opts = {}) {
  if (route.length < 2) throw new Error('Servono almeno partenza e arrivo');
  const marginNm = opts.marginNm ?? 15;
  const maxPoints = opts.maxPoints ?? CORRIDOR_MAX_POINTS;
  let step = opts.stepDeg ?? 0.1;
  const legs = route.slice(1).map((b, i) => {
    const a = route[i];
    return { a, b, d: distanceNm(a.lat, a.lon, b.lat, b.lon) };
  });
  // Rettangolo che contiene tutte le ellissi: estremi ± (margine + semiasse minore).
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;
  for (const { a, b, d } of legs) {
    const semiMinor = Math.sqrt((d / 2 + marginNm) ** 2 - (d / 2) ** 2);
    const ext = Math.max(marginNm, semiMinor) / 60;
    const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    latMin = Math.min(latMin, a.lat - ext, b.lat - ext);
    latMax = Math.max(latMax, a.lat + ext, b.lat + ext);
    lonMin = Math.min(lonMin, a.lon - ext / k, b.lon - ext / k);
    lonMax = Math.max(lonMax, a.lon + ext / k, b.lon + ext / k);
  }
  const inside = (lat, lon) => legs.some(({ a, b, d }) => distanceNm(lat, lon, a.lat, a.lon) + distanceNm(lat, lon, b.lat, b.lon) <= d + 2 * marginNm);

  for (;;) {
    // Griglia allineata ai multipli del passo (stessi punti tra calcoli vicini → cache).
    const lat0 = Math.floor(latMin / step) * step;
    const lon0 = Math.floor(lonMin / step) * step;
    const ny = Math.ceil((latMax - lat0) / step) + 1;
    const nx = Math.ceil((lonMax - lon0) / step) + 1;
    const r = (v) => Math.round(v * 1e4) / 1e4;
    /** @type {import('./grid.js').GridSpec} */
    const grid = { id: `cor${step}_${r(lat0)}_${r(lon0)}_${nx}x${ny}`, lat0: r(lat0), lon0: r(lon0), dLat: step, dLon: step, nx, ny };
    const indices = [];
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        // Un punto fuori dall'ellisse ma con un vicino dentro serve all'interpolazione: si tiene un anello.
        const lat = grid.lat0 + y * step;
        const lon = grid.lon0 + x * step;
        const near = inside(lat, lon) || inside(lat + step, lon) || inside(lat - step, lon) || inside(lat, lon + step) || inside(lat, lon - step);
        if (near) indices.push(y * nx + x);
      }
    }
    if (indices.length <= maxPoints || step >= 0.25) return { grid, indices, stepDeg: step };
    step = Math.round(step * 1.5 * 1000) / 1000;
  }
}
