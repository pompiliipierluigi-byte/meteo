// Campo colorato (heatmap) di una grandezza scalare: intensità del vento; riusato per l'onda.

import { CanvasLayer, screenGrid } from './canvas-layer.js';
import { sampler } from '../weather/grid.js';
import { windRamp } from './colors.js';

/** Lato della cella di calcolo in pixel CSS (poi scalata con interpolazione). */
const CELL_PX = 4;

/**
 * Layer heatmap. Opzioni: `ramp` (scala colori), `value(sample, lat, lon)` (grandezza da colorare).
 */
export const FieldLayer = CanvasLayer.extend({
  options: { opacity: 0.6, dprMax: 1 },

  /**
   * @param {import('../weather/grid.js').WeatherField | null} field
   * @param {number} tMs
   */
  setData(field, tMs) {
    this._field = field;
    this._tMs = tMs;
    return this.redraw();
  },

  /** @param {number} opacity 0–1 */
  setOpacity(opacity) {
    this.options.opacity = opacity;
    if (this._canvas) this._canvas.style.opacity = String(opacity);
    return this;
  },

  draw(ctx) {
    this._canvas.style.opacity = String(this.options.opacity);
    if (!this._field) return;
    const sg = screenGrid(this._map, CELL_PX);
    const s = sampler(this._field, this._tMs);
    const { ramp, value } = this.options;
    const off = document.createElement('canvas');
    off.width = sg.cols;
    off.height = sg.rows;
    const octx = off.getContext('2d');
    const img = octx.createImageData(sg.cols, sg.rows);
    const px = img.data;
    for (let j = 0; j < sg.rows; j++) {
      const lat = sg.latAt[j];
      for (let i = 0; i < sg.cols; i++) {
        const v = value(s, lat, sg.lonAt[i]);
        if (!Number.isFinite(v)) continue;
        const c = ramp.lookup(v);
        const k = (j * sg.cols + i) * 4;
        px[k] = (c >> 16) & 255;
        px[k + 1] = (c >> 8) & 255;
        px[k + 2] = c & 255;
        px[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, -CELL_PX / 2, -CELL_PX / 2, sg.cols * CELL_PX, sg.rows * CELL_PX);
  },
});

/**
 * Heatmap dell'intensità del vento (nodi), dalle componenti u, v interpolate.
 * @param {{pane: string, opacity?: number}} opts
 */
export function windFieldLayer(opts) {
  return new FieldLayer({
    ...opts,
    ramp: windRamp,
    value: (s, lat, lon) => Math.hypot(s('u', lat, lon), s('v', lat, lon)),
  });
}
