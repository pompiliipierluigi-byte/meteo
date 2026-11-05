import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePolar, tableBsp, polarBsp, optimalAngles, sailSpeed, bestSailing, useMotor, foldTwa,
  DEFAULT_CORRECTIONS, NO_CORRECTIONS,
} from '../js/boats/polar.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Polare di prova (tipo crociera 12 m). */
const P = {
  version: 1,
  tws: [6, 10, 16],
  twa: [52, 90, 120, 150, 180],
  bsp: [
    [5.0, 6.5, 7.2],
    [5.8, 7.4, 8.0],
    [5.6, 7.2, 8.4],
    [4.6, 6.4, 7.8],
    [3.8, 5.6, 7.0],
  ],
  beat: { twa: [44, 41, 39], bsp: [4.4, 5.9, 6.6] },
  run: { twa: [150, 160, 170], bsp: [4.6, 6.0, 7.4] },
};

test('validazione', () => {
  assert.deepEqual(validatePolar(P), []);
  assert.ok(validatePolar({ ...P, tws: [10, 6, 16] }).length > 0);
  assert.ok(validatePolar({ ...P, bsp: P.bsp.slice(1) }).length > 0);
  assert.ok(validatePolar({ ...P, twa: [52, 90, 120, 150, 190] }).length > 0);
  assert.ok(validatePolar({ ...P, beat: { twa: [44], bsp: [4] } }).length > 0);
  assert.deepEqual(validatePolar({ ...P, beat: undefined, run: undefined }), []);
});

test('ai nodi della tabella la velocità è quella della fonte', () => {
  P.twa.forEach((twa, i) => P.tws.forEach((tws, j) => close(tableBsp(P, twa, tws), P.bsp[i][j])));
  P.twa.forEach((twa, i) => P.tws.forEach((tws, j) => close(polarBsp(P, twa, tws), P.bsp[i][j])));
});

test('interpolazione bilineare', () => {
  close(tableBsp(P, 105, 8), (5.8 + 7.4 + 5.6 + 7.2) / 4);
});

test('TWS sotto il minimo: verso 0; sopra il massimo: valore al massimo', () => {
  close(tableBsp(P, 90, 3), 5.8 / 2);
  close(tableBsp(P, 90, 0), 0);
  close(polarBsp(P, 90, 0), 0);
  close(tableBsp(P, 90, 30), 8.0);
});

test('zona morta sotto l’angolo di bolina e raccordo fino alla tabella', () => {
  assert.equal(polarBsp(P, 30, 10), 0);
  assert.equal(polarBsp(P, 40, 10), 0);
  close(polarBsp(P, 41, 10), 5.9);
  close(polarBsp(P, 46.5, 10), (5.9 + 6.5) / 2);
});

test('simmetria delle mure', () => {
  assert.equal(foldTwa(-90), 90);
  assert.equal(foldTwa(270), 90);
  close(polarBsp(P, -120, 10), polarBsp(P, 120, 10));
});

test('angoli ottimi: dalla polare, oppure calcolati con la VMG', () => {
  const o = optimalAngles(P, 10);
  assert.deepEqual([o.beatTwa, o.beatBsp, o.runTwa, o.runBsp], [41, 5.9, 160, 6.0]);
  const n = optimalAngles({ ...P, beat: undefined, run: undefined }, 10);
  assert.equal(n.beatTwa, 52);
  assert.ok(n.runTwa >= 150 && n.runTwa <= 180);
});

test('correttivi di default: full all’80 %, portanti a vele bianche al 40 %', () => {
  const polars = { full: P };
  close(sailSpeed(polars, 'full', 90, 10, DEFAULT_CORRECTIONS), 7.4 * 0.8);
  close(sailSpeed(polars, 'full', 52, 10, DEFAULT_CORRECTIONS), 6.5 * 0.8);
  close(sailSpeed(polars, 'white', 52, 10, DEFAULT_CORRECTIONS), 6.5 * 0.8);
  close(sailSpeed(polars, 'white', 120, 10, DEFAULT_CORRECTIONS), 7.2 * 0.4);
  close(sailSpeed(polars, 'white', 150, 16, DEFAULT_CORRECTIONS), 7.8 * 0.4);
});

test('efficienza disattivata (polari manuali/CSV) e polare vele bianche propria', () => {
  const c = { ...DEFAULT_CORRECTIONS, applyEfficiency: false };
  close(sailSpeed({ full: P }, 'full', 120, 10, c), 7.2);
  close(sailSpeed({ full: P }, 'white', 120, 10, c), 7.2 * 0.5);
  const white = { ...P, bsp: P.bsp.map((r) => r.map((v) => v - 1)) };
  close(sailSpeed({ full: P, white }, 'white', 120, 10, DEFAULT_CORRECTIONS), 6.2 * 0.8);
  close(sailSpeed({ full: P }, 'full', 120, 10, NO_CORRECTIONS), 7.2);
});

test('confine bolina/portanti regolabile', () => {
  const c = { ...DEFAULT_CORRECTIONS, upwindEffPct: 90, downwindEffPct: 70, splitTwaDeg: 100 };
  close(sailSpeed({ full: P }, 'full', 90, 10, c), 7.4 * 0.9);
  close(sailSpeed({ full: P }, 'full', 120, 10, c), 7.2 * 0.7);
});

test('regola motore: esempi della SPEC (soglia 3 kn)', () => {
  const cfg = { mode: 'vmg', thresholdKn: 3 };
  assert.equal(useMotor({ maxBsp: 7, maxVmc: 4 }, cfg), false);
  assert.equal(useMotor({ maxBsp: 7, maxVmc: 2.5 }, cfg), true);
  assert.equal(useMotor({ maxBsp: 2.9, maxVmc: 2.9 }, { mode: 'speed', thresholdKn: 3 }), true);
  assert.equal(useMotor({ maxBsp: 7, maxVmc: 0 }, { mode: 'speed', thresholdKn: 3 }), false);
});

test('migliori prestazioni: meta controvento → VMC di bolina', () => {
  const speedAt = (twa) => polarBsp(P, twa, 10);
  const b = bestSailing(speedAt, 0, 0, 1);
  close(b.maxVmc, 5.9 * Math.cos((41 * Math.PI) / 180), 1e-9);
  close(b.maxBsp, 7.4, 0.01);
  const down = bestSailing(speedAt, 0, 180, 1);
  // Poppa: la VMC massima è quella della tabella (tra 150° e 180°), non sotto il punto di poppa indicato.
  let best = 0;
  for (let twa = 150; twa <= 180; twa += 1) best = Math.max(best, -tableBsp(P, twa, 10) * Math.cos((twa * Math.PI) / 180));
  close(down.maxVmc, best, 1e-9);
});
