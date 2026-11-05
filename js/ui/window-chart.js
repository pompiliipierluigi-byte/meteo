// Grafico SVG della finestra di partenza (SPEC §2.7), scritto a mano: una colonna per partenza.
// In alto: durata (barra) con la parte a motore; sopra la barra i segni delle categorie.
// In basso: vento max, raffica max (kn, scala a sinistra) e onda max (m, scala a destra).
// Tocco su una colonna → onSelect(indice).

import { localHour } from '../lib/format.js';

const NS = 'http://www.w3.org/2000/svg';

/** Colori (coerenti con la rotta sulla mappa). */
export const CHART_COLORS = {
  sail: '#0b6e4f',
  motor: '#7a3fb0',
  wind: '#1c5d99',
  gust: '#e8590c',
  wave: '#138a9e',
  limit: '#9aa5b1',
  selected: 'rgba(255, 196, 61, 0.35)',
  categories: { speedy: '#d6336c', shorty: '#f59f00', windy: '#1c7ed6', lazy: '#2f9e44' },
};

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {string} [text]
 */
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Massimo "rotondo" per l'asse.
 * @param {number} v
 * @param {number} step
 */
export function niceMax(v, step) {
  return Math.max(step, Math.ceil((v * 1.05) / step) * step);
}

/**
 * @param {Object} o
 * @param {number[]} o.departures ms UTC
 * @param {(import('../routing/departure-window.js').WindowRun | undefined)[]} o.runs
 * @param {(import('../routing/departure-categories.js').RunClass)[] | null} o.classes null finché la finestra non è completa
 * @param {number | null} o.selected
 * @param {(i: number) => void} o.onSelect
 * @param {{h: string, kn: string, m: string, notFound: string, limit: string, pending: string, categories: Record<string, string>}} o.labels
 * @returns {SVGSVGElement}
 */
export function windowChart(o) {
  const n = o.departures.length;
  const left = 26;
  const right = 24;
  const colW = 13;
  const W = left + n * colW + right;
  const topY = 26; // spazio per i segni delle categorie
  const durH = 96;
  const durBase = topY + durH;
  const lineTop = durBase + 22;
  const lineH = 56;
  const lineBase = lineTop + lineH;
  const H = lineBase + 18;

  // Array.from: `runs` può avere buchi (run non ancora arrivati).
  const ok = Array.from({ length: n }, (_, i) => o.runs[i]?.summary ?? null);
  const maxDur = niceMax(Math.max(1, ...ok.map((s) => s?.duration_h ?? 0)), 6);
  const maxKn = niceMax(Math.max(10, ...ok.map((s) => Math.max(s?.max_tws_kn ?? 0, s?.max_gust_kn ?? 0))), 10);
  const maxM = niceMax(Math.max(1, ...ok.map((s) => s?.max_wave_m ?? 0)), 1);
  const x = (i) => left + i * colW + colW / 2;

  const root = /** @type {SVGSVGElement} */ (svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'window-chart', role: 'img' }));
  root.append(svg('title', {}, o.labels.title ?? ''));
  const defs = svg('defs');
  const hatch = svg('pattern', { id: 'wc-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hatch.append(svg('rect', { width: 4, height: 4, fill: '#e9edf1' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: CHART_COLORS.limit, 'stroke-width': 2 }));
  defs.append(hatch);
  root.append(defs);

  // Colonna selezionata.
  if (o.selected !== null && o.selected >= 0) {
    root.append(svg('rect', { x: left + o.selected * colW, y: 2, width: colW, height: lineBase - 2, fill: CHART_COLORS.selected, rx: 2 }));
  }

  // Assi e griglia.
  const axis = (y0, yBase, maxV, unit, side) => {
    for (const f of [0, 0.5, 1]) {
      const y = yBase - f * (yBase - y0);
      root.append(svg('line', { x1: left, x2: W - right, y1: y, y2: y, stroke: '#e3e8ee', 'stroke-width': 0.6 }));
      const v = maxV * f;
      const tx = side === 'left' ? left - 3 : W - right + 3;
      root.append(svg('text', { x: tx, y: y + 3, 'font-size': 7, fill: '#5b6878', 'text-anchor': side === 'left' ? 'end' : 'start' }, `${Number.isInteger(v) ? v : v.toFixed(1)}`));
    }
    root.append(svg('text', { x: side === 'left' ? 2 : W - 2, y: y0 - 4, 'font-size': 7, fill: '#5b6878', 'text-anchor': side === 'left' ? 'start' : 'end' }, unit));
  };
  axis(topY, durBase, maxDur, o.labels.h, 'left');
  axis(lineTop, lineBase, maxKn, o.labels.kn, 'left');
  axis(lineTop, lineBase, maxM, o.labels.m, 'right');

  // Barre della durata.
  o.departures.forEach((_, i) => {
    const r = o.runs[i];
    const c = o.classes?.[i];
    const bx = left + i * colW + 2;
    const bw = colW - 4;
    if (!r) {
      root.append(svg('rect', { x: bx, y: durBase - 6, width: bw, height: 6, fill: '#eef1f4', rx: 1 }));
      return;
    }
    if (!r.summary) {
      root.append(svg('text', { x: x(i), y: durBase - 3, 'font-size': 9, 'text-anchor': 'middle', fill: '#b3261e', 'font-weight': 700 }, '×'));
      return;
    }
    const s = r.summary;
    const h = (s.duration_h / maxDur) * durH;
    const hm = (Math.min(s.motor_h, s.duration_h) / maxDur) * durH;
    const limit = c?.status === 'limit';
    root.append(svg('rect', { x: bx, y: durBase - h, width: bw, height: h, fill: limit ? 'url(#wc-hatch)' : CHART_COLORS.sail, rx: 1 }));
    if (hm > 0.3) root.append(svg('rect', { x: bx, y: durBase - hm, width: bw, height: hm, fill: limit ? CHART_COLORS.limit : CHART_COLORS.motor, rx: 1 }));
    // Segni delle categorie sopra la barra (uno per categoria).
    (c?.categories ?? []).forEach((k, j) => {
      root.append(svg('circle', { cx: x(i), cy: durBase - h - 5 - j * 8, r: 3.4, fill: CHART_COLORS.categories[k], stroke: '#fff', 'stroke-width': 0.8 }));
    });
  });

  // Linee: vento max, raffica max, onda max.
  const line = (get, maxV, color, dash) => {
    let d = '';
    let pen = false;
    ok.forEach((s, i) => {
      const v = s ? get(s) : NaN;
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      const y = lineBase - (Math.min(v, maxV) / maxV) * lineH;
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
      root.append(svg('circle', { cx: x(i), cy: y, r: 1.4, fill: color }));
    });
    if (d) root.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.3, ...(dash ? { 'stroke-dasharray': dash } : {}) }));
  };
  line((s) => s.max_gust_kn, maxKn, CHART_COLORS.gust, '3 2');
  line((s) => s.max_tws_kn, maxKn, CHART_COLORS.wind, '');
  line((s) => (s.max_wave_m > 0 ? s.max_wave_m : NaN), maxM, CHART_COLORS.wave, '1.5 1.5');

  // Asse delle ore (locali): 00, 03, 06, …; mezzanotte in grassetto.
  o.departures.forEach((t, i) => {
    const h = localHour(t);
    if (h % 3 !== 0) return;
    root.append(svg('text', { x: x(i), y: H - 6, 'font-size': 7, 'text-anchor': 'middle', fill: '#1b2430', 'font-weight': h === 0 ? 700 : 400 }, String(h).padStart(2, '0')));
  });
  root.append(svg('line', { x1: left, x2: W - right, y1: durBase, y2: durBase, stroke: '#9aa5b1', 'stroke-width': 0.8 }));
  root.append(svg('line', { x1: left, x2: W - right, y1: lineBase, y2: lineBase, stroke: '#9aa5b1', 'stroke-width': 0.8 }));

  // Zone di tocco (tutta l'altezza della colonna).
  o.departures.forEach((_, i) => {
    const r = o.runs[i];
    const hit = svg('rect', { x: left + i * colW, y: 0, width: colW, height: H, fill: 'transparent', class: 'wc-hit', 'data-index': i });
    const tip = !r ? o.labels.pending : !r.summary ? o.labels.notFound : o.classes?.[i]?.status === 'limit' ? o.labels.limit : '';
    hit.append(svg('title', {}, tip));
    if (r) {
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', () => o.onSelect(i));
    }
    root.append(hit);
  });
  return root;
}
