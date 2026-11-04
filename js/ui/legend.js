// Legenda delle scale colori (vento in nodi, onda in metri), in basso a sinistra sulla mappa.

import { WIND_STOPS, WAVE_STOPS, css } from '../map/colors.js';
import { it } from '../i18n/it.js';

/**
 * Gradiente CSS con le soglie in proporzione al valore.
 * @param {import('../map/colors.js').ColorStop[]} stops
 * @returns {string}
 */
function gradient(stops) {
  const max = stops[stops.length - 1][0];
  return `linear-gradient(to right, ${stops.map(([v, c]) => `${css(c)} ${((v / max) * 100).toFixed(1)}%`).join(', ')})`;
}

/**
 * @param {string} title
 * @param {import('../map/colors.js').ColorStop[]} stops
 * @param {(v: number) => string} label
 * @returns {HTMLElement}
 */
function scale(title, stops, label) {
  const max = stops[stops.length - 1][0];
  const el = document.createElement('div');
  el.className = 'legend-scale';
  const ticks = stops.map(([v], i) => {
    const text = i === stops.length - 1 ? `${label(v)}+` : label(v);
    return `<span style="left:${((v / max) * 100).toFixed(1)}%">${text}</span>`;
  }).join('');
  el.innerHTML = `<div class="legend-title"></div><div class="legend-bar" style="background:${gradient(stops)}"></div><div class="legend-ticks">${ticks}</div>`;
  el.querySelector('.legend-title').textContent = title;
  return el;
}

/**
 * @param {HTMLElement} mapEl contenitore della mappa
 * @returns {{update: (show: {wind: boolean, wave: string | null}) => void}}
 */
export function createLegend(mapEl) {
  const root = document.createElement('div');
  root.className = 'legend';
  const wind = scale(it.legend.wind, WIND_STOPS, (v) => String(v));
  const wave = scale(it.legend.wave, WAVE_STOPS, (v) => String(v));
  root.append(wind, wave);
  mapEl.append(root);
  return {
    update(show) {
      wind.classList.toggle('hidden', !show.wind);
      wave.classList.toggle('hidden', !show.wave);
      if (show.wave) wave.querySelector('.legend-title').textContent = `${it.legend.wave} — ${show.wave}`;
      root.classList.toggle('hidden', !show.wind && !show.wave);
    },
  };
}
