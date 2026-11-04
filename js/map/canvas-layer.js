// Layer Leaflet su canvas a tutto schermo, ridisegnato a fine spostamento/zoom.
// Base comune per campo colorato, frecce e particelle.

import * as L from '../../vendor/leaflet/leaflet-src.esm.js';

/**
 * Proiezione dello schermo: lon per colonna e lat per riga (Web Mercator: lon dipende solo da x,
 * lat solo da y), campionate ogni `step` pixel CSS.
 * @typedef {Object} ScreenGrid
 * @property {number} width larghezza CSS
 * @property {number} height altezza CSS
 * @property {number} step
 * @property {number} cols
 * @property {number} rows
 * @property {Float64Array} lonAt lon della colonna i (x = i·step)
 * @property {Float64Array} latAt lat della riga j (y = j·step)
 */

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {number} step
 * @returns {ScreenGrid}
 */
export function screenGrid(map, step) {
  const size = map.getSize();
  const cols = Math.ceil(size.x / step) + 1;
  const rows = Math.ceil(size.y / step) + 1;
  const lonAt = new Float64Array(cols);
  const latAt = new Float64Array(rows);
  for (let i = 0; i < cols; i++) lonAt[i] = map.containerPointToLatLng([i * step, 0]).lng;
  for (let j = 0; j < rows; j++) latAt[j] = map.containerPointToLatLng([0, j * step]).lat;
  return { width: size.x, height: size.y, step, cols, rows, lonAt, latAt };
}

/**
 * Crea (se manca) un pane per i layer meteo con lo z-index indicato.
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {string} name
 * @param {number} zIndex
 * @returns {string}
 */
export function ensurePane(map, name, zIndex) {
  if (!map.getPane(name)) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    pane.style.pointerEvents = 'none';
  }
  return name;
}

/**
 * Layer canvas. Le sottoclassi implementano `draw(ctx, size)` e possono usare `onMoveStart()`.
 * Opzioni: `pane` (nome), `dprMax` (densità massima del canvas).
 */
export const CanvasLayer = L.Layer.extend({
  options: { pane: 'overlayPane', dprMax: 2 },

  initialize(options) {
    L.setOptions(this, options);
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'wx-canvas leaflet-zoom-hide');
    this._canvas.style.position = 'absolute';
    this.getPane().appendChild(this._canvas);
    map.on('moveend zoomend resize viewreset', this._reset, this);
    map.on('movestart zoomstart', this._moveStart, this);
    this._reset();
  },

  onRemove(map) {
    map.off('moveend zoomend resize viewreset', this._reset, this);
    map.off('movestart zoomstart', this._moveStart, this);
    this.onMoveStart?.();
    L.DomUtil.remove(this._canvas);
    this._canvas = null;
  },

  /** Ridisegna (dati o ora cambiati). */
  redraw() {
    if (this._map && this._canvas) this._reset();
    return this;
  },

  _moveStart() {
    this.onMoveStart?.();
  },

  _reset() {
    const map = this._map;
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, this.options.dprMax);
    const c = this._canvas;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    const w = Math.round(size.x * dpr);
    const h = Math.round(size.y * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      c.style.width = `${size.x}px`;
      c.style.height = `${size.y}px`;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this.draw(ctx, size, dpr);
  },

  /**
   * @param {CanvasRenderingContext2D} _ctx
   * @param {{x: number, y: number}} _size
   * @param {number} _dpr
   */
  draw(_ctx, _size, _dpr) {},
});
