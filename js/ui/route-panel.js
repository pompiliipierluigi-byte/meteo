// Pannello rotta (foglio in basso sopra il cursore temporale): punti, opzioni di calcolo (barca, vele,
// correttivi), calcolo nel worker con avanzamento e annullamento, riepilogo, avvisi e tabella dei passi.

import { it } from '../i18n/it.js';
import { formatLatLon, formatDateTime, formatShortDateTime, formatDeg, fmtNum, formatHm } from '../lib/format.js';
import { el, btn, input, field } from './panel.js';
import { correctionsFor, cleanProfile, PROFILE_DEFAULTS } from '../data/profile-repo.js';
import { errorMessage } from '../data/supabase.js';
import { fill } from '../lib/text.js';
import { modelLabel } from '../weather/models.js';
import { departureTimes, runDepartureWindow } from '../routing/departure-window.js';
import { categorize, CATEGORIES } from '../routing/departure-categories.js';
import { createPlacePicker } from './place-picker.js';
import { windowChart, CHART_COLORS } from './window-chart.js';

/**
 * Dipendenze per il calcolo.
 * @typedef {Object} RouteDeps
 * @property {() => {user: any, profile: import('../data/profile-repo.js').Profile | null,
 *   boats: import('../data/boats-repo.js').Boat[], activeBoatId: string | null,
 *   choice: import('../weather/models.js').ModelChoice, tMs: number}} context
 * @property {(choice: any, route: {lat: number, lon: number}[], departMs: number) => Promise<any>} getCorridor
 * @property {import('../routing/client.js').RoutingClient} routing
 * @property {ReturnType<typeof import('../map/route-layer.js').createRouteLayer>} layer
 * @property {(fields: Record<string, number>) => Promise<void>} saveCorrections
 * @property {EventTarget} weatherEvents servizio meteo (eventi "progress")
 * @property {() => void} [onLayout] il pannello ha cambiato altezza (la mappa deve ricalcolare le dimensioni)
 * @property {ReturnType<typeof import('../data/routes-repo.js').createRoutesRepo>} routesRepo
 * @property {(onOpen: (r: import('../data/routes-repo.js').SavedRoute) => void) => void} openSaved elenco delle rotte salvate
 * @property {(tMs: number) => void} [setTime] porta il cursore temporale a un istante
 * @property {() => import('../places/search.js').Place[]} [savedPlaces] luoghi salvati (per la ricerca)
 * @property {(p: import('../places/search.js').Place) => HTMLElement | null} [placeExtra] azioni in più su un risultato (salva)
 */

/**
 * Informazioni mostrate sotto il riepilogo.
 * @typedef {{boatName: string, sails: 'full' | 'white', runs: Record<string, number>, secs: number | null, savedAt?: string}} ResultInfo
 */

/**
 * Rotta mostrata, pronta per il salvataggio.
 * @typedef {{res: {track: any[], summary: any}, request: import('../routing/run.js').RouteRequest, model: any,
 *   boatId: string | null, info: ResultInfo, fromWindow: boolean, savedId?: string}} Current

/**
 * @param {HTMLElement} host contenitore (sopra la barra inferiore)
 * @param {HTMLElement} topbar
 * @param {import('./route-points.js').RoutePoints} points
 * @param {RouteDeps} deps
 * @returns {{root: HTMLElement, body: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, refresh: () => void, refreshOptions: () => void, showSaved: (r: import('../data/routes-repo.js').SavedRoute) => void}}
 */
export function createRoutePanel(host, topbar, points, deps) {
  const t = it.routePanel;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-btn route-btn';
  toggle.setAttribute('aria-label', t.open);
  toggle.title = t.open;
  toggle.innerHTML = '<span aria-hidden="true">🧭</span>';
  topbar.querySelector('.refresh-btn')?.before(toggle);

  const root = el('section', 'route-sheet hidden');
  root.setAttribute('aria-label', t.title);
  const head = el('div', 'route-sheet-head');
  const title = el('h2', '', t.title);
  const close = btn('✕', () => api.close(), 'icon-btn');
  close.setAttribute('aria-label', t.close);
  const savedBtn = btn(`📂 ${t.saved}`, () => deps.openSaved((r) => api.showSaved(r)), 'btn-small route-saved-btn');
  const headBtns = el('div', 'route-sheet-tools');
  headBtns.append(savedBtn, close);
  head.append(title, headBtns);
  // Durante la scelta di un punto il pannello si abbassa e lascia libera la mappa.
  const pickBar = el('div', 'route-pickbar hidden');
  const pickText = el('span', '');
  pickBar.append(pickText, btn(t.cancelPick, () => points.pick(null), 'btn-small'));
  const pointsBox = el('div', 'route-points');
  // Località: partenza, waypoint o arrivo da porto, luogo salvato o ricerca online.
  const picker = createPlacePicker({
    actions: [
      { label: 'P', title: t.asStart, onPick: (p) => points.place('start', p) },
      { label: '+', title: t.asWaypoint, onPick: (p) => points.place('waypoint', p) },
      { label: 'A', title: t.asEnd, onPick: (p) => points.place('end', p) },
    ],
    saved: () => deps.savedPlaces?.() ?? [],
    extra: (p) => deps.placeExtra?.(p) ?? null,
  });
  const body = el('div', 'route-sheet-body');
  const optionsBox = el('div', 'route-options');
  const runBox = el('div', 'route-run');
  const windowBox = el('div', 'route-window');
  const resultBox = el('div', 'route-result');
  body.append(pointsBox, optionsBox, runBox, windowBox, resultBox);
  root.append(head, pickBar, body);
  host.prepend(root);

  function renderPoints() {
    const { start, end, waypoints } = points.get();
    const picking = points.picking();
    const role = picking === 'start' || picking === 'end' || picking === 'waypoint' ? picking : null;
    root.classList.toggle('picking-min', Boolean(role));
    pickBar.classList.toggle('hidden', !role);
    if (role) pickText.textContent = it.routePoints.tapMap[role];
    deps.onLayout?.();
    pointsBox.replaceChildren();
    const row = (label, p, cls, ...buttons) => {
      const r = el('div', `rp-row ${cls}`);
      const txt = el('div', 'rp-text');
      txt.append(el('strong', '', label), el('small', '', p ? formatLatLon(p.lat, p.lon) : t.notSet));
      const b = el('div', 'rp-buttons');
      b.append(...buttons);
      r.append(txt, b);
      pointsBox.append(r);
    };
    const pickBtn = (role) => {
      const b = btn(picking === role ? t.tapNow : t.tap, () => points.pick(picking === role ? null : role), picking === role ? 'btn-small active' : 'btn-small');
      return b;
    };
    row(t.start, start, 'rp-row-start', pickBtn('start'), btn(t.gps, () => points.useGps(), 'btn-small'));
    waypoints.forEach((w, i) => {
      const up = btn('↑', () => points.moveWaypoint(i, -1), 'btn-small');
      up.setAttribute('aria-label', t.up);
      up.disabled = i === 0;
      const down = btn('↓', () => points.moveWaypoint(i, 1), 'btn-small');
      down.setAttribute('aria-label', t.down);
      down.disabled = i === waypoints.length - 1;
      const del = btn('✕', () => points.removeWaypoint(i), 'btn-small');
      del.setAttribute('aria-label', t.remove);
      row(`${t.waypoint} ${i + 1}`, w, 'rp-row-way', up, down, del);
    });
    row(t.end, end, 'rp-row-end', pickBtn('end'));
    const tools = el('div', 'btn-row');
    tools.append(
      btn(picking === 'waypoint' ? t.tapNow : t.addWaypoint, () => points.pick(picking === 'waypoint' ? null : 'waypoint'), picking === 'waypoint' ? 'btn-small active' : 'btn-small'),
      btn(t.clear, () => points.clear(), 'btn-small'),
    );
    pointsBox.append(tools, picker);
  }

  points.onChange(() => {
    renderPoints();
    renderRun();
  });
  renderPoints();

  // --- Opzioni di calcolo -------------------------------------------------------
  /** @type {'full' | 'white'} */
  let sails = 'full';
  /** @type {string | null} */
  let boatId = null;
  /** Correttivi modificati qui (valgono per il calcolo; "Salva nel profilo" li rende permanenti). */
  /** @type {Record<string, string>} */
  let corr = {};

  function renderOptions() {
    const c = deps.context();
    optionsBox.replaceChildren();
    if (!c.user) {
      optionsBox.append(el('p', 'muted', t.needLogin));
      return;
    }
    if (!c.boats.length) {
      optionsBox.append(el('p', 'muted', t.needBoat));
      return;
    }
    if (!boatId || !c.boats.some((b) => b.id === boatId)) boatId = c.activeBoatId ?? c.boats[0].id;
    const sel = document.createElement('select');
    for (const b of c.boats) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.name;
      sel.append(o);
    }
    sel.value = boatId;
    sel.addEventListener('change', () => { boatId = sel.value; });
    optionsBox.append(field(t.boat, sel));

    const sailsRow = el('div', 'opt-inline');
    sailsRow.append(el('span', 'field-label', t.sails));
    for (const k of /** @type {const} */ (['full', 'white'])) {
      const r = input('route-sails', k, { type: 'radio', checked: sails === k });
      r.addEventListener('change', () => { if (r.checked) sails = k; });
      const l = el('label', 'opt-row');
      l.append(r, el('span', '', t.sailNames[k]));
      sailsRow.append(l);
    }
    optionsBox.append(sailsRow);

    // Correttivi a portata di mano (richiesta del 2026-11-05).
    const p = { ...PROFILE_DEFAULTS, ...(c.profile ?? {}) };
    const det = document.createElement('details');
    det.className = 'route-corr';
    const sum = document.createElement('summary');
    const cur = (k) => corr[k] ?? String(p[k]);
    sum.textContent = fill(t.corrSummary, { up: cur('upwind_eff_pct'), down: cur('downwind_eff_pct'), white: cur('white_downwind_pct') });
    det.append(sum);
    for (const k of ['upwind_eff_pct', 'downwind_eff_pct', 'white_downwind_pct']) {
      const i = input(k, cur(k), { type: 'number', step: '1', inputMode: 'decimal' });
      i.addEventListener('input', () => { corr[k] = i.value; });
      det.append(field(it.profile.fields[k], i));
    }
    det.append(btn(t.saveCorr, async () => {
      const { value, errors } = cleanProfile(Object.fromEntries(Object.entries(corr)), it.profile.fields);
      if (errors.length) {
        showMsg(errors.join(' · '), 'error');
        return;
      }
      try {
        await deps.saveCorrections(value);
        corr = {};
        showMsg(t.corrSaved, 'ok');
        renderOptions();
      } catch (err) {
        showMsg(errorMessage(err), 'error');
      }
    }, 'btn-small'));
    optionsBox.append(det);

    // Isocrone non mostrate: troppo pesanti da disegnare sul telefono (2026-11-05).
  }

  // --- Calcolo --------------------------------------------------------------------
  /** @type {false | 'route' | 'window'} */
  let running = false;
  /** @type {{cancel: () => void} | null} finestra di partenza in corso */
  let winJob = null;
  /** @type {Current | null} */
  let current = null;
  const msg = el('p', 'panel-msg');

  /** @param {string} text @param {'ok' | 'error'} kind */
  function showMsg(text, kind) {
    msg.textContent = text;
    msg.dataset.kind = kind;
  }

  function renderRun() {
    const c = deps.context();
    runBox.replaceChildren();
    const depart = el('p', 'small', `${t.departure}: ${formatDateTime(c.tMs)} ${t.departureHint}`);
    const calc = btn(running === 'route' ? t.running : t.compute, compute, 'btn-primary');
    const win = btn(running === 'window' ? t.running : t.window, computeWindow, 'btn-secondary');
    calc.disabled = win.disabled = Boolean(running) || !c.user || !c.boats.length || points.route().length < 2;
    const row = el('div', 'btn-row');
    row.append(calc, win);
    if (running) row.append(btn(t.cancel, cancel, 'btn-danger'));
    runBox.append(depart, row, bar, msg);
  }

  const bar = el('div', 'progress hidden');
  const barFill = el('div', 'progress-fill');
  const barText = el('small', 'progress-text');
  bar.append(barFill, barText);
  /** @param {number} f 0–1 @param {string} text */
  const setBar = (f, text) => {
    bar.classList.remove('hidden');
    barFill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
    barText.textContent = text;
  };

  function cancel() {
    if (winJob) winJob.cancel();
    else deps.routing.cancel();
  }

  /**
   * Meteo del corridoio con avanzamento nella prima metà della barra.
   * @param {any} c contesto
   * @param {{lat: number, lon: number}[]} route
   * @param {number} untilMs ultima partenza prevista (Auto: decide se serve anche ECMWF)
   */
  async function corridorWeather(c, route, untilMs) {
    const onWx = (e) => {
      const { label, done, total, waitMs } = /** @type {CustomEvent} */ (e).detail;
      setBar(total ? (done / total) * 0.5 : 0, waitMs > 0 ? `${label}: ${done}/${total} · ${fill(it.notice.quotaWait, { s: Math.ceil(waitMs / 1000) })}` : `${label}: ${done}/${total}`);
    };
    deps.weatherEvents.addEventListener('progress', onWx);
    try {
      setBar(0, t.loadingWeather);
      return await deps.getCorridor(c.choice, route, untilMs);
    } finally {
      deps.weatherEvents.removeEventListener('progress', onWx);
    }
  }

  /**
   * Richiesta di calcolo con profilo, correttivi del pannello e barca.
   * @param {any} c contesto
   * @param {import('../data/boats-repo.js').Boat} boat
   * @param {{lat: number, lon: number}[]} route
   * @param {number} departMs
   * @returns {import('../routing/run.js').RouteRequest}
   */
  function buildRequest(c, boat, route, departMs) {
    const p = { ...PROFILE_DEFAULTS, ...(c.profile ?? {}) };
    const overrides = cleanProfile(corr).value;
    const prof = { ...p, ...overrides };
    return {
      route,
      departMs,
      polars: { full: boat.polars.full.data, white: boat.polars.white?.data ?? null },
      sails,
      corrections: correctionsFor(/** @type {any} */ (prof), boat),
      motor: {
        mode: prof.motor_mode,
        thresholdKn: Number(prof.motor_threshold_kn),
        speedKn: Number(boat.motor_speed_kn),
        nearLand: Boolean(prof.motor_near_land),
        nearLandNm: Number(prof.motor_near_land_nm),
      },
      limits: { twsKn: prof.limit_tws_kn, gustKn: prof.limit_gust_kn, waveM: prof.limit_wave_m },
      coastMarginNm: Number(prof.coast_margin_nm),
      coastWarningNm: Number(prof.coast_warning_nm),
      waveWarningM: Number(prof.wave_warning_m),
      keepIsochrones: false,
    };
  }

  /** Barca e punti pronti per il calcolo, o null. */
  function ready() {
    const c = deps.context();
    const boat = c.boats.find((b) => b.id === boatId);
    const route = points.route();
    if (!boat?.polars.full || route.length < 2) return null;
    return { c, boat, route };
  }

  /** @param {'route' | 'window'} kind */
  function begin(kind) {
    running = kind;
    showMsg('', 'ok');
    renderRun();
    resultBox.replaceChildren();
    deps.layer.clear();
    current = null;
  }

  /** @param {any} err */
  function failed(err) {
    bar.classList.add('hidden');
    showMsg(err?.code === 'cancelled' ? t.cancelled : (err?.message ?? errorMessage(err)), err?.code === 'cancelled' ? 'ok' : 'error');
  }

  async function compute() {
    const r = ready();
    if (!r) return;
    const { c, boat, route } = r;
    begin('route');
    windowBox.replaceChildren();
    win = null;
    try {
      const weather = await corridorWeather(c, route, c.tMs);
      const request = buildRequest(c, boat, route, c.tMs);
      setBar(0.5, t.computing);
      const t0 = performance.now();
      const res = await deps.routing.route(request, { wind: weather.wind.field, marine: weather.marine }, (f) => setBar(0.5 + f * 0.5, `${t.computing} ${Math.round(f * 100)} %`));
      const secs = (performance.now() - t0) / 1000;
      deps.layer.show(res);
      deps.layer.setTime(deps.context().tMs);
      deps.layer.fit();
      const info = { boatName: boat.name, sails, runs: weather.wind.runs ?? {}, secs };
      current = { res, request, model: c.choice, boatId: boat.id, info, fromWindow: false };
      renderResult(res, info);
      bar.classList.add('hidden');
    } catch (err) {
      failed(err);
    } finally {
      running = false;
      renderRun();
    }
  }

  // --- Finestra di partenza (SPEC §2.7) -----------------------------------------------
  /**
   * Stato dell'ultima finestra calcolata.
   * @type {{departures: number[], runs: (import('../routing/departure-window.js').WindowRun | undefined)[],
   *   selected: number | null, info: ResultInfo, request: import('../routing/run.js').RouteRequest | null,
   *   model: any, boatId: string | null, limits: import('../routing/run.js').RouteRequest['limits'], waveWarningM: number,
   *   saved?: boolean} | null}
   */
  let win = null;

  async function computeWindow() {
    const r = ready();
    if (!r) return;
    const { c, boat, route } = r;
    begin('window');
    const departures = departureTimes(Math.max(c.tMs, Date.now()));
    const request = buildRequest(c, boat, route, departures[0]);
    win = {
      departures, runs: new Array(departures.length), selected: null, info: { boatName: boat.name, sails, runs: {}, secs: null },
      request, model: c.choice, boatId: boat.id, limits: request.limits, waveWarningM: request.waveWarningM,
    };
    renderWindow();
    try {
      const weather = await corridorWeather(c, route, departures[departures.length - 1]);
      win.info.runs = weather.wind.runs ?? {};
      const t0 = performance.now();
      setBar(0.5, fill(t.windowProgress, { n: 0, total: departures.length }));
      const job = runDepartureWindow({
        request,
        weather: { wind: weather.wind.field, marine: weather.marine },
        departures,
        primary: deps.routing,
        onRun: (i, run) => {
          if (win) win.runs[i] = run;
          renderWindow();
        },
        onProgress: (n, total, f) => setBar(0.5 + f * 0.5, fill(t.windowProgress, { n, total })),
      });
      winJob = job;
      await job.done;
      win.info = { ...win.info, secs: (performance.now() - t0) / 1000 };
      bar.classList.add('hidden');
      renderWindow();
    } catch (err) {
      failed(err);
      if (err?.code === 'cancelled' && win && !win.runs.some(Boolean)) {
        win = null;
        windowBox.replaceChildren();
      }
    } finally {
      winJob = null;
      running = false;
      renderRun();
    }
  }

  /** Mostra su mappa e nel riepilogo la rotta di una partenza della finestra. @param {number} i */
  function selectRun(i) {
    const run = win?.runs[i];
    if (!win || !run) return;
    win.selected = i;
    renderWindow();
    resultBox.replaceChildren();
    deps.layer.clear();
    current = null;
    if (run.error) {
      resultBox.append(el('p', 'panel-msg', run.error.message));
      return;
    }
    if (!run.track) {
      // Finestra riaperta: solo i riepiloghi sono salvati (SPEC §4.4).
      renderResult({ track: [], summary: run.summary }, { ...win.info, secs: null });
      resultBox.append(el('p', 'field-hint', t.noTrackSaved));
      return;
    }
    const res = { track: /** @type {any} */ (run.track), summary: run.summary };
    deps.layer.show(res);
    deps.layer.setTime(deps.context().tMs);
    deps.layer.fit();
    if (win.request) {
      current = { res, request: { ...win.request, departMs: run.departMs }, model: win.model, boatId: win.boatId, info: { ...win.info, secs: null }, fromWindow: true };
    }
    // Tempo di calcolo: è quello dell'intera finestra, mostrato sotto il grafico.
    renderResult(res, { ...win.info, secs: null });
  }

  function renderWindow() {
    windowBox.replaceChildren();
    if (!win) return;
    windowBox.append(el('h3', 'route-window-title', t.windowTitle), el('p', 'route-disclaimer', `⚠️ ${it.disclaimer.bar}`));
    // Categorie solo a finestra completa (prima cambierebbero a ogni run).
    const complete = win.runs.filter(Boolean).length === win.departures.length;
    const cls = complete ? categorize(win.runs, { limits: win.limits, waveWarningM: win.waveWarningM }) : null;
    const wrap = el('div', 'window-chart-wrap');
    wrap.append(windowChart({
      departures: win.departures,
      runs: win.runs,
      classes: cls?.runs ?? null,
      selected: win.selected,
      onSelect: selectRun,
      labels: { title: t.windowTitle, h: 'h', kn: 'kn', m: 'm', notFound: t.windowNotFound, limit: t.outOfLimits, pending: t.windowPending, categories: t.categories },
    }));
    windowBox.append(wrap);
    // Legenda delle serie.
    const legend = el('div', 'window-legend');
    const key = (color, text, kind = 'box') => {
      const k = el('span', `wl-item wl-${kind}`);
      const sw = el('i', '');
      sw.style.background = color;
      k.append(sw, document.createTextNode(text));
      legend.append(k);
    };
    key(CHART_COLORS.sail, t.legend.duration);
    key(CHART_COLORS.motor, t.legend.motor);
    key(CHART_COLORS.wind, t.legend.wind, 'line');
    key(CHART_COLORS.gust, t.legend.gust, 'line');
    key(CHART_COLORS.wave, t.legend.wave, 'line');
    key(CHART_COLORS.limit, t.outOfLimits);
    windowBox.append(legend);
    // Categorie: pulsanti che selezionano la partenza.
    if (cls) {
      const cats = el('div', 'window-cats');
      for (const k of CATEGORIES) {
        const i = cls.best[k];
        const row = el('button', `wc-cat${i !== null && i === win.selected ? ' active' : ''}`);
        /** @type {HTMLButtonElement} */ (row).type = 'button';
        const dot = el('i', '');
        dot.style.background = CHART_COLORS.categories[k];
        const s = i !== null ? win.runs[i]?.summary : null;
        row.append(dot, el('strong', '', t.categories[k]), el('span', '', i === null || !s
          ? `${t.categoryHints[k]} — ${t.windowNone}`
          : `${formatShortDateTime(win.departures[i])} · ${formatHm(s.duration_h)} h · ${t.motorShort} ${formatHm(s.motor_h)} — ${t.categoryHints[k]}`));
        if (i !== null) row.addEventListener('click', () => selectRun(/** @type {number} */ (i)));
        else /** @type {HTMLButtonElement} */ (row).disabled = true;
        cats.append(row);
      }
      windowBox.append(cats);
      const nf = win.runs.filter((r) => r?.error).length;
      if (nf) windowBox.append(el('small', 'muted', fill(t.windowNotFoundCount, { n: nf })));
    }
    if (win.info.secs) windowBox.append(el('small', 'muted', fill(t.windowMeta, { secs: win.info.secs.toFixed(0) })));
    else if (win.saved) windowBox.append(el('small', 'muted', t.windowSavedHint));
  }

  // --- Risultato ------------------------------------------------------------------
  /**
   * @param {{track: import('../routing/isochrone.js').TrackPoint[], summary: any}} res
   * @param {ResultInfo} info
   */
  function renderResult(res, info) {
    const s = res.summary;
    resultBox.replaceChildren();
    resultBox.append(el('p', 'route-disclaimer', `⚠️ ${it.disclaimer.bar}`));
    const grid = el('dl', 'route-summary');
    const item = (k, v) => grid.append(el('dt', '', k), el('dd', '', v));
    const hm = (h) => `${formatHm(h).replace(':', ' h ')} min`;
    item(t.sum.arrival, formatDateTime(s.arrival_ms));
    item(t.sum.duration, hm(s.duration_h));
    item(t.sum.distance, `${fmtNum(s.distance_nm, 1)} NM`);
    item(t.sum.motor, hm(s.motor_h));
    item(t.sum.maxTws, `${fmtNum(s.max_tws_kn, 1)} kn`);
    item(t.sum.maxGust, `${fmtNum(s.max_gust_kn, 1)} kn`);
    item(t.sum.maxWave, s.max_wave_m > 0 ? `${fmtNum(s.max_wave_m, 1)} m` : it.probe.noData);
    resultBox.append(grid);
    const runs = Object.entries(info.runs ?? {}).map(([m, r]) => `${modelLabel(/** @type {any} */ (m))} ${formatShortDateTime(r)}`).join(', ');
    const meta = { boat: info.boatName, sails: t.sailNames[info.sails] ?? info.sails, runs, secs: info.secs?.toFixed(1) ?? '' };
    resultBox.append(el('small', 'muted', fill(info.savedAt ? t.sum.metaSaved : info.secs !== null ? t.sum.meta : t.sum.metaNoTime, { ...meta, date: info.savedAt ?? '' })));
    resultBox.append(saveBox());
    if (s.warnings.length) {
      const ul = el('ul', 'route-warnings');
      for (const w of s.warnings) ul.append(el('li', '', t.warnings[w] ?? w));
      resultBox.append(ul);
    }
    if (!res.track.length) return;
    // Tabella dei passi.
    const table = document.createElement('table');
    table.className = 'route-table';
    const head = document.createElement('tr');
    for (const h of t.cols) head.append(Object.assign(document.createElement('th'), { textContent: h }));
    table.append(head);
    for (const q of res.track) {
      const tr = document.createElement('tr');
      if (q.warn.length) tr.className = 'warn';
      const cells = [
        formatShortDateTime(q.t).slice(6),
        formatLatLon(q.lat, q.lon),
        formatDeg(q.cog),
        fmtNum(q.sog, 1),
        fmtNum(q.tws, 0),
        Number.isFinite(q.twa) ? `${Math.round(Math.abs(q.twa))}°${q.twa < 0 ? 'S' : 'D'}` : '',
        fmtNum(q.gust, 0),
        Number.isFinite(q.wave_h) ? fmtNum(q.wave_h, 1) : '',
        q.motor ? t.motorShort : t.sailShort,
      ];
      for (const v of cells) tr.append(Object.assign(document.createElement('td'), { textContent: v }));
      table.append(tr);
    }
    const wrap = el('div', 'route-table-wrap');
    wrap.append(table);
    resultBox.append(wrap, el('small', 'field-hint', t.tableHint));
  }

  /** Salvataggio della rotta mostrata (nome modificabile). */
  function saveBox() {
    const box = el('div', 'route-save');
    const cur = current;
    if (!cur) return box;
    if (cur.savedId) {
      box.append(el('p', 'small', `✓ ${t.savedOk}`));
      return box;
    }
    if (!deps.context().user) return box;
    const pts = cur.request.route;
    const def = fill(t.defaultName, {
      from: formatLatLon(pts[0].lat, pts[0].lon).split(' ')[0],
      to: formatLatLon(pts[pts.length - 1].lat, pts[pts.length - 1].lon).split(' ')[0],
      date: formatShortDateTime(cur.res.summary.departure_ms),
    });
    const name = input('route-name', def, { maxLength: 100 });
    const m = el('small', 'panel-msg');
    const save = btn(t.save, async () => {
      save.disabled = true;
      try {
        cur.savedId = await deps.routesRepo.save({
          name: name.value,
          boatId: cur.boatId,
          boatName: cur.info.boatName,
          route: cur.request.route,
          model: cur.model,
          runs: cur.info.runs,
          request: cur.request,
          track: cur.res.track,
          summary: cur.res.summary,
          window: cur.fromWindow && win ? { departures: win.departures, runs: win.runs, selected: win.selected, limits: win.limits, waveWarningM: win.waveWarningM } : null,
        });
        box.replaceChildren(el('p', 'small', `✓ ${t.savedOk}`));
      } catch (err) {
        save.disabled = false;
        m.textContent = err?.errors ? err.errors.join(' · ') : errorMessage(err);
        m.dataset.kind = 'error';
      }
    }, 'btn-primary');
    const row = el('div', 'route-save-row');
    row.append(name, save);
    box.append(field(t.saveName, /** @type {any} */ (row)), m);
    if (cur.fromWindow) box.append(el('small', 'field-hint', t.saveWithWindow));
    return box;
  }

  /**
   * Riapre una rotta salvata: punti, traccia e riepilogo come al salvataggio, finestra se presente.
   * @param {import('../data/routes-repo.js').SavedRoute} r
   */
  function showSaved(r) {
    if (running) cancel();
    points.set(r.route);
    deps.layer.clear();
    resultBox.replaceChildren();
    windowBox.replaceChildren();
    showMsg('', 'ok');
    const info = {
      boatName: r.params.boatName ?? '—',
      sails: r.polar_kind,
      runs: r.params.runs ?? {},
      secs: null,
      savedAt: formatShortDateTime(Date.parse(r.created_at)),
    };
    const res = { track: r.track, summary: r.summary };
    current = { res, request: /** @type {any} */ ({ ...r.params, route: r.route, departMs: r.departMs }), model: r.model, boatId: r.boat_id, info, fromWindow: false, savedId: r.id };
    win = null;
    if (r.window?.departures?.length) {
      win = {
        departures: r.window.departures,
        runs: r.window.departures.map((d, i) => {
          const w = r.window?.runs[i];
          if (!w) return undefined;
          // La partenza salvata ha anche la traccia.
          if (i === r.window?.selected && w.summary) return { departMs: d, summary: r.summary, track: r.track };
          return w.error ? { departMs: d, error: w.error } : { departMs: d, summary: w.summary };
        }),
        selected: r.window.selected,
        info,
        request: null,
        model: r.model,
        boatId: r.boat_id,
        limits: r.window.limits,
        waveWarningM: r.window.waveWarningM,
        saved: true,
      };
      renderWindow();
    }
    api.open();
    deps.setTime?.(r.departMs);
    deps.layer.show(res);
    deps.layer.setTime(deps.context().tMs);
    deps.layer.fit();
    renderResult(res, info);
  }

  renderOptions();
  renderRun();

  const api = {
    root,
    body,
    open() {
      renderOptions();
      renderRun();
      root.classList.remove('hidden');
      toggle.classList.add('active');
      deps.onLayout?.();
    },
    close() {
      root.classList.add('hidden');
      toggle.classList.remove('active');
      points.pick(null);
      deps.onLayout?.();
    },
    isOpen: () => !root.classList.contains('hidden'),
    /** Ora di partenza cambiata (cursore). */
    refresh() {
      renderRun();
    },
    /** Account, barche o profilo cambiati. */
    refreshOptions() {
      renderOptions();
      renderRun();
      savedBtn.classList.toggle('hidden', !deps.context().user);
    },
    showSaved,
  };
  toggle.addEventListener('click', () => (api.isOpen() ? api.close() : api.open()));
  return api;
}
