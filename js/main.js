// Avvio dell'app e coordinamento tra servizio meteo, mappa e interfaccia.

import { APP_VERSION } from './config.js';
import { it } from './i18n/it.js';
import { fill } from './lib/text.js';
import { getPref, setPref } from './lib/prefs.js';
import { formatShortDateTime } from './lib/format.js';
import { initDisclaimer } from './ui/disclaimer.js';
import { createMap } from './map/map.js';
import { createSideMenu, radioGroup, checkbox } from './ui/side-menu.js';
import { createNotice } from './ui/notice.js';
import { createModelPicker } from './ui/model-picker.js';
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

  initDisclaimer(document.getElementById('bottombar'));

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

  radioGroup(menu.addSection(it.menu.basemap), 'basemap', [
    { value: 'carto', label: it.map.carto },
    { value: 'osm', label: it.map.osm },
  ], mapCtl.getBasemap(), (v) => mapCtl.setBasemap(/** @type {any} */ (v)));

  checkbox(menu.addSection(it.menu.overlays), it.map.openseamap, mapCtl.getSeamarks(),
    (on) => mapCtl.setSeamarks(on));

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
      const stale = wind.stale || waves.stale;
      if (stale) {
        notice.show(fill(it.notice.stale, { date: formatShortDateTime(Math.min(wind.fetchedMs, waves.fetchedMs)) }), 'warn');
      } else {
        notice.hide();
      }
      updateStatus();
      document.dispatchEvent(new CustomEvent('weather-updated'));
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      notice.show(err?.quota ? it.notice.quota : fill(it.notice.error, { msg: err?.message ?? String(err) }), 'error');
    } finally {
      if (seq === loadSeq) picker.setBusy(false);
    }
  }

  loadWeather(false);
}

start();
