// Maschera della terra per i layer meteo: dopo il disegno si cancella dal canvas tutto ciò che cade
// sulla terra (linea di costa OSM a tasselli, la stessa del routing), così costa, porti e punti della
// rotta restano visibili sotto il campo colorato e le frecce. Tasselli caricati su richiesta.

import { tilePolygons } from '../routing/land.js';

const COAST_DIR = new URL('../../data/coastline/', import.meta.url);

/**
 * Proiezione Web Mercator in pixel del mondo allo zoom indicato.
 * @param {number} lat
 * @param {number} lon
 * @param {number} worldPx
 * @returns {[number, number]}
 */
export function mercator(lat, lon, worldPx) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * worldPx, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx];
}

/**
 * @param {() => void} onLoad chiamata quando arrivano nuovi tasselli (i layer vanno ridisegnati)
 */
export function createLandMask(onLoad) {
  /** @type {Promise<any[]> | null} */
  let indexPromise = null;
  /** @type {any[]} */
  let index = [];
  /** @type {Map<string, Float64Array[][] | 'land' | 'loading'>} anelli (lon, lat alternati) per tassello */
  const tiles = new Map();
  /** Tracciato della terra per l'inquadratura corrente (riusato da tutti i layer e a ogni ora). */
  let cache = { key: '', path: /** @type {Path2D | null} */ (null) };
  let version = 0;

  const loadIndex = () => {
    if (!indexPromise) {
      indexPromise = fetch(new URL('index.json', COAST_DIR)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }).then((j) => {
        index = j.tiles;
        return index;
      }).catch((err) => {
        // Senza costa i layer restano come prima (anche sulla terra).
        console.warn('Maschera terra non disponibile:', err);
        indexPromise = null;
        return [];
      });
    }
    return indexPromise;
  };

  /** @param {number[]} b [lonMin, latMin, lonMax, latMax] @param {{getWest: Function, getEast: Function, getSouth: Function, getNorth: Function}} v */
  const visible = (b, v) => b[2] >= v.getWest() && b[0] <= v.getEast() && b[3] >= v.getSouth() && b[1] <= v.getNorth();

  /**
   * Carica i tasselli che coprono l'area visibile.
   * @param {any} bounds LatLngBounds della mappa
   */
  async function ensure(bounds) {
    const list = await loadIndex();
    const jobs = [];
    for (const t of list) {
      if (t.kind === 'sea' || tiles.has(t.id) || !visible(t.bounds, bounds)) continue;
      if (t.kind === 'land') {
        tiles.set(t.id, 'land');
        jobs.push(Promise.resolve());
        continue;
      }
      tiles.set(t.id, 'loading');
      jobs.push(fetch(new URL(`${t.id}.geojson`, COAST_DIR)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }).then((gj) => {
        tiles.set(t.id, tilePolygons(gj).map((poly) => poly.map((ring) => Float64Array.from(ring.flat()))));
      }).catch((err) => {
        tiles.delete(t.id);
        console.warn(`Tassello di costa ${t.id} non disponibile:`, err);
      }));
    }
    if (jobs.length) {
      await Promise.all(jobs);
      version++;
      onLoad();
    }
  }

  /**
   * Cancella la terra dal canvas (coordinate in pixel CSS del contenitore della mappa).
   * @param {CanvasRenderingContext2D} ctx
   * @param {any} map mappa Leaflet
   */
  function erase(ctx, map) {
    if (!index.length) return;
    const bounds = map.getBounds();
    const worldPx = 256 * 2 ** map.getZoom();
    const origin = map.getPixelOrigin();
    const pane = map.containerPointToLayerPoint([0, 0]);
    const ox = origin.x + pane.x;
    const oy = origin.y + pane.y;
    const size = map.getSize();
    const key = `${map.getZoom()}|${ox}|${oy}|${size.x}x${size.y}|${version}`;
    if (cache.key !== key) cache = { key, path: buildPath(bounds, worldPx, ox, oy) };
    const path = /** @type {Path2D} */ (cache.path);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill(path, 'evenodd');
    // Bordo sottile: chiude le fessure di antialiasing tra tasselli adiacenti.
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.8;
    ctx.stroke(path);
    ctx.restore();
  }

  /**
   * @param {any} bounds
   * @param {number} worldPx
   * @param {number} ox
   * @param {number} oy
   */
  function buildPath(bounds, worldPx, ox, oy) {
    const path = new Path2D();
    for (const t of index) {
      const data = tiles.get(t.id);
      if (!data || data === 'loading' || !visible(t.bounds, bounds)) continue;
      if (data === 'land') {
        const [x0, y0] = mercator(t.bounds[3], t.bounds[0], worldPx);
        const [x1, y1] = mercator(t.bounds[1], t.bounds[2], worldPx);
        path.rect(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
        continue;
      }
      for (const poly of data) {
        for (const ring of poly) {
          let lx = NaN;
          let ly = NaN;
          for (let k = 0; k < ring.length; k += 2) {
            const [px, py] = mercator(ring[k + 1], ring[k], worldPx);
            const x = px - ox;
            const y = py - oy;
            // Vertici più vicini di mezzo pixel al precedente: saltati (zoom bassi).
            if (k > 0 && k < ring.length - 2 && Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5) continue;
            if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
            lx = x;
            ly = y;
          }
          path.closePath();
        }
      }
    }
    return path;
  }

  return { ensure, erase };
}
