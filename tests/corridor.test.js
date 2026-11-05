import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corridorGrid } from '../js/weather/corridor.js';
import { gridPoint } from '../js/weather/grid.js';
import { distanceNm } from '../js/routing/geo.js';

const ANCONA = { lat: 43.62, lon: 13.52 };
const ZARA = { lat: 44.11, lon: 15.22 };

test('corridoio Ancona → Zara: punti dentro l’ellisse, numero contenuto', () => {
  const { grid, indices, stepDeg } = corridorGrid([ANCONA, ZARA], { stepDeg: 0.1, marginNm: 15 });
  assert.equal(stepDeg, 0.1);
  assert.ok(indices.length > 50 && indices.length < 600, `${indices.length}`);
  const d = distanceNm(ANCONA.lat, ANCONA.lon, ZARA.lat, ZARA.lon);
  for (const i of indices) {
    const p = gridPoint(grid, i % grid.nx, Math.floor(i / grid.nx));
    const s = distanceNm(p.lat, p.lon, ANCONA.lat, ANCONA.lon) + distanceNm(p.lat, p.lon, ZARA.lat, ZARA.lon);
    // Dentro l'ellisse o nell'anello di una cella (≤ 2 × 6 NM in più).
    assert.ok(s <= d + 30 + 13, `${s}`);
  }
  // Partenza e arrivo coperti da punti vicini.
  const near = (q) => indices.some((i) => {
    const p = gridPoint(grid, i % grid.nx, Math.floor(i / grid.nx));
    return distanceNm(p.lat, p.lon, q.lat, q.lon) < 6;
  });
  assert.ok(near(ANCONA) && near(ZARA));
});

test('con waypoint il corridoio segue i tratti; passo allargato oltre il massimo', () => {
  const via = { lat: 42.9, lon: 14.6 };
  const a = corridorGrid([ANCONA, via, ZARA], { stepDeg: 0.1 });
  const b = corridorGrid([ANCONA, ZARA], { stepDeg: 0.1 });
  assert.ok(a.indices.length > b.indices.length);
  const big = corridorGrid([{ lat: 45.6, lon: 13.6 }, { lat: 40.0, lon: 19.4 }], { stepDeg: 0.05, maxPoints: 400 });
  assert.ok(big.stepDeg > 0.05);
  assert.ok(big.indices.length <= 400 || big.stepDeg >= 0.25);
});
