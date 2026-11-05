// Barche e polari dell'utente su Supabase (tabelle boats e polars, SPEC §4.2–4.3).
// La RLS garantisce che ognuno veda e modifichi solo i propri dati; qui si validano i valori prima dell'invio.

import { validatePolar } from '../boats/polar.js';

/**
 * Barca come salvata.
 * @typedef {Object} Boat
 * @property {string} id
 * @property {string} name
 * @property {string | null} model
 * @property {number | null} loa_m
 * @property {'orc' | 'manual' | 'csv'} source
 * @property {string | null} orc_ref
 * @property {number | null} orc_year
 * @property {boolean} apply_efficiency
 * @property {number} motor_speed_kn
 * @property {number} tack_penalty_s
 * @property {{full?: PolarRow, white?: PolarRow}} polars
 */

/**
 * @typedef {Object} PolarRow
 * @property {string} id
 * @property {'full' | 'white'} kind
 * @property {import('../boats/polar.js').Polar} data
 * @property {'orc' | 'manual' | 'csv'} source
 * @property {string | null} notes
 */

/** Campi modificabili di una barca. */
const BOAT_FIELDS = ['name', 'model', 'loa_m', 'source', 'orc_ref', 'orc_year', 'apply_efficiency', 'motor_speed_kn', 'tack_penalty_s'];
const SOURCES = ['orc', 'manual', 'csv'];

/**
 * Controlla e ripulisce i campi di una barca (stessi limiti della migrazione SQL).
 * @param {Record<string, any>} b
 * @param {boolean} partial true per gli aggiornamenti (campi assenti ignorati)
 * @returns {{value: Record<string, any>, errors: string[]}}
 */
export function cleanBoat(b, partial = false) {
  /** @type {Record<string, any>} */
  const v = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
  for (const k of BOAT_FIELDS) if (has(k)) v[k] = b[k];
  if (!partial || has('name')) {
    v.name = String(v.name ?? '').trim();
    if (!v.name || v.name.length > 100) errors.push('Nome della barca obbligatorio (max 100 caratteri)');
  }
  if (!partial || has('source')) {
    if (!SOURCES.includes(v.source)) errors.push('Origine della polare non valida');
  }
  if (has('model')) v.model = String(v.model ?? '').trim().slice(0, 100) || null;
  const numIn = (k, lo, hi, label, nullable) => {
    if (!has(k)) return;
    if (v[k] === null || v[k] === '') {
      if (nullable) v[k] = null; else errors.push(`${label} obbligatorio`);
      return;
    }
    const n = Number(v[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${label} deve essere tra ${lo} e ${hi}`);
    else v[k] = n;
  };
  numIn('loa_m', 2, 100, 'Lunghezza (m)', true);
  numIn('orc_year', 1990, 2100, 'Anno del certificato', true);
  numIn('motor_speed_kn', 0.5, 30, 'Velocità a motore (kn)', false);
  numIn('tack_penalty_s', 0, 600, 'Penalità virata (s)', false);
  if (has('apply_efficiency')) v.apply_efficiency = Boolean(v.apply_efficiency);
  if (has('orc_ref')) v.orc_ref = v.orc_ref ? String(v.orc_ref).slice(0, 100) : null;
  return { value: v, errors };
}

/** Errore di validazione da mostrare all'utente. */
export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * @param {{error: any}} res
 */
function check(res) {
  if (res.error) throw res.error;
  return res;
}

/**
 * Riga dal database → Boat (polari raggruppate per tipo).
 * @param {any} row
 * @returns {Boat}
 */
export function toBoat(row) {
  const { polars = [], ...rest } = row;
  /** @type {Boat['polars']} */
  const byKind = {};
  for (const p of polars) byKind[/** @type {'full'|'white'} */ (p.kind)] = p;
  return { ...rest, polars: byKind };
}

const SELECT = 'id, name, model, loa_m, source, orc_ref, orc_year, apply_efficiency, motor_speed_kn, tack_penalty_s, created_at, updated_at, polars (id, kind, data, source, notes)';

/**
 * @param {() => Promise<any>} getClient client Supabase (iniettato: nei test un finto client)
 */
export function createBoatsRepo(getClient) {
  /**
   * @param {import('../boats/polar.js').Polar} data
   */
  const validPolar = (data) => {
    const errs = validatePolar(data);
    if (errs.length) throw new ValidationError(errs);
  };

  return {
    /** @returns {Promise<Boat[]>} barche dell'utente, per nome */
    async list() {
      const sb = await getClient();
      const res = check(await sb.from('boats').select(SELECT).order('name', { ascending: true }));
      return res.data.map(toBoat);
    },

    /**
     * @param {string} id
     * @returns {Promise<Boat | null>}
     */
    async get(id) {
      const sb = await getClient();
      const res = check(await sb.from('boats').select(SELECT).eq('id', id).maybeSingle());
      return res.data ? toBoat(res.data) : null;
    },

    /**
     * Crea una barca con la polare full (e facoltativamente quella vele bianche).
     * @param {Record<string, any>} boat
     * @param {{full: {data: import('../boats/polar.js').Polar, source: string, notes?: string | null}, white?: {data: import('../boats/polar.js').Polar, source: string, notes?: string | null}}} polars
     * @returns {Promise<Boat>}
     */
    async create(boat, polars) {
      const { value, errors } = cleanBoat(boat, false);
      if (errors.length) throw new ValidationError(errors);
      validPolar(polars.full.data);
      if (polars.white) validPolar(polars.white.data);
      const sb = await getClient();
      const created = check(await sb.from('boats').insert(value).select('id').single()).data;
      const rows = [['full', polars.full], ['white', polars.white]]
        .filter(([, p]) => p)
        .map(([kind, p]) => ({ boat_id: created.id, kind, data: p.data, source: p.source, notes: p.notes ?? null }));
      const res = await sb.from('polars').insert(rows);
      if (res.error) {
        // Niente barche senza polare: si annulla la creazione.
        await sb.from('boats').delete().eq('id', created.id);
        throw res.error;
      }
      return /** @type {Boat} */ (await this.get(created.id));
    },

    /**
     * @param {string} id
     * @param {Record<string, any>} fields
     */
    async update(id, fields) {
      const { value, errors } = cleanBoat(fields, true);
      if (errors.length) throw new ValidationError(errors);
      const sb = await getClient();
      check(await sb.from('boats').update(value).eq('id', id));
    },

    /**
     * Salva (crea o sostituisce) una polare della barca.
     * @param {string} boatId
     * @param {'full' | 'white'} kind
     * @param {import('../boats/polar.js').Polar} data
     * @param {'orc' | 'manual' | 'csv'} source
     * @param {string | null} [notes]
     */
    async savePolar(boatId, kind, data, source, notes = null) {
      validPolar(data);
      if (!SOURCES.includes(source)) throw new ValidationError(['Origine della polare non valida']);
      const sb = await getClient();
      check(await sb.from('polars').upsert({ boat_id: boatId, kind, data, source, notes }, { onConflict: 'boat_id,kind' }));
    },

    /**
     * Elimina la polare vele bianche (si torna a quella derivata). La full non si elimina da sola.
     * @param {string} boatId
     */
    async deleteWhitePolar(boatId) {
      const sb = await getClient();
      check(await sb.from('polars').delete().eq('boat_id', boatId).eq('kind', 'white'));
    },

    /**
     * Elimina la barca (le polari seguono, la barca predefinita del profilo si azzera).
     * @param {string} id
     */
    async remove(id) {
      const sb = await getClient();
      check(await sb.from('boats').delete().eq('id', id));
    },
  };
}
