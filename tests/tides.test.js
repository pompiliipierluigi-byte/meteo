import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tideExtremes, getTide } from '../js/weather/tides.js';

const H = 3600e3;

test('alte e basse da una marea semidiurna sintetica (periodo 12.42 h)', () => {
  const t = Array.from({ length: 28 }, (_, i) => i * H);
  const lv = t.map((x) => 0.4 * Math.cos((2 * Math.PI * x) / (12.42 * H)));
  const e = tideExtremes(t, lv);
  assert.deepEqual(e.map((x) => x.kind), ['low', 'high', 'low', 'high']);
  // Bassa al semiperiodo (6.21 h), alta a 12.42 h: errore della parabola < 5 min, livello < 1 cm.
  assert.ok(Math.abs(e[0].t - 6.21 * H) < 5 * 60e3);
  assert.ok(Math.abs(e[1].t - 12.42 * H) < 5 * 60e3);
  assert.ok(Math.abs(e[1].levelM - 0.4) < 0.01);
});

test('rumore piccolo ignorato, buchi nei dati tollerati', () => {
  const t = Array.from({ length: 8 }, (_, i) => i * H);
  assert.deepEqual(tideExtremes(t, [0, 0.01, 0, 0.01, 0, 0.3, 0, NaN]).map((x) => x.kind), ['high']);
});

test('cache locale prima della rete', async () => {
  const mem = new Map();
  const storage = /** @type {any} */ ({
    getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k),
    get length() { return mem.size; }, key: (i) => [...mem.keys()][i],
  });
  let calls = 0;
  const now = Math.floor(Date.now() / H) * H;
  const fetchFn = async () => {
    calls++;
    return new Response(JSON.stringify({ hourly: { time: [0, 1, 2].map((k) => (now + k * H) / 1000), sea_level_height_msl: [0.1, null, -0.2] } }), { status: 200 });
  };
  const a = await getTide(42.75, 13.97, { fetchFn, storage });
  assert.equal(a.levelsM[0], 0.1);
  assert.ok(Number.isNaN(a.levelsM[1]));
  const b = await getTide(42.76, 13.97, { fetchFn, storage });
  assert.equal(calls, 1);
  assert.ok(Number.isNaN(b.levelsM[1]));
});
