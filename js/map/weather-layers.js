// Gestione dei layer meteo sulla mappa: dati correnti, ora selezionata, attivazione e opacità.

import { ensurePane } from './canvas-layer.js';
import { windFieldLayer } from './wind-field.js';
import { windArrowsLayer } from './wind-arrows.js';
import { windParticlesLayer } from './wind-particles.js';

/** @typedef {'windField' | 'windArrows' | 'windParticles'} LayerId */

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {{active: Partial<Record<LayerId, boolean>>, opacity: number}} initial
 */
export function createWeatherLayers(map, initial) {
  const fieldPane = ensurePane(map, 'wxField', 350);
  const particlesPane = ensurePane(map, 'wxParticles', 380);
  const arrowsPane = ensurePane(map, 'wxArrows', 390);

  const layers = {
    windField: windFieldLayer({ pane: fieldPane, opacity: initial.opacity }),
    windArrows: windArrowsLayer({ pane: arrowsPane }),
    windParticles: windParticlesLayer({ pane: particlesPane }),
  };
  /** @type {Record<LayerId, boolean>} */
  const active = { windField: true, windArrows: false, windParticles: true, ...initial.active };

  /** @type {import('../weather/grid.js').WeatherField | null} */
  let windField = null;
  let tMs = Date.now();

  /** @param {LayerId} id */
  const fieldFor = (id) => (id.startsWith('wind') ? windField : null);

  function syncParticleColor() {
    layers.windParticles.setColored(!active.windField);
  }

  /** @param {LayerId} id */
  function refresh(id) {
    const layer = layers[id];
    if (!active[id]) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    layer._field = fieldFor(id);
    layer._tMs = tMs;
    if (!map.hasLayer(layer)) layer.addTo(map); else layer.redraw();
  }

  const all = () => /** @type {LayerId[]} */ (Object.keys(layers)).forEach(refresh);
  syncParticleColor();

  return {
    /** @param {import('../weather/grid.js').WeatherField | null} field */
    setWind(field) {
      windField = field;
      all();
    },
    /** @param {number} t */
    setTime(t) {
      tMs = t;
      all();
    },
    /**
     * @param {LayerId} id
     * @param {boolean} on
     */
    setActive(id, on) {
      active[id] = on;
      syncParticleColor();
      refresh(id);
      if (id === 'windField' && active.windParticles) refresh('windParticles');
    },
    /** @param {LayerId} id */
    isActive: (id) => active[id],
    /** @param {number} opacity */
    setOpacity(opacity) {
      layers.windField.setOpacity(opacity);
    },
  };
}
