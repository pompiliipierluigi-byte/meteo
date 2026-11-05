// Sonda: tocco su un punto della mappa → popup con i valori interpolati all'ora selezionata.

import { it } from '../i18n/it.js';
import { MARINE } from '../config.js';
import { sample, timeIndex, uvToWind } from '../weather/grid.js';
import { modelLabel } from '../weather/models.js';
import { formatDateTime, formatLatLon, formatDeg, compass16, formatShortDateTime, fmtNum } from '../lib/format.js';

/**
 * Valori della sonda in un punto.
 * @typedef {Object} ProbeValues
 * @property {number} windKn
 * @property {number} windFromDeg
 * @property {number} gustKn
 * @property {{key: 'wave'|'wwave'|'swell', heightM: number, fromDeg: number, periodS: number}[]} waves
 * @property {import('../weather/models.js').ModelId | null} model modello del vento in quel punto e ora
 * @property {number | null} runMs
 */

/**
 * Calcolo puro dei valori (bilineare nello spazio, lineare nel tempo).
 * @param {import('../weather/weather-service.js').WindResult | null} wind
 * @param {import('../weather/weather-service.js').WaveResult | null} waves
 * @param {number} lat
 * @param {number} lon
 * @param {number} tMs
 * @returns {ProbeValues}
 */
export function probeValues(wind, waves, lat, lon, tMs) {
  let windKn = NaN;
  let windFromDeg = NaN;
  let gustKn = NaN;
  /** @type {import('../weather/models.js').ModelId | null} */
  let model = null;
  if (wind) {
    const u = sample(wind.field, 'u', lat, lon, tMs);
    const v = sample(wind.field, 'v', lat, lon, tMs);
    if (Number.isFinite(u) && Number.isFinite(v)) {
      const w = uvToWind(u, v);
      windKn = w.speed;
      windFromDeg = w.fromDeg;
    }
    gustKn = sample(wind.field, 'gust', lat, lon, tMs);
    const ti = timeIndex(wind.field.timesMs, tMs);
    if (ti) {
      const i = ti.w < 0.5 ? ti.i0 : Math.min(ti.i0 + 1, wind.sourceByTime.length - 1);
      model = wind.sourceByTime[i];
      // In Auto, fuori dal dominio ICON-2I il punto è servito da ECMWF.
      const icon = wind.parts.icon2i;
      if (model === 'icon2i' && wind.parts.ecmwf && icon
        && !Number.isFinite(sample(icon, 'u', lat, lon, wind.field.timesMs[i]))) model = 'ecmwf';
    }
  }
  const list = /** @type {const} */ (['wave', 'wwave', 'swell']).map((key) => {
    if (!waves) return { key, heightM: NaN, fromDeg: NaN, periodS: NaN };
    const f = waves.field;
    const dx = sample(f, `${key}_dx`, lat, lon, tMs);
    const dy = sample(f, `${key}_dy`, lat, lon, tMs);
    let fromDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
    if (fromDeg < 0) fromDeg += 360;
    return {
      key,
      heightM: sample(f, `${key}_h`, lat, lon, tMs),
      fromDeg: Number.isFinite(dx) && Math.hypot(dx, dy) > 1e-3 ? fromDeg : NaN,
      periodS: sample(f, `${key}_per`, lat, lon, tMs),
    };
  });
  return {
    windKn, windFromDeg, gustKn, waves: list, model,
    runMs: model && wind ? wind.runs[model] ?? null : null,
  };
}

/** @param {number} deg */
const dirText = (deg) => (Number.isFinite(deg) ? `${it.probe.from} ${formatDeg(deg)} (${compass16(deg)})` : '');

/**
 * HTML del popup.
 * @param {ProbeValues} p
 * @param {number} lat
 * @param {number} lon
 * @param {number} tMs
 * @param {number | null} waveRunMs
 * @returns {string}
 */
function render(p, lat, lon, tMs, waveRunMs) {
  const t = it.probe;
  const names = { wave: t.waveTotal, wwave: t.waveWind, swell: t.swell };
  const rows = [
    [t.wind, Number.isFinite(p.windKn) ? `<b>${fmtNum(p.windKn, 1)} kn</b> ${dirText(p.windFromDeg)}` : t.noData],
    [t.gust, Number.isFinite(p.gustKn) ? `${fmtNum(p.gustKn, 1)} kn` : t.noData],
    ...p.waves.map((w) => [names[w.key], Number.isFinite(w.heightM)
      ? `<b>${fmtNum(w.heightM, 1)} m</b> ${dirText(w.fromDeg)}${Number.isFinite(w.periodS) ? ` · ${fmtNum(w.periodS, 0)} s` : ''}`
      : t.noData]),
  ];
  const model = p.model
    ? `${modelLabel(p.model)}${p.runMs ? ` (run ${formatShortDateTime(p.runMs)})` : ''}`
    : t.noData;
  const wave = `${MARINE.label}${waveRunMs ? ` (run ${formatShortDateTime(waveRunMs)})` : ''}`;
  return `
    <div class="probe">
      <div class="probe-pos">${formatLatLon(lat, lon)}</div>
      <div class="probe-time">${formatDateTime(tMs)}</div>
      <table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      <div class="probe-model">${t.model}: ${model}; ${t.waveModel}: ${wave}</div>
    </div>`;
}

/**
 * Collega la sonda alla mappa.
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {typeof import('../../vendor/leaflet/leaflet-src.esm.js')} L
 * @param {() => {wind: import('../weather/weather-service.js').WindResult | null, waves: import('../weather/weather-service.js').WaveResult | null, tMs: number}} getState
 * @param {() => boolean} [ignoreClick] true = il tocco serve ad altro (es. scelta di un punto della rotta)
 * @returns {{refresh: () => void}} aggiorna il popup aperto (cambio di ora o di dati)
 */
export function initProbe(map, L, getState, ignoreClick) {
  const popup = L.popup({ maxWidth: 320, autoPanPaddingTopLeft: [10, 60], className: 'probe-popup' });
  /** @type {{lat: number, lng: number} | null} */
  let at = null;
  const update = () => {
    if (!at) return;
    const s = getState();
    const html = s.wind || s.waves
      ? render(probeValues(s.wind, s.waves, at.lat, at.lng, s.tMs), at.lat, at.lng, s.tMs, s.waves?.runMs ?? null)
      : `<div class="probe">${it.probe.noWeather}</div>`;
    popup.setContent(html);
  };
  map.on('click', (e) => {
    if (ignoreClick?.()) return;
    at = e.latlng;
    popup.setLatLng(e.latlng);
    update();
    popup.openOn(map);
  });
  popup.on('remove', () => { at = null; });
  return { refresh: update };
}
