import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampler } from '../js/routing/interp.js';
import { makeGrid, emptyField, windToUV } from '../js/weather/grid.js';

const H = 3600e3;
const g = makeGrid({ latMin: 43, latMax: 44, lonMin: 15, lonMax: 16 }, 0.5, 't');
const n = g.nx * g.ny;

function windField(speedAt) {
  const f = emptyField(g, [0, H], ['u', 'v', 'gust']);
  for (let t = 0; t < 2; t++) {
    const [s, d] = speedAt(t);
    const { u, v } = windToUV(s, d);
    f.vars.u.fill(u, t * n, (t + 1) * n);
    f.vars.v.fill(v, t * n, (t + 1) * n);
    f.vars.gust.fill(s * 1.4, t * n, (t + 1) * n);
  }
  return f;
}

test('vento: costante nello spazio, interpolato nel tempo sulle componenti', () => {
  const s = createSampler({ wind: windField((t) => (t === 0 ? [10, 0] : [10, 90])) });
  const c0 = s(43.5, 15.5, 0);
  assert.ok(Math.abs(c0.twsKn - 10) < 1e-6 && Math.abs(c0.twdDeg % 360) < 1e-6);
  const mid = s(43.5, 15.5, H / 2);
  // Media di (da N, 10) e (da E, 10): da NE, 10·√2/2.
  assert.ok(Math.abs(mid.twdDeg - 45) < 1e-6);
  assert.ok(Math.abs(mid.twsKn - 10 * Math.SQRT1_2) < 1e-6);
  assert.equal(c0.curKn, 0);
  assert.ok(Number.isNaN(c0.waveHeightM));
  assert.equal(s(45, 15.5, 0), null);
});

test('onda e corrente dal campo marino', () => {
  const m = emptyField(g, [0], ['wave_h', 'wave_per', 'wave_dx', 'wave_dy', 'cur_u', 'cur_v']);
  m.vars.wave_h.fill(1.5);
  m.vars.wave_per.fill(5);
  m.vars.wave_dx.fill(1); // da est
  m.vars.wave_dy.fill(0);
  m.vars.cur_u.fill(0);
  m.vars.cur_v.fill(-0.8); // verso sud
  const s = createSampler({ wind: windField(() => [12, 270]), marine: m });
  const c = s(43.2, 15.7, 0);
  assert.equal(c.waveHeightM, 1.5);
  assert.equal(c.wavePeriodS, 5);
  assert.ok(Math.abs(c.waveDirDeg - 90) < 1e-9);
  assert.ok(Math.abs(c.curKn - 0.8) < 1e-6);
  assert.ok(Math.abs(c.curDirDeg - 180) < 1e-9);
});
