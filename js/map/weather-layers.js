// Gestione dei layer meteo sulla mappa: dati correnti, ora selezionata, attivazione e opacità.

import { ensurePane } from './canvas-layer.js';
import { windFieldLayer } from './wind-field.js';
import { windArrowsLayer } from './wind-arrows.js';
import { windParticlesLayer } from './wind-particles.js';
import { waveFieldLayer, waveArrowsLayer } from './wave-layer.js';
import { currentLayer } from './current-layer.js';

/** @typedef {'windField' | 'windArrows' | 'windParticles' | 'waveArrows' | 'wavePeriods' | 'currents'} ToggleId */
/** @typedef {'none' | import('./wave-layer.js').WaveKind} WaveChoice */

/**
 * Impostazioni dei layer (salvate tra le sessioni).
 * @typedef {Object} LayerSettings
 * @property {boolean} windField
 * @property {boolean} windArrows
 * @property {boolean} windParticles
 * @property {WaveChoice} wave
 * @property {boolean} waveArrows
 * @property {boolean} wavePeriods
 * @property {boolean} currents
 * @property {number} opacity
 */

/** @type {LayerSettings} */
export const DEFAULT_LAYER_SETTINGS = {
  windField: true,
  windArrows: false,
  windParticles: true,
  wave: 'none',
  waveArrows: true,
  wavePeriods: false,
  currents: false,
  opacity: 0.6,
};

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {Partial<LayerSettings>} saved
 * @param {(settings: LayerSettings) => void} onChange chiamata a ogni modifica delle impostazioni
 */
export function createWeatherLayers(map, saved, onChange) {
  const fieldPane = ensurePane(map, 'wxField', 350);
  const particlesPane = ensurePane(map, 'wxParticles', 380);
  const arrowsPane = ensurePane(map, 'wxArrows', 390);

  /** @type {LayerSettings} */
  const st = { ...DEFAULT_LAYER_SETTINGS, ...saved };
  if (!['none', 'wave', 'wwave', 'swell'].includes(st.wave)) st.wave = 'none';

  const kind = st.wave === 'none' ? 'wave' : st.wave;
  const layers = {
    waveField: waveFieldLayer({ pane: fieldPane, opacity: st.opacity, kind }),
    windField: windFieldLayer({ pane: fieldPane, opacity: st.opacity }),
    windParticles: windParticlesLayer({ pane: particlesPane }),
    waveArrows: waveArrowsLayer({ pane: arrowsPane, kind }),
    windArrows: windArrowsLayer({ pane: arrowsPane }),
    currents: currentLayer({ pane: arrowsPane }),
  };

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
    Object.assign(layers.waveArrows.options, { kind: k, arrows: st.waveArrows, periods: st.wavePeriods });
    // Sopra un campo colorato le particelle sono bianche, altrimenti colorate per intensità.
    layers.windParticles.setColored(!st.windField && st.wave === 'none');
  }

  const all = () => /** @type {(keyof typeof layers)[]} */ (Object.keys(layers)).forEach(refresh);
  const changed = () => onChange({ ...st });
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
