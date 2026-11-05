// Luoghi salvati su Supabase (tabella places, SPEC §4.6): preferiti e un porto base per utente.

import { ValidationError } from './boats-repo.js';

/**
 * @typedef {Object} SavedPlace
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {string | null} note
 * @property {boolean} is_home
 */

/**
 * Controlla e ripulisce i campi (stessi vincoli della migrazione SQL).
 * @param {Record<string, any>} f
 * @param {boolean} partial
 * @returns {Record<string, any>}
 */
export function cleanPlace(f, partial = false) {
  const v = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(f, k) && f[k] !== undefined;
  if (!partial || has('name')) {
    v.name = String(f.name ?? '').trim();
    if (!v.name || v.name.length > 100) errors.push('Nome del luogo obbligatorio (max 100 caratteri)');
  }
  for (const [k, lim] of [['lat', 90], ['lon', 180]]) {
    if (!partial || has(k)) {
      const n = Number(f[k]);
      if (!Number.isFinite(n) || Math.abs(n) > lim) errors.push(`Coordinata ${k} non valida`);
      else v[k] = n;
    }
  }
  if (has('note')) v.note = f.note ? String(f.note).slice(0, 500) : null;
  if (has('is_home')) v.is_home = Boolean(f.is_home);
  if (errors.length) throw new ValidationError(errors);
  return v;
}

/** @param {{error: any}} res */
function check(res) {
  if (res.error) throw res.error;
  return res;
}

/**
 * Luogo salvato → risultato di ricerca.
 * @param {SavedPlace} p
 * @returns {import('../places/search.js').Place}
 */
export const toSearchPlace = (p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: 'saved', id: p.id, home: p.is_home, detail: p.note ?? undefined });

/**
 * @param {() => Promise<any>} getClient
 */
export function createPlacesRepo(getClient) {
  const COLS = 'id, name, lat, lon, note, is_home';
  return {
    /** @returns {Promise<SavedPlace[]>} porto base per primo, poi per nome */
    async list() {
      const sb = await getClient();
      const rows = check(await sb.from('places').select(COLS).order('name', { ascending: true })).data;
      return [...rows].sort((a, b) => Number(b.is_home) - Number(a.is_home));
    },

    /**
     * @param {{name: string, lat: number, lon: number, note?: string | null}} f
     * @returns {Promise<SavedPlace>}
     */
    async create(f) {
      const v = cleanPlace({ ...f, is_home: false });
      const sb = await getClient();
      return check(await sb.from('places').insert(v).select(COLS).single()).data;
    },

    /** @param {string} id @param {Record<string, any>} fields */
    async update(id, fields) {
      const { is_home: _h, ...rest } = fields;
      const v = cleanPlace(rest, true);
      const sb = await getClient();
      check(await sb.from('places').update(v).eq('id', id));
    },

    /**
     * Imposta (o toglie con null) il porto base: prima si toglie il vecchio (indice unico).
     * @param {string | null} id
     */
    async setHome(id) {
      const sb = await getClient();
      check(await sb.from('places').update({ is_home: false }).eq('is_home', true));
      if (id) check(await sb.from('places').update({ is_home: true }).eq('id', id));
    },

    /** @param {string} id */
    async remove(id) {
      const sb = await getClient();
      check(await sb.from('places').delete().eq('id', id));
    },
  };
}
