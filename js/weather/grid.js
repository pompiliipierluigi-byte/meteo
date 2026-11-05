// Griglie meteo regolari in lat/lon: definizione, maschera mare, conversioni u/v, interpolazione.
// Modulo puro (nessun DOM): usato anche dai test Node e, in fase 3, dal worker.

/**
 * Griglia regolare: punto (x, y) = (lon0 + x·dLon, lat0 + y·dLat).
 * @typedef {Object} GridSpec
 * @property {string} id identificativo (chiave di cache)
 * @property {number} lat0
 * @property {number} lon0
 * @property {number} dLat
 * @property {number} dLon
 * @property {number} nx
 * @property {number} ny
 */

/**
 * Campo meteo su griglia: ogni variabile è un Float32Array indicizzato [t][y][x]
 * (indice = t·ny·nx + y·nx + x), NaN dove il dato manca.
 * @typedef {Object} WeatherField
 * @property {GridSpec} grid
 * @property {number[]} timesMs istanti UTC (ms), crescenti, passo orario
 * @property {Record<string, Float32Array>} vars
 */

/**
 * Griglia che copre la BBOX con passo costante (l'ultima riga/colonna può superarla di poco).
 * @param {{latMin: number, latMax: number, lonMin: number, lonMax: number}} bbox
 * @param {number} stepDeg
 * @param {string} id
 * @returns {GridSpec}
 */
export function makeGrid(bbox, stepDeg, id) {
  const eps = 1e-9;
  const nx = Math.ceil((bbox.lonMax - bbox.lonMin) / stepDeg - eps) + 1;
  const ny = Math.ceil((bbox.latMax - bbox.latMin) / stepDeg - eps) + 1;
  return { id, lat0: bbox.latMin, lon0: bbox.lonMin, dLat: stepDeg, dLon: stepDeg, nx, ny };
}

/**
 * Coordinate del punto (x, y), arrotondate a 4 decimali (come inviate all'API).
 * @param {GridSpec} g
 * @param {number} x
 * @param {number} y
 * @returns {{lat: number, lon: number}}
 */
export function gridPoint(g, x, y) {
  return {
    lat: Math.round((g.lat0 + y * g.dLat) * 1e4) / 1e4,
    lon: Math.round((g.lon0 + x * g.dLon) * 1e4) / 1e4,
  };
}

/**
 * Indici (y·nx + x) dei punti selezionati dalla maschera, o di tutti se la maschera manca.
 * @param {GridSpec} g
 * @param {Uint8Array} [mask]
 * @returns {number[]}
 */
export function maskedIndices(g, mask) {
  const out = [];
  for (let i = 0; i < g.nx * g.ny; i++) if (!mask || mask[i]) out.push(i);
  return out;
}

/**
 * Maschera mare: 1 dove la serie ha almeno un valore valido.
 * @param {GridSpec} g
 * @param {number[]} indices punti a cui si riferiscono le serie
 * @param {(number|null)[][]} series una serie per punto
 * @returns {Uint8Array}
 */
export function seaMaskFromSeries(g, indices, series) {
  const mask = new Uint8Array(g.nx * g.ny);
  indices.forEach((idx, k) => {
    if (series[k].some((v) => v !== null && Number.isFinite(v))) mask[idx] = 1;
  });
  return mask;
}

/**
 * Dilata la maschera di `rings` celle (vicinato a 8): aggiunge l'anello di punti costieri.
 * @param {GridSpec} g
 * @param {Uint8Array} mask
 * @param {number} [rings]
 * @returns {Uint8Array}
 */
export function dilateMask(g, mask, rings = 1) {
  let cur = mask;
  for (let r = 0; r < rings; r++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < g.ny; y++) {
      for (let x = 0; x < g.nx; x++) {
        if (!cur[y * g.nx + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < g.nx && yy < g.ny) next[yy * g.nx + xx] = 1;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Vento (velocità, direzione di provenienza) → componenti u (verso est), v (verso nord).
 * @param {number} speed
 * @param {number} fromDeg
 * @returns {{u: number, v: number}}
 */
export function windToUV(speed, fromDeg) {
  const r = (fromDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

/**
 * Componenti u, v → velocità e direzione di provenienza (0–360, 0 = da nord).
 * @param {number} u
 * @param {number} v
 * @returns {{speed: number, fromDeg: number}}
 */
export function uvToWind(u, v) {
  const speed = Math.hypot(u, v);
  let fromDeg = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (fromDeg < 0) fromDeg += 360;
  if (speed === 0) fromDeg = 0;
  return { speed, fromDeg };
}

/**
 * Crea un campo vuoto (tutto NaN) con le variabili indicate.
 * @param {GridSpec} g
 * @param {number[]} timesMs
 * @param {string[]} names
 * @returns {WeatherField}
 */
export function emptyField(g, timesMs, names) {
  const n = timesMs.length * g.ny * g.nx;
  /** @type {Record<string, Float32Array>} */
  const vars = {};
  for (const name of names) vars[name] = new Float32Array(n).fill(NaN);
  return { grid: g, timesMs, vars };
}

/**
 * Riempie i punti senza dato con il valore valido più vicino entro `maxCells` celle
 * (onda vicino a costa, SPEC §3.4). Solo nei punti della maschera.
 * @param {WeatherField} field
 * @param {string[]} names variabili da riempire
 * @param {Uint8Array} mask
 * @param {number} [maxCells]
 */
export function fillNearest(field, names, mask, maxCells = 2) {
  const g = field.grid;
  const plane = g.nx * g.ny;
  // Per ogni punto da riempire, elenco dei vicini ordinati per distanza (calcolato una volta).
  /** @type {[number, number[]][]} */
  const plan = [];
  const ref = field.vars[names[0]];
  for (let i = 0; i < plane; i++) {
    if (!mask[i] || Number.isFinite(ref[i])) continue;
    const x = i % g.nx;
    const y = (i - x) / g.nx;
    const cand = [];
    for (let dy = -maxCells; dy <= maxCells; dy++) {
      for (let dx = -maxCells; dx <= maxCells; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < g.nx && yy < g.ny) {
          cand.push([dx * dx + dy * dy, yy * g.nx + xx]);
        }
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    plan.push([i, cand.map((c) => c[1])]);
  }
  for (let t = 0; t < field.timesMs.length; t++) {
    const off = t * plane;
    // Sorgenti scelte prima di scrivere, così un punto riempito non fa da sorgente (niente catene).
    const sources = plan.map(([i, neigh]) => [i, neigh.find((j) => Number.isFinite(ref[off + j]))]);
    for (const [i, src] of sources) {
      if (src === undefined) continue;
      for (const name of names) {
        const a = field.vars[name];
        if (!Number.isFinite(a[off + i])) a[off + i] = a[off + src];
      }
    }
  }
}

/**
 * Posizione temporale: indice inferiore e peso del successivo (fuori intervallo: estremo, peso 0).
 * @param {number[]} timesMs
 * @param {number} tMs
 * @returns {{i0: number, w: number} | null}
 */
export function timeIndex(timesMs, tMs) {
  const n = timesMs.length;
  if (n === 0) return null;
  if (tMs <= timesMs[0]) return { i0: 0, w: 0 };
  if (tMs >= timesMs[n - 1]) return { i0: n - 1, w: 0 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesMs[mid] <= tMs) lo = mid; else hi = mid;
  }
  return { i0: lo, w: (tMs - timesMs[lo]) / (timesMs[hi] - timesMs[lo]) };
}

/**
 * Interpolazione bilineare nello spazio su un piano (un istante); i vertici senza dato
 * sono esclusi e i pesi rinormalizzati. NaN se nessun vertice è valido o il punto è fuori griglia.
 * @param {Float32Array} arr
 * @param {GridSpec} g
 * @param {number} offset inizio del piano (t·ny·nx)
 * @param {number} lat
 * @param {number} lon
 * @returns {number}
 */
export function bilinear(arr, g, offset, lat, lon) {
  const fx = (lon - g.lon0) / g.dLon;
  const fy = (lat - g.lat0) / g.dLat;
  if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return NaN;
  const x0 = Math.min(Math.floor(fx), g.nx - 2);
  const y0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = offset + y0 * g.nx + x0;
  const vals = [arr[i00], arr[i00 + 1], arr[i00 + g.nx], arr[i00 + g.nx + 1]];
  const ws = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < 4; k++) {
    if (Number.isFinite(vals[k]) && ws[k] > 0) {
      sum += vals[k] * ws[k];
      wsum += ws[k];
    }
  }
  // Se restano solo vertici a peso nullo (punto esattamente su un nodo mancante) → NaN.
  return wsum > 1e-9 ? sum / wsum : NaN;
}

/**
 * Valore di una variabile in (lat, lon, t): bilineare nello spazio, lineare nel tempo.
 * @param {WeatherField} field
 * @param {string} name
 * @param {number} lat
 * @param {number} lon
 * @param {number} tMs
 * @returns {number} NaN se non disponibile
 */
export function sample(field, name, lat, lon, tMs) {
  const arr = field.vars[name];
  const ti = timeIndex(field.timesMs, tMs);
  if (!arr || !ti) return NaN;
  const plane = field.grid.nx * field.grid.ny;
  const a = bilinear(arr, field.grid, ti.i0 * plane, lat, lon);
  if (ti.w === 0) return a;
  const b = bilinear(arr, field.grid, (ti.i0 + 1) * plane, lat, lon);
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * ti.w;
}

/**
 * Campionatore per un istante fissato: l'indice temporale si calcola una volta sola
 * (rendering di molti punti alla stessa ora).
 * @param {WeatherField} field
 * @param {number} tMs
 * @returns {(name: string, lat: number, lon: number) => number}
 */
export function sampler(field, tMs) {
  const ti = timeIndex(field.timesMs, tMs);
  const plane = field.grid.nx * field.grid.ny;
  if (!ti) return () => NaN;
  const off0 = ti.i0 * plane;
  const off1 = (ti.i0 + 1) * plane;
  const w = ti.w;
  return (name, lat, lon) => {
    const arr = field.vars[name];
    if (!arr) return NaN;
    const a = bilinear(arr, field.grid, off0, lat, lon);
    if (w === 0) return a;
    const b = bilinear(arr, field.grid, off1, lat, lon);
    if (!Number.isFinite(a)) return b;
    if (!Number.isFinite(b)) return a;
    return a + (b - a) * w;
  };
}
