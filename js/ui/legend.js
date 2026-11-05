// Legenda delle scale colori (vento in nodi, onda in metri), in basso a sinistra sulla mappa.

import { WIND_STOPS, WAVE_STOPS, CURRENT_STOPS, css } from '../map/colors.js';
import { it } from '../i18n/it.js';
import { getPref, setPref } from '../lib/prefs.js';

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
 * @returns {{update: (show: {wind: boolean, wave: string | null, current?: boolean}) => void}}
 */
export function createLegend(mapEl) {
  const root = document.createElement('div');
  root.className = 'legend';
  // A scomparsa sul lato: chiusa di default sugli schermi stretti, si apre con un tocco (o uno scorrimento).
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'legend-tab';
  tab.textContent = it.legend.open;
  tab.setAttribute('aria-label', it.legend.openLabel);
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'legend-hide';
  hide.textContent = '‹';
  hide.setAttribute('aria-label', it.legend.closeLabel);
  const box = document.createElement('div');
  box.className = 'legend-box';
  let open = getPref('legendOpen', window.innerWidth > 700);
  const apply = () => {
    root.classList.toggle('collapsed', !open);
    setPref('legendOpen', open);
  };
  tab.addEventListener('click', () => { open = true; apply(); });
  hide.addEventListener('click', () => { open = false; apply(); });
  // Scorrimento verso sinistra sulla legenda aperta: la chiude; verso destra sulla linguetta: la apre.
  let x0 = null;
  root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (dx < -30 && open) { open = false; apply(); }
    if (dx > 30 && !open) { open = true; apply(); }
  });
  const wind = scale(it.legend.wind, WIND_STOPS, (v) => String(v));
  const wave = scale(it.legend.wave, WAVE_STOPS, (v) => String(v));
  const current = scale(it.legend.current, CURRENT_STOPS, (v) => String(v));
  box.append(hide, wind, wave, current);
  root.append(tab, box);
  mapEl.append(root);
  apply();
  return {
    update(show) {
      wind.classList.toggle('hidden', !show.wind);
      wave.classList.toggle('hidden', !show.wave);
      if (show.wave) wave.querySelector('.legend-title').textContent = `${it.legend.wave} — ${show.wave}`;
      current.classList.toggle('hidden', !show.current);
      root.classList.toggle('hidden', !show.wind && !show.wave && !show.current);
    },
  };
}
