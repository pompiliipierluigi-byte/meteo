import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedLatestRunMs, cacheDecision, MIN_RECHECK_MS } from '../js/weather/cache.js';
import { fetchLastRunMs, metaUrl } from '../js/weather/openmeteo.js';

const T = (iso) => Date.parse(iso);

test('run atteso: ultimo run pubblicato tenendo conto del ritardo', () => {
  const h = [0, 6, 12, 18];
  assert.equal(expectedLatestRunMs(T('2026-11-04T13:00Z'), h, 7), T('2026-11-04T06:00Z'));
  assert.equal(expectedLatestRunMs(T('2026-11-04T19:00Z'), h, 7), T('2026-11-04T12:00Z'));
  // Prima della pubblicazione del run delle 00 → run delle 18 del giorno prima.
  assert.equal(expectedLatestRunMs(T('2026-11-04T03:00Z'), h, 7), T('2026-11-03T18:00Z'));
  assert.equal(expectedLatestRunMs(T('2026-11-04T03:00Z'), [0, 12], 4), T('2026-11-03T12:00Z'));
});

test('decisione di cache', () => {
  const cfg = { runHoursUtc: [0, 12], availDelayH: 4 };
  const now = T('2026-11-04T17:00Z');
  assert.equal(cacheDecision(null, now, cfg), 'fetch');
  assert.equal(cacheDecision({ runMs: T('2026-11-04T12:00Z'), checkedMs: 0 }, now, cfg), 'fresh');
  assert.equal(cacheDecision({ runMs: T('2026-11-04T00:00Z'), checkedMs: now - MIN_RECHECK_MS - 1 }, now, cfg), 'check');
  assert.equal(cacheDecision({ runMs: T('2026-11-04T00:00Z'), checkedMs: now - 60e3 }, now, cfg), 'fresh');
});

test('meta.json: URL e lettura del run', async () => {
  assert.equal(metaUrl('forecast', 'ecmwf_ifs'), 'https://api.open-meteo.com/data/ecmwf_ifs/static/meta.json');
  assert.equal(metaUrl('marine', 'meteofrance_wave'), 'https://marine-api.open-meteo.com/data/meteofrance_wave/static/meta.json');
  const fetchFn = async () => ({ ok: true, json: async () => ({ last_run_initialisation_time: 1762214400 }) });
  assert.equal(await fetchLastRunMs('forecast', 'x', { fetchFn }), 1762214400000);
});
