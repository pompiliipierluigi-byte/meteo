import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departureTimes, splitDepartures, WINDOW_RUNS } from '../js/routing/departure-window.js';

const H = 3600e3;

test('24 partenze dall\'ora intera successiva', () => {
  const now = Date.UTC(2026, 10, 5, 17, 20);
  const d = departureTimes(now);
  assert.equal(d.length, WINDOW_RUNS);
  assert.equal(d[0], Date.UTC(2026, 10, 5, 18));
  assert.equal(d[23] - d[0], 23 * H);
  // Ora già intera: si parte da lì.
  assert.equal(departureTimes(Date.UTC(2026, 10, 6, 6), 3)[0], Date.UTC(2026, 10, 6, 6));
});

test('suddivisione alternata tra i worker, indici conservati', () => {
  const d = departureTimes(0, 5);
  const g = splitDepartures(d, 2);
  assert.deepEqual(g.map((l) => l.map((x) => x.index)), [[0, 2, 4], [1, 3]]);
  assert.equal(g[1][0].departMs, d[1]);
  assert.equal(splitDepartures(d, 1).length, 1);
  assert.equal(splitDepartures(d.slice(0, 1), 2).length, 1);
});
