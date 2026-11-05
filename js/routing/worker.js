// Web Worker (modulo) del routing: carica i tasselli di costa necessari, calcola la rotta, invia
// avanzamento e risultato. Nessun DOM. Annullamento: il client termina il worker (il calcolo è sincrono).
//
// Messaggi in ingresso:
//   {type: 'route', id, request: RouteRequest, weather: {wind, marine}}
//   {type: 'snap', id, points: [{lat, lon}], offsetNm}  → punti a terra spostati al mare più vicino
//   {type: 'window', id, request, weather, departures: [{index, departMs}]}  → più run, stesso meteo
// Messaggi in uscita:
//   {type: 'progress', id, fraction}
//   {type: 'result', id, track, summary, isochrones}
//   {type: 'windowRun', id, index, departMs, track?, summary?, error?: {message, code}}  (uno per run)
//   {type: 'windowDone', id}
//   {type: 'snapped', id, points: [{lat, lon, moved, distNm} | null]}
//   {type: 'error', id, message, code}

import { createLandIndex, tilePolygons } from './land.js';
import { runRoute, tilesFor, gridBounds } from './run.js';

const COAST_DIR = new URL('../../data/coastline/', import.meta.url);

const land = createLandIndex();
/** @type {Map<string, Promise<void>>} tasselli caricati o in caricamento */
const loaded = new Map();
/** @type {Promise<Map<string, any>> | null} */
let indexPromise = null;

/** Indice dei tasselli (data/coastline/index.json). */
function coastIndex() {
  if (!indexPromise) {
    indexPromise = fetch(new URL('index.json', COAST_DIR)).then((r) => {
      if (!r.ok) throw new Error(`Linea di costa non disponibile (HTTP ${r.status})`);
      return r.json();
    }).then((j) => new Map(j.tiles.map((t) => [t.id, t]))).catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/**
 * Carica i tasselli che coprono il rettangolo (una volta sola per sessione del worker).
 * @param {{latMin: number, latMax: number, lonMin: number, lonMax: number}} b
 */
async function ensureTiles(b) {
  const index = await coastIndex();
  const jobs = tilesFor(b).map((id) => {
    if (!loaded.has(id)) {
      const t = index.get(id);
      const job = (async () => {
        if (!t) return;
        if (t.kind !== 'mixed') {
          land.addTile({ id, bounds: t.bounds, kind: t.kind });
          return;
        }
        const r = await fetch(new URL(`${id}.geojson`, COAST_DIR));
        if (!r.ok) throw new Error(`Tassello di costa ${id} non disponibile (HTTP ${r.status})`);
        land.addTile({ id, bounds: t.bounds, kind: 'mixed', polygons: tilePolygons(await r.json()) });
      })().catch((err) => {
        loaded.delete(id);
        throw err;
      });
      loaded.set(id, job);
    }
    return loaded.get(id);
  });
  await Promise.all(jobs);
}

/** @param {{lat: number, lon: number}[]} pts */
function boundsOf(pts, padDeg) {
  return {
    latMin: Math.min(...pts.map((p) => p.lat)) - padDeg,
    latMax: Math.max(...pts.map((p) => p.lat)) + padDeg,
    lonMin: Math.min(...pts.map((p) => p.lon)) - padDeg,
    lonMax: Math.max(...pts.map((p) => p.lon)) + padDeg,
  };
}

self.addEventListener('message', async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'snap') {
      await ensureTiles(boundsOf(msg.points, 0.1));
      const points = msg.points.map((p) => land.snapToSea(p.lat, p.lon, { offsetNm: msg.offsetNm ?? 0.15, maxNm: 5 }));
      self.postMessage({ type: 'snapped', id: msg.id, points });
      return;
    }
    if (msg.type === 'route') {
      await ensureTiles(gridBounds(msg.weather.wind.grid));
      let last = 0;
      const result = runRoute(msg.request, msg.weather, land, {
        onProgress: (fraction) => {
          const now = Date.now();
          if (now - last > 150) {
            last = now;
            self.postMessage({ type: 'progress', id: msg.id, fraction });
          }
        },
      });
      self.postMessage({ type: 'result', id: msg.id, ...result });
      return;
    }
    if (msg.type === 'window') {
      // Finestra di partenza (SPEC §6.7): un run per partenza, terra e meteo caricati una volta sola.
      await ensureTiles(gridBounds(msg.weather.wind.grid));
      const n = msg.departures.length;
      let last = 0;
      msg.departures.forEach(({ index, departMs }, k) => {
        let out;
        try {
          const r = runRoute({ ...msg.request, departMs, keepIsochrones: false }, msg.weather, land, {
            onProgress: (f) => {
              const now = Date.now();
              if (now - last > 250) {
                last = now;
                self.postMessage({ type: 'progress', id: msg.id, fraction: (k + f) / n });
              }
            },
          });
          out = { track: r.track, summary: r.summary };
        } catch (err) {
          out = { error: { message: err?.message ?? String(err), code: err?.code ?? 'error' } };
        }
        self.postMessage({ type: 'windowRun', id: msg.id, index, departMs, ...out });
      });
      self.postMessage({ type: 'windowDone', id: msg.id });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err?.message ?? String(err), code: err?.code ?? 'error' });
  }
});
