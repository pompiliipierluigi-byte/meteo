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
  let loading = false;
  /** @type {number | undefined} conto alla rovescia dell'attesa di quota */
  let waitTimer;
  weather.addEventListener('progress', (e) => {
    clearInterval(waitTimer);
    // Solo durante un caricamento: un evento tardivo non deve coprire un errore già mostrato.
    if (!loading) return;
    const { label, done, total, waitMs } = /** @type {CustomEvent} */ (e).detail;
    const text = fill(it.notice.loading, { label, done, total });
    if (!(waitMs > 0)) {
      notice.show(text);
      return;
    }
    const until = Date.now() + waitMs;
    const tick = () => {
      if (!loading) return clearInterval(waitTimer);
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      notice.show(`${text} ${fill(it.notice.quotaWait, { s })}`);
    };
    tick();
    waitTimer = window.setInterval(tick, 1000);
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

  // Diagnostica: ultimo errore dei dati meteo, conservato tra le sessioni per poterlo riferire.
  const diag = document.createElement('p');
  diag.className = 'diag';
  menu.addSection(it.diag.title).append(diag);
  /** @param {{msg: string, t: number} | null} e */
  const showLastError = (e) => {
    diag.textContent = e ? `${formatShortDateTime(e.t)} — ${e.msg}` : it.diag.none;
  };
  showLastError(getPref('lastError', null));
  /** @param {unknown} err */
  const recordError = (err) => {
    const e = { msg: String(/** @type {any} */ (err)?.message ?? err), t: Date.now() };
    setPref('lastError', e);
    showLastError(e);
  };

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
      loading = true;
      // In sequenza (quota): prima il vento, mostrato subito, poi l'onda.
      const wind = await weather.getWind(state.choice, { force });
      if (seq !== loadSeq) return;
      state.wind = wind;
      slider.setMarker(wind.switchMs, it.model.autoSwitch);
      wx.setWind(wind.field);
      probe.refresh();
      updateStatus();
      const waves = await weather.getWaves({ force });
      if (seq !== loadSeq) return;
      state.waves = waves;
      wx.setWaves(waves.field);
      probe.refresh();
      showDataBanner();
      document.dispatchEvent(new CustomEvent('weather-updated'));
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      recordError(err);
      if (!navigator.onLine && !state.wind) {
        notice.show(it.notice.offlineNoData, 'warn');
        return;
      }
      notice.show(fill(err?.quota ? it.notice.quota : it.notice.error, { msg: err?.message ?? String(err) }), 'error');
    } finally {
      if (seq === loadSeq) {
        loading = false;
        picker.setBusy(false);
      }
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
    else if (wind.stale || waves.stale) {
      recordError(wind.stale || waves.stale);
      notice.show(fill(it.notice.stale, { date }), 'warn');
    } else notice.hide();
  }

  window.addEventListener('offline', showDataBanner);
  window.addEventListener('online', () => loadWeather(false));

  loadWeather(false);
}

start();
