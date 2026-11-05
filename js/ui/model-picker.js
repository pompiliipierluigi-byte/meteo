// Selettore del modello (menu laterale) e indicazione del modello effettivo e del run (barra superiore).

import { it } from '../i18n/it.js';
import { MODEL_CHOICES, modelLabel } from '../weather/models.js';
import { formatShortDateTime } from '../lib/format.js';
import { radioGroup } from './side-menu.js';

/**
 * @param {HTMLElement} section corpo della sezione del menu
 * @param {HTMLElement} topbar
 * @param {import('../weather/models.js').ModelChoice} current
 * @param {(choice: import('../weather/models.js').ModelChoice) => void} onChange
 * @param {() => void} onRefresh
 * @returns {{setStatus: (modelId: import('../weather/models.js').ModelId | null, runMs: number | null) => void, setBusy: (busy: boolean) => void,
 *   setChoice: (choice: import('../weather/models.js').ModelChoice) => void}}
 */
export function createModelPicker(section, topbar, current, onChange, onRefresh) {
  const setRadio = radioGroup(section, 'model', MODEL_CHOICES.map((c) => ({ value: c, label: it.model[c] })), current,
    (v) => onChange(/** @type {any} */ (v)));

  const status = document.createElement('div');
  status.className = 'model-status';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'icon-btn refresh-btn';
  refresh.setAttribute('aria-label', it.model.refresh);
  refresh.title = it.model.refresh;
  refresh.innerHTML = '<span aria-hidden="true">⟳</span>';
  refresh.addEventListener('click', onRefresh);
  topbar.append(status, refresh);

  return {
    setStatus(modelId, runMs) {
      if (!modelId) {
        status.textContent = '';
        return;
      }
      const run = runMs ? ` · ${it.model.run} ${formatShortDateTime(runMs)}` : '';
      status.textContent = `${modelLabel(modelId)}${run}`;
    },
    setChoice: (choice) => setRadio(choice),
    setBusy(busy) {
      refresh.disabled = busy;
      refresh.classList.toggle('spin', busy);
    },
  };
}
