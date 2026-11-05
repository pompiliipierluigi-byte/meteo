// Pagina profilo: correttivi polari, soglia motore, margini costa, avvisi, limiti, preferenze (SPEC §2.9).

import { it } from '../i18n/it.js';
import { errorMessage } from '../data/supabase.js';
import { cleanProfile, PROFILE_DEFAULTS } from '../data/profile-repo.js';
import { MODEL_CHOICES } from '../weather/models.js';
import { openPanel, el, field, input, btn } from './panel.js';

/**
 * @typedef {Object} ProfilePanelDeps
 * @property {import('../data/profile-repo.js').Profile} profile
 * @property {ReturnType<typeof import('../data/profile-repo.js').createProfileRepo>} repo
 * @property {(p: import('../data/profile-repo.js').Profile) => void} onSaved
 * @property {() => Record<string, any>} currentSettings preferenze attuali dell'app (modello, layer)
 * @property {(draft: Record<string, any>) => HTMLElement | null} [preview] anteprima (diagramma polare) aggiornata a ogni modifica
 */

/**
 * @param {ProfilePanelDeps} deps
 */
export function openProfilePanel(deps) {
  const t = it.profile;
  const panel = openPanel(t.title);
  const p = deps.profile;
  const msg = el('p', 'panel-msg');
  msg.setAttribute('role', 'alert');
  /** @param {string} text @param {'error'|'ok'} [kind] */
  const show = (text, kind = 'error') => {
    msg.textContent = text;
    msg.dataset.kind = kind;
  };

  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  /**
   * @param {string} key
   * @param {{step: string, min: number, max: number}} a
   * @param {string} [hint]
   */
  const num = (key, a, hint) => {
    const i = input(key, p[key], { type: 'number', step: a.step, min: String(a.min), max: String(a.max), inputMode: 'decimal' });
    inputs[key] = i;
    return field(t.fields[key], i, hint);
  };
  /** @param {string} key */
  const check = (key) => {
    const i = input(key, '', { type: 'checkbox' });
    i.checked = Boolean(p[key]);
    inputs[key] = i;
    const row = el('label', 'opt-row');
    row.append(i, el('span', '', t.fields[key]));
    return row;
  };

  const name = input('display_name', p.display_name, { maxLength: 100, autocomplete: 'name' });
  inputs.display_name = name;

  // Modalità motore.
  const modeBox = el('div');
  for (const mode of ['vmg', 'speed']) {
    const r = input('motor_mode', mode, { type: 'radio', checked: p.motor_mode === mode });
    const row = el('label', 'opt-row');
    row.append(r, el('span', '', t.motorModes[mode]));
    modeBox.append(row);
  }
  modeBox.append(el('small', 'field-hint', t.motorModeHint));

  // Modello preferito.
  const model = document.createElement('select');
  model.name = 'model';
  for (const c of MODEL_CHOICES) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = it.model[c];
    model.append(o);
  }
  model.value = p.settings?.model ?? deps.currentSettings().model ?? 'auto';

  const summary = el('p', 'field-hint');
  const previewBox = el('div', 'profile-preview');

  /** Valori del modulo così come sono (testo), per anteprima e salvataggio. */
  const draft = () => {
    /** @type {Record<string, any>} */
    const d = {};
    for (const [k, i] of Object.entries(inputs)) d[k] = i.type === 'checkbox' ? i.checked : i.value;
    d.motor_mode = /** @type {HTMLInputElement | null} */ (panel.body.querySelector('input[name=motor_mode]:checked'))?.value ?? p.motor_mode;
    return d;
  };

  const updatePreview = () => {
    const d = draft();
    const up = Number(String(d.upwind_eff_pct).replace(',', '.'));
    const down = Number(String(d.downwind_eff_pct).replace(',', '.'));
    const white = Number(String(d.white_downwind_pct).replace(',', '.'));
    if ([up, down, white].every(Number.isFinite)) {
      summary.textContent = `${t.summary} ${Math.round(up)} % ${t.summaryUp}, ${Math.round(down)} % ${t.summaryDown}, `
        + `${Math.round((down * white) / 100)} % ${t.summaryWhite}.`;
    }
    const pv = deps.preview?.(d);
    previewBox.replaceChildren(...(pv ? [pv] : []));
  };

  const save = btn(t.save, async () => {
    const d = draft();
    const { value, errors } = cleanProfile({ ...d, settings: { ...(p.settings ?? {}), ...deps.currentSettings(), model: model.value } }, t.fields);
    if (errors.length) {
      show(errors.join(' · '));
      return;
    }
    save.disabled = true;
    show(t.saving, 'ok');
    try {
      await deps.repo.update(p.id, value);
      Object.assign(p, value);
      deps.onSaved(p);
      show(t.saved, 'ok');
    } catch (err) {
      show(errorMessage(err));
    } finally {
      save.disabled = false;
    }
  }, 'btn-primary');

  const reset = btn(t.reset, () => {
    for (const [k, v] of Object.entries(PROFILE_DEFAULTS)) {
      const i = inputs[k];
      if (i) {
        if (i.type === 'checkbox') i.checked = Boolean(v);
        else i.value = v === null ? '' : String(v);
      }
    }
    const r = /** @type {HTMLInputElement | null} */ (panel.body.querySelector(`input[name=motor_mode][value=${PROFILE_DEFAULTS.motor_mode}]`));
    if (r) r.checked = true;
    updatePreview();
    show(t.resetDone, 'ok');
  });

  const actions = el('div', 'btn-row sticky-actions');
  actions.append(save, reset);

  panel.body.append(
    msg,
    field(t.fields.display_name, name),
    el('h3', '', t.sections.polars),
    el('small', 'field-hint', t.polarsHint),
    num('upwind_eff_pct', { step: '1', min: 30, max: 120 }),
    num('downwind_eff_pct', { step: '1', min: 30, max: 120 }),
    num('white_downwind_pct', { step: '1', min: 20, max: 100 }, t.whiteHint),
    num('split_twa_deg', { step: '1', min: 30, max: 150 }, t.splitHint),
    summary,
    previewBox,
    el('h3', '', t.sections.motor),
    modeBox,
    num('motor_threshold_kn', { step: '0.1', min: 0, max: 10 }),
    el('h3', '', t.sections.coast),
    num('coast_margin_nm', { step: '0.05', min: 0, max: 5 }, t.marginHint),
    num('coast_warning_nm', { step: '0.1', min: 0, max: 10 }, t.warningHint),
    check('motor_near_land'),
    num('motor_near_land_nm', { step: '0.1', min: 0, max: 10 }),
    el('h3', '', t.sections.warnings),
    num('wave_warning_m', { step: '0.1', min: 0.1, max: 15 }),
    el('h3', '', t.sections.limits),
    el('small', 'field-hint', t.limitsHint),
    num('limit_tws_kn', { step: '1', min: 1, max: 80 }),
    num('limit_gust_kn', { step: '1', min: 1, max: 100 }),
    num('limit_wave_m', { step: '0.1', min: 0.1, max: 15 }),
    el('h3', '', t.sections.prefs),
    field(t.fields.model, model, t.prefsHint),
    actions,
  );
  panel.body.addEventListener('input', updatePreview);
  panel.body.addEventListener('change', updatePreview);
  updatePreview();
  return panel;
}
