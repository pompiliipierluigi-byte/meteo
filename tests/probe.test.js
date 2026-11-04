import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeValues } from '../js/ui/probe.js';
import { makeGrid, emptyField, windToUV } from '../js/weather/grid.js';
import { fuseAuto } from '../js/weather/models.js';

const H = 3600e3;
const g = makeGrid({ latMin: 43, latMax: 44, lonMin: 14, lonMax: 15 }, 1, 't');

function wind(speed, from, n = 2, validHours = n) {
  const f = emptyField(g, Array.from({ length: n }, (_, i) => i * H), ['u', 'v', 'gust']);
  const { u, v } = windToUV(speed, from);
  for (let t = 0; t < validHours; t++) {
    f.vars.u.fill(u, t * 4, t * 4 + 4);
    f.vars.v.fill(v, t * 4, t * 4 + 4);
    f.vars.gust.fill(speed * 1.3, t * 4, t * 4 + 4);
  }
  return f;
}

test('sonda: vento costante restituito identico (nessun errore di interpolazione)', () => {
  const w = { ...fuseAuto(wind(12, 225, 2, 1), wind(20, 90)), runs: { icon2i: 1, ecmwf: 2 }, fetchedMs: 0, stale: null };
  const p0 = probeValues(w, null, 43.4, 14.6, 0);
  assert.ok(Math.abs(p0.windKn - 12) < 1e-4);
  assert.ok(Math.abs(p0.windFromDeg - 225) < 1e-3);
  assert.ok(Math.abs(p0.gustKn - 15.6) < 1e-4);
  assert.equal(p0.model, 'icon2i');
  assert.equal(p0.runMs, 1);
  const p1 = probeValues(w, null, 43.4, 14.6, H);
  assert.equal(p1.model, 'ecmwf');
  assert.ok(Math.abs(p1.windFromDeg - 90) < 1e-3);
  assert.ok(p0.waves.every((x) => Number.isNaN(x.heightM)));
});

test('sonda: onda con direzione di provenienza', () => {
  const f = emptyField(g, [0], ['wave_h', 'wave_per', 'wave_dx', 'wave_dy']);
  f.vars.wave_h.fill(1.4);
  f.vars.wave_per.fill(6);
  f.vars.wave_dx.fill(Math.sin(Math.PI / 2));
  f.vars.wave_dy.fill(Math.cos(Math.PI / 2));
  const p = probeValues(null, { field: f, runMs: 0, fetchedMs: 0, stale: null }, 43.5, 14.5, 0);
  const total = p.waves.find((x) => x.key === 'wave');
  assert.ok(Math.abs(total.heightM - 1.4) < 1e-6);
  assert.ok(Math.abs(total.fromDeg - 90) < 1e-4);
  assert.equal(total.periodS, 6);
  assert.equal(p.model, null);
});
