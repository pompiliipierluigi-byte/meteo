import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDegMin, formatLatLon, formatDeg, compass16, formatShortDateTime, localHour, fmtNum } from '../js/lib/format.js';

test('gradi e minuti decimali', () => {
  assert.equal(formatLatLon(43.504167, 16.435), '43°30.25\'N 016°26.10\'E');
  assert.equal(formatDegMin(-0.5, 'lon'), '000°30.00\'W');
  assert.equal(formatDegMin(44.99999999, 'lat'), '45°00.00\'N');
});

test('direzioni', () => {
  assert.equal(formatDeg(45.4), '045°');
  assert.equal(formatDeg(359.6), '000°');
  assert.equal(formatDeg(-90), '270°');
  assert.equal(compass16(0), 'N');
  assert.equal(compass16(225), 'SO');
  assert.equal(compass16(350), 'N');
});

test('ora locale Europe/Rome (CET/CEST)', () => {
  assert.equal(formatShortDateTime(Date.parse('2026-11-04T12:00Z')), '04/11 13:00');
  assert.equal(localHour(Date.parse('2026-07-01T12:00Z')), 14);
});

test('numeri non disponibili', () => {
  assert.equal(fmtNum(NaN, 1), 'n.d.');
  assert.equal(fmtNum(1.25, 1), '1.3');
});
