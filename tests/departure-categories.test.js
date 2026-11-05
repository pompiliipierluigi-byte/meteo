import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, lazyScore, overLimits } from '../js/routing/departure-categories.js';

/** @param {Partial<import('../js/routing/departure-categories.js').RunSummary>} s */
const run = (s) => ({ summary: { duration_h: 20, distance_nm: 120, motor_h: 2, beat_h: 5, max_tws_kn: 15, max_gust_kn: 20, max_wave_m: 1, ...s } });
const NO_LIMITS = { twsKn: null, gustKn: null, waveM: null };

test('set di prova: ogni categoria alla partenza giusta, più categorie sulla stessa partenza', () => {
  const runs = [
    run({}),
    run({ duration_h: 16 }), // Speedy
    run({ distance_nm: 110, duration_h: 18 }), // Shorty
    run({ motor_h: 0, duration_h: 22 }), // Windy (motore 0)
    run({ motor_h: 0, duration_h: 21, beat_h: 0, max_wave_m: 0.4 }), // Windy a parità di motore (durata minore) e Lazy
    { error: { code: 'notfound', message: 'x' } },
    undefined,
  ];
  const { runs: c, best } = categorize(runs, { limits: NO_LIMITS, waveWarningM: 2 });
  assert.deepEqual(best, { speedy: 1, shorty: 2, windy: 4, lazy: 4 });
  assert.deepEqual(c[4].categories, ['windy', 'lazy']);
  assert.deepEqual(c[0].categories, []);
  assert.equal(c[5].status, 'notfound');
  assert.equal(c[6].status, 'notfound');
});

test('fuori limite: escluso dalle categorie', () => {
  const runs = [run({ duration_h: 10, max_tws_kn: 32 }), run({ duration_h: 12, max_wave_m: 2.6 }), run({ duration_h: 14 })];
  const { runs: c, best } = categorize(runs, { limits: { twsKn: 30, gustKn: null, waveM: 2.5 }, waveWarningM: 2 });
  assert.equal(c[0].status, 'limit');
  assert.deepEqual(c[0].over, ['tws']);
  assert.deepEqual(c[1].over, ['wave']);
  assert.equal(best.speedy, 2);
  assert.deepEqual(c[2].categories, ['speedy', 'shorty', 'windy', 'lazy']);
});

test('a parità vince la partenza più vicina; nessun run valido → nessuna categoria', () => {
  const { best } = categorize([run({}), run({})]);
  assert.equal(best.speedy, 0);
  const none = categorize([{ error: {} }, run({ max_gust_kn: 40 })], { limits: { twsKn: null, gustKn: 35, waveM: null } });
  assert.deepEqual(none.best, { speedy: null, shorty: null, windy: null, lazy: null });
});

test('punteggio Lazy: bolina sulla durata + onda su onda di avviso', () => {
  assert.equal(lazyScore(run({ beat_h: 10, duration_h: 20, max_wave_m: 1 }).summary, 2), 1);
  assert.equal(lazyScore(run({ beat_h: 0, max_wave_m: 0 }).summary, 2), 0);
  assert.deepEqual(overLimits(run({}).summary, NO_LIMITS), []);
});
