import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mercator } from '../js/map/land-mask.js';

test('Web Mercator: equatore al centro, nord in alto, lon lineare', () => {
  assert.deepEqual(mercator(0, 0, 256), [128, 128]);
  const [x, y] = mercator(45, 15, 256);
  assert.ok(Math.abs(x - (195 / 360) * 256) < 1e-9);
  assert.ok(y < 128);
  // Valore noto: lat 45° → y ≈ 92.09 px su 256 (Leaflet/OSM).
  assert.ok(Math.abs(y - 92.09) < 0.01);
});
