// Pannello a tutta pagina (sopra la mappa) con titolo, pulsante indietro/chiudi e contenuto.
// Usato da barche e profilo.

import { it } from '../i18n/it.js';

/**
 * @typedef {Object} Panel
 * @property {HTMLElement} body contenuto da riempire
 * @property {(title: string) => void} setTitle
 * @property {(fn: (() => void) | null) => void} setBack pulsante "indietro" (null = solo chiusura)
 * @property {() => void} close
 */

/**
 * Apre un pannello; uno solo alla volta.
 * @param {string} title
 * @param {() => void} [onClose]
 * @returns {Panel}
 */
export function openPanel(title, onClose) {
  document.querySelector('.panel')?.remove();
  const el = document.createElement('section');
  el.className = 'panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <header class="panel-head">
      <button type="button" class="icon-btn panel-back hidden" aria-label="${it.panel.back}">‹</button>
      <h2></h2>
      <button type="button" class="icon-btn panel-close" aria-label="${it.panel.close}">✕</button>
    </header>
    <div class="panel-body"></div>`;
  const h = /** @type {HTMLElement} */ (el.querySelector('h2'));
  const back = /** @type {HTMLButtonElement} */ (el.querySelector('.panel-back'));
  const body = /** @type {HTMLElement} */ (el.querySelector('.panel-body'));
  h.textContent = title;
  /** @type {(() => void) | null} */
  let backFn = null;
  back.addEventListener('click', () => backFn?.());
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);
  el.querySelector('.panel-close').addEventListener('click', close);
  document.body.append(el);
  return {
    body,
    setTitle: (t) => { h.textContent = t; },
    setBack: (fn) => {
      backFn = fn;
      back.classList.toggle('hidden', !fn);
    },
    close,
  };
}

/**
 * Crea un elemento con classe e testo.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Campo con etichetta.
 * @param {string} label
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} input
 * @param {string} [hint]
 * @returns {HTMLLabelElement}
 */
export function field(label, input, hint) {
  const l = /** @type {HTMLLabelElement} */ (el('label', 'field'));
  l.append(el('span', 'field-label', label), input);
  if (hint) l.append(el('small', 'field-hint', hint));
  return l;
}

/**
 * Campo di testo/numero.
 * @param {string} name
 * @param {string | number | null | undefined} value
 * @param {Partial<HTMLInputElement>} [attrs]
 * @returns {HTMLInputElement}
 */
export function input(name, value, attrs = {}) {
  const i = document.createElement('input');
  i.name = name;
  i.value = value === null || value === undefined ? '' : String(value);
  Object.assign(i, attrs);
  return i;
}

/**
 * Pulsante.
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [className]
 * @returns {HTMLButtonElement}
 */
export function btn(label, onClick, className = 'btn-secondary') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Conferma con una piccola finestra (al posto di confirm(), bloccante e brutto su iOS).
 * @param {string} text
 * @param {string} okLabel
 * @returns {Promise<boolean>}
 */
export function confirmBox(text, okLabel) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', 'modal');
    box.setAttribute('role', 'alertdialog');
    const p = el('p', '', text);
    const row = el('div', 'btn-row');
    const done = (v) => {
      backdrop.remove();
      resolve(v);
    };
    row.append(btn(it.panel.cancel, () => done(false)), btn(okLabel, () => done(true), 'btn-danger'));
    box.append(p, row);
    backdrop.append(box);
    document.body.append(backdrop);
  });
}

/**
 * Scarica un testo come file.
 * @param {string} filename
 * @param {string} text
 * @param {string} [type]
 */
export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Richiesta di un testo (al posto di prompt()).
 * @param {string} text
 * @param {string} value valore proposto
 * @param {string} okLabel
 * @returns {Promise<string | null>} null se annullato
 */
export function promptBox(text, value, okLabel) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    const i = input('prompt', value, { maxLength: 100 });
    i.className = 'prompt-input';
    const row = el('div', 'btn-row');
    const done = (v) => {
      backdrop.remove();
      resolve(v);
    };
    const ok = btn(okLabel, () => done(i.value.trim() || null), 'btn-primary');
    row.append(btn(it.panel.cancel, () => done(null)), ok);
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') done(null);
    });
    box.append(el('p', '', text), i, row);
    backdrop.append(box);
    document.body.append(backdrop);
    i.focus();
    i.select();
  });
}
