// Frecce (o barbe) del vento su griglia regolare dello schermo (diradate con lo zoom), colorate per
// intensità. La freccia indica il verso in cui soffia il vento; la barba la provenienza.

import { CanvasLayer } from './canvas-layer.js';
import { sampler } from '../weather/grid.js';
import { windRamp, css } from './colors.js';
import { traceBarb } from './wind-barbs.js';

/** Distanza tra le frecce (pixel CSS). */
const SPACING_PX = 46;

/**
 * Disegna una freccia centrata in (x, y) nella direzione (dx, dy) normalizzata.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @param {number} len
 */
export function drawArrow(ctx, x, y, dx, dy, len) {
  const hx = x + (dx * len) / 2;
  const hy = y + (dy * len) / 2;
  const tx = x - (dx * len) / 2;
  const ty = y - (dy * len) / 2;
  const head = Math.min(7, len * 0.4);
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  // Punta: due segmenti a ±28°.
  const a = Math.atan2(dy, dx);
  for (const s of [-1, 1]) {
    const b = a + Math.PI + s * 0.5;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(b) * head, hy + Math.sin(b) * head);
  }
}

/**
 * Layer frecce generico: `vector(sample, lat, lon)` → {dx, dy (verso, schermo), mag (per il colore)} | null.
 * Opzione `symbol`: 'arrows' (default) o 'barbs' (solo vento: `mag` in nodi).
 */
export const ArrowLayer = CanvasLayer.extend({
  options: { spacing: SPACING_PX, colored: true },

  setData(field, tMs) {
    this._field = field;
    this._tMs = tMs;
    return this.redraw();
  },

  draw(ctx, size) {
    if (!this._field) return;
    const map = this._map;
    const s = sampler(this._field, this._tMs);
    const sp = this.options.spacing;
    const { ramp, vector, lengthFn } = this.options;
    ctx.lineCap = 'round';
    /** @type {Map<string, [number, number, number, number, number][]>} raggruppate per colore */
    const groups = new Map();
    for (let y = sp / 2; y < size.y; y += sp) {
      const lat = map.containerPointToLatLng([0, y]).lat;
      for (let x = sp / 2; x < size.x; x += sp) {
        const lon = map.containerPointToLatLng([x, 0]).lng;
        const vec = vector(s, lat, lon);
        if (!vec) continue;
        const color = this.options.colored ? css(ramp.rgb(vec.mag)) : '#ffffff';
        if (!groups.has(color)) groups.set(color, []);
        groups.get(color).push([x, y, vec.dx, vec.dy, vec.mag]);
      }
    }
    const barbs = this.options.symbol === 'barbs';
    // Contorno scuro per la leggibilità su mappa chiara e su heatmap.
    for (const pass of [0, 1]) {
      for (const [color, list] of groups) {
        ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.55)' : color;
        ctx.lineWidth = pass === 0 ? 4 : 2;
        if (barbs) {
          const stroke = new Path2D();
          const fill = new Path2D();
          for (const [x, y, dx, dy, mag] of list) traceBarb(stroke, fill, x, y, dx, dy, mag);
          ctx.lineJoin = 'round';
          ctx.stroke(stroke);
          if (pass === 1) {
            ctx.fillStyle = color;
            ctx.fill(fill);
          }
          continue;
        }
        ctx.beginPath();
        for (const [x, y, dx, dy, mag] of list) drawArrow(ctx, x, y, dx, dy, lengthFn(mag));
        ctx.stroke();
      }
    }
  },
});

/**
 * Frecce (o barbe) del vento.
 * @param {{pane: string, symbol?: 'arrows' | 'barbs'}} opts
 */
export function windArrowsLayer(opts) {
  return new ArrowLayer({
    ...opts,
    ramp: windRamp,
    vector: (s, lat, lon) => {
      const u = s('u', lat, lon);
      const v = s('v', lat, lon);
      const mag = Math.hypot(u, v);
      if (!Number.isFinite(mag) || mag < 0.05) return null;
      // Schermo: x verso est, y verso sud.
      return { dx: u / mag, dy: -v / mag, mag };
    },
    // Lunghezza crescente con l'intensità, entro limiti leggibili.
    lengthFn: (kn) => 14 + Math.min(kn, 35) * 0.5,
  });
}
