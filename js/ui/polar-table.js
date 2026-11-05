// Tabella polare modificabile (TWA × TWS): celle numeriche, aggiunta/rimozione di righe e colonne.

import { it } from '../i18n/it.js';
import { validatePolar } from '../boats/polar.js';
import { el, btn } from './panel.js';

/** Griglia proposta per l'inserimento manuale. */
export const DEFAULT_TWS = [6, 8, 10, 12, 14, 16, 20];
export const DEFAULT_TWA = [52, 60, 75, 90, 110, 120, 135, 150, 165, 180];

/**
 * Polare vuota sulla griglia proposta.
 * @returns {import('../boats/polar.js').Polar}
 */
export function emptyPolar() {
  return { version: 1, tws: [...DEFAULT_TWS], twa: [...DEFAULT_TWA], bsp: DEFAULT_TWA.map(() => DEFAULT_TWS.map(() => null)) };
}

/**
 * @typedef {Object} PolarTable
 * @property {HTMLElement} root
 * @property {() => {polar: import('../boats/polar.js').Polar | null, errors: string[]}} read polare dai campi
 * @property {(p: import('../boats/polar.js').Polar) => void} load
 */

/**
 * @param {import('../boats/polar.js').Polar} initial
 * @param {{readOnly?: boolean, onChange?: () => void}} [opts]
 * @returns {PolarTable}
 */
export function createPolarTable(initial, opts = {}) {
  const t = it.polarTable;
  const root = el('div', 'polar-table');
  const wrap = el('div', 'polar-table-wrap');
  const table = document.createElement('table');
  wrap.append(table);
  root.append(wrap);

  /** @type {{tws: string[], twa: string[], bsp: string[][]}} stato come testo dei campi */
  let st = toText(initial);

  /** @param {import('../boats/polar.js').Polar} p */
  function toText(p) {
    return {
      tws: p.tws.map(String),
      twa: p.twa.map(String),
      bsp: p.bsp.map((r) => r.map((v) => (v === null ? '' : String(v)))),
    };
  }

  /**
   * @param {string} value
   * @param {(v: string) => void} set
   * @param {string} label
   * @param {string} cls
   */
  const cell = (value, set, label, cls) => {
    if (opts.readOnly) return el('span', cls, value);
    const i = document.createElement('input');
    i.type = 'text';
    i.inputMode = 'decimal';
    i.value = value;
    i.className = cls;
    i.setAttribute('aria-label', label);
    i.addEventListener('input', () => {
      set(i.value);
      opts.onChange?.();
    });
    return i;
  };

  function render() {
    table.replaceChildren();
    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = t.corner;
    head.append(corner);
    st.tws.forEach((v, j) => {
      const th = document.createElement('th');
      th.append(cell(v, (x) => { st.tws[j] = x; }, `${t.tws} ${j + 1}`, 'pt-axis'));
      if (!opts.readOnly && st.tws.length > 1) th.append(miniBtn('−', t.removeCol, () => { st.tws.splice(j, 1); st.bsp.forEach((r) => r.splice(j, 1)); render(); opts.onChange?.(); }));
      head.append(th);
    });
    table.append(head);
    st.twa.forEach((a, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.append(cell(a, (x) => { st.twa[i] = x; }, `${t.twa} ${i + 1}`, 'pt-axis'));
      if (!opts.readOnly && st.twa.length > 1) th.append(miniBtn('−', t.removeRow, () => { st.twa.splice(i, 1); st.bsp.splice(i, 1); render(); opts.onChange?.(); }));
      tr.append(th);
      st.bsp[i].forEach((v, j) => {
        const td = document.createElement('td');
        td.append(cell(v, (x) => { st.bsp[i][j] = x; }, `${t.speedAt} ${st.twa[i]}°, ${st.tws[j]} kn`, 'pt-cell'));
        tr.append(td);
      });
      table.append(tr);
    });
  }

  /**
   * @param {string} label
   * @param {string} title
   * @param {() => void} fn
   */
  function miniBtn(label, title, fn) {
    const b = btn(label, fn, 'pt-mini');
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  if (!opts.readOnly) {
    const tools = el('div', 'btn-row');
    tools.append(
      btn(t.addRow, () => { st.twa.push(''); st.bsp.push(st.tws.map(() => '')); render(); }),
      btn(t.addCol, () => { st.tws.push(''); st.bsp.forEach((r) => r.push('')); render(); }),
    );
    root.append(tools, el('small', 'field-hint', t.hint));
  }
  render();

  return {
    root,
    read() {
      const errors = [];
      const parse = (s, label) => {
        const x = String(s).trim().replace(',', '.');
        if (x === '') return null;
        const n = Number(x);
        if (!Number.isFinite(n)) {
          errors.push(`${label}: «${s}» non è un numero`);
          return NaN;
        }
        return n;
      };
      const tws = st.tws.map((s, j) => parse(s, `${t.tws} ${j + 1}`));
      const twa = st.twa.map((s, i) => parse(s, `${t.twa} ${i + 1}`));
      if (tws.some((v) => v === null)) errors.push(t.errEmptyTws);
      if (twa.some((v) => v === null)) errors.push(t.errEmptyTwa);
      const bsp = st.bsp.map((r, i) => r.map((s, j) => {
        const v = parse(s, `${t.speedAt} ${st.twa[i]}°/${st.tws[j]} kn`);
        return v === 0 ? null : v;
      }));
      if (errors.length) return { polar: null, errors };
      /** @type {import('../boats/polar.js').Polar} */
      const polar = { version: 1, tws: /** @type {number[]} */ (tws), twa: /** @type {number[]} */ (twa), bsp };
      if (bsp.every((r) => r.every((v) => v === null))) return { polar: null, errors: [t.errAllEmpty] };
      const v = validatePolar(polar);
      return v.length ? { polar: null, errors: v } : { polar, errors: [] };
    },
    load(p) {
      st = toText(p);
      render();
    },
  };
}
