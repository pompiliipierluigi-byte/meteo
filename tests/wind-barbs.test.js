import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barbCounts, barbGeometry, BARB_STAFF_PX } from '../js/map/wind-barbs.js';

test('scomposizione in pennoni, alette e mezze alette (arrotondata ai 5 kn)', () => {
  assert.deepEqual(barbCounts(1), { calm: true, pennants: 0, full: 0, half: 0 });
  assert.deepEqual(barbCounts(5), { calm: false, pennants: 0, full: 0, half: 1 });
  assert.deepEqual(barbCounts(13), { calm: false, pennants: 0, full: 1, half: 1 });
  assert.deepEqual(barbCounts(22), { calm: false, pennants: 0, full: 2, half: 0 });
  assert.deepEqual(barbCounts(48), { calm: false, pennants: 1, full: 0, half: 0 });
  assert.deepEqual(barbCounts(65), { calm: false, pennants: 1, full: 1, half: 1 });
});

test('asta verso la provenienza e alette sul lato orario', () => {
  // Vento da nord: soffia verso sud (schermo: dy = +1). L'asta va verso nord (y decrescente).
  const g = barbGeometry(100, 100, 0, 1, 20);
  const [x1, y1, x2, y2] = g.lines[0];
  assert.deepEqual([x1, y1, x2, y2], [100, 100, 100, 100 - BARB_STAFF_PX]);
  assert.equal(g.lines.length, 3);
  // Alette verso est (x crescente): lato orario per un'asta che punta a nord.
  for (const l of g.lines.slice(1)) assert.ok(l[2] > l[0]);
  assert.equal(barbGeometry(0, 0, 1, 0, 55).triangles.length, 1);
  assert.equal(barbGeometry(0, 0, 1, 0, 0).calm, true);
});
