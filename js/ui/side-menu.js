// Menu laterale a scomparsa: contenitore di sezioni (mappa base, overlay, layer meteo, modello, opacità).

import { it } from '../i18n/it.js';

/**
 * @typedef {Object} SideMenu
 * @property {(title: string) => HTMLElement} addSection aggiunge una sezione e ne restituisce il corpo
 * @property {() => void} open
 * @property {() => void} close
 */

/**
 * Crea il pulsante nella barra superiore e il pannello.
 * @param {HTMLElement} topbar
 * @returns {SideMenu}
 */
export function createSideMenu(topbar) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn menu-btn';
  btn.setAttribute('aria-label', it.menu.open);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'side-menu');
  btn.innerHTML = '<span aria-hidden="true">☰</span>';
  topbar.prepend(btn);

  const backdrop = document.createElement('div');
  backdrop.className = 'side-backdrop';
  const panel = document.createElement('aside');
  panel.id = 'side-menu';
  panel.className = 'side-menu';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <div class="side-head">
      <h2>${it.menu.title}</h2>
      <button type="button" class="icon-btn" aria-label="${it.menu.close}">✕</button>
    </div>
    <div class="side-body"></div>`;
  const body = panel.querySelector('.side-body');
  document.body.append(backdrop, panel);

  const open = () => {
    document.body.classList.add('menu-open');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    document.body.classList.remove('menu-open');
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    if (document.body.classList.contains('menu-open')) close(); else open();
  });
  panel.querySelector('.side-head button').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return {
    addSection(title) {
      const sec = document.createElement('section');
      sec.className = 'side-section';
      const h = document.createElement('h3');
      h.textContent = title;
      const content = document.createElement('div');
      sec.append(h, content);
      body.append(sec);
      return content;
    },
    open,
    close,
  };
}

let uid = 0;

/**
 * Gruppo di radio button.
 * @param {HTMLElement} parent
 * @param {string} name
 * @param {{value: string, label: string}[]} options
 * @param {string} current
 * @param {(value: string) => void} onChange
 * @returns {(value: string) => void} funzione per impostare il valore da codice
 */
export function radioGroup(parent, name, options, current, onChange) {
  const inputs = options.map((o) => {
    const id = `r${++uid}`;
    const row = document.createElement('label');
    row.className = 'opt-row';
    row.htmlFor = id;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.id = id;
    input.value = o.value;
    input.checked = o.value === current;
    input.addEventListener('change', () => input.checked && onChange(o.value));
    const span = document.createElement('span');
    span.textContent = o.label;
    row.append(input, span);
    parent.append(row);
    return input;
  });
  return (value) => inputs.forEach((i) => { i.checked = i.value === value; });
}

/**
 * Casella di spunta.
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {boolean} checked
 * @param {(on: boolean) => void} onChange
 * @returns {HTMLInputElement}
 */
export function checkbox(parent, label, checked, onChange) {
  const id = `c${++uid}`;
  const row = document.createElement('label');
  row.className = 'opt-row';
  row.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.append(input, span);
  parent.append(row);
  return input;
}

/**
 * Cursore numerico con etichetta.
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {{min: number, max: number, step: number, value: number, format?: (v: number) => string}} cfg
 * @param {(value: number) => void} onChange
 * @returns {HTMLInputElement}
 */
export function rangeRow(parent, label, cfg, onChange) {
  const id = `g${++uid}`;
  const row = document.createElement('div');
  row.className = 'range-row';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const out = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(cfg.min);
  input.max = String(cfg.max);
  input.step = String(cfg.step);
  input.value = String(cfg.value);
  const fmt = cfg.format ?? String;
  out.textContent = fmt(cfg.value);
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    onChange(Number(input.value));
  });
  row.append(lab, out, input);
  parent.append(row);
  return input;
}
