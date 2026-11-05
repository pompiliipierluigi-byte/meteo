import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRow, fromRow, packTrack, unpackTrack, createRoutesRepo } from '../js/data/routes-repo.js';
import { ValidationError } from '../js/data/boats-repo.js';

const H = 3600e3;
const T0 = Date.UTC(2026, 10, 6, 6);
const POLAR = { version: 1, tws: [6, 10], twa: [52, 90], bsp: [[5, 6], [6, 7]] };
const pt = (k, extra = {}) => ({
  t: T0 + k * H, lat: 43.6 + k * 0.1, lon: 13.5 + k * 0.2, heading: 80, bsp: 6.123, cog: 81.4, sog: 6.3, tws: 12.34, twd: 320,
  twa: -120.4, gust: 16.8, wave_h: NaN, wave_dir: NaN, wave_per: NaN, cur_kn: 0.2, cur_dir: 140, motor: false,
  dist_land_nm: Infinity, warn: [], leg: 0, ...extra,
});
const track = [pt(0), pt(1, { motor: true, warn: ['coast'] }), pt(2)];
const summary = { departure_ms: T0, arrival_ms: T0 + 2 * H, duration_h: 2, distance_nm: 24.4567, motor_h: 1, beat_h: 0, max_tws_kn: 12.34, max_gust_kn: 16.8, max_wave_m: 0, warnings: ['coast'] };
const request = {
  route: [{ lat: 43.6, lon: 13.5 }, { lat: 43.7, lon: 13.9 }, { lat: 43.8, lon: 13.9 }],
  departMs: T0,
  polars: { full: POLAR, white: null },
  sails: 'white',
  corrections: { upwindEffPct: 80, downwindEffPct: 80, whiteDownwindPct: 50, splitTwaDeg: 90, applyEfficiency: true },
  motor: { mode: 'vmg', thresholdKn: 3, speedKn: 6, nearLand: false, nearLandNm: 0.5 },
  limits: { twsKn: 25, gustKn: null, waveM: null },
  coastMarginNm: 0.3, coastWarningNm: 1, waveWarningM: 2, keepIsochrones: false,
};
const toSave = {
  name: ' Ancona → Zara ', boatId: 'b1', boatName: 'Ali', route: request.route, model: 'auto',
  runs: { icon2i: T0 - 6 * H, ecmwf: T0 - 12 * H }, request, track, summary,
  window: { departures: [T0, T0 + H], runs: [{ departMs: T0, track, summary }, { departMs: T0 + H, error: { code: 'notfound', message: 'x' } }], selected: 0, limits: request.limits, waveWarningM: 2 },
};

test('riga da salvare: campi, copia di polare e parametri, finestra senza tracce', () => {
  const r = toRow(/** @type {any} */ (toSave));
  assert.equal(r.name, 'Ancona → Zara');
  assert.deepEqual(r.waypoints, [{ lat: 43.7, lon: 13.9 }]);
  assert.equal(r.polar_kind, 'white');
  assert.equal(r.forecast_run_at, new Date(T0 - 12 * H).toISOString());
  assert.deepEqual(r.params.polars.full, POLAR);
  assert.equal(r.params.boatName, 'Ali');
  assert.equal(r.params.route, undefined);
  assert.equal(r.distance_nm, 24.46);
  assert.equal(r.departure_window.runs[0].track, undefined);
  assert.equal(r.departure_window.runs[0].summary.duration_h, 2);
  assert.equal(r.departure_window.runs[1].error.code, 'notfound');
  // Serializzabile in JSON (niente NaN/Infinito nella traccia).
  assert.ok(!JSON.stringify(r).includes('NaN'));
  assert.equal(JSON.parse(JSON.stringify(r)).track[0].dist_land_nm, null);
});

test('riapertura identica: traccia, riepilogo e punti', () => {
  const row = { id: 'r1', created_at: 'x', ...JSON.parse(JSON.stringify(toRow(/** @type {any} */ (toSave)))) };
  const s = fromRow(row);
  assert.deepEqual(s.route, request.route);
  assert.equal(s.departMs, T0);
  assert.equal(s.track.length, 3);
  assert.equal(s.track[1].motor, true);
  assert.deepEqual(s.track[1].warn, ['coast']);
  assert.ok(Number.isNaN(s.track[0].wave_h));
  assert.equal(s.track[0].dist_land_nm, Infinity);
  assert.equal(s.track[0].bsp, 6.123);
  assert.equal(s.summary.duration_h, 2);
  assert.deepEqual(s.summary.warnings, ['coast']);
  assert.equal(s.params.sails, 'white');
  assert.equal(s.window.runs.length, 2);
});

test('pack/unpack della traccia conservano la struttura', () => {
  const back = unpackTrack(JSON.parse(JSON.stringify(packTrack(track))));
  assert.deepEqual(Object.keys(back[0]).sort(), Object.keys(track[0]).sort());
  assert.equal(back[2].lat, track[2].lat);
});

test('validazione: nome e rotta calcolata obbligatori, nessuna chiamata al server', async () => {
  assert.throws(() => toRow(/** @type {any} */ ({ ...toSave, name: '  ' })), ValidationError);
  assert.throws(() => toRow(/** @type {any} */ ({ ...toSave, track: [] })), ValidationError);
  let calls = 0;
  const repo = createRoutesRepo(async () => { calls++; return {}; });
  await assert.rejects(repo.save(/** @type {any} */ ({ ...toSave, name: '' })), ValidationError);
  assert.equal(calls, 0);
});

test('salvataggio: insert su routes e id restituito', async () => {
  const seen = [];
  const client = {
    from(table) {
      const q = { table };
      const api = {
        insert(p) { q.op = 'insert'; q.payload = p; return api; },
        select() { return api; },
        single() { return api; },
        then(res) { seen.push(q); return Promise.resolve({ data: { id: 'new' }, error: null }).then(res); },
      };
      return api;
    },
  };
  const id = await createRoutesRepo(async () => client).save(/** @type {any} */ (toSave));
  assert.equal(id, 'new');
  assert.equal(seen[0].table, 'routes');
  assert.equal(seen[0].payload.boat_id, 'b1');
});
