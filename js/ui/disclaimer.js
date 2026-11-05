// Avviso di sicurezza: modale al primo avvio (per versione del testo) e barra fissa.
// L'avviso non va mai rimosso o nascosto (CLAUDE.md, SPEC §2.8).

import { it } from '../i18n/it.js';

const STORAGE_KEY = 'meteo.disclaimer.acceptedVersion';

/** @returns {number} versione accettata, 0 se mai accettata o storage non disponibile */
function acceptedVersion() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** @param {number} version */
function storeAccepted(version) {
  try {
    localStorage.setItem(STORAGE_KEY, String(version));
  } catch {
    // Storage non disponibile: l'avviso verrà riproposto al prossimo avvio.
  }
}

/**
 * Mostra la modale; si chiude solo con "Ho capito".
 * @returns {Promise<void>} risolta all'accettazione
 */
export function showDisclaimerModal() {
  return new Promise((resolve) => {
    const t = it.disclaimer;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="disc-title" aria-describedby="disc-body">
        <h2 id="disc-title">⚠️ ${t.title}</h2>
        <p id="disc-body"></p>
        <button type="button" class="btn-primary">${t.accept}</button>
      </div>`;
    backdrop.querySelector('#disc-body').textContent = t.body;
    const btn = backdrop.querySelector('button');
    btn.addEventListener('click', () => {
      storeAccepted(t.version);
      backdrop.remove();
      resolve();
    });
    // Esc non chiude: serve accettazione esplicita.
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.preventDefault();
    });
    document.body.append(backdrop);
    btn.focus();
  });
}

/**
 * Inserisce il testo fisso nella barra inferiore e, se serve, mostra la modale.
 * @param {HTMLElement} bar contenitore della barra inferiore
 * @returns {Promise<void>} risolta quando l'avviso corrente è stato accettato
 */
export function initDisclaimer(bar) {
  const t = it.disclaimer;
  const el = document.createElement('div');
  el.className = 'disclaimer-bar';
  const text = document.createElement('span');
  text.textContent = `⚠️ ${t.bar}`;
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'link-btn';
  link.textContent = t.showAgain;
  link.addEventListener('click', () => showDisclaimerModal());
  el.append(text, link);
  bar.prepend(el);

  if (acceptedVersion() >= t.version) return Promise.resolve();
  return showDisclaimerModal();
}
