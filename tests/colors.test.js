import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorAt, WIND_STOPS, WAVE_STOPS, windRamp, waveRamp } from '../js/map/colors.js';

test('colori alle soglie e interpolati', () => {
  assert.deepEqual(colorAt(WIND_STOPS, 0), WIND_STOPS[0][1]);
  assert.deepEqual(colorAt(WIND_STOPS, 15), WIND_STOPS[3][1]);
  assert.deepEqual(colorAt(WIND_STOPS, 60), WIND_STOPS[7][1]);
  assert.deepEqual(colorAt(WIND_STOPS, -3), WIND_STOPS[0][1]);
  const mid = colorAt(WAVE_STOPS, 2.5);
  assert.deepEqual(mid, [238, 168, 53]);
});

test('scale precalcolate coerenti', () => {
  assert.deepEqual(windRamp.rgb(20), WIND_STOPS[4][1]);
  assert.deepEqual(waveRamp.rgb(4), WAVE_STOPS[6][1]);
  assert.deepEqual(waveRamp.rgb(9), WAVE_STOPS[6][1]);
});
