import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandIndex, segmentsIntersect, tilePolygons } from '../js/routing/land.js';

// Due tasselli: una penisola che attraversa il confine lon 16 (ritagliata su entrambi) e un'isola quadrata.
// Isola: 15.40–15.50 E, 43.40–43.50 N. Penisola: 15.80–16.30 E, 43.60–43.70 N.
const T15 = {
  id: '43_15',
  bounds: [15, 43, 16, 44],
  kind: 'mixed',
  polygons: [
    [[[15.4, 43.4], [15.5, 43.4], [15.5, 43.5], [15.4, 43.5], [15.4, 43.4]]],
    [[[15.8, 43.6], [16, 43.6], [16, 43.7], [15.8, 43.7], [15.8, 43.6]]],
  ],
};
const T16 = {
  id: '43_16',
  bounds: [16, 43, 17, 44],
  kind: 'mixed',
  polygons: [[[[16, 43.6], [16.3, 43.6], [16.3, 43.7], [16, 43.7], [16, 43.6]]]],
};

function index() {
  const ix = createLandIndex();
  ix.addTile(T15);
  ix.addTile(T16);
  return ix;
}

test('punto in terra e in mare', () => {
  const ix = index();
  assert.equal(ix.isLand(43.45, 15.45), true);
  assert.equal(ix.isLand(43.45, 15.55), false);
  assert.equal(ix.isLand(43.65, 15.99), true);
  assert.equal(ix.isLand(43.65, 16.01), true);
  assert.equal(ix.isLand(43.65, 16.31), false);
  assert.equal(ix.isLand(43.2, 15.2), false);
  assert.equal(ix.isLand(42.5, 15.5), false); // fuori dai tasselli caricati
});

test('i lati sul bordo dei tasselli non sono costa', () => {
  const ix = index();
  // Isola: 4 lati; penisola: 3 + 3 (il lato a lon 16 è artificiale in entrambi i tasselli).
  assert.equal(ix.coastSegments(), 4 + 3 + 3);
  // Un segmento interamente sulla terra della penisola attraversa lon 16: non tocca costa ma è a terra.
  assert.equal(ix.segmentHitsLand(43.65, 15.95, 43.65, 16.05), true);
});

test('attraversamento della costa', () => {
  const ix = index();
  assert.equal(ix.segmentHitsLand(43.45, 15.3, 43.45, 15.6), true); // attraversa l'isola
  assert.equal(ix.segmentHitsLand(43.35, 15.3, 43.35, 15.6), false); // passa a sud
  assert.equal(ix.segmentHitsLand(43.38, 15.45, 43.42, 15.45), true); // entra nell'isola
  assert.equal(ix.segmentHitsLand(43.55, 15.0, 43.55, 16.9), false); // tra isola e penisola
});

test('distanza dalla costa in NM', () => {
  const ix = index();
  // 0.05° di latitudine a sud dell'isola = 3 NM.
  assert.ok(Math.abs(ix.distanceToCoastNm(43.35, 15.45, 5) - 3) < 1e-6);
  assert.equal(ix.distanceToCoastNm(43.35, 15.45, 2), Infinity);
  // A est dell'isola: 0.05° di longitudine a 43.45° N.
  const expect = 0.05 * 60 * Math.cos((43.45 * Math.PI) / 180);
  assert.ok(Math.abs(ix.distanceToCoastNm(43.45, 15.55, 5) - expect) < 1e-3);
});

test('spostamento a mare del punto a terra più vicino', () => {
  const ix = index();
  const p = ix.snapToSea(43.41, 15.45, { offsetNm: 0.1 });
  assert.ok(p && p.moved);
  assert.equal(ix.isLand(p.lat, p.lon), false);
  assert.ok(p.lat < 43.4 && Math.abs(p.lon - 15.45) < 1e-9);
  assert.ok(Math.abs(p.distNm - (0.01 * 60 + 0.1)) < 1e-6);
  assert.deepEqual(ix.snapToSea(43.3, 15.45), { lat: 43.3, lon: 15.45, moved: false, distNm: 0 });
});

test('tassello tutto terra e tutto mare; lettura del GeoJSON', () => {
  const ix = createLandIndex();
  ix.addTile({ id: '45_16', bounds: [16, 45, 17, 46], kind: 'land' });
  ix.addTile({ id: '42_16', bounds: [16, 42, 17, 43], kind: 'sea' });
  assert.equal(ix.isLand(45.5, 16.5), true);
  assert.equal(ix.isLand(42.5, 16.5), false);
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: T15.polygons } }] };
  assert.equal(tilePolygons(fc).length, 2);
});

test('intersezione di segmenti', () => {
  assert.equal(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0), true);
  assert.equal(segmentsIntersect(0, 0, 1, 1, 2, 2, 3, 0), false);
  assert.equal(segmentsIntersect(0, 0, 2, 0, 1, 0, 1, 1), true); // tocca
});
