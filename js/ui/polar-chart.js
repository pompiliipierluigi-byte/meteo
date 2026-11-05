// Diagramma polare in SVG: una curva per TWS, polare full (linea piena) e vele bianche (tratteggio),
// con i correttivi applicati (SPEC §2.5). Il calcolo dei punti è puro; il disegno produce una stringa SVG.

import { sailSpeed } from '../boats/polar.js';

/** Colori delle curve (distinguibili anche su schermi piccoli). */
const PALETTE = ['#1f77b4', '#2ca02c', '#d4a017', '#ff7f0e', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf'];

/**
 * TWS da disegnare: quelli della tabella, al massimo `max` scelti in modo uniforme.
 * @param {number[]} tws
 * @param {number} max
 */
export function chartTws(tws, max = 6) {
  if (tws.length <= max) return [...tws];
  const out = [];
  for (let k = 0; k < max; k++) out.push(tws[Math.round((k * (tws.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

/**
 * Punti di una curva: velocità per TWA da 0 a 180° (passo `step`).
 * @param {(twa: number) => number} speedAt
 * @param {number} [step]
 * @returns {[number, number][]} [twa, velocità]
 */
export function curvePoints(speedAt, step = 2) {
  const pts = [];
  for (let twa = 0; twa <= 180; twa += step) pts.push([twa, Math.max(0, speedAt(twa))]);
  return pts;
}

/**
 * Velocità massima arrotondata per la scala radiale.
 * @param {number} v
 */
function niceMax(v) {
  const s = v <= 4 ? 1 : v <= 10 ? 2 : v <= 20 ? 4 : 5;
  return Math.max(s, Math.ceil(v / s) * s);
}

/**
 * SVG del diagramma.
 * @param {{full: import('../boats/polar.js').Polar, white?: import('../boats/polar.js').Polar | null}} polars
 * @param {import('../boats/polar.js').Corrections} corrections
 * @param {{showWhite?: boolean, labels?: {kn: string, full: string, white: string, tws: string}}} [opts]
 * @returns {string}
 */
export function polarChartSvg(polars, corrections, opts = {}) {
  const labels = opts.labels ?? { kn: 'kn', full: 'full', white: 'vele bianche', tws: 'TWS' };
  const showWhite = opts.showWhite ?? true;
  const twsList = chartTws(polars.full.tws);
  const curves = twsList.map((tws, k) => ({
    tws,
    color: PALETTE[k % PALETTE.length],
    full: curvePoints((a) => sailSpeed(polars, 'full', a, tws, corrections)),
    white: showWhite ? curvePoints((a) => sailSpeed(polars, 'white', a, tws, corrections)) : null,
  }));
  const vmax = niceMax(Math.max(1, ...curves.flatMap((c) => c.full.map((p) => p[1])), ...curves.flatMap((c) => (c.white ?? []).map((p) => p[1]))));

  // Mezzo diagramma a destra: centro a sinistra, 0° in alto, 180° in basso.
  const R = 140;
  const cx = 24;
  const cy = R + 16;
  const W = cx + R + 100;
  const H = 2 * R + 32;
  const xy = (twa, v) => {
    const r = (v / vmax) * R;
    const a = (twa * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const f = (n) => n.toFixed(1);
  const path = (pts) => pts.map(([a, v], i) => {
    const [x, y] = xy(a, v);
    return `${i ? 'L' : 'M'}${f(x)},${f(y)}`;
  }).join('');

  const parts = [];
  // Anelli di velocità.
  const ringStep = vmax <= 4 ? 1 : vmax <= 10 ? 2 : vmax <= 20 ? 4 : 5;
  for (let v = ringStep; v <= vmax + 1e-9; v += ringStep) {
    const r = (v / vmax) * R;
    parts.push(`<path d="M${f(cx)},${f(cy - r)} A${f(r)},${f(r)} 0 0 1 ${f(cx)},${f(cy + r)}" class="pc-grid"/>`);
    parts.push(`<text x="${f(cx + 3)}" y="${f(cy - r + 10)}" class="pc-label">${v}</text>`);
  }
  // Raggi ogni 30°.
  for (let a = 0; a <= 180; a += 30) {
    const [x, y] = xy(a, vmax);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" class="pc-grid"/>`);
    const [lx, ly] = xy(a, vmax * 1.07);
    parts.push(`<text x="${f(lx)}" y="${f(ly + 3)}" class="pc-label" text-anchor="middle">${a}°</text>`);
  }
  parts.push(`<text x="${f(cx + 3)}" y="${f(cy + 12)}" class="pc-label">${labels.kn}</text>`);
  // Curve.
  for (const c of curves) {
    if (c.white) parts.push(`<path d="${path(c.white)}" fill="none" stroke="${c.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="${path(c.full)}" fill="none" stroke="${c.color}" stroke-width="2"/>`);
  }
  // Legenda.
  let ly = 18;
  parts.push(`<text x="${W - 88}" y="${ly}" class="pc-label pc-bold">${labels.tws}</text>`);
  for (const c of curves) {
    ly += 14;
    parts.push(`<line x1="${W - 88}" y1="${ly - 4}" x2="${W - 72}" y2="${ly - 4}" stroke="${c.color}" stroke-width="2"/>`);
    parts.push(`<text x="${W - 68}" y="${ly}" class="pc-label">${c.tws} ${labels.kn}</text>`);
  }
  if (showWhite) {
    ly += 20;
    parts.push(`<line x1="${W - 88}" y1="${ly - 4}" x2="${W - 72}" y2="${ly - 4}" stroke="#555" stroke-width="2"/>`);
    parts.push(`<text x="${W - 68}" y="${ly}" class="pc-label">${labels.full}</text>`);
    ly += 14;
    parts.push(`<line x1="${W - 88}" y1="${ly - 4}" x2="${W - 72}" y2="${ly - 4}" stroke="#555" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${W - 68}" y="${ly}" class="pc-label">${labels.white}</text>`);
  }
  return `<svg class="polar-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagramma polare" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/**
 * Elemento DOM con il diagramma.
 * @param {Parameters<typeof polarChartSvg>[0]} polars
 * @param {Parameters<typeof polarChartSvg>[1]} corrections
 * @param {Parameters<typeof polarChartSvg>[2]} [opts]
 * @returns {HTMLElement}
 */
export function polarChart(polars, corrections, opts) {
  const div = document.createElement('div');
  div.className = 'polar-chart-box';
  div.innerHTML = polarChartSvg(polars, corrections, opts);
  return div;
}
