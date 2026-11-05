// Pagina "Sole, luna e maree" (SPEC §2.12–2.13) per una località e un giorno.

import { it } from '../i18n/it.js';
import { openPanel, el, btn } from './panel.js';
import { dayEphemeris, nextPhases } from '../lib/astro.js';
import { formatLatLon, formatTime, formatShortDateTime, startOfLocalDay, formatHm, localHour, fmtNum } from '../lib/format.js';
import { getTide, tideExtremes } from '../weather/tides.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400e3;
const MOON_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

/**
 * @typedef {{lat: number, lon: number, name?: string}} Place
 */

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {string} [text]
 */
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Icona della fase (8 settori). @param {number} age 0–1 */
export const moonIcon = (age) => MOON_ICONS[Math.round(age * 8) % 8];

/**
 * Grafico della marea del giorno: curva oraria, alte/basse, ora attuale.
 * @param {import('../weather/tides.js').TideData} tide
 * @param {number} day0 inizio del giorno locale
 * @param {{t: number, levelM: number, kind: string}[]} ext
 */
function tideChart(tide, day0, ext) {
  const W = 340;
  const H = 130;
  const left = 30;
  const right = 8;
  const top = 14;
  const base = H - 20;
  const lv = tide.levelsM.filter(Number.isFinite);
  const lo = Math.floor(Math.min(...lv) * 10) / 10;
  const hi = Math.ceil(Math.max(...lv) * 10) / 10;
  const span = Math.max(0.1, hi - lo);
  const x = (t) => left + ((t - day0) / DAY) * (W - left - right);
  const y = (v) => base - ((v - lo) / span) * (base - top);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tide-chart', role: 'img' });
  root.append(svg('title', {}, it.almanac.tideTitle));
  for (const v of [lo, (lo + hi) / 2, hi]) {
    root.append(svg('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), stroke: '#e3e8ee', 'stroke-width': 0.7 }));
    root.append(svg('text', { x: left - 3, y: y(v) + 3, 'font-size': 8, 'text-anchor': 'end', fill: '#5b6878' }, v.toFixed(1)));
  }
  root.append(svg('text', { x: 2, y: 9, 'font-size': 8, fill: '#5b6878' }, 'm'));
  for (let h = 0; h <= 24; h += 3) {
    const t = day0 + h * 3600e3;
    root.append(svg('text', { x: x(t), y: H - 6, 'font-size': 8, 'text-anchor': 'middle', fill: '#1b2430' }, String(h).padStart(2, '0')));
  }
  let d = '';
  let pen = false;
  tide.timesMs.forEach((t, i) => {
    const v = tide.levelsM[i];
    if (t < day0 - 3600e3 || t > day0 + DAY + 3600e3 || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  const clip = svg('clipPath', { id: 'tide-clip' });
  clip.append(svg('rect', { x: left, y: 0, width: W - left - right, height: H }));
  root.append(clip);
  root.append(svg('path', { d, fill: 'none', stroke: '#1c5d99', 'stroke-width': 1.8, 'clip-path': 'url(#tide-clip)' }));
  for (const e of ext) {
    if (e.t < day0 || e.t >= day0 + DAY) continue;
    root.append(svg('circle', { cx: x(e.t), cy: y(e.levelM), r: 2.8, fill: e.kind === 'high' ? '#1c5d99' : '#e8590c' }));
    root.append(svg('text', { x: x(e.t), y: y(e.levelM) + (e.kind === 'high' ? -5 : 11), 'font-size': 8, 'text-anchor': 'middle', fill: '#1b2430' }, formatTime(e.t)));
  }
  const now = Date.now();
  if (now >= day0 && now < day0 + DAY) {
    root.append(svg('line', { x1: x(now), x2: x(now), y1: top - 4, y2: base, stroke: '#ffc43d', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
  }
  return root;
}

/**
 * Apre la pagina.
 * @param {{place: Place, mapCenter: () => Place, onPickPlace?: (cb: (p: Place) => void) => HTMLElement | null}} deps
 */
export function openAlmanacPanel(deps) {
  const t = it.almanac;
  const panel = openPanel(t.title);
  /** @type {Place} */
  let place = deps.place;
  let day0 = startOfLocalDay(Date.now());
  /** @type {import('../weather/tides.js').TideData | null} */
  let tide = null;
  /** @type {string} */
  let tideMsg = '';
  let tideSeq = 0;

  async function loadTide() {
    const seq = ++tideSeq;
    tide = null;
    tideMsg = t.tideLoading;
    render();
    try {
      const r = await getTide(place.lat, place.lon);
      if (seq !== tideSeq) return;
      tide = r;
      tideMsg = '';
    } catch (err) {
      if (seq !== tideSeq) return;
      tideMsg = err?.message ?? String(err);
    }
    render();
  }

  /** @param {Place} p */
  function setPlace(p) {
    place = p;
    loadTide();
  }

  function gps() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: t.gpsName }),
      () => { tideMsg = it.routePoints.gpsError; render(); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  }

  function render() {
    const body = panel.body;
    body.replaceChildren();
    // Località.
    const head = el('div', 'alm-place');
    head.append(el('strong', '', place.name ?? t.point), el('small', 'muted', formatLatLon(place.lat, place.lon)));
    const tools = el('div', 'btn-row');
    tools.append(btn(t.mapCenter, () => setPlace({ ...deps.mapCenter(), name: t.mapCenterName }), 'btn-small'), btn(t.gps, gps, 'btn-small'));
    const picker = deps.onPickPlace?.((p) => setPlace(p));
    body.append(head, tools);
    if (picker) body.append(picker);
    // Giorni.
    const days = el('div', 'alm-days');
    const today = startOfLocalDay(Date.now());
    for (let k = 0; k < 5; k++) {
      const d = startOfLocalDay(today + k * DAY + 12 * 3600e3);
      const label = k === 0 ? t.today : k === 1 ? t.tomorrow : formatShortDateTime(d).slice(0, 5);
      days.append(btn(label, () => { day0 = d; render(); }, d === day0 ? 'btn-small active' : 'btn-small'));
    }
    body.append(days);

    // Sole.
    const e = dayEphemeris(day0, place.lat, place.lon);
    const dl = (rows) => {
      const g = el('dl', 'route-summary');
      for (const [k, v] of rows) g.append(el('dt', '', k), el('dd', '', v));
      return g;
    };
    const len = e.sun.rise !== null && e.sun.set !== null ? `${formatHm((e.sun.set - e.sun.rise) / 3600e3)} h` : '—';
    body.append(el('h3', 'alm-h', `☀️ ${t.sun}`), dl([
      [t.sunrise, formatTime(e.sun.rise)],
      [t.sunset, formatTime(e.sun.set)],
      [t.dayLength, len],
      [t.noon, `${formatTime(e.noon)} (${fmtNum(e.noonAltDeg, 0)}°)`],
      [t.civil, `${formatTime(e.civil.rise)} – ${formatTime(e.civil.set)}`],
      [t.nautical, `${formatTime(e.nautical.rise)} – ${formatTime(e.nautical.set)}`],
    ]));
    // Luna.
    const ph = e.phase;
    body.append(el('h3', 'alm-h', `${moonIcon(ph.age)} ${t.moon}`), dl([
      [t.moonrise, formatTime(e.moon.rise)],
      [t.moonset, formatTime(e.moon.set)],
      [t.phase, `${t.phases[ph.name]}, ${Math.round(ph.illumination * 100)} %`],
    ]));
    const next = el('ul', 'alm-phases');
    for (const p of nextPhases(day0)) {
      next.append(el('li', '', `${MOON_ICONS[{ new: 0, firstQuarter: 2, full: 4, lastQuarter: 6 }[p.name]]} ${t.phases[p.name]}: ${formatShortDateTime(p.t)}`));
    }
    body.append(next);

    // Marea.
    body.append(el('h3', 'alm-h', `🌊 ${t.tide}`));
    if (tide) {
      const ext = tideExtremes(tide.timesMs, tide.levelsM);
      const wrap = el('div', 'window-chart-wrap');
      wrap.append(tideChart(tide, day0, ext));
      body.append(wrap);
      const list = el('ul', 'alm-tides');
      const todays = ext.filter((x) => x.t >= day0 && x.t < day0 + DAY);
      for (const x of todays) list.append(el('li', '', `${x.kind === 'high' ? `▲ ${t.high}` : `▼ ${t.low}`} ${formatTime(x.t)} · ${x.levelM >= 0 ? '+' : ''}${fmtNum(x.levelM, 2)} m`));
      if (!todays.length) list.append(el('li', 'muted', t.noExtremes));
      body.append(list, el('small', 'field-hint', `${t.tideNote} ${t.tideSource} ${formatShortDateTime(tide.fetchedMs)}.`));
    } else {
      body.append(el('p', 'muted', tideMsg));
    }
    body.append(el('p', 'route-disclaimer', `⚠️ ${it.disclaimer.bar}`));
  }

  loadTide();
  return { setPlace, panel };
}
