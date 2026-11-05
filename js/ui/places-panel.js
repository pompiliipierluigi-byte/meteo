// Luoghi salvati: elenco, porto base, rinomina, eliminazione.

import { it } from '../i18n/it.js';
import { errorMessage } from '../data/supabase.js';
import { formatLatLon } from '../lib/format.js';
import { openPanel, el, btn, confirmBox, promptBox } from './panel.js';

/**
 * @param {{repo: ReturnType<typeof import('../data/places-repo.js').createPlacesRepo>, onChanged: () => void,
 *   onUse?: (p: import('../data/places-repo.js').SavedPlace) => void}} deps
 */
export function openPlacesPanel(deps) {
  const t = it.savedPlaces;
  const panel = openPanel(t.title);
  const msg = el('p', 'panel-msg');
  msg.setAttribute('role', 'alert');
  /** @param {string} text @param {'error' | 'ok'} [kind] */
  const show = (text, kind = 'error') => {
    msg.textContent = text;
    msg.dataset.kind = kind;
  };
  /** @param {() => Promise<void>} fn */
  const act = async (fn) => {
    try {
      await fn();
      deps.onChanged();
      await list();
    } catch (err) {
      show(err?.errors ? err.errors.join(' · ') : errorMessage(err));
    }
  };

  async function list() {
    let rows;
    try {
      rows = await deps.repo.list();
    } catch (err) {
      show(errorMessage(err));
      panel.body.replaceChildren(msg, btn(t.retry, list));
      return;
    }
    const ul = el('ul', 'routes-list');
    if (!rows.length) ul.append(el('li', 'muted', t.empty));
    for (const p of rows) {
      const li = el('li', 'routes-item');
      const txt = el('div', 'routes-text');
      txt.append(el('strong', '', `${p.is_home ? '🏠' : '★'} ${p.name}`), el('small', 'muted', `${formatLatLon(p.lat, p.lon)}${p.is_home ? ` · ${t.home}` : ''}`));
      const b = el('div', 'btn-row');
      b.append(btn(p.is_home ? t.unsetHome : t.setHome, () => act(() => deps.repo.setHome(p.is_home ? null : p.id)), 'btn-small'));
      b.append(btn(t.rename, async () => {
        const n = await promptBox(t.renameAsk, p.name, t.save);
        if (n) act(() => deps.repo.update(p.id, { name: n }));
      }, 'btn-small'));
      if (deps.onUse) b.append(btn(t.use, () => { panel.close(); deps.onUse?.(p); }, 'btn-small'));
      b.append(btn(t.remove, async () => {
        if (await confirmBox(t.confirmRemove.replace('{name}', p.name), t.remove)) act(() => deps.repo.remove(p.id));
      }, 'btn-small'));
      li.append(txt, b);
      ul.append(li);
    }
    panel.body.replaceChildren(msg, el('p', 'field-hint', t.hint), ul);
  }

  panel.body.replaceChildren(el('p', 'muted', t.loading));
  list();
  return panel;
}
