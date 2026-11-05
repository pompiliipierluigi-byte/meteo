import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../js/weather/rate-limit.js';
import { fetchPoints, requestWeight, WAVE_VARS } from '../js/weather/openmeteo.js';

/** Orologio finto: sleep fa avanzare il tempo. */
function fakeClock() {
  let t = 0;
  const waits = [];
  return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, waits };
}

test('peso: un punto = una chiamata, ×2 oltre 10 variabili', () => {
  assert.equal(requestWeight(100, 9), 100);
  assert.equal(requestWeight(100, 11), 200);
});

test('limitatore: 800 punti in blocchi da 100 con budget 500/min → attesa dopo il quinto', async () => {
  const c = fakeClock();
  const lim = createRateLimiter({ budget: 500, windowMs: 60e3, now: c.now, sleep: c.sleep });
  const times = [];
  for (let i = 0; i < 8; i++) {
    await lim.acquire(100);
    times.push(c.now());
  }
  assert.deepEqual(times.slice(0, 5), [0, 0, 0, 0, 0]);
  assert.ok(times[5] >= 60e3);
  assert.equal(c.waits.length, 1);
});

test('fetchPoints: 429 della quota al minuto → attende e riprova lo stesso blocco', async () => {
  const c = fakeClock();
  const lim = createRateLimiter({ budget: 500, windowMs: 60e3, now: c.now, sleep: c.sleep });
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({ error: true, reason: 'Minutely API request limit exceeded. Please try again in one minute.' }) };
    return { ok: true, json: async () => ({ hourly: { time: [0], wave_height: [1] } }) };
  };
  const waits = [];
  const r = await fetchPoints('marine', [{ lat: 43, lon: 15 }], WAVE_VARS, { fetchFn, limiter: lim, onWait: (ms) => waits.push(ms) });
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(r.series.wave_height, [[1]]);
});
