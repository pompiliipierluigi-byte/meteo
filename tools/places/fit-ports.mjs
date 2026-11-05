// Porta le coordinate di data/places/ports.json in acqua libera: se il punto è a terra o a meno di
// MIN_NM dalla costa, lo sostituisce con il punto di mare più vicino (ricerca a griglia fine) che sta ad
// almeno MIN_NM dalla costa, usando i tasselli di data/coastline (stessa costa del routing).
// Uso: node tools/places/fit-ports.mjs   (non eseguito dall'app)

import fs from 'node:fs';
import { createLandIndex, tilePolygons } from '../../js/routing/land.js';

const MIN_NM = 0.15;
const MAX_NM = 3;
const root = new URL('../../', import.meta.url);
const dir = new URL('data/coastline/', root);
const file = new URL('data/places/ports.json', root);
const idx = JSON.parse(fs.readFileSync(new URL('index.json', dir)));
const land = createLandIndex();
for (const t of idx.tiles) {
  if (t.kind !== 'mixed') land.addTile({ id: t.id, bounds: t.bounds, kind: t.kind });
  else land.addTile({ id: t.id, bounds: t.bounds, kind: 'mixed', polygons: tilePolygons(JSON.parse(fs.readFileSync(new URL(`${t.id}.geojson`, dir)))) });
}
const ok = (lat, lon) => !land.isLand(lat, lon) && land.distanceToCoastNm(lat, lon, MIN_NM * 2) >= MIN_NM;
const data = JSON.parse(fs.readFileSync(file));
for (const p of data.ports) {
  if (ok(p.lat, p.lon)) continue;
  const kx = Math.cos((p.lat * Math.PI) / 180) * 60;
  let best = null;
  // Anelli crescenti (passo 0.02 NM): il primo punto valido è il più vicino.
  for (let r = 0.02; r <= MAX_NM && !best; r += 0.02) {
    const n = Math.max(16, Math.ceil((2 * Math.PI * r) / 0.02));
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const lat = p.lat + (r * Math.cos(a)) / 60;
      const lon = p.lon + (r * Math.sin(a)) / kx;
      if (ok(lat, lon)) {
        best = { lat, lon, r };
        break;
      }
    }
  }
  if (!best) {
    console.log(`${p.name}: nessun mare entro ${MAX_NM} NM`);
    continue;
  }
  console.log(`${p.name}: spostato di ${best.r.toFixed(2)} NM`);
  p.lat = Math.round(best.lat * 1e4) / 1e4;
  p.lon = Math.round(best.lon * 1e4) / 1e4;
}
data.note = 'Porti e marine dell\'area di lavoro: coordinate in acqua libera vicino al porto (almeno 0.15 NM dalla costa OSM, tools/places/fit-ports.mjs). Nomi italiani storici come alias.';
fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
