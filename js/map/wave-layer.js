// Layer onda (totale, da vento, swell): campo colorato dell'altezza significativa, frecce della
// direzione (verso di propagazione) ed etichette facoltative del periodo.

import { FieldLayer } from './wind-field.js';
import { CanvasLayer } from './canvas-layer.js';
import { drawArrow } from './wind-arrows.js';
import { sampler } from '../weather/grid.js';
import { waveRamp } from './colors.js';

/** @typedef {'wave' | 'wwave' | 'swell'} WaveKind prefisso delle variabili del campo */

/** Distanza tra le frecce d'onda (px CSS), diversa dal vento per non sovrapporle. */
const SPACING_PX = 58;
const ARROW_LEN_PX = 16;

/**
 * Heatmap dell'altezza (m) del tipo d'onda scelto.
 * @param {{pane: string, opacity?: number, kind: WaveKind}} opts
 */
export function waveFieldLayer(opts) {
  const layer = new FieldLayer({
    ...opts,
    ramp: waveRamp,
    value: (s, lat, lon) => s(`${layer.options.kind}_h`, lat, lon),
  });
  return layer;
}

/**
 * Frecce di direzione (e periodo) del tipo d'onda scelto.
 */
export const WaveArrowLayer = CanvasLayer.extend({
  options: { kind: 'wave', arrows: true, periods: false },

  setData(field, tMs) {
    this._field = field;
    this._tMs = tMs;
    return this.redraw();
  },

  draw(ctx, size) {
    if (!this._field) return;
    const map = this._map;
    const s = sampler(this._field, this._tMs);
    const k = this.options.kind;
    /** @type {[number, number, number, number, number][]} x, y, dx, dy, periodo */
    const items = [];
    for (let y = SPACING_PX / 2; y < size.y; y += SPACING_PX) {
      const lat = map.containerPointToLatLng([0, y]).lat;
      for (let x = SPACING_PX / 2; x < size.x; x += SPACING_PX) {
        const lon = map.containerPointToLatLng([x, 0]).lng;
        const h = s(`${k}_h`, lat, lon);
        const fx = s(`${k}_dx`, lat, lon);
        const fy = s(`${k}_dy`, lat, lon);
        const m = Math.hypot(fx, fy);
        if (!Number.isFinite(h) || !(m > 1e-3) || h < 0.05) continue;
        // Provenienza (fx est, fy nord) → verso di propagazione sullo schermo (y verso il basso).
        items.push([x, y, -fx / m, fy / m, s(`${k}_per`, lat, lon)]);
      }
    }
    if (this.options.arrows) {
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        ctx.beginPath();
        for (const [x, y, dx, dy] of items) drawArrow(ctx, x, y, dx, dy, ARROW_LEN_PX);
        ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.9)' : '#0b2e4f';
        ctx.lineWidth = pass === 0 ? 4 : 2;
        ctx.stroke();
      }
    }
    if (this.options.periods) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = '#0b2e4f';
      for (const [x, y, , , per] of items) {
        if (!Number.isFinite(per)) continue;
        const text = `${per.toFixed(0)} s`;
        ctx.strokeText(text, x, y + 10);
        ctx.fillText(text, x, y + 10);
      }
    }
  },
});

/**
 * @param {{pane: string, kind: WaveKind}} opts
 */
export function waveArrowsLayer(opts) {
  return new WaveArrowLayer(opts);
}
