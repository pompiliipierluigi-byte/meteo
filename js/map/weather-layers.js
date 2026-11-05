// Gestione dei layer meteo sulla mappa: dati correnti, ora selezionata, attivazione e opacità.

import { ensurePane } from './canvas-layer.js';
import { windFieldLayer } from './wind-field.js';
import { windArrowsLayer } from './wind-arrows.js';
import { waveFieldLayer, waveArrowsLayer } from './wave-layer.js';
import { currentLayer } from './current-layer.js';
import { sstLayer } from './sst-layer.js';

/** @typedef {'windField' | 'windArrows' | 'waveArrows' | 'wavePeriods' | 'currents' | 'sst'} ToggleId */
/** @typedef {'none' | import('./wave-layer.js').WaveKind} WaveChoice */

/**
 * Impostazioni dei layer (salvate tra le sessioni).
 * @typedef {Object} LayerSettings
 * @property {boolean} windField
 * @property {boolean} windArrows simboli di direzione del vento attivi
 * @property {'arrows' | 'barbs'} windSymbol frecce o barbe meteorologiche
 * @property {WaveChoice} wave
 * @property {boolean} waveArrows
 * @property {boolean} wavePeriods
 * @property {boolean} currents
 * @property {boolean} sst temperatura del mare
 * @property {number} opacity
 */

/** Versione delle impostazioni salvate (2 = senza particelle; 3 = opacità di default al 50 %). */
const LAYER_SETTINGS_VERSION = 3;

/** @type {LayerSettings} */
export const DEFAULT_LAYER_SETTINGS = {
  windField: true,
  windArrows: true,
  windSymbol: 'arrows',
  wave: 'none',
  waveArrows: true,
  wavePeriods: false,
  currents: false,
  sst: false,
  // 50 %: la mappa sotto (costa, porti) resta leggibile (2026-11-05).
  opacity: 0.5,
};

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {Partial<LayerSettings>} saved
 * @param {(settings: LayerSettings) => void} onChange chiamata a ogni modifica delle impostazioni
 */
export function createWeatherLayers(map, saved, onChange) {
  const fieldPane = ensurePane(map, 'wxField', 350);
  const arrowsPane = ensurePane(map, 'wxArrows', 390);

  // Impostazioni salvate prima della 1.7 (particelle, opacità 60 %): si ripartisce dai nuovi default
  // (frecce e campo colorato al massimo, niente particelle: troppo pesanti sul telefono).
  // Impostazioni della 1.7–1.8 (v2): si tiene tutto tranne l'opacità, che torna al nuovo default.
  const fresh = saved && saved.v === LAYER_SETTINGS_VERSION;
  const v2 = saved && saved.v === 2;
  /** @type {LayerSettings} */
  const st = {
    ...DEFAULT_LAYER_SETTINGS,
    ...(fresh ? saved : v2 ? { ...saved, opacity: undefined } : { wave: saved?.wave, waveArrows: saved?.waveArrows, wavePeriods: saved?.wavePeriods, currents: saved?.currents, sst: saved?.sst }),
  };
  for (const k of Object.keys(st)) if (st[k] === undefined) st[k] = DEFAULT_LAYER_SETTINGS[k];
  delete st.windParticles;
  if (!['none', 'wave', 'wwave', 'swell'].includes(st.wave)) st.wave = 'none';
  if (!['arrows', 'barbs'].includes(st.windSymbol)) st.windSymbol = 'arrows';

  const kind = st.wave === 'none' ? 'wave' : st.wave;
  // Ordine di disegno: temperatura del mare sotto onda e vento.
  const layers = {
    sst: sstLayer({ pane: fieldPane, opacity: st.opacity }),
    waveField: waveFieldLayer({ pane: fieldPane, opacity: st.opacity, kind }),
    windField: windFieldLayer({ pane: fieldPane, opacity: st.opacity }),
    waveArrows: waveArrowsLayer({ pane: arrowsPane, kind }),
    windArrows: windArrowsLayer({ pane: arrowsPane, symbol: st.windSymbol }),
    currents: currentLayer({ pane: arrowsPane }),
  };

  /** @type {import('../weather/grid.js').WeatherField | null} */
  let windData = null;
  /** @type {import('../weather/grid.js').WeatherField | null} */
  let waveData = null;
  /** @type {import('../weather/grid.js').WeatherField | null} */
  let currentData = null;
  /** @type {import('../weather/grid.js').WeatherField | null} */
  let sstData = null;
  let tMs = Date.now();

  /** @param {keyof typeof layers} id */
  function isOn(id) {
    switch (id) {
      case 'waveField': return st.wave !== 'none';
      case 'waveArrows': return st.wave !== 'none' && (st.waveArrows || st.wavePeriods);
      default: return st[id];
    }
  }

  /** @param {keyof typeof layers} id */
  function refresh(id) {
    const layer = layers[id];
    if (!isOn(id)) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    layer._field = id.startsWith('wind') ? windData : id === 'currents' ? currentData : id === 'sst' ? sstData : waveData;
    layer._tMs = tMs;
    if (!map.hasLayer(layer)) layer.addTo(map); else layer.redraw();
  }

  function applyOptions() {
    const k = st.wave === 'none' ? 'wave' : st.wave;
    layers.waveField.options.kind = k;
    layers.windArrows.options.symbol = st.windSymbol;
    Object.assign(layers.waveArrows.options, { kind: k, arrows: st.waveArrows, periods: st.wavePeriods });
  }

  const all = () => /** @type {(keyof typeof layers)[]} */ (Object.keys(layers)).forEach(refresh);
  const changed = () => onChange({ ...st, v: LAYER_SETTINGS_VERSION });
  applyOptions();

  return {
    /** @param {import('../weather/grid.js').WeatherField | null} field */
    setWind(field) {
      windData = field;
      all();
    },
    /** @param {import('../weather/grid.js').WeatherField | null} field */
    setSst(field) {
      sstData = field;
      refresh('sst');
    },
    /** @param {import('../weather/grid.js').WeatherField | null} field */
    setCurrents(field) {
      currentData = field;
      refresh('currents');
    },
    /** @param {import('../weather/grid.js').WeatherField | null} field */
    setWaves(field) {
      waveData = field;
      all();
    },
    /** @param {number} t */
    setTime(t) {
      tMs = t;
      all();
    },
    /**
     * @param {ToggleId} id
     * @param {boolean} on
     */
    setToggle(id, on) {
      st[id] = on;
      applyOptions();
      all();
      changed();
    },
    /** @param {'arrows' | 'barbs'} symbol */
    setWindSymbol(symbol) {
      st.windSymbol = symbol;
      applyOptions();
      all();
      changed();
    },
    /** @param {WaveChoice} choice */
    setWave(choice) {
      st.wave = choice;
      applyOptions();
      all();
      changed();
    },
    /** @param {number} opacity */
    setOpacity(opacity) {
      st.opacity = opacity;
      layers.windField.setOpacity(opacity);
      layers.waveField.setOpacity(opacity);
      layers.sst.setOpacity(opacity);
      changed();
    },
    /** @returns {LayerSettings} */
    settings: () => ({ ...st }),
  };
}
