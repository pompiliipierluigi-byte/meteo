import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartTws, curvePoints, polarChartSvg } from '../js/ui/polar-chart.js';
import { DEFAULT_CORRECTIONS } from '../js/boats/polar.js';

const P = { version: 1, tws: [6, 10, 16], twa: [52, 90, 150], bsp: [[5, 6.5, 7.2], [5.8, 7.4, 8], [4.6, 6.4, 7.8]] };

test('TWS scelti per il diagramma', () => {
  assert.deepEqual(chartTws([6, 8, 10]), [6, 8, 10]);
  assert.deepEqual(chartTws([4, 6, 8, 10, 12, 14, 16, 20, 24], 5), [4, 8, 12, 16, 24]);
});

test('punti della curva da 0 a 180°', () => {
  const pts = curvePoints((a) => a / 10, 30);
  assert.deepEqual(pts.map((p) => p[0]), [0, 30, 60, 90, 120, 150, 180]);
  assert.equal(pts[3][1], 9);
});

test('SVG: una curva full e una vele bianche per TWS; i correttivi cambiano il disegno', () => {
  const svg = polarChartSvg({ full: P }, DEFAULT_CORRECTIONS);
  assert.ok(svg.startsWith('<svg'));
  assert.equal((svg.match(/<path d="M[^"]+" fill="none" stroke="[^"]+" stroke-width="1.5" stroke-dasharray/g) ?? []).length, 3);
  assert.equal((svg.match(/<path d="M[^"]+" fill="none" stroke="[^"]+" stroke-width="2"\/>/g) ?? []).length, 3);
  const other = polarChartSvg({ full: P }, { ...DEFAULT_CORRECTIONS, white_downwind_pct: 50, whiteDownwindPct: 90 });
  assert.notEqual(svg, other);
  assert.ok(!polarChartSvg({ full: P }, DEFAULT_CORRECTIONS, { showWhite: false }).includes('stroke-dasharray'));
});
