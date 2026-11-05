import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, parseResponse, fetchPoints, windField, waveField, WIND_VARS, WAVE_VARS } from '../js/weather/openmeteo.js';
import { makeGrid, sample, uvToWind } from '../js/weather/grid.js';

test('URL forecast multi-punto', () => {
  const url = buildUrl('forecast', [{ lat: 43.5, lon: 14 }, { lat: 44, lon: 15.25 }], WIND_VARS, { model: 'ecmwf_ifs' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(u.searchParams.get('latitude'), '43.5,44');
  assert.equal(u.searchParams.get('longitude'), '14,15.25');
  assert.equal(u.searchParams.get('hourly'), 'wind_speed_10m,wind_direction_10m,wind_gusts_10m');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'kn');
  assert.equal(u.searchParams.get('timezone'), 'GMT');
  assert.equal(u.searchParams.get('models'), 'ecmwf_ifs');
  assert.ok(url.includes('latitude=43.5,44'));
});

test('URL marine senza unità vento né modello', () => {
  const u = new URL(buildUrl('marine', [{ lat: 43, lon: 15 }], WAVE_VARS));
  assert.equal(u.hostname, 'marine-api.open-meteo.com');
  assert.equal(u.searchParams.get('wind_speed_unit'), null);
  assert.equal(u.searchParams.get('models'), null);
});

test('parseResponse: singolo oggetto e array; errore API', () => {
  const one = { hourly: { time: [0, 3600], wind_speed_10m: [1, 2] } };
  const r = parseResponse(one, ['wind_speed_10m', 'wind_gusts_10m']);
  assert.deepEqual(r.timesMs, [0, 3600000]);
  assert.deepEqual(r.series.wind_speed_10m, [[1, 2]]);
  assert.deepEqual(r.series.wind_gusts_10m, [[null, null]]);
  assert.equal(parseResponse([one, one], ['wind_speed_10m']).series.wind_speed_10m.length, 2);
  assert.throws(() => parseResponse({ error: true, reason: 'x' }, []), /x/);
});

test('fetchPoints divide in blocchi e ricompone l’ordine; campo vento coerente', async () => {
  const g = makeGrid({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 149 }, 1, 't');
  const points = Array.from({ length: 150 }, (_, i) => ({ lat: 0, lon: i }));
  const calls = [];
  const fetchFn = async (url) => {
    const u = new URL(url);
    const lons = u.searchParams.get('longitude').split(',').map(Number);
    calls.push(lons.length);
    const body = lons.map((lon) => ({
      hourly: { time: [0, 3600], wind_speed_10m: [lon, lon], wind_direction_10m: [270, 270], wind_gusts_10m: [lon + 5, null] },
    }));
    return { ok: true, json: async () => (body.length === 1 ? body[0] : body) };
  };
  const data = await fetchPoints('forecast', points, WIND_VARS, { fetchFn });
  assert.deepEqual(calls, [100, 50]);
  const f = windField(g, points.map((_, i) => i), data);
  const u = sample(f, 'u', 0, 120, 0);
  const v = sample(f, 'v', 0, 120, 0);
  const w = uvToWind(u, v);
  assert.ok(Math.abs(w.speed - 120) < 1e-3);
  assert.ok(Math.abs(w.fromDeg - 270) < 1e-3);
  assert.equal(sample(f, 'gust', 0, 120, 0), 125);
  assert.ok(Number.isNaN(f.vars.gust[150 + 120]));
});

test('fetchPoints: errore HTTP con quota', async () => {
  const fetchFn = async () => ({ ok: false, status: 429, json: async () => ({ reason: 'Daily limit' }) });
  await assert.rejects(fetchPoints('marine', [{ lat: 0, lon: 0 }], WAVE_VARS, { fetchFn }), (e) => e.quota && /Daily limit/.test(e.message));
});

test('campo onda: altezza, periodo e versore di provenienza', () => {
  const g = makeGrid({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 }, 1, 't');
  const s = (x) => [[x]];
  const data = {
    timesMs: [0],
    series: Object.fromEntries(WAVE_VARS.map((v) => [v, v.endsWith('direction') ? s(90) : v.endsWith('height') ? s(1.5) : s(null)])),
  };
  const f = waveField(g, [0], data);
  assert.equal(f.vars.wave_h[0], 1.5);
  assert.ok(Number.isNaN(f.vars.swell_per[0]));
  assert.ok(Math.abs(f.vars.wwave_dx[0] - 1) < 1e-6);
});
