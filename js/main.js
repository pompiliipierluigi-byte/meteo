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
import { createRoutePoints } from './ui/route-points.js';
import { createRoutePanel } from './ui/route-panel.js';
import { RoutingClient } from './routing/client.js';
import { initAuth } from './ui/auth.js';
import { getClient } from './data/supabase.js';
import { createBoatsRepo } from './data/boats-repo.js';
import { openBoatsPanel } from './ui/boats-panel.js';
import { createProfileRepo, cleanProfile } from './data/profile-repo.js';
import { openProfilePanel } from './ui/profile-panel.js';
import { polarChart } from './ui/polar-chart.js';
import { correctionsFor, PROFILE_DEFAULTS } from './data/profile-repo.js';
import { errorMessage } from './data/supabase.js';
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
  const version = document.createElement('span');
  version.className = 'app-version';
  version.textContent = fill(it.app.version, { v: APP_VERSION });
  bottombar.querySelector('.disclaimer-bar')?.append(version);

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

  // --- Account: profilo, barca attiva, barche (solo con login, SPEC §2.9) ---
  const auth = initAuth(topbar, menu.addSection(it.auth.section));
  const boatsRepo = createBoatsRepo(getClient);
  const profileRepo = createProfileRepo(getClient);
  /** @type {import('./data/profile-repo.js').Profile | null} */
  let profile = null;
  /** @type {import('./data/boats-repo.js').Boat[]} */
  let boats = [];
  const accountSec = menu.addSection(it.boats.section);
  const accountHint = document.createElement('p');
  accountHint.className = 'muted small';
  const activeLine = document.createElement('p');
  activeLine.className = 'small';
  const accountBtns = document.createElement('div');
  accountBtns.className = 'btn-row';
  const boatsBtn = document.createElement('button');
  boatsBtn.type = 'button';
  boatsBtn.className = 'btn-secondary';
  boatsBtn.textContent = it.boats.open;
  const profileBtn = document.createElement('button');
  profileBtn.type = 'button';
  profileBtn.className = 'btn-secondary';
  profileBtn.textContent = it.profile.open;
  accountBtns.append(boatsBtn, profileBtn);
  accountSec.append(accountHint, activeLine, accountBtns);

  const activeBoat = () => boats.find((b) => b.id === profile?.default_boat_id) ?? null;
  const renderAccount = () => {
    const on = Boolean(auth.user());
    accountBtns.classList.toggle('hidden', !on);
    activeLine.classList.toggle('hidden', !on);
    accountHint.classList.toggle('hidden', on);
    accountHint.textContent = it.boats.needLogin;
    const a = activeBoat();
    activeLine.textContent = a ? `${it.boats.activeLabel}: ${a.name}` : it.boats.noActive;
  };

  /** Ricarica profilo e barche dopo login o modifiche; errori mostrati senza bloccare mappa e meteo. */
  async function refreshAccount() {
    if (!auth.user()) {
      profile = null;
      boats = [];
      renderAccount();
      return;
    }
    try {
      [profile, boats] = await Promise.all([profileRepo.get(), boatsRepo.list()]);
      // Preferenze salvate nel profilo: modello applicato all'accesso.
      const pref = profile?.settings?.model;
      if (pref && MODEL_CHOICES.includes(pref) && pref !== state.choice) {
        state.choice = pref;
        setPref('model', pref);
        picker.setChoice(pref);
        loadWeather(false);
      }
    } catch (err) {
      console.warn(err);
      recordError(err);
      notice.show(errorMessage(err), 'error');
    }
    renderAccount();
  }

  const chartLabels = { kn: 'kn', full: it.chart.full, white: it.chart.white, tws: it.chart.tws };
  /**
   * Diagramma polare di una barca con i correttivi indicati (di default quelli del profilo).
   * @param {import('./data/boats-repo.js').Boat} b
   * @param {Record<string, any>} [prof]
   */
  const boatChart = (b, prof) => {
    if (!b.polars.full) return null;
    const c = correctionsFor(/** @type {any} */ ({ ...PROFILE_DEFAULTS, ...(prof ?? profile ?? {}) }), b);
    if (![c.upwindEffPct, c.downwindEffPct, c.whiteDownwindPct, c.splitTwaDeg].every(Number.isFinite)) return null;
    return polarChart({ full: b.polars.full.data, white: b.polars.white?.data ?? null }, c, { labels: chartLabels });
  };

  /** @param {string | null} boatId */
  async function setActiveBoat(boatId) {
    if (!profile) return;
    const { value } = cleanProfile({ default_boat_id: boatId });
    await profileRepo.update(profile.id, value);
    profile.default_boat_id = boatId;
    renderAccount();
  }

  boatsBtn.addEventListener('click', () => {
    menu.close();
    const panel = openBoatsPanel({
      repo: boatsRepo,
      onChanged: () => { refreshAccount(); },
      preview: (b) => boatChart(b),
      extraActions: (b) => {
        if (b.id === profile?.default_boat_id) return Object.assign(document.createElement('span'), { className: 'badge badge-active', textContent: `★ ${it.boats.active}` });
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'btn-secondary';
        x.textContent = it.boats.makeActive;
        x.addEventListener('click', async () => {
          x.disabled = true;
          try {
            await setActiveBoat(b.id);
            panel.close();
            boatsBtn.click();
          } catch (err) {
            x.disabled = false;
            notice.show(errorMessage(err), 'error');
          }
        });
        return x;
      },
    });
  });

  profileBtn.addEventListener('click', () => {
    menu.close();
    if (!profile) {
      notice.show(it.profile.unavailable, 'error');
      return;
    }
    openProfilePanel({
      profile,
      repo: profileRepo,
      onSaved: (p) => { profile = p; renderAccount(); },
      currentSettings: () => ({ model: state.choice, layers: wx.settings() }),
      // Il diagramma della barca attiva si aggiorna a ogni modifica dei correttivi.
      preview: (draft) => {
        const b = activeBoat() ?? boats[0];
        if (!b) return null;
        const num = (k) => Number(String(draft[k]).replace(',', '.'));
        const box = document.createElement('div');
        box.className = 'profile-chart';
        const chart = boatChart(b, {
          upwind_eff_pct: num('upwind_eff_pct'),
          downwind_eff_pct: num('downwind_eff_pct'),
          white_downwind_pct: num('white_downwind_pct'),
          split_twa_deg: num('split_twa_deg'),
        });
        if (!chart) return null;
        box.append(Object.assign(document.createElement('small'), { className: 'field-hint', textContent: `${it.chart.of} ${b.name}` }), chart);
        return box;
      },
    });
  });

  auth.onChange(() => { refreshAccount(); });
  renderAccount();

  const legend = createLegend(document.getElementById('map'));
  const waveNames = { wave: it.layers.waveTotal, wwave: it.layers.waveWind, swell: it.layers.waveSwell };
  /** @param {import('./map/weather-layers.js').LayerSettings} s */
  const updateLegend = (s) => legend.update({
    wind: s.windField || s.windArrows || (s.windParticles && !s.windField && s.wave === 'none'),
    wave: s.wave === 'none' ? null : waveNames[s.wave],
    current: s.currents,
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

  // Correnti: scaricate solo quando il layer è attivo (quota Open-Meteo).
  const curSec = menu.addSection(it.layers.currentsSection);
  let currentsLoaded = false;
  const loadCurrents = async () => {
    if (currentsLoaded) return;
    try {
      const c = await weather.getCurrents();
      currentsLoaded = true;
      wx.setCurrents(c.field);
    } catch (err) {
      recordError(err);
      notice.show(fill(it.notice.error, { msg: err?.message ?? String(err) }), 'error');
    }
  };
  checkbox(curSec, it.layers.currents, ls.currents, (on) => {
    wx.setToggle('currents', on);
    if (on) loadCurrents();
  });
  curSec.append(Object.assign(document.createElement('small'), { className: 'field-hint', textContent: it.layers.currentsHint }));
  if (ls.currents) setTimeout(loadCurrents, 0);

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

  // --- Rotta (fase 3) ---
  const routing = new RoutingClient();
  const routePoints = createRoutePoints(mapCtl.map, L, {
    snap: (pts) => routing.snap(pts, 0.15),
    notify: (text, kind = 'info') => notice.show(text, kind),
  });
  const routePanel = createRoutePanel(bottombar, topbar, routePoints);

  const probe = initProbe(mapCtl.map, L, () => state, () => routePoints.picking() !== null);

  const slider = createTimeSlider(bottombar, (tMs) => {
    state.tMs = tMs;
    updateStatus();
    wx.setTime(tMs);
    probe.refresh();
    document.dispatchEvent(new CustomEvent('time-changed'));
  });
  state.tMs = slider.get();
  wx.setTime(state.tMs);
  // Il pannello rotta sta sopra il cursore temporale.
  bottombar.prepend(routePanel.root);

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
