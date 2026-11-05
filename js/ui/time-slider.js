// Cursore temporale: dall'ora corrente a +HORIZON_H, passi di un'ora, pulsanti ±1 h, ±1 giorno, play.
// Orari mostrati in Europe/Rome; il valore interno è in ms UTC.

import { HORIZON_H } from '../config.js';
import { it } from '../i18n/it.js';
import { formatDateTime } from '../lib/format.js';

const HOUR = 3600e3;
/** Durata di un fotogramma dell'animazione (ms per ora di previsione). */
const PLAY_STEP_MS = 800;

/**
 * @typedef {Object} TimeSlider
 * @property {() => number} get istante selezionato (ms UTC)
 * @property {(tMs: number) => void} set
 * @property {(switchMs: number | null, label?: string) => void} setMarker segna la discontinuità del modello Auto
 */

/**
 * @param {HTMLElement} parent
 * @param {(tMs: number) => void} onChange
 * @returns {TimeSlider}
 */
export function createTimeSlider(parent, onChange) {
  const t = it.time;
  const root = document.createElement('div');
  root.className = 'time-slider';
  root.innerHTML = `
    <div class="ts-row">
      <button type="button" class="ts-btn" data-step="-24" aria-label="${t.minusDay}">«</button>
      <button type="button" class="ts-btn" data-step="-1" aria-label="${t.minusHour}">‹</button>
      <output class="ts-label" aria-live="off"></output>
      <button type="button" class="ts-btn" data-step="1" aria-label="${t.plusHour}">›</button>
      <button type="button" class="ts-btn" data-step="24" aria-label="${t.plusDay}">»</button>
      <button type="button" class="ts-btn ts-play" aria-label="${t.play}">▶</button>
    </div>
    <div class="ts-track">
      <input type="range" min="0" max="${HORIZON_H}" step="1" value="0" aria-label="${t.label}">
      <div class="ts-marker hidden" aria-hidden="true"><span></span></div>
    </div>`;
  parent.prepend(root);

  const range = /** @type {HTMLInputElement} */ (root.querySelector('input'));
  const label = /** @type {HTMLOutputElement} */ (root.querySelector('.ts-label'));
  const playBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.ts-play'));
  const marker = /** @type {HTMLElement} */ (root.querySelector('.ts-marker'));

  /** Ora intera corrente: inizio del cursore. */
  const startMs = () => Math.floor(Date.now() / HOUR) * HOUR;
  let offsetH = 0;
  /** @type {number | null} */
  let markerMs = null;

  function render() {
    const tMs = startMs() + offsetH * HOUR;
    range.value = String(offsetH);
    const rel = offsetH === 0 ? t.now : `+${offsetH} h`;
    label.textContent = `${formatDateTime(tMs)} (${rel})`;
    placeMarker();
  }

  function placeMarker() {
    if (markerMs === null) {
      marker.classList.add('hidden');
      return;
    }
    const h = (markerMs - startMs()) / HOUR;
    if (h <= 0 || h > HORIZON_H) {
      marker.classList.add('hidden');
      return;
    }
    marker.classList.remove('hidden');
    // Il cursore del range non arriva ai bordi: si compensa con la sua larghezza (CSS --thumb).
    marker.style.setProperty('--pos', String(h / HORIZON_H));
  }

  /** @param {number} h */
  function setOffset(h) {
    const clamped = Math.max(0, Math.min(HORIZON_H, Math.round(h)));
    if (clamped === offsetH) {
      render();
      return;
    }
    offsetH = clamped;
    render();
    onChange(startMs() + offsetH * HOUR);
  }

  range.addEventListener('input', () => setOffset(Number(range.value)));
  root.querySelectorAll('[data-step]').forEach((b) => {
    b.addEventListener('click', () => {
      stop();
      setOffset(offsetH + Number(/** @type {HTMLElement} */ (b).dataset.step));
    });
  });

  /** @type {number | null} */
  let timer = null;
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', t.play);
  }
  playBtn.addEventListener('click', () => {
    if (timer !== null) {
      stop();
      return;
    }
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', t.pause);
    timer = window.setInterval(() => setOffset(offsetH >= HORIZON_H ? 0 : offsetH + 1), PLAY_STEP_MS);
  });

  // Allo scoccare dell'ora l'inizio del cursore avanza: si mantiene lo stesso istante assoluto.
  let lastStart = startMs();
  setInterval(() => {
    const s = startMs();
    if (s !== lastStart) {
      const abs = lastStart + offsetH * HOUR;
      lastStart = s;
      offsetH = Math.max(0, Math.round((abs - s) / HOUR));
      render();
      onChange(s + offsetH * HOUR);
    }
  }, 60e3);

  render();

  return {
    get: () => startMs() + offsetH * HOUR,
    set: (tMs) => setOffset((tMs - startMs()) / HOUR),
    setMarker(switchMs, text) {
      markerMs = switchMs;
      marker.querySelector('span').textContent = text ?? '';
      placeMarker();
    },
  };
}
