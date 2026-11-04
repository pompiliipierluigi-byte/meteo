// Scale di colore per vento (nodi) e onda (metri). Modulo puro.

/** @typedef {[number, [number, number, number]]} ColorStop valore, RGB */

/** Scala vento: 0–5–10–15–20–25–30–35+ kn (SPEC §2.2). @type {ColorStop[]} */
export const WIND_STOPS = [
  [0, [150, 190, 235]],
  [5, [70, 150, 220]],
  [10, [50, 185, 130]],
  [15, [225, 210, 50]],
  [20, [245, 150, 40]],
  [25, [225, 60, 45]],
  [30, [190, 40, 125]],
  [35, [115, 40, 150]],
];

/** Scala onda: 0–0.5–1–1.5–2–3–4+ m (SPEC §2.3). @type {ColorStop[]} */
export const WAVE_STOPS = [
  [0, [205, 232, 248]],
  [0.5, [130, 200, 235]],
  [1, [60, 155, 215]],
  [1.5, [70, 185, 120]],
  [2, [235, 210, 60]],
  [3, [240, 125, 45]],
  [4, [200, 40, 70]],
];

/**
 * Colore interpolato linearmente tra le soglie (oltre l'ultima: colore dell'ultima).
 * @param {ColorStop[]} stops
 * @param {number} value
 * @returns {[number, number, number]}
 */
export function colorAt(stops, value) {
  if (!(value > stops[0][0])) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      const k = (value - v0) / (v1 - v0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Tabella di colori precalcolata (RGB impacchettati) per un accesso rapido nel rendering.
 * @param {ColorStop[]} stops
 * @param {number} step risoluzione in unità della scala
 * @returns {{lookup: (value: number) => number, rgb: (value: number) => [number, number, number]}}
 */
export function colorRamp(stops, step) {
  const max = stops[stops.length - 1][0];
  const n = Math.ceil(max / step) + 1;
  const table = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = colorAt(stops, i * step);
    table[i] = (r << 16) | (g << 8) | b;
  }
  const lookup = (value) => table[Math.max(0, Math.min(n - 1, Math.round(value / step)))];
  return {
    lookup,
    rgb: (value) => {
      const c = lookup(value);
      return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    },
  };
}

/**
 * Colore CSS.
 * @param {[number, number, number]} rgb
 * @param {number} [alpha]
 * @returns {string}
 */
export function css(rgb, alpha = 1) {
  return alpha === 1 ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export const windRamp = colorRamp(WIND_STOPS, 0.25);
export const waveRamp = colorRamp(WAVE_STOPS, 0.05);
