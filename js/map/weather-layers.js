// Gestione dei layer meteo sulla mappa: dati correnti, ora selezionata, attivazione e opacità.

import { ensurePane } from './canvas-layer.js';
import { windFieldLayer } from './wind-field.js';
import { windArrowsLayer } from './wind-arrows.js';
import { waveFieldLayer, waveArrowsLayer } from './wave-layer.js';
import { currentLayer } from './current-layer.js';
import { createLandMask } from './land-mask.js';

/** @typedef {'windField' | 'windArrows' | 'waveArrows' | 'wavePeriods' | 'currents'} ToggleId */
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
 * @property {number} opacity
 */

/** Versione delle impostazioni salvate (2 = senza particelle, opacità piena). */
const LAYER_SETTINGS_VERSION = 2;

/** @type {LayerSettings} */
export const DEFAULT_LAYER_SETTINGS = {
  windField: true,
  windArrows: true,
  windSymbol: 'arrows',
  wave: 'none',
  waveArrows: true,
  wavePeriods: false,
  currents: false,
  opacity: 1,
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
  const fresh = saved && saved.v === LAYER_SETTINGS_VERSION;
  /** @type {LayerSettings} */
  const st = { ...DEFAULT_LAYER_SETTINGS, ...(fresh ? saved : { wave: saved?.wave, waveArrows: saved?.waveArrows, wavePeriods: saved?.wavePeriods, currents: saved?.currents }) };
  for (const k of Object.keys(st)) if (st[k] === undefined) st[k] = DEFAULT_LAYER_SETTINGS[k];
  delete st.windParticles;
  if (!['none', 'wave', 'wwave', 'swell'].includes(st.wave)) st.wave = 'none';
  if (!['arrows', 'barbs'].includes(st.windSymbol)) st.windSymbol = 'arrows';

  const kind = st.wave === 'none' ? 'wave' : st.wave;
  // Campi e frecce solo sul mare: la terra resta visibile (costa, porti, punti della rotta).
  const landMask = createLandMask(() => all());
  const layers = {
    waveField: waveFieldLayer({ pane: fieldPane, opacity: st.opacity, kind, landMask }),
    windField: windFieldLayer({ pane: fieldPane, opacity: st.opacity, landMask }),
    waveArrows: waveArrowsLayer({ pane: arrowsPane, kind, landMask }),
    windArrows: windArrowsLayer({ pane: arrowsPane, symbol: st.windSymbol, landMask }),
    currents: currentLayer({ pane: arrowsPane, landMask }),
  };
  const loadLand = () => landMask.ensure(map.getBounds());
  map.on('moveend', loadLand);
  loadLand();

  /** @type {import('../weather/grid.js').WeatherField | null} */
  let windData = null;
  /** @type {import('../weather/grid.js').WeatherField | null} */
  let waveData = null;
  /** @type {import('../weather/grid.js').WeatherField | null} */
  let currentData = null;
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
    layer._field = id.startsWith('wind') ? windData : id === 'currents' ? currentData : waveData;
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
      changed();
    },
    /** @returns {LayerSettings} */
    settings: () => ({ ...st }),
  };
}
