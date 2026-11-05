import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoute, RouteError } from '../js/routing/isochrone.js';
import { polarBsp, optimalAngles, sailSpeed, NO_CORRECTIONS } from '../js/boats/polar.js';
import { createLandIndex } from '../js/routing/land.js';
import { destination, distanceNm, bearingDeg } from '../js/routing/geo.js';

// Polare di prova, senza correttivi.
const P = {
  version: 1,
  tws: [6, 10, 16],
  twa: [40, 52, 90, 120, 150, 180],
  bsp: [[4.2, 5.4, 6.0], [5.0, 6.5, 7.2], [5.8, 7.4, 8.0], [5.6, 7.2, 8.4], [4.6, 6.4, 7.8], [3.8, 5.6, 7.0]],
};
const speed = (twa, tws) => sailSpeed({ full: P }, 'full', twa, tws, NO_CORRECTIONS);
const H = 3600e3;

/** Vento e corrente costanti. */
const constant = (twsKn, twdDeg, curU = 0, curV = 0) => () => ({
  twsKn, twdDeg, gustKn: twsKn * 1.3, waveHeightM: 0.5, waveDirDeg: twdDeg, wavePeriodS: 4,
  curKn: Math.hypot(curU, curV), curDirDeg: 0, curU, curV,
});

const base = (over) => ({
  departMs: 0,
  sailSpeed: speed,
  maxSailKn: 8.4,
  motor: { mode: 'vmg', thresholdKn: 0, speedKn: 6, nearLand: false, nearLandNm: 0.5 },
  splitTwaDeg: 90,
  ...over,
});

/** VMG ottima di bolina/poppa con la polare (per confronto con l'ottimo teorico). */
function bestVmg(tws, upwind) {
  let best = 0;
  for (let a = 0; a <= 180; a += 0.1) {
    const v = polarBsp(P, a, tws) * Math.cos((a * Math.PI) / 180) * (upwind ? 1 : -1);
    if (v > best) best = v;
  }
  return best;
}

test('vento costante, meta controvento: durata entro il 2 % dell’ottimo (VMG di bolina)', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 0, 20);
  const r = computeRoute(base({ route: [from, to], sampler: constant(10, 0) }));
  const ideal = 20 / bestVmg(10, true);
  const err = (r.summary.duration_h - ideal) / ideal;
  assert.ok(err > -0.005 && err < 0.02, `durata ${r.summary.duration_h.toFixed(3)} h, ottimo ${ideal.toFixed(3)} h`);
  assert.ok(r.track.some((p) => p.twa > 0) && r.track.some((p) => p.twa < 0), 'bordeggio su entrambe le mure');
  assert.equal(r.summary.motor_h, 0);
  assert.ok(r.summary.beat_h > 0.9 * r.summary.duration_h);
});

test('vento costante, meta sottovento: entro il 2 % dell’ottimo (VMG di poppa)', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 180, 20);
  const r = computeRoute(base({ route: [from, to], sampler: constant(10, 0) }));
  const ideal = 20 / bestVmg(10, false);
  const err = (r.summary.duration_h - ideal) / ideal;
  assert.ok(err > -0.005 && err < 0.02, `durata ${r.summary.duration_h.toFixed(3)} h, ottimo ${ideal.toFixed(3)} h`);
});

test('traverso: rotta diretta a velocità di tabella', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 90, 15);
  const r = computeRoute(base({ route: [from, to], sampler: constant(10, 0) }));
  const ideal = 15 / 7.4;
  assert.ok(Math.abs(r.summary.duration_h - ideal) / ideal < 0.02, `${r.summary.duration_h}`);
  assert.ok(Math.abs(r.summary.distance_nm - 15) < 0.3);
});

test('corrente costante: deriva compensata come atteso (motore 6 kn, corrente 1 kn al traverso)', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 90, 12);
  // Niente vento a vela (soglia velocità altissima → sempre motore), corrente verso nord 1 kn.
  const r = computeRoute(base({
    route: [from, to],
    sampler: constant(2, 0, 0, 1),
    motor: { mode: 'speed', thresholdKn: 99, speedKn: 6, nearLand: false, nearLandNm: 0.5 },
  }));
  const ideal = 12 / Math.sqrt(36 - 1);
  assert.ok(Math.abs(r.summary.duration_h - ideal) / ideal < 0.02, `${r.summary.duration_h} vs ${ideal}`);
  assert.ok(Math.abs(r.summary.motor_h - r.summary.duration_h) < 1e-9);
  // Prua media corretta verso sud (angolo di deriva teorico ~9.6°), tempo pesato sui passi.
  let hs = 0;
  let ts = 0;
  for (let i = 0; i + 1 < r.track.length; i++) {
    const dt = r.track[i + 1].t - r.track[i].t;
    hs += r.track[i].heading * dt;
    ts += dt;
  }
  const mean = hs / ts;
  assert.ok(mean > 95 && mean < 105, `prua media ${mean}`);
});

test('isola sulla rotta: la traccia la aggira e non tocca terra', () => {
  const from = { lat: 43.5, lon: 15.0 };
  const to = { lat: 43.5, lon: 15.6 };
  const land = createLandIndex();
  land.addTile({ id: '43_15', bounds: [15, 43, 16, 44], kind: 'mixed', polygons: [[[[15.25, 43.45], [15.35, 43.45], [15.35, 43.55], [15.25, 43.55], [15.25, 43.45]]]] });
  const r = computeRoute(base({ route: [from, to], sampler: constant(10, 0), land, coastMarginNm: 0.3, coastWarningNm: 1 }));
  for (let i = 0; i + 1 < r.track.length; i++) {
    const a = r.track[i];
    const b = r.track[i + 1];
    assert.equal(land.segmentHitsLand(a.lat, a.lon, b.lat, b.lon), false, `tratto ${i} a terra`);
  }
  assert.ok(r.summary.distance_nm > distanceNm(from.lat, from.lon, to.lat, to.lon) + 0.5);
  assert.ok(r.summary.warnings.includes('coast'));
});

test('waypoint: la rotta passa per ciascuno nell’ordine dato', () => {
  const a = { lat: 43.0, lon: 15.0 };
  const w = { lat: 43.1, lon: 15.2 };
  const b = { lat: 43.0, lon: 15.4 };
  const r = computeRoute(base({ route: [a, w, b], sampler: constant(10, 0) }));
  const iw = r.track.findIndex((p) => Math.abs(p.lat - w.lat) < 1e-9 && Math.abs(p.lon - w.lon) < 1e-9);
  assert.ok(iw > 0 && iw < r.track.length - 1);
  assert.deepEqual([r.track[0].lat, r.track[0].lon], [a.lat, a.lon]);
  const last = r.track[r.track.length - 1];
  assert.deepEqual([last.lat, last.lon], [b.lat, b.lon]);
  assert.ok(r.track.slice(0, iw).every((p) => p.leg === 0) && r.track.slice(iw + 1).every((p) => p.leg === 1));
});

test('limiti: zona oltre il vento massimo evitata; senza via d’uscita → errore', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 90, 10);
  const windy = (lat, lon) => {
    const strong = lat < 43.05 && lon > 15.05 && lon < 15.15;
    return { ...constant(strong ? 30 : 10, 0)() };
  };
  const r = computeRoute(base({ route: [from, to], sampler: windy, limits: { twsKn: 25, gustKn: null, waveM: null } }));
  assert.ok(r.track.every((p) => p.tws <= 25));
  assert.throws(() => computeRoute(base({ route: [from, to], sampler: constant(30, 0), limits: { twsKn: 25, gustKn: null, waveM: null } })), RouteError);
});

test('regola motore VMG: controvento con VMG sotto soglia si va a motore', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 0, 6);
  const vmg = bestVmg(6, true); // ~3.7 kn
  const r = computeRoute(base({ route: [from, to], sampler: constant(6, 0), motor: { mode: 'vmg', thresholdKn: vmg + 0.5, speedKn: 6, nearLand: false, nearLandNm: 0.5 } }));
  assert.ok(r.summary.motor_h > 0.9 * r.summary.duration_h);
  assert.ok(Math.abs(r.summary.duration_h - 1) < 0.03);
  const sail = computeRoute(base({ route: [from, to], sampler: constant(6, 0), motor: { mode: 'vmg', thresholdKn: vmg - 0.5, speedKn: 6, nearLand: false, nearLandNm: 0.5 } }));
  assert.equal(sail.summary.motor_h, 0);
});

test('annullamento', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = destination(from.lat, from.lon, 0, 20);
  assert.throws(() => computeRoute(base({ route: [from, to], sampler: constant(10, 0), isCancelled: () => true })), (e) => e.code === 'cancelled');
});

test('riepilogo coerente con la tabella dei passi', () => {
  const from = { lat: 43.0, lon: 15.0 };
  const to = { lat: 43.3, lon: 15.4 };
  const r = computeRoute(base({ route: [from, to], sampler: constant(12, 200) }));
  const s = r.summary;
  assert.ok(Math.abs(s.duration_h - (r.track.at(-1).t - r.track[0].t) / H) < 1e-9);
  let d = 0;
  for (let i = 0; i + 1 < r.track.length; i++) d += distanceNm(r.track[i].lat, r.track[i].lon, r.track[i + 1].lat, r.track[i + 1].lon);
  assert.ok(Math.abs(d - s.distance_nm) < 1e-9);
  assert.equal(s.max_tws_kn, 12);
  assert.ok(Math.abs(bearingDeg(from.lat, from.lon, to.lat, to.lon) - 43) < 5);
});
