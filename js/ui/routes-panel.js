// Rotte salvate: elenco (dalla più recente), apertura ed eliminazione.

import { it } from '../i18n/it.js';
import { errorMessage } from '../data/supabase.js';
import { formatShortDateTime, fmtNum, formatHm } from '../lib/format.js';
import { openPanel, el, btn, confirmBox } from './panel.js';
import { modelLabel } from '../weather/models.js';

/**
 * @param {{repo: ReturnType<typeof import('../data/routes-repo.js').createRoutesRepo>,
 *   onOpen: (r: import('../data/routes-repo.js').SavedRoute) => void}} deps
 */
export function openRoutesPanel(deps) {
  const t = it.routes;
  const panel = openPanel(t.title);
  const msg = el('p', 'panel-msg');
  msg.setAttribute('role', 'alert');
  /** @param {string} text @param {'error' | 'ok'} [kind] */
  const show = (text, kind = 'error') => {
    msg.textContent = text;
    msg.dataset.kind = kind;
  };

  async function showList() {
    show('');
    panel.body.replaceChildren(msg, el('p', 'muted', t.loading));
    let rows;
    try {
      rows = await deps.repo.list();
    } catch (err) {
      show(errorMessage(err));
      panel.body.replaceChildren(msg, btn(t.retry, showList));
      return;
    }
    const list = el('ul', 'routes-list');
    if (!rows.length) list.append(el('li', 'muted', t.empty));
    for (const r of rows) {
      const li = el('li', 'routes-item');
      const text = el('div', 'routes-text');
      text.append(
        el('strong', '', r.name),
        el('small', '', `${t.departure} ${formatShortDateTime(Date.parse(r.departure_at))} · ${formatHm(Number(r.duration_h))} h · ${fmtNum(Number(r.distance_nm), 1)} NM · ${t.motor} ${formatHm(Number(r.motor_h))} h`),
        el('small', 'muted', `${r.boat_name ?? '—'} · ${r.model === 'auto' ? 'Auto' : modelLabel(r.model)} · ${t.savedAt} ${formatShortDateTime(Date.parse(r.created_at))}`),
      );
      const actions = el('div', 'btn-row');
      const open = btn(t.open, async () => {
        open.disabled = true;
        try {
          const full = await deps.repo.get(r.id);
          if (!full) throw new Error(t.missing);
          panel.close();
          deps.onOpen(full);
        } catch (err) {
          open.disabled = false;
          show(err?.message && !err?.code ? err.message : errorMessage(err));
        }
      }, 'btn-primary');
      const del = btn(t.remove, async () => {
        if (!(await confirmBox(t.confirmRemove.replace('{name}', r.name), t.remove))) return;
        try {
          await deps.repo.remove(r.id);
          show(t.removed, 'ok');
          showList();
        } catch (err) {
          show(errorMessage(err));
        }
      }, 'btn-danger');
      actions.append(open, del);
      li.append(text, actions);
      list.append(li);
    }
    panel.body.replaceChildren(msg, el('p', 'route-disclaimer', `⚠️ ${it.disclaimer.bar}`), list);
  }

  showList();
  return panel;
}
