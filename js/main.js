// Avvio dell'app e coordinamento tra servizio meteo, mappa e interfaccia.

import { APP_VERSION } from './config.js';
import { it } from './i18n/it.js';
import { fill } from './lib/text.js';
import { getPref, setPref } from './lib/prefs.js';
import { formatShortDateTime } from './lib/format.js';
import { initDisclaimer } from './ui/disclaimer.js';
import { createMap } from './map/map.js';
import { createSideMenu, radioGroup, checkbox, rangeRow } from './ui/side-menu.js';
import { createWeatherLayers } from './map/weather-layers.js';
import { createLegend } from './ui/legend.js';
import { initProbe } from './ui/probe.js';
import { L, AVAILABLE_BASEMAPS } from './map/map.js';
import { createNotice } from './ui/notice.js';
import { createModelPicker } from './ui/model-picker.js';
import { createTimeSlider } from './ui/time-slider.js';
import { WeatherService } from './weather/weather-service.js';
import { MODEL_CHOICES } from './weather/models.js';
import { timeIndex } from './weather/grid.js';

/** Registra il service worker (percorso relativo, scope = cartella dell'app). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}

/**
 * Stato condiviso dell'app.
 * @type {{
 *   choice: import('./weather/models.js').ModelChoice,
 *   tMs: number,
 *   wind: import('./weather/weather-service.js').WindResult | null,
 *   waves: import('./weather/weather-service.js').WaveResult | null,
 * }}
 */
const state = {
  choice: 'auto',
  tMs: Math.floor(Date.now() / 3600e3) * 3600e3,
  wind: null,
  waves: null,
};

function start() {
  document.documentElement.dataset.version = APP_VERSION;
  registerServiceWorker();

  const topbar = document.getElementById('topbar');
  const title = document.createElement('h1');
  title.className = 'app-title';
  title.textContent = it.app.title;
  topbar.append(title);

  const bottombar = document.getElementById('bottombar');
  initDisclaimer(bottombar);

  const mapCtl = createMap(document.getElementById('map'));
  const menu = createSideMenu(topbar);
  const notice = createNotice(topbar);

  const savedChoice = getPref('model', 'auto');
  state.choice = MODEL_CHOICES.includes(savedChoice) ? savedChoice : 'auto';

  const weather = new WeatherService();
  weather.addEventListener('progress', (e) => {
    const { label, done, total } = /** @type {CustomEvent} */ (e).detail;
    notice.show(fill(it.notice.loading, { label, done, total }));
  });

  const picker = createModelPicker(menu.addSection(it.model.title), topbar, state.choice, (choice) => {
    state.choice = choice;
    setPref('model', choice);
    loadWeather(false);
  }, () => loadWeather(true));

  const legend = createLegend(document.getElementById('map'));
  const waveNames = { wave: it.layers.waveTotal, wwave: it.layers.waveWind, swell: it.layers.waveSwell };
  /** @param {import('./map/weather-layers.js').LayerSettings} s */
  const updateLegend = (s) => legend.update({
    wind: s.windField || s.windArrows || (s.windParticles && !s.windField && s.wave === 'none'),
    wave: s.wave === 'none' ? null : waveNames[s.wave],
  });
  const wx = createWeatherLayers(mapCtl.map, getPref('layers', {}), (s) => {
    setPref('layers', s);
    updateLegend(s);
  });
  const ls = wx.settings();
  updateLegend(ls);

  const windSec = menu.addSection(it.layers.wind);
  for (const id of /** @type {const} */ (['windField', 'windArrows', 'windParticles'])) {
    checkbox(windSec, it.layers[id], ls[id], (on) => wx.setToggle(id, on));
  }
  const waveSec = menu.addSection(it.layers.wave);
  radioGroup(waveSec, 'wave', [
    { value: 'none', label: it.layers.waveNone },
    { value: 'wave', label: it.layers.waveTotal },
    { value: 'wwave', label: it.layers.waveWind },
    { value: 'swell', label: it.layers.waveSwell },
  ], ls.wave, (v) => wx.setWave(/** @type {any} */ (v)));
  checkbox(waveSec, it.layers.waveArrows, ls.waveArrows, (on) => wx.setToggle('waveArrows', on));
  checkbox(waveSec, it.layers.wavePeriods, ls.wavePeriods, (on) => wx.setToggle('wavePeriods', on));

  rangeRow(menu.addSection(it.layers.opacity), it.layers.opacity, {
    min: 0.1, max: 1, step: 0.05, value: ls.opacity, format: (v) => `${Math.round(v * 100)} %`,
  }, (v) => wx.setOpacity(v));

  radioGroup(menu.addSection(it.menu.basemap), 'basemap', AVAILABLE_BASEMAPS.map((id) => (
    { value: id, label: it.map[id] })), mapCtl.getBasemap(), (v) => mapCtl.setBasemap(/** @type {any} */ (v)));

  checkbox(menu.addSection(it.menu.overlays), it.map.openseamap, mapCtl.getSeamarks(),
    (on) => mapCtl.setSeamarks(on));

  const probe = initProbe(mapCtl.map, L, () => state);

  const slider = createTimeSlider(bottombar, (tMs) => {
    state.tMs = tMs;
    updateStatus();
    wx.setTime(tMs);
    probe.refresh();
    document.dispatchEvent(new CustomEvent('time-changed'));
  });
  state.tMs = slider.get();
  wx.setTime(state.tMs);

  /** Aggiorna l'indicazione del modello effettivo e del run per l'ora selezionata. */
  function updateStatus() {
    const w = state.wind;
    if (!w) {
      picker.setStatus(null, null);
      return;
    }
    const ti = timeIndex(w.field.timesMs, state.tMs);
    const id = ti ? w.sourceByTime[ti.i0] : w.sourceByTime[0];
    picker.setStatus(id, w.runs[id] ?? null);
  }

  let loadSeq = 0;
  /**
   * Carica vento (modello scelto) e onda; cache prima della rete.
   * @param {boolean} force controlla subito se c'è un run nuovo
   */
  async function loadWeather(force) {
    const seq = ++loadSeq;
    picker.setBusy(true);
    notice.show(it.notice.loadingStart);
    try {
      const [wind, waves] = await Promise.all([
        weather.getWind(state.choice, { force }),
        weather.getWaves({ force }),
      ]);
      if (seq !== loadSeq) return;
      state.wind = wind;
      state.waves = waves;
      showDataBanner();
      slider.setMarker(wind.switchMs, it.model.autoSwitch);
      wx.setWind(wind.field);
      wx.setWaves(waves.field);
      probe.refresh();
      updateStatus();
      document.dispatchEvent(new CustomEvent('weather-updated'));
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      if (!navigator.onLine && !state.wind) {
        notice.show(it.notice.offlineNoData, 'warn');
        return;
      }
      notice.show(err?.quota ? it.notice.quota : fill(it.notice.error, { msg: err?.message ?? String(err) }), 'error');
    } finally {
      if (seq === loadSeq) picker.setBusy(false);
    }
  }

  /**
   * Banner sullo stato dei dati: offline o aggiornamento non riuscito → "dati del …" (SPEC §2.10).
   */
  function showDataBanner() {
    const { wind, waves } = state;
    if (!wind || !waves) {
      if (!navigator.onLine) notice.show(it.notice.offlineNoData, 'warn');
      return;
    }
    const date = formatShortDateTime(Math.min(wind.fetchedMs, waves.fetchedMs));
    if (!navigator.onLine) notice.show(fill(it.notice.offline, { date }), 'warn');
    else if (wind.stale || waves.stale) notice.show(fill(it.notice.stale, { date }), 'warn');
    else notice.hide();
  }

  window.addEventListener('offline', showDataBanner);
  window.addEventListener('online', () => loadWeather(false));

  loadWeather(false);
}

start();
