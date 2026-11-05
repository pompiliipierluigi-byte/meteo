// Particelle animate su canvas che seguono il campo di vento interpolato (scritto in proprio, SPEC §3.2).

import { CanvasLayer, screenGrid } from './canvas-layer.js';
import { sampler } from '../weather/grid.js';
import { windRamp, css } from './colors.js';

/** Lato della cella della griglia di velocità sullo schermo (px CSS). */
const CELL_PX = 8;
/** Spostamento per fotogramma (a 60 fps) per nodo di vento (px). Scelta visiva, non fisica. */
const PX_PER_KN_FRAME = 0.06;
/** Pixel quadrati per particella e limite massimo (prestazioni su smartphone). */
const AREA_PER_PARTICLE = 220;
const MAX_PARTICLES = 3000;
/** Persistenza della scia (0–1, più alto = scia più lunga). */
const FADE = 0.92;
/** Fasce di colore per intensità (nodi, estremi inferiori). */
const BANDS = [0, 5, 10, 15, 20, 25, 30, 35];

export const ParticlesLayer = CanvasLayer.extend({
  options: { dprMax: 1, colored: true },

  setData(field, tMs) {
    this._field = field;
    this._tMs = tMs;
    return this.redraw();
  },

  /** @param {boolean} colored false = particelle bianche (sopra il campo colorato) */
  setColored(colored) {
    this.options.colored = colored;
    return this;
  },

  onMoveStart() {
    this._stop();
    if (this._canvas) {
      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  },

  _stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  },

  draw(ctx, size) {
    this._stop();
    if (!this._field) return;
    // Griglia di velocità sullo schermo (px per fotogramma), calcolata una volta per vista e ora.
    const sg = screenGrid(this._map, CELL_PX);
    const s = sampler(this._field, this._tMs);
    const n = sg.cols * sg.rows;
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const kn = new Float32Array(n).fill(NaN);
    for (let j = 0; j < sg.rows; j++) {
      const lat = sg.latAt[j];
      for (let i = 0; i < sg.cols; i++) {
        const u = s('u', lat, sg.lonAt[i]);
        const v = s('v', lat, sg.lonAt[i]);
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const k = j * sg.cols + i;
        vx[k] = u * PX_PER_KN_FRAME;
        vy[k] = -v * PX_PER_KN_FRAME;
        kn[k] = Math.hypot(u, v);
      }
    }
    const count = Math.min(MAX_PARTICLES, Math.round((size.x * size.y) / AREA_PER_PARTICLE));
    const px = new Float32Array(count);
    const py = new Float32Array(count);
    const age = new Uint16Array(count);
    const maxAge = new Uint16Array(count);

    const cellOf = (x, y) => {
      const i = Math.round(x / CELL_PX);
      const j = Math.round(y / CELL_PX);
      return i >= 0 && j >= 0 && i < sg.cols && j < sg.rows ? j * sg.cols + i : -1;
    };
    const spawn = (p) => {
      // Alcuni tentativi per nascere dove c'è vento (non sulla terra senza dati).
      for (let tries = 0; tries < 8; tries++) {
        px[p] = Math.random() * size.x;
        py[p] = Math.random() * size.y;
        const c = cellOf(px[p], py[p]);
        if (c >= 0 && Number.isFinite(kn[c])) break;
      }
      age[p] = 0;
      maxAge[p] = 40 + Math.floor(Math.random() * 60);
    };
    for (let p = 0; p < count; p++) {
      spawn(p);
      age[p] = Math.floor(Math.random() * maxAge[p]);
    }

    const colored = this.options.colored;
    const bandColors = BANDS.map((b) => css(windRamp.rgb(b + 2.5), 0.9));
    const white = 'rgba(255,255,255,0.85)';
    /** @type {number[][]} segmenti per fascia: x0, y0, x1, y1, … */
    const segs = BANDS.map(() => []);
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min(3, (now - last) / 16.7);
      last = now;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${FADE})`;
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';
      for (const sgm of segs) sgm.length = 0;
      for (let p = 0; p < count; p++) {
        const c = cellOf(px[p], py[p]);
        if (c < 0 || !Number.isFinite(kn[c]) || age[p] >= maxAge[p]) {
          spawn(p);
          continue;
        }
        const x0 = px[p];
        const y0 = py[p];
        const x1 = x0 + vx[c] * dt;
        const y1 = y0 + vy[c] * dt;
        px[p] = x1;
        py[p] = y1;
        age[p]++;
        let b = 0;
        if (colored) while (b < BANDS.length - 1 && kn[c] >= BANDS[b + 1]) b++;
        segs[b].push(x0, y0, x1, y1);
      }
      ctx.lineWidth = 1.5;
      for (let b = 0; b < segs.length; b++) {
        const sgm = segs[b];
        if (!sgm.length) continue;
        ctx.beginPath();
        for (let k = 0; k < sgm.length; k += 4) {
          ctx.moveTo(sgm[k], sgm[k + 1]);
          ctx.lineTo(sgm[k + 2], sgm[k + 3]);
        }
        ctx.strokeStyle = colored ? bandColors[b] : white;
        ctx.stroke();
      }
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  },
});

/**
 * @param {{pane: string}} opts
 */
export function windParticlesLayer(opts) {
  return new ParticlesLayer(opts);
}
