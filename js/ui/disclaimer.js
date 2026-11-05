// Avviso di sicurezza: modale al primo avvio (per versione del testo) e barra fissa.
// La barra si può chiudere con ✕ fino al prossimo avvio (richiesta del 2026-11-05: ruba spazio);
// l'avviso resta nel riepilogo della rotta, nella finestra di partenza e nel menu (CLAUDE.md, SPEC §2.8).

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
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'disclaimer-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', t.hideBar);
  close.title = t.hideBar;
  // Solo in memoria: al prossimo avvio la barra ricompare.
  close.addEventListener('click', () => {
    el.classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
  });
  el.append(text, link, close);
  bar.prepend(el);

  if (acceptedVersion() >= t.version) return Promise.resolve();
  return showDisclaimerModal();
}
