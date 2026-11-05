// Terra e costa per il routing (SPEC §7.3): indice spaziale a celle, test punto-in-terra, attraversamento
// della costa da parte di un segmento, distanza dalla costa, spostamento a mare.
// Modulo puro (nessun DOM): usato nel worker. Distanze in miglia nautiche su proiezione locale
// equirettangolare (errore trascurabile alle distanze in gioco, < 50 NM).

const NM_PER_DEG = 60;
const EPS = 1e-9;

/**
 * Tassello come da data/coastline/index.json + contenuto del file.
 * @typedef {Object} TileInput
 * @property {string} id
 * @property {[number, number, number, number]} bounds [lonMin, latMin, lonMax, latMax]
 * @property {'sea' | 'land' | 'mixed'} kind
 * @property {number[][][][]} [polygons] coordinate MultiPolygon [poligono][anello][punto][lon, lat] (solo mixed)
 */

/**
 * Estrae i poligoni (coordinate MultiPolygon) da un GeoJSON di tassello.
 * @param {any} geojson
 * @returns {number[][][][]}
 */
export function tilePolygons(geojson) {
  const out = [];
  const feats = geojson?.type === 'FeatureCollection' ? geojson.features : [geojson];
  for (const f of feats) {
    const g = f?.geometry ?? f;
    if (g?.type === 'Polygon') out.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') out.push(...g.coordinates);
  }
  return out;
}

/**
 * Indice della terra costruito dai tasselli caricati.
 * @param {{cellDeg?: number}} [opts] lato delle celle (default 0.05°, SPEC §7.3)
 */
export function createLandIndex(opts = {}) {
  const cellDeg = opts.cellDeg ?? 0.05;
  /** @type {Map<string, {b: number[], kind: string, edges: Float64Array, rows: Map<number, number[]>}>} */
  const tiles = new Map();
  // Segmenti di costa (esclusi i lati artificiali sul bordo dei tasselli): x1, y1, x2, y2 (lon, lat).
  /** @type {number[]} */
  let coast = [];
  /** @type {Map<string, number[]>} cella → indici dei segmenti di costa */
  const cells = new Map();
  /** @type {Map<string, boolean>} stato delle celle senza costa: true = terra */
  const cellState = new Map();

  const cellKey = (ix, iy) => `${ix},${iy}`;
  const ixOf = (lon) => Math.floor(lon / cellDeg);
  const iyOf = (lat) => Math.floor(lat / cellDeg);
  const tileKey = (lat, lon) => `${Math.floor(lat)}_${Math.floor(lon)}`;

  /**
   * @param {number[]} b
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   */
  const onBorder = (b, x1, y1, x2, y2) => (Math.abs(x1 - x2) < EPS && (Math.abs(x1 - b[0]) < EPS || Math.abs(x1 - b[2]) < EPS))
    || (Math.abs(y1 - y2) < EPS && (Math.abs(y1 - b[1]) < EPS || Math.abs(y1 - b[3]) < EPS));

  /**
   * Aggiunge un tassello (sostituisce quello con lo stesso id).
   * @param {TileInput} t
   */
  function addTile(t) {
    const b = t.bounds;
    const all = [];
    for (const poly of t.polygons ?? []) {
      for (const ring of poly) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          if (x1 === x2 && y1 === y2) continue;
          all.push(x1, y1, x2, y2);
          if (!onBorder(b, x1, y1, x2, y2)) addCoast(x1, y1, x2, y2);
        }
      }
    }
    const edges = Float64Array.from(all);
    // Per il punto-in-poligono: lati del tassello raggruppati per fascia di latitudine (riga di celle).
    /** @type {Map<number, number[]>} */
    const rows = new Map();
    for (let k = 0; k < edges.length; k += 4) {
      const lo = Math.min(edges[k + 1], edges[k + 3]);
      const hi = Math.max(edges[k + 1], edges[k + 3]);
      for (let r = iyOf(lo); r <= iyOf(hi); r++) {
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(k);
      }
    }
    tiles.set(t.id, { b, kind: t.kind, edges, rows });
    cellState.clear();
  }

  /** Inserisce un segmento di costa nelle celle che attraversa. */
  function addCoast(x1, y1, x2, y2) {
    const idx = coast.length;
    coast.push(x1, y1, x2, y2);
    for (const key of cellsAlong(x1, y1, x2, y2)) {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(idx);
    }
  }

  /**
   * Celle toccate da un segmento (rettangolo delle celle, sufficiente per segmenti corti).
   * @returns {string[]}
   */
  function cellsAlong(x1, y1, x2, y2) {
    const keys = [];
    const ix0 = ixOf(Math.min(x1, x2));
    const ix1 = ixOf(Math.max(x1, x2));
    const iy0 = iyOf(Math.min(y1, y2));
    const iy1 = iyOf(Math.max(y1, y2));
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) keys.push(cellKey(ix, iy));
    return keys;
  }

  /**
   * Terra in (lat, lon): ray casting verso est sui poligoni del tassello (chiusi entro il tassello).
   * Fuori dai tasselli caricati: mare.
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  function pointInLand(lat, lon) {
    const t = tiles.get(tileKey(lat, lon));
    if (!t) return false;
    if (t.kind === 'land') return true;
    if (t.kind === 'sea') return false;
    const list = t.rows.get(iyOf(lat));
    if (!list) return false;
    const e = t.edges;
    let inside = false;
    for (const k of list) {
      const x1 = e[k];
      const y1 = e[k + 1];
      const x2 = e[k + 2];
      const y2 = e[k + 3];
      if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  }

  /**
   * Terra o mare, con le celle senza costa risolte una sola volta (centro della cella).
   * @param {number} lat
   * @param {number} lon
   */
  function isLand(lat, lon) {
    const key = cellKey(ixOf(lon), iyOf(lat));
    if (cells.has(key)) return pointInLand(lat, lon);
    let s = cellState.get(key);
    if (s === undefined) {
      s = pointInLand((iyOf(lat) + 0.5) * cellDeg, (ixOf(lon) + 0.5) * cellDeg);
      cellState.set(key, s);
    }
    return s;
  }

  /**
   * Il segmento tocca terra? Estremi a terra, oppure attraversa un segmento di costa.
   * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
   * @returns {boolean}
   */
  function segmentHitsLand(lat1, lon1, lat2, lon2) {
    if (isLand(lat1, lon1) || isLand(lat2, lon2)) return true;
    const seen = new Set();
    for (const key of cellsAlong(lon1, lat1, lon2, lat2)) {
      const list = cells.get(key);
      if (!list) continue;
      for (const k of list) {
        if (seen.has(k)) continue;
        seen.add(k);
        if (segmentsIntersect(lon1, lat1, lon2, lat2, coast[k], coast[k + 1], coast[k + 2], coast[k + 3])) return true;
      }
    }
    return false;
  }

  /**
   * Distanza (NM) dalla costa più vicina, cercando entro `maxNm`; Infinity se nessuna costa entro il raggio.
   * @param {number} lat
   * @param {number} lon
   * @param {number} maxNm
   * @returns {number}
   */
  function distanceToCoastNm(lat, lon, maxNm) {
    return nearestCoast(lat, lon, maxNm)?.distNm ?? Infinity;
  }

  /**
   * Punto di costa più vicino entro `maxNm`.
   * @returns {{distNm: number, lat: number, lon: number} | null}
   */
  function nearestCoast(lat, lon, maxNm) {
    const kx = Math.cos((lat * Math.PI) / 180) * NM_PER_DEG;
    const ky = NM_PER_DEG;
    const dLat = maxNm / ky;
    const dLon = maxNm / Math.max(kx, 1e-6);
    let best = null;
    const seen = new Set();
    for (let ix = ixOf(lon - dLon); ix <= ixOf(lon + dLon); ix++) {
      for (let iy = iyOf(lat - dLat); iy <= iyOf(lat + dLat); iy++) {
        const list = cells.get(cellKey(ix, iy));
        if (!list) continue;
        for (const k of list) {
          if (seen.has(k)) continue;
          seen.add(k);
          // Proiezione locale centrata nel punto: x = Δlon·kx, y = Δlat·ky.
          const ax = (coast[k] - lon) * kx;
          const ay = (coast[k + 1] - lat) * ky;
          const bx = (coast[k + 2] - lon) * kx;
          const by = (coast[k + 3] - lat) * ky;
          const [px, py] = closestOnSegment(0, 0, ax, ay, bx, by);
          const d = Math.hypot(px, py);
          if (d <= maxNm && (!best || d < best.distNm)) best = { distNm: d, lat: lat + py / ky, lon: lon + px / kx };
        }
      }
    }
    return best;
  }

  /**
   * Se il punto è a terra, il punto di mare più vicino (oltre la costa di `offsetNm`); altrimenti il punto stesso.
   * @param {number} lat
   * @param {number} lon
   * @param {{maxNm?: number, offsetNm?: number}} [o]
   * @returns {{lat: number, lon: number, moved: boolean, distNm: number} | null} null se nessun mare entro maxNm
   */
  function snapToSea(lat, lon, o = {}) {
    const maxNm = o.maxNm ?? 5;
    const offsetNm = o.offsetNm ?? 0.1;
    if (!isLand(lat, lon)) return { lat, lon, moved: false, distNm: 0 };
    const c = nearestCoast(lat, lon, maxNm);
    if (!c) return null;
    const kx = Math.cos((lat * Math.PI) / 180) * NM_PER_DEG;
    const vx = (c.lon - lon) * kx;
    const vy = (c.lat - lat) * NM_PER_DEG;
    const len = Math.hypot(vx, vy) || 1;
    // Oltre la costa nella stessa direzione; se si ricade a terra (penisola sottile) si allunga.
    for (const extra of [offsetNm, offsetNm * 2, offsetNm * 4, offsetNm * 8]) {
      const s = (len + extra) / len;
      const p = { lat: lat + (vy * s) / NM_PER_DEG, lon: lon + (vx * s) / kx };
      if (!isLand(p.lat, p.lon)) return { ...p, moved: true, distNm: len + extra };
    }
    return null;
  }

  return {
    addTile,
    isLand,
    segmentHitsLand,
    distanceToCoastNm,
    nearestCoast,
    snapToSea,
    /** @returns {string[]} id dei tasselli caricati */
    tileIds: () => [...tiles.keys()],
    /** @returns {number} segmenti di costa indicizzati */
    coastSegments: () => coast.length / 4,
  };
}

/**
 * Intersezione di due segmenti (estremi inclusi).
 */
export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (px, py, qx, qy, rx, ry) => Math.min(px, qx) - EPS <= rx && rx <= Math.max(px, qx) + EPS
    && Math.min(py, qy) - EPS <= ry && ry <= Math.max(py, qy) + EPS;
  if (Math.abs(d1) < EPS * EPS && on(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d2) < EPS * EPS && on(cx, cy, dx, dy, bx, by)) return true;
  if (Math.abs(d3) < EPS * EPS && on(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d4) < EPS * EPS && on(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

/** Prodotto vettoriale (orientamento di r rispetto a p→q). */
function orient(px, py, qx, qy, rx, ry) {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}

/**
 * Punto del segmento AB più vicino a P.
 * @returns {[number, number]}
 */
function closestOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return [ax + t * vx, ay + t * vy];
}
