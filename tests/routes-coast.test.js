// Rotte di prova sulla linea di costa reale (data/coastline): nessuna traccia attraversa la terra (PIANO fase 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLandIndex, tilePolygons } from '../js/routing/land.js';
import { computeRoute } from '../js/routing/isochrone.js';
import { sailSpeed, DEFAULT_CORRECTIONS } from '../js/boats/polar.js';
import { orcToPolar } from '../js/boats/orc.js';
import { distanceNm } from '../js/routing/geo.js';
import { speedTable } from '../js/routing/run.js';

const dir = new URL('../data/coastline/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const land = createLandIndex();
for (const t of index.tiles) {
  const polygons = t.kind === 'mixed' ? tilePolygons(JSON.parse(readFileSync(new URL(`${t.id}.geojson`, dir), 'utf8'))) : undefined;
  land.addTile({ id: t.id, bounds: t.bounds, kind: t.kind, polygons });
}
const polar = orcToPolar(JSON.parse(readFileSync(new URL('./fixtures/orc-ITA15598.json', import.meta.url), 'utf8')));
const speed = speedTable((twa, tws) => sailSpeed({ full: polar }, "full", twa, tws, DEFAULT_CORRECTIONS));

/** Maestrale uniforme 14 kn da 315°. */
const sampler = () => ({ twsKn: 14, twdDeg: 315, gustKn: 18, waveHeightM: 0.8, waveDirDeg: 315, wavePeriodS: 4, curKn: 0, curDirDeg: 0, curU: 0, curV: 0 });

const ROUTES = [
  ['Ancona → Zara', { lat: 43.63, lon: 13.50 }, { lat: 44.115, lon: 15.20 }],
  ['Pescara → Vis', { lat: 42.48, lon: 14.23 }, { lat: 43.065, lon: 16.19 }],
  ['Spalato → Lastovo', { lat: 43.50, lon: 16.43 }, { lat: 42.775, lon: 16.90 }],
  ['Trieste → Pola', { lat: 45.645, lon: 13.75 }, { lat: 44.875, lon: 13.835 }],
  ['Brindisi → Dubrovnik', { lat: 40.66, lon: 17.97 }, { lat: 42.65, lon: 18.065 }],
];

for (const [name, a0, b0] of ROUTES) {
  test(`${name}: traccia sempre in mare`, () => {
    const a = land.snapToSea(a0.lat, a0.lon, { offsetNm: 0.2 });
    const b = land.snapToSea(b0.lat, b0.lon, { offsetNm: 0.2 });
    assert.ok(a && b, 'partenza/arrivo in mare');
    const t0 = performance.now();
    const r = computeRoute({
      route: [a, b],
      departMs: 0,
      sailSpeed: speed,
      maxSailKn: 9,
      sampler,
      land,
      motor: { mode: 'vmg', thresholdKn: 2, speedKn: 6, nearLand: false, nearLandNm: 0.5 },
      coastMarginNm: 0.3,
      coastWarningNm: 1,
      waveWarningM: 2,
      splitTwaDeg: 90,
    });
    const ms = performance.now() - t0;
    for (let i = 0; i + 1 < r.track.length; i++) {
      const p = r.track[i];
      const q = r.track[i + 1];
      assert.equal(land.segmentHitsLand(p.lat, p.lon, q.lat, q.lon), false, `tratto ${i} a terra (${p.lat.toFixed(4)},${p.lon.toFixed(4)} → ${q.lat.toFixed(4)},${q.lon.toFixed(4)})`);
    }
    const direct = distanceNm(a.lat, a.lon, b.lat, b.lon);
    console.log(`  ${name}: ${r.summary.distance_nm.toFixed(1)} NM (diretta ${direct.toFixed(1)}), ${r.summary.duration_h.toFixed(1)} h, calcolo ${Math.round(ms)} ms`);
    assert.ok(r.summary.distance_nm >= direct - 0.01);
  });
}
