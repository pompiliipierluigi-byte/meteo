import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProfile, correctionsFor, PROFILE_DEFAULTS } from '../js/data/profile-repo.js';
import { sailSpeed } from '../js/boats/polar.js';

test('validazione profilo: limiti della SPEC, virgola decimale, null per i limiti', () => {
  assert.deepEqual(cleanProfile({ upwind_eff_pct: '75,5', limit_tws_kn: '' }).value, { upwind_eff_pct: 75.5, limit_tws_kn: null });
  assert.ok(cleanProfile({ upwind_eff_pct: 25 }).errors.length === 1);
  assert.ok(cleanProfile({ white_downwind_pct: 120 }).errors.length === 1);
  assert.ok(cleanProfile({ motor_threshold_kn: 11 }).errors.length === 1);
  assert.ok(cleanProfile({ coast_margin_nm: '' }).errors.length === 1);
  assert.ok(cleanProfile({ motor_mode: 'vela' }).errors.length === 1);
  assert.deepEqual(cleanProfile({ motor_mode: 'speed', motor_near_land: 1 }).value, { motor_mode: 'speed', motor_near_land: true });
  assert.deepEqual(cleanProfile(PROFILE_DEFAULTS).errors, []);
});

test('correttivi dal profilo: con i default ORC 80 % e vele bianche 40 %', () => {
  const p = { ...PROFILE_DEFAULTS };
  const polar = { version: 1, tws: [10], twa: [52, 90, 150], bsp: [[6], [7], [6.5]] };
  const c = correctionsFor(/** @type {any} */ (p), { apply_efficiency: true });
  assert.ok(Math.abs(sailSpeed({ full: polar }, 'full', 90, 10, c) - 5.6) < 1e-9);
  assert.ok(Math.abs(sailSpeed({ full: polar }, 'white', 150, 10, c) - 2.6) < 1e-9);
  const manual = correctionsFor(/** @type {any} */ (p), { apply_efficiency: false });
  assert.ok(Math.abs(sailSpeed({ full: polar }, 'full', 90, 10, manual) - 7) < 1e-9);
});
