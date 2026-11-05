// Pannello rotta (foglio in basso sopra il cursore temporale): punti della rotta.
// Calcolo, riepilogo e tabella si aggiungono al passo 3.8.

import { it } from '../i18n/it.js';
import { formatLatLon } from '../lib/format.js';
import { el, btn } from './panel.js';

/**
 * @param {HTMLElement} host contenitore (sopra la barra inferiore)
 * @param {HTMLElement} topbar
 * @param {import('./route-points.js').RoutePoints} points
 * @returns {{root: HTMLElement, body: HTMLElement, open: () => void, close: () => void, isOpen: () => boolean}}
 */
export function createRoutePanel(host, topbar, points) {
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
  body.append(pointsBox);
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

  points.onChange(renderPoints);
  renderPoints();

  const api = {
    root,
    body,
    open() {
      root.classList.remove('hidden');
      toggle.classList.add('active');
    },
    close() {
      root.classList.add('hidden');
      toggle.classList.remove('active');
      points.pick(null);
    },
    isOpen: () => !root.classList.contains('hidden'),
  };
  toggle.addEventListener('click', () => (api.isOpen() ? api.close() : api.open()));
  return api;
}
