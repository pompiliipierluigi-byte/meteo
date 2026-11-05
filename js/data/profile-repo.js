// Profilo dell'utente su Supabase (tabella profiles, SPEC §4.1): correttivi polari, motore, costa,
// avvisi, limiti, preferenze e barca predefinita (= barca attiva).

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string | null} display_name
 * @property {string | null} default_boat_id
 * @property {number} upwind_eff_pct
 * @property {number} downwind_eff_pct
 * @property {number} white_downwind_pct
 * @property {number} split_twa_deg
 * @property {'speed' | 'vmg'} motor_mode
 * @property {number} motor_threshold_kn
 * @property {boolean} motor_near_land
 * @property {number} motor_near_land_nm
 * @property {number} coast_margin_nm
 * @property {number} coast_warning_nm
 * @property {number} wave_warning_m
 * @property {number | null} limit_tws_kn
 * @property {number | null} limit_gust_kn
 * @property {number | null} limit_wave_m
 * @property {Record<string, any>} settings
 * @property {number} disclaimer_version
 */

/**
 * Campi numerici con limiti (uguali ai vincoli della migrazione) e se ammettono null.
 * @type {Record<string, [number, number, boolean]>}
 */
export const PROFILE_RANGES = {
  upwind_eff_pct: [30, 120, false],
  downwind_eff_pct: [30, 120, false],
  white_downwind_pct: [20, 100, false],
  split_twa_deg: [30, 150, false],
  motor_threshold_kn: [0, 10, false],
  motor_near_land_nm: [0, 10, false],
  coast_margin_nm: [0, 5, false],
  coast_warning_nm: [0, 10, false],
  wave_warning_m: [0.1, 15, false],
  limit_tws_kn: [1, 80, true],
  limit_gust_kn: [1, 100, true],
  limit_wave_m: [0.1, 15, true],
};

/** Valori di default (SPEC §4.1), usati anche per "ripristina". */
export const PROFILE_DEFAULTS = Object.freeze({
  upwind_eff_pct: 80,
  downwind_eff_pct: 80,
  white_downwind_pct: 50,
  split_twa_deg: 90,
  motor_mode: 'vmg',
  motor_threshold_kn: 3,
  motor_near_land: false,
  motor_near_land_nm: 0.5,
  coast_margin_nm: 0.3,
  coast_warning_nm: 1,
  wave_warning_m: 2,
  limit_tws_kn: null,
  limit_gust_kn: null,
  limit_wave_m: null,
});

/**
 * Controlla i campi da aggiornare. I numeri arrivano anche come testo (virgola accettata).
 * @param {Record<string, any>} f
 * @param {Record<string, string>} [labels] nomi leggibili dei campi per i messaggi
 * @returns {{value: Record<string, any>, errors: string[]}}
 */
export function cleanProfile(f, labels = {}) {
  /** @type {Record<string, any>} */
  const value = {};
  const errors = [];
  for (const [k, raw] of Object.entries(f)) {
    if (raw === undefined) continue;
    const name = labels[k] ?? k;
    if (k in PROFILE_RANGES) {
      const [lo, hi, nullable] = PROFILE_RANGES[k];
      if (raw === null || String(raw).trim() === '') {
        if (nullable) value[k] = null; else errors.push(`${name}: valore obbligatorio`);
        continue;
      }
      const n = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${name}: deve essere tra ${lo} e ${hi}`);
      else value[k] = n;
    } else if (k === 'motor_mode') {
      if (raw === 'speed' || raw === 'vmg') value[k] = raw; else errors.push(`${name}: modalità non valida`);
    } else if (k === 'motor_near_land') {
      value[k] = Boolean(raw);
    } else if (k === 'display_name') {
      value[k] = String(raw ?? '').trim().slice(0, 100) || null;
    } else if (k === 'default_boat_id') {
      value[k] = raw || null;
    } else if (k === 'settings') {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) value[k] = raw; else errors.push(`${name}: non valido`);
    } else if (k === 'disclaimer_version') {
      value[k] = Math.max(0, Math.trunc(Number(raw) || 0));
    }
  }
  return { value, errors };
}

/**
 * Correttivi per il modello polare (js/boats/polar.js) da profilo e barca.
 * @param {Profile} p
 * @param {{apply_efficiency: boolean}} boat
 * @returns {import('../boats/polar.js').Corrections}
 */
export function correctionsFor(p, boat) {
  return {
    applyEfficiency: Boolean(boat.apply_efficiency),
    upwindEffPct: Number(p.upwind_eff_pct),
    downwindEffPct: Number(p.downwind_eff_pct),
    whiteDownwindPct: Number(p.white_downwind_pct),
    splitTwaDeg: Number(p.split_twa_deg),
  };
}

/**
 * @param {() => Promise<any>} getClient
 */
export function createProfileRepo(getClient) {
  return {
    /** @returns {Promise<Profile | null>} profilo dell'utente collegato (la RLS restituisce solo il suo) */
    async get() {
      const sb = await getClient();
      const { data, error } = await sb.from('profiles').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },

    /**
     * @param {string} id
     * @param {Record<string, any>} fields già validati con cleanProfile
     */
    async update(id, fields) {
      const sb = await getClient();
      const { error } = await sb.from('profiles').update(fields).eq('id', id);
      if (error) throw error;
    },
  };
}
