import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseAuto, lastValidTimeMs, sourcesFor, singleModel } from '../js/weather/models.js';
import { makeGrid, emptyField } from '../js/weather/grid.js';

const H = 3600e3;

/** Campo 2 punti × n ore con valore costante per modello. */
function field(n, value, validHours = n) {
  const g = makeGrid({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 1 }, 1, 't');
  const f = emptyField(g, Array.from({ length: n }, (_, i) => i * H), ['u', 'v', 'gust']);
  for (let t = 0; t < validHours; t++) {
    for (const name of ['u', 'v', 'gust']) f.vars[name].fill(value, t * 2, t * 2 + 2);
  }
  return f;
}

test('scelte e sorgenti', () => {
  assert.deepEqual(sourcesFor('auto'), ['icon2i', 'ecmwf']);
  assert.deepEqual(sourcesFor('gfs'), ['gfs']);
});

test('ultima ora valida', () => {
  assert.equal(lastValidTimeMs(field(6, 1, 3), 'u'), 2 * H);
  assert.equal(lastValidTimeMs(field(6, 1, 0), 'u'), -Infinity);
});

test('Auto: ICON-2I fino all’ultima ora valida, poi ECMWF; discontinuità segnalata', () => {
  const icon = field(6, 1, 3);
  const ecmwf = field(6, 2);
  const w = fuseAuto(icon, ecmwf);
  assert.deepEqual(w.sourceByTime, ['icon2i', 'icon2i', 'icon2i', 'ecmwf', 'ecmwf', 'ecmwf']);
  assert.equal(w.switchMs, 3 * H);
  assert.deepEqual([...w.field.vars.u], [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
});

test('Auto: punto fuori dal dominio ICON-2I → ECMWF in quel punto', () => {
  const icon = field(2, 1);
  icon.vars.u[1] = NaN; // t=0, punto 1
  const w = fuseAuto(icon, field(2, 2));
  assert.equal(w.field.vars.u[0], 1);
  assert.equal(w.field.vars.u[1], 2);
  assert.equal(w.field.vars.gust[1], 2);
});

test('Auto senza ICON-2I → solo ECMWF', () => {
  const w = fuseAuto(null, field(2, 2));
  assert.deepEqual(w.sourceByTime, ['ecmwf', 'ecmwf']);
  assert.equal(w.switchMs, null);
  assert.deepEqual(singleModel('gfs', field(1, 3)).sourceByTime, ['gfs']);
});
