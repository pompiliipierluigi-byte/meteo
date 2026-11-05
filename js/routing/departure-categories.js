// Categorie della finestra di partenza (SPEC §2.7, §6.7): Speedy, Shorty, Windy, Lazy e "fuori limite".
// Modulo puro.

/** @typedef {'speedy' | 'shorty' | 'windy' | 'lazy'} Category */

/** Ordine di visualizzazione. @type {Category[]} */
export const CATEGORIES = ['speedy', 'shorty', 'windy', 'lazy'];

/**
 * @typedef {Object} RunSummary
 * @property {number} duration_h
 * @property {number} distance_nm
 * @property {number} motor_h
 * @property {number} beat_h ore di bolina a vela (TWA < confine bolina/portanti)
 * @property {number} max_tws_kn
 * @property {number} max_gust_kn
 * @property {number} max_wave_m
 */

/**
 * @typedef {Object} RunClass
 * @property {'ok' | 'limit' | 'notfound'} status
 * @property {Category[]} categories
 * @property {number | null} lazyScore
 * @property {('tws' | 'gust' | 'wave')[]} over limiti superati
 */

/**
 * Punteggio di disagio (Lazy): quota di bolina sulla durata + onda massima rispetto all'onda di avviso.
 * Vento in poppa/lasco e motore non pesano. Pesi da tarare sui casi reali (SPEC §9).
 * @param {RunSummary} s
 * @param {number} waveWarningM
 */
export function lazyScore(s, waveWarningM) {
  const beat = s.duration_h > 0 ? s.beat_h / s.duration_h : 0;
  const wave = waveWarningM > 0 && Number.isFinite(s.max_wave_m) ? s.max_wave_m / waveWarningM : 0;
  return beat + wave;
}

/**
 * Limiti superati dai massimi del run.
 * @param {RunSummary} s
 * @param {{twsKn: number|null, gustKn: number|null, waveM: number|null}} limits
 * @returns {('tws' | 'gust' | 'wave')[]}
 */
export function overLimits(s, limits) {
  const out = [];
  const on = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
  if (on(limits?.twsKn) && s.max_tws_kn > Number(limits.twsKn)) out.push('tws');
  if (on(limits?.gustKn) && s.max_gust_kn > Number(limits.gustKn)) out.push('gust');
  if (on(limits?.waveM) && s.max_wave_m > Number(limits.waveM)) out.push('wave');
  return /** @type {any} */ (out);
}

/**
 * Classifica i run. Una partenza può avere più categorie; a parità vince la partenza più vicina.
 * @param {({summary?: RunSummary, error?: any} | null | undefined)[]} runs nell'ordine delle partenze
 * @param {{limits?: {twsKn: number|null, gustKn: number|null, waveM: number|null}, waveWarningM?: number}} [opts]
 * @returns {{runs: RunClass[], best: Record<Category, number | null>}}
 */
export function categorize(runs, opts = {}) {
  const limits = opts.limits ?? { twsKn: null, gustKn: null, waveM: null };
  const waveWarningM = opts.waveWarningM ?? 2;
  /** @type {RunClass[]} */
  const out = runs.map((r) => {
    if (!r?.summary) return { status: 'notfound', categories: [], lazyScore: null, over: [] };
    const over = overLimits(r.summary, limits);
    return { status: over.length ? 'limit' : 'ok', categories: [], lazyScore: lazyScore(r.summary, waveWarningM), over };
  });
  const valid = out.map((c, i) => (c.status === 'ok' ? i : -1)).filter((i) => i >= 0);
  const EPS = 1e-6;
  /**
   * Indice del minimo secondo le chiavi (in ordine), o null.
   * @param {((i: number) => number)[]} keys
   */
  const argmin = (...keys) => {
    let best = null;
    for (const i of valid) {
      if (best === null) {
        best = i;
        continue;
      }
      for (const k of keys) {
        const d = k(i) - k(best);
        if (d < -EPS) {
          best = i;
          break;
        }
        if (d > EPS) break;
      }
    }
    return best;
  };
  const s = (i) => /** @type {RunSummary} */ (runs[i]?.summary);
  /** @type {Record<Category, number | null>} */
  const best = {
    speedy: argmin((i) => s(i).duration_h),
    shorty: argmin((i) => s(i).distance_nm),
    windy: argmin((i) => s(i).motor_h, (i) => s(i).duration_h),
    lazy: argmin((i) => /** @type {number} */ (out[i].lazyScore)),
  };
  for (const c of CATEGORIES) if (best[c] !== null) out[/** @type {number} */ (best[c])].categories.push(c);
  return { runs: out, best };
}
