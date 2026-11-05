// Interfaccia barche: elenco, creazione (ORC, manuale, CSV), modifica, polare vele bianche, esportazione, eliminazione.

import { it } from '../i18n/it.js';
import { errorMessage } from '../data/supabase.js';
import { ValidationError } from '../data/boats-repo.js';
import { loadOrcIndex, searchOrc, fetchOrcBoat, orcToPolar, orcBoatRecord } from '../boats/orc.js';
import { parsePolarCsv, polarToCsv, formatCsvError } from '../boats/polar-csv.js';
import { openPanel, el, field, input, btn, confirmBox, downloadText } from './panel.js';
import { createPolarTable, emptyPolar } from './polar-table.js';

/**
 * @typedef {Object} BoatsPanelDeps
 * @property {ReturnType<typeof import('../data/boats-repo.js').createBoatsRepo>} repo
 * @property {() => void} [onChanged] chiamata dopo ogni salvataggio o eliminazione
 * @property {(boat: import('../data/boats-repo.js').Boat) => HTMLElement | null} [extraActions] azioni in più per barca (es. "attiva")
 * @property {(boat: import('../data/boats-repo.js').Boat) => HTMLElement | null} [preview] anteprima polare (diagramma)
 */

/** @param {unknown} err */
function msgOf(err) {
  return err instanceof ValidationError ? err.errors.join(' · ') : errorMessage(err);
}

/** Nome di file sicuro. @param {string} s */
const fileName = (s) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'polare';

/**
 * Apre il pannello delle barche.
 * @param {BoatsPanelDeps} deps
 */
export function openBoatsPanel(deps) {
  const t = it.boats;
  const panel = openPanel(t.title);
  const msg = el('p', 'panel-msg');
  msg.setAttribute('role', 'alert');
  /** @param {string} text @param {'error'|'ok'} [kind] */
  const show = (text, kind = 'error') => {
    msg.textContent = text;
    msg.dataset.kind = kind;
  };
  /** @param {...Node} nodes */
  const view = (...nodes) => {
    panel.body.replaceChildren(msg, ...nodes);
    panel.body.scrollTop = 0;
  };

  // --- Elenco ---------------------------------------------------------------
  async function showList() {
    panel.setTitle(t.title);
    panel.setBack(null);
    show('');
    view(el('p', 'muted', t.loading));
    let boats;
    try {
      boats = await deps.repo.list();
    } catch (err) {
      show(msgOf(err));
      view(btn(t.retry, showList));
      return;
    }
    const list = el('div', 'boat-list');
    if (!boats.length) list.append(el('p', 'muted', t.empty));
    for (const b of boats) {
      const card = el('article', 'boat-card');
      const head = el('div', 'boat-card-head');
      head.append(el('strong', '', b.name), el('span', `badge badge-${b.source}`, t.sources[b.source]));
      const info = [b.model, b.loa_m ? `${b.loa_m} m` : null, b.orc_ref].filter(Boolean).join(' · ');
      const actions = el('div', 'btn-row');
      actions.append(btn(t.edit, () => showForm({ boat: b })));
      const extra = deps.extraActions?.(b);
      if (extra) actions.prepend(extra);
      card.append(head, el('small', 'muted', info || ' '));
      const pv = deps.preview?.(b);
      if (pv) card.append(pv);
      card.append(actions);
      list.append(card);
    }
    view(btn(t.add, showSourceChoice, 'btn-primary'), list);
  }

  // --- Scelta dell'origine --------------------------------------------------
  function showSourceChoice() {
    panel.setTitle(t.addTitle);
    panel.setBack(showList);
    show('');
    const choices = el('div', 'choice-list');
    for (const [key, fn] of /** @type {const} */ ([['orc', showOrcSearch], ['manual', () => showForm({ source: 'manual', polar: emptyPolar() })], ['csv', showCsvImport]])) {
      const b = btn('', fn, 'choice');
      b.append(el('strong', '', t.sourceTitles[key]), el('small', '', t.sourceHints[key]));
      choices.append(b);
    }
    view(choices);
  }

  // --- ORC ------------------------------------------------------------------
  function showOrcSearch() {
    panel.setTitle(t.orcTitle);
    panel.setBack(showSourceChoice);
    show('');
    const q = input('q', '', { type: 'search', placeholder: t.orcPlaceholder, autocomplete: 'off' });
    const results = el('div', 'orc-results');
    const credit = el('small', 'muted');
    credit.innerHTML = t.orcCredit;
    view(field(t.orcSearch, q), results, credit);
    q.focus();
    /** @type {import('../boats/orc.js').OrcIndex | null} */
    let index = null;
    loadOrcIndex().then((i) => {
      index = i;
      run();
    }).catch((err) => show(msgOf(err)));
    let timer = 0;
    const run = () => {
      results.replaceChildren();
      if (!index) {
        results.append(el('p', 'muted', t.orcLoading));
        return;
      }
      const hits = searchOrc(index.boats, q.value, 40);
      if (q.value.trim().length < 2) {
        results.append(el('p', 'muted', t.orcHint));
        return;
      }
      if (!hits.length) results.append(el('p', 'muted', t.orcNone));
      for (const [sn, name, type, year] of hits) {
        const b = btn('', () => pick(sn, index?.vppYear ?? null), 'orc-hit');
        b.append(el('strong', '', name || type || sn), el('small', '', [type, sn, year].filter(Boolean).join(' · ')));
        results.append(b);
      }
    };
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(run, 200);
    });

    /** @param {string} sn @param {number | null} vppYear */
    async function pick(sn, vppYear) {
      show(t.orcFetching, 'ok');
      try {
        const data = await fetchOrcBoat(sn);
        const polar = orcToPolar(data);
        show('');
        showForm({ source: 'orc', polar, fields: orcBoatRecord(data, vppYear), back: showOrcSearch });
      } catch (err) {
        show(msgOf(err));
      }
    }
  }

  // --- CSV ------------------------------------------------------------------
  function showCsvImport() {
    panel.setTitle(t.csvTitle);
    panel.setBack(showSourceChoice);
    show('');
    const file = input('file', '', { type: 'file', accept: '.csv,.pol,.txt,text/csv,text/plain' });
    const text = document.createElement('textarea');
    text.rows = 8;
    text.placeholder = 'TWA\\TWS;6;8;10\n52;5.1;5.9;6.4\n…';
    text.className = 'mono';
    const errors = el('ul', 'error-list');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) text.value = await f.text();
    });
    const read = () => {
      errors.replaceChildren();
      const r = parsePolarCsv(text.value);
      if (r.errors.length) {
        show(t.csvErrors);
        r.errors.slice(0, 30).forEach((e) => errors.append(el('li', '', formatCsvError(e))));
        return;
      }
      show('');
      showForm({ source: 'csv', polar: /** @type {any} */ (r.polar), back: showCsvImport });
    };
    view(field(t.csvFile, file), field(t.csvPaste, text, t.csvFormat), btn(t.csvRead, read, 'btn-primary'), errors);
  }

  // --- Form barca -----------------------------------------------------------
  /**
   * @param {{boat?: import('../data/boats-repo.js').Boat, source?: 'orc'|'manual'|'csv', polar?: import('../boats/polar.js').Polar,
   *   fields?: Record<string, any>, back?: () => void}} o
   */
  function showForm(o) {
    const editing = Boolean(o.boat);
    const b = o.boat;
    const source = b?.source ?? o.source ?? 'manual';
    const f = { ...(o.fields ?? {}), ...(b ?? {}) };
    panel.setTitle(editing ? b.name : t.newTitle);
    panel.setBack(o.back ?? (editing ? showList : showSourceChoice));
    show('');

    const name = input('name', f.name, { maxLength: 100, required: true, autocomplete: 'off' });
    const model = input('model', f.model, { maxLength: 100, autocomplete: 'off' });
    const loa = input('loa', f.loa_m, { type: 'number', step: '0.01', min: '2', max: '100', inputMode: 'decimal' });
    const motor = input('motor', f.motor_speed_kn ?? 6, { type: 'number', step: '0.1', min: '0.5', max: '30', inputMode: 'decimal' });
    const eff = input('eff', '', { type: 'checkbox' });
    eff.checked = f.apply_efficiency ?? source === 'orc';
    const effRow = el('label', 'opt-row');
    effRow.append(eff, el('span', '', t.applyEff));

    let fullChanged = false;
    const fullPolar = o.polar ?? b?.polars.full?.data ?? emptyPolar();
    const full = createPolarTable(fullPolar, { onChange: () => { fullChanged = true; } });

    // Vele bianche: derivate (default) o polare propria.
    const ownWhite = b?.polars.white?.data ?? null;
    const whiteBox = el('div', 'white-box');
    const radios = el('div');
    const mkRadio = (value, label, checked) => {
      const r = input('white', value, { type: 'radio', checked });
      const l = el('label', 'opt-row');
      l.append(r, el('span', '', label));
      r.addEventListener('change', () => r.checked && renderWhite(value));
      radios.append(l);
    };
    mkRadio('derived', t.whiteDerived, !ownWhite);
    mkRadio('own', t.whiteOwn, Boolean(ownWhite));
    const whiteArea = el('div');
    /** @type {ReturnType<typeof createPolarTable> | null} */
    let whiteTable = null;
    /** @param {'derived'|'own'} mode */
    const renderWhite = (mode) => {
      whiteArea.replaceChildren();
      whiteTable = null;
      if (mode === 'derived') {
        whiteArea.append(el('small', 'field-hint', t.whiteDerivedHint));
        return;
      }
      const start = ownWhite ?? full.read().polar ?? emptyPolar();
      whiteTable = createPolarTable(start);
      const csv = input('wcsv', '', { type: 'file', accept: '.csv,.pol,.txt,text/csv,text/plain' });
      csv.addEventListener('change', async () => {
        const file = csv.files?.[0];
        if (!file) return;
        const r = parsePolarCsv(await file.text());
        if (r.errors.length) show(r.errors.slice(0, 5).map(formatCsvError).join(' · '));
        else whiteTable?.load(/** @type {any} */ (r.polar));
      });
      whiteArea.append(field(t.whiteCsv, csv), whiteTable.root);
    };
    whiteBox.append(el('h3', '', t.whiteTitle), radios, whiteArea);
    renderWhite(ownWhite ? 'own' : 'derived');

    const save = btn(editing ? t.save : t.create, async () => {
      const fr = full.read();
      if (!fr.polar) {
        show(`${t.fullErrors}: ${fr.errors.join(' · ')}`);
        return;
      }
      let white = null;
      if (whiteTable) {
        const wr = whiteTable.read();
        if (!wr.polar) {
          show(`${t.whiteErrors}: ${wr.errors.join(' · ')}`);
          return;
        }
        white = wr.polar;
      }
      const fields = {
        ...(o.fields ?? {}),
        name: name.value,
        model: model.value,
        loa_m: loa.value === '' ? null : loa.value,
        motor_speed_kn: motor.value,
        apply_efficiency: eff.checked,
        source,
      };
      // Una polare ORC modificata a mano non è più quella del certificato.
      const fullSource = fullChanged && source === 'orc' ? 'manual' : (b?.polars.full?.source ?? source);
      save.disabled = true;
      show(t.saving, 'ok');
      try {
        if (editing) {
          await deps.repo.update(b.id, fields);
          if (fullChanged) await deps.repo.savePolar(b.id, 'full', fr.polar, fullSource);
          if (white) await deps.repo.savePolar(b.id, 'white', white, 'manual');
          else if (ownWhite) await deps.repo.deleteWhitePolar(b.id);
        } else {
          await deps.repo.create(fields, {
            full: { data: fr.polar, source: fullSource },
            ...(white ? { white: { data: white, source: 'manual' } } : {}),
          });
        }
        deps.onChanged?.();
        await showList();
        show(t.saved, 'ok');
      } catch (err) {
        show(msgOf(err));
        save.disabled = false;
      }
    }, 'btn-primary');

    const exportBtn = btn(t.exportCsv, () => {
      const fr = full.read();
      if (!fr.polar) {
        show(`${t.fullErrors}: ${fr.errors.join(' · ')}`);
        return;
      }
      downloadText(`${fileName(name.value || 'polare')}.csv`, polarToCsv(fr.polar));
    });

    const nodes = [
      field(t.name, name),
      field(t.model, model),
      field(t.loa, loa),
      field(t.motorSpeed, motor, t.motorSpeedHint),
      effRow,
      el('small', 'field-hint', t.applyEffHint),
      el('h3', '', `${t.fullTitle} (${t.sources[source]})`),
      el('small', 'field-hint', source === 'orc' ? t.fullOrcHint : t.fullHint),
      full.root,
      whiteBox,
      el('div', 'btn-row sticky-actions'),
    ];
    const actions = /** @type {HTMLElement} */ (nodes[nodes.length - 1]);
    actions.append(save, exportBtn);
    if (editing) {
      actions.append(btn(t.remove, async () => {
        if (!(await confirmBox(`${t.confirmRemove} «${b.name}»?`, t.remove))) return;
        try {
          await deps.repo.remove(b.id);
          deps.onChanged?.();
          await showList();
          show(t.removed, 'ok');
        } catch (err) {
          show(msgOf(err));
        }
      }, 'btn-danger'));
    }
    view(...nodes);
    if (!editing) name.focus();
  }

  showList();
  return panel;
}
