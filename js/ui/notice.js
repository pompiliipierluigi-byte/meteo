// Riga di avvisi sotto la barra superiore: avanzamento dei download ed errori.

import { it } from '../i18n/it.js';

/**
 * @param {HTMLElement} host elemento dopo cui inserire la riga
 * @returns {{show: (text: string, kind?: 'info'|'error'|'warn') => void, hide: () => void}}
 */
export function createNotice(host) {
  const el = document.createElement('div');
  el.className = 'notice hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const text = document.createElement('span');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn';
  close.setAttribute('aria-label', it.notice.close);
  close.textContent = '✕';
  close.addEventListener('click', () => el.classList.add('hidden'));
  el.append(text, close);
  host.after(el);
  return {
    show(msg, kind = 'info') {
      text.textContent = msg;
      el.dataset.kind = kind;
      el.classList.remove('hidden');
    },
    hide() {
      el.classList.add('hidden');
    },
  };
}
