// Selettore di località: mentre si scrive cerca tra porti e luoghi salvati (in locale, senza rete);
// "Cerca online" interroga Open-Meteo Geocoding. Ogni risultato ha i pulsanti delle azioni richieste.

import { it } from '../i18n/it.js';
import { el, btn } from './panel.js';
import { searchKnown, searchOnline, loadPorts } from '../places/search.js';

const ICON = { port: '⚓', saved: '★', online: '📍' };

/**
 * @param {{actions: {label: string, title?: string, onPick: (p: import('../places/search.js').Place) => void}[],
 *   saved?: () => import('../places/search.js').Place[],
 *   extra?: (p: import('../places/search.js').Place) => HTMLElement | null}} o
 * @returns {HTMLElement}
 */
export function createPlacePicker(o) {
  const t = it.places;
  const root = el('div', 'place-picker');
  const row = el('div', 'place-row');
  const q = document.createElement('input');
  q.type = 'search';
  q.placeholder = t.placeholder;
  q.setAttribute('aria-label', t.placeholder);
  q.enterKeyHint = 'search';
  const online = btn(t.online, () => runOnline(), 'btn-small');
  row.append(q, online);
  const list = el('ul', 'place-results');
  const msg = el('small', 'muted');
  root.append(row, list, msg);
  /** @type {any[]} */
  let ports = [];
  loadPorts().then((p) => { ports = p; render(); });
  /** @type {import('../places/search.js').Place[]} */
  let onlineHits = [];
  let seq = 0;

  /** @param {import('../places/search.js').Place[]} items */
  function show(items) {
    list.replaceChildren();
    for (const p of items) {
      const li = el('li', `place-item place-${p.kind}`);
      const txt = el('div', 'place-text');
      txt.append(el('strong', '', `${ICON[p.kind]} ${p.name}${p.home ? ` (${t.home})` : ''}`));
      if (p.detail) txt.append(el('small', 'muted', p.detail));
      const b = el('div', 'rp-buttons');
      for (const a of o.actions) {
        const x = btn(a.label, () => {
          a.onPick(p);
          q.value = '';
          onlineHits = [];
          render();
        }, 'btn-small');
        if (a.title) x.title = x.ariaLabel = a.title;
        b.append(x);
      }
      const extra = o.extra?.(p);
      if (extra) b.append(extra);
      li.append(txt, b);
      list.append(li);
    }
  }

  function render() {
    const known = searchKnown(q.value, ports, o.saved?.() ?? []);
    const seen = new Set(known.map((p) => `${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`));
    show([...known, ...onlineHits.filter((p) => !seen.has(`${p.lat.toFixed(2)}_${p.lon.toFixed(2)}`))]);
    msg.textContent = q.value.trim().length >= 2 && !known.length && !onlineHits.length ? t.noneKnown : '';
  }

  async function runOnline() {
    const text = q.value.trim();
    if (text.length < 2) return;
    const s = ++seq;
    msg.textContent = t.searching;
    online.disabled = true;
    try {
      const r = await searchOnline(text);
      if (s !== seq) return;
      onlineHits = r;
      render();
      if (!r.length) msg.textContent = t.noneOnline;
    } catch (err) {
      if (s === seq) msg.textContent = err?.message ?? String(err);
    } finally {
      online.disabled = false;
    }
  }

  q.addEventListener('input', () => {
    onlineHits = [];
    render();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runOnline();
    }
  });
  return Object.assign(root, { refresh: render });
}
