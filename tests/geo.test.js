import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceNm, bearingDeg, destination, norm360, angleDiff, addVectors, EARTH_RADIUS_NM } from '../js/routing/geo.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('un primo di latitudine = 1 NM (circa) e giro completo', () => {
  close(distanceNm(43, 15, 43 + 1 / 60, 15), 1.0007, 1e-3);
  close(distanceNm(0, 0, 0, 180), Math.PI * EARTH_RADIUS_NM, 1e-6);
});

test('Ancona → Zara: distanza e rotta plausibili', () => {
  // Ancona 43°37′N 13°31′E, Zara 44°07′N 15°13′E: ~80 NM per ~067°.
  const d = distanceNm(43.617, 13.517, 44.117, 15.217);
  const b = bearingDeg(43.617, 13.517, 44.117, 15.217);
  assert.ok(d > 78 && d < 84, `${d}`);
  assert.ok(b > 62 && b < 70, `${b}`);
});

test('destinazione: andata e ritorno coerenti con distanza e rotta', () => {
  for (const course of [0, 45, 90, 180, 270, 333]) {
    const p = destination(43.5, 15.5, course, 37.2);
    close(distanceNm(43.5, 15.5, p.lat, p.lon), 37.2, 1e-6);
    close(angleDiff(bearingDeg(43.5, 15.5, p.lat, p.lon), course), 0, 1e-6);
  }
  const n = destination(43, 15, 0, 60);
  close(n.lat, 44, 0.01);
  close(n.lon, 15, 1e-9);
});

test('angoli', () => {
  assert.equal(norm360(-10), 350);
  assert.equal(norm360(720), 0);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(0, 180), 180);
});

test('somma di vettori (barca + corrente)', () => {
  const v = addVectors(6, 0, 1, 90);
  close(v.speed, Math.hypot(6, 1), 1e-9);
  close(v.dirDeg, Math.atan2(1, 6) * 180 / Math.PI, 1e-9);
  const opp = addVectors(5, 90, 5, 270);
  close(opp.speed, 0, 1e-9);
});
