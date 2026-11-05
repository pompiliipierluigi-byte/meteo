// Pannello rotta (foglio in basso sopra il cursore temporale): punti, opzioni di calcolo (barca, vele,
// correttivi), calcolo nel worker con avanzamento e annullamento, riepilogo, avvisi e tabella dei passi.

import { it } from '../i18n/it.js';
import { formatLatLon, formatDateTime, formatShortDateTime, formatDeg, fmtNum } from '../lib/format.js';
import { el, btn, input, field } from './panel.js';
import { correctionsFor, cleanProfile, PROFILE_DEFAULTS } from '../data/profile-repo.js';
import { errorMessage } from '../data/supabase.js';
import { fill } from '../lib/text.js';
import { modelLabel } from '../weather/models.js';

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
 */

/**
 * @param {HTMLElement} host contenitore (sopra la barra inferiore)
 * @param {HTMLElement} topbar
 * @param {import('./route-points.js').RoutePoints} points
 * @param {RouteDeps} deps
 * @returns {{root: HTMLElement, body: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean, refresh: () => void, refreshOptions: () => void}}
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
  head.append(title, close);
  const pointsBox = el('div', 'route-points');
  const body = el('div', 'route-sheet-body');
  const optionsBox = el('div', 'route-options');
  const runBox = el('div', 'route-run');
  const resultBox = el('div', 'route-result');
  body.append(pointsBox, optionsBox, runBox, resultBox);
  root.append(head, body);
  host.prepend(root);

  function renderPoints() {
    const { start, end, waypoints } = points.get();
    const picking = points.picking();
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
    pointsBox.append(tools);
  }

  points.onChange(() => {
    renderPoints();
    renderRun();
  });
  renderPoints();

  // --- Opzioni di calcolo -------------------------------------------------------
  /** @type {'full' | 'white'} */
  let sails = 'full';
  let showIso = false;
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

    const iso = input('iso', '', { type: 'checkbox', checked: showIso });
    iso.addEventListener('change', () => {
      showIso = iso.checked;
      deps.layer.setIsochrones(showIso);
    });
    const isoRow = el('label', 'opt-row');
    isoRow.append(iso, el('span', '', t.showIso));
    optionsBox.append(isoRow);
  }

  // --- Calcolo --------------------------------------------------------------------
  let running = false;
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
    const calc = btn(running ? t.running : t.compute, compute, 'btn-primary');
    calc.disabled = running || !c.user || !c.boats.length || points.route().length < 2;
    const row = el('div', 'btn-row');
    row.append(calc);
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
    deps.routing.cancel();
  }

  async function compute() {
    const c = deps.context();
    const boat = c.boats.find((b) => b.id === boatId);
    const route = points.route();
    if (!boat?.polars.full || route.length < 2) return;
    running = true;
    showMsg('', 'ok');
    renderRun();
    resultBox.replaceChildren();
    deps.layer.clear();
    const onWx = (e) => {
      const { label, done, total, waitMs } = /** @type {CustomEvent} */ (e).detail;
      setBar(total ? (done / total) * 0.5 : 0, waitMs > 0 ? `${label}: ${done}/${total} · ${fill(it.notice.quotaWait, { s: Math.ceil(waitMs / 1000) })}` : `${label}: ${done}/${total}`);
    };
    deps.weatherEvents.addEventListener('progress', onWx);
    try {
      setBar(0, t.loadingWeather);
      const weather = await deps.getCorridor(c.choice, route, c.tMs);
      deps.weatherEvents.removeEventListener('progress', onWx);
      const p = { ...PROFILE_DEFAULTS, ...(c.profile ?? {}) };
      const overrides = cleanProfile(corr).value;
      const prof = { ...p, ...overrides };
      const request = {
        route,
        departMs: c.tMs,
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
        keepIsochrones: true,
      };
      setBar(0.5, t.computing);
      const t0 = performance.now();
      const res = await deps.routing.route(request, { wind: weather.wind.field, marine: weather.marine }, (f) => setBar(0.5 + f * 0.5, `${t.computing} ${Math.round(f * 100)} %`));
      const secs = (performance.now() - t0) / 1000;
      deps.layer.show(res, { showIsochrones: showIso });
      deps.layer.setTime(deps.context().tMs);
      deps.layer.fit();
      renderResult(res, { boat, sails, weather, secs });
      bar.classList.add('hidden');
    } catch (err) {
      bar.classList.add('hidden');
      showMsg(err?.code === 'cancelled' ? t.cancelled : (err?.message ?? errorMessage(err)), err?.code === 'cancelled' ? 'ok' : 'error');
    } finally {
      deps.weatherEvents.removeEventListener('progress', onWx);
      running = false;
      renderRun();
    }
  }

  // --- Risultato ------------------------------------------------------------------
  /**
   * @param {{track: import('../routing/isochrone.js').TrackPoint[], summary: any}} res
   * @param {{boat: any, sails: string, weather: any, secs: number}} info
   */
  function renderResult(res, info) {
    const s = res.summary;
    resultBox.replaceChildren();
    resultBox.append(el('p', 'route-disclaimer', `⚠️ ${it.disclaimer.bar}`));
    const grid = el('dl', 'route-summary');
    const item = (k, v) => grid.append(el('dt', '', k), el('dd', '', v));
    const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
    item(t.sum.arrival, formatDateTime(s.arrival_ms));
    item(t.sum.duration, hm(s.duration_h));
    item(t.sum.distance, `${fmtNum(s.distance_nm, 1)} NM`);
    item(t.sum.motor, hm(s.motor_h));
    item(t.sum.maxTws, `${fmtNum(s.max_tws_kn, 1)} kn`);
    item(t.sum.maxGust, `${fmtNum(s.max_gust_kn, 1)} kn`);
    item(t.sum.maxWave, s.max_wave_m > 0 ? `${fmtNum(s.max_wave_m, 1)} m` : it.probe.noData);
    resultBox.append(grid);
    const runs = Object.entries(info.weather.wind.runs ?? {}).map(([m, r]) => `${modelLabel(/** @type {any} */ (m))} ${formatShortDateTime(r)}`).join(', ');
    resultBox.append(el('small', 'muted', fill(t.sum.meta, { boat: info.boat.name, sails: t.sailNames[info.sails], runs, secs: info.secs.toFixed(1) })));
    if (s.warnings.length) {
      const ul = el('ul', 'route-warnings');
      for (const w of s.warnings) ul.append(el('li', '', t.warnings[w] ?? w));
      resultBox.append(ul);
    }
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
    },
  };
  toggle.addEventListener('click', () => (api.isOpen() ? api.close() : api.open()));
  return api;
}
