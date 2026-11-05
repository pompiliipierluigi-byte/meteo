import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGrid, gridPoint, maskedIndices, seaMaskFromSeries, dilateMask,
  windToUV, uvToWind, emptyField, fillNearest, timeIndex, bilinear, sample,
} from '../js/weather/grid.js';
import { BBOX, PANORAMIC_STEP_DEG } from '../js/config.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('griglia panoramica copre la BBOX (25 × 32 punti)', () => {
  const g = makeGrid(BBOX, PANORAMIC_STEP_DEG, 'pan');
  assert.equal(g.ny, 25);
  assert.equal(g.nx, 32);
  assert.deepEqual(gridPoint(g, 0, 0), { lat: 39.8, lon: 12 });
  const last = gridPoint(g, g.nx - 1, g.ny - 1);
  assert.equal(last.lat, 45.8);
  assert.ok(last.lon >= BBOX.lonMax);
});

test('vento da nord → v negativo; andata e ritorno u/v', () => {
  const n = windToUV(10, 0);
  close(n.u, 0);
  close(n.v, -10);
  const w = windToUV(10, 270); // da ovest → soffia verso est
  close(w.u, 10);
  close(w.v, 0);
  for (const d of [0, 45, 135, 180, 225, 359]) {
    const { u, v } = windToUV(12.5, d);
    const back = uvToWind(u, v);
    close(back.speed, 12.5);
    close(back.fromDeg % 360, d);
  }
});

test('interpolazione delle componenti tra 350° e 10° dà 0°, non 180°', () => {
  const g = makeGrid({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 1 }, 1, 't');
  const f = emptyField(g, [0], ['u', 'v']);
  const a = windToUV(10, 350);
  const b = windToUV(10, 10);
  f.vars.u.set([a.u, b.u]);
  f.vars.v.set([a.v, b.v]);
  const u = sample(f, 'u', 0, 0.5, 0);
  const v = sample(f, 'v', 0, 0.5, 0);
  close(uvToWind(u, v).fromDeg, 0, 1e-4);
});

test('bilineare e tempo lineare', () => {
  const g = makeGrid({ latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 }, 1, 't');
  const f = emptyField(g, [0, 3600e3], ['x']);
  // t0: 0 1 / 2 3 ; t1: tutto +10
  f.vars.x.set([0, 1, 2, 3, 10, 11, 12, 13]);
  close(sample(f, 'x', 0.5, 0.5, 0), 1.5);
  close(sample(f, 'x', 0.5, 0.5, 1800e3), 6.5);
  close(sample(f, 'x', 0, 0, 3600e3), 10);
  assert.ok(Number.isNaN(sample(f, 'x', 2, 0, 0)));
});

test('bilineare ignora i vertici mancanti', () => {
  const g = makeGrid({ latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 }, 1, 't');
  const arr = new Float32Array([NaN, 2, 2, 2]);
  close(bilinear(arr, g, 0, 0.5, 0.5), 2);
  assert.ok(Number.isNaN(bilinear(new Float32Array([NaN, 2, 2, 2]), g, 0, 0, 0)));
});

test('timeIndex', () => {
  const t = [0, 10, 20];
  assert.deepEqual(timeIndex(t, -5), { i0: 0, w: 0 });
  assert.deepEqual(timeIndex(t, 15), { i0: 1, w: 0.5 });
  assert.deepEqual(timeIndex(t, 25), { i0: 2, w: 0 });
  assert.equal(timeIndex([], 1), null);
});

test('maschera mare e anello costiero', () => {
  const g = makeGrid({ latMin: 0, latMax: 2, lonMin: 0, lonMax: 2 }, 1, 't');
  const idx = maskedIndices(g);
  assert.equal(idx.length, 9);
  const series = idx.map((i) => (i === 0 ? [1, null] : [null, null]));
  const sea = seaMaskFromSeries(g, idx, series);
  assert.deepEqual([...sea], [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const ring = dilateMask(g, sea);
  assert.deepEqual([...ring], [1, 1, 0, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(maskedIndices(g, ring), [0, 1, 3, 4]);
});

test('fillNearest riempie entro 2 celle, solo nella maschera', () => {
  const g = makeGrid({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 4 }, 1, 't');
  const f = emptyField(g, [0], ['h', 'p']);
  f.vars.h.set([1, NaN, NaN, NaN, NaN]);
  f.vars.p.set([5, NaN, NaN, NaN, NaN]);
  fillNearest(f, ['h', 'p'], new Uint8Array([1, 1, 1, 1, 0]), 2);
  assert.deepEqual([...f.vars.h].map((x) => (Number.isNaN(x) ? null : x)), [1, 1, 1, null, null]);
  assert.equal(f.vars.p[2], 5);
});
