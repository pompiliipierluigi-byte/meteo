// Genera js/weather/sea-mask.js: maschera mare della griglia panoramica dai poligoni di terra
// Natural Earth 10 m (pubblico dominio). Eseguire a mano, non fa parte dell'app:
//   curl -o /tmp/ne/land10.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
//   node tools/seamask/make-seamask.mjs /tmp/ne/land10.geojson > js/weather/sea-mask.js
import { readFileSync } from 'node:fs';
import { BBOX, PANORAMIC_STEP_DEG } from '../../js/config.js';
import { makeGrid, gridPoint } from '../../js/weather/grid.js';

const geo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const g = makeGrid(BBOX, PANORAMIC_STEP_DEG, `pan${PANORAMIC_STEP_DEG}`);
const pad = 0.5;
const box = { latMin: g.lat0 - pad, latMax: g.lat0 + (g.ny - 1) * g.dLat + pad, lonMin: g.lon0 - pad, lonMax: g.lon0 + (g.nx - 1) * g.dLon + pad };

/** Anelli (esterni e buchi) che toccano l'area. */
const rings = [];
for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      let a = Infinity; let b = -Infinity; let c = Infinity; let d = -Infinity;
      for (const [lon, lat] of ring) { a = Math.min(a, lon); b = Math.max(b, lon); c = Math.min(c, lat); d = Math.max(d, lat); }
      if (b < box.lonMin || a > box.lonMax || d < box.latMin || c > box.latMax) continue;
      rings.push(ring);
    }
  }
}

/** Terra = numero dispari di attraversamenti su tutti gli anelli (i buchi si annullano). */
function isLand(lat, lon) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Mare se almeno un sottopunto della cella (passo/4) è in mare: include i punti costieri.
const q = PANORAMIC_STEP_DEG / 4;
let bits = '';
let sea = 0;
for (let y = 0; y < g.ny; y++) {
  for (let x = 0; x < g.nx; x++) {
    const { lat, lon } = gridPoint(g, x, y);
    let s = false;
    for (const dy of [-q, 0, q]) for (const dx of [-q, 0, q]) if (!s && !isLand(lat + dy, lon + dx)) s = true;
    bits += s ? '1' : '0';
    if (s) sea++;
  }
}
console.log(`// Generato da tools/seamask/make-seamask.mjs (Natural Earth 10 m land, pubblico dominio). Non modificare a mano.
// Maschera mare della griglia "${g.id}" (${g.nx} × ${g.ny}, righe da sud a nord): ${sea} punti di mare.

/** Identificativo della griglia a cui si riferisce la maschera. */
export const SEA_MASK_GRID_ID = '${g.id}';

/** Un carattere per punto (indice y·nx + x): '1' mare, '0' terra. */
export const SEA_MASK_BITS = '${bits}';
`);
