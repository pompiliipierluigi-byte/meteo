import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRoute, tilesFor, gridBounds, maxSpeed } from '../js/routing/run.js';
import { makeGrid, emptyField, windToUV } from '../js/weather/grid.js';
import { DEFAULT_CORRECTIONS } from '../js/boats/polar.js';

const P = { version: 1, tws: [6, 10, 16], twa: [52, 90, 150, 180], bsp: [[5, 6.5, 7.2], [5.8, 7.4, 8], [4.6, 6.4, 7.8], [3.8, 5.6, 7]] };

test('tasselli e limiti di una griglia', () => {
  assert.deepEqual(tilesFor({ latMin: 43.2, latMax: 44.1, lonMin: 13.5, lonMax: 15.2 }), ['43_13', '43_14', '43_15', '44_13', '44_14', '44_15']);
  assert.deepEqual(gridBounds({ lat0: 43, lon0: 13, dLat: 0.1, dLon: 0.1, nx: 11, ny: 6 }), { latMin: 43, latMax: 43.5, lonMin: 13, lonMax: 14 });
});

test('calcolo completo con campo meteo su griglia e correttivi di default', () => {
  const g = makeGrid({ latMin: 42.8, latMax: 43.4, lonMin: 14.8, lonMax: 15.6 }, 0.1, 'cor');
  const times = [0, 3600e3, 7200e3, 10800e3, 14400e3, 18000e3];
  const wind = emptyField(g, times, ['u', 'v', 'gust']);
  const { u, v } = windToUV(10, 0);
  wind.vars.u.fill(u);
  wind.vars.v.fill(v);
  wind.vars.gust.fill(13);
  const req = {
    route: [{ lat: 43.0, lon: 15.0 }, { lat: 43.0, lon: 15.3 }],
    departMs: 0,
    polars: { full: P },
    sails: 'full',
    corrections: DEFAULT_CORRECTIONS,
    motor: { mode: 'vmg', thresholdKn: 1, speedKn: 6, nearLand: false, nearLandNm: 0.5 },
    limits: { twsKn: null, gustKn: null, waveM: null },
    coastMarginNm: 0.3,
    coastWarningNm: 1,
    waveWarningM: 2,
  };
  const r = runRoute(req, { wind, marine: null }, null);
  // Traverso a 10 kn: 7.4 × 0.8 = 5.92 kn su ~13.2 NM.
  const ideal = 13.16 / (7.4 * 0.8);
  assert.ok(Math.abs(r.summary.duration_h - ideal) / ideal < 0.03, `${r.summary.duration_h} vs ${ideal}`);
  assert.ok(maxSpeed((a, w) => a / 20 + w, [5, 10]) >= 19);
});
