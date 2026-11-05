// Importazione ORC da orc-data (https://github.com/jieter/orc-data): indice di ricerca, scheda della barca,
// conversione della VPP nel formato interno (SPEC §5.4). Le funzioni di conversione e ricerca sono pure.
//
// L'indice viene da data/orc/index.json (generato da tools/orc/make-index.mjs: quello pubblicato da orc-data
// è incompleto); le schede si leggono su richiesta dal sito di orc-data.

/** Indirizzi delle schede (il secondo è la copia grezza del repository, se il sito non risponde). */
const BOAT_URLS = [
  (sn) => `https://jieter.github.io/orc-data/site/data/${sn}.json`,
  (sn) => `https://raw.githubusercontent.com/jieter/orc-data/master/site/data/${sn}.json`,
];
const INDEX_URL = new URL('../../data/orc/index.json', import.meta.url).href;

/**
 * Voce dell'indice: numero velico (con nazione, es. "ITA/ITA15598"), nome, tipo, anno, LOA (m).
 * @typedef {[string, string, string, number | null, number | null]} OrcIndexEntry
 */

/**
 * @typedef {Object} OrcIndex
 * @property {string} generated
 * @property {number | null} vppYear
 * @property {OrcIndexEntry[]} boats
 */

/** @type {Promise<OrcIndex> | null} */
let indexPromise = null;

/**
 * Indice (scaricato una volta; il service worker lo conserva per l'uso offline).
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<OrcIndex>}
 */
export function loadOrcIndex(fetchFn = fetch) {
  if (!indexPromise) {
    indexPromise = fetchFn(INDEX_URL).then((r) => {
      if (!r.ok) throw new Error(`Indice ORC non disponibile (HTTP ${r.status})`);
      return r.json();
    }).catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/**
 * Testo normalizzato per la ricerca (minuscole, senza accenti, spazi e segni uniformati).
 * @param {string} s
 */
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ').trim();
}

/**
 * Ricerca per nome, numero velico, nazione o tipo: tutte le parole devono comparire.
 * Prima i numeri velici che coincidono, poi i nomi che iniziano con la ricerca.
 * @param {OrcIndexEntry[]} boats
 * @param {string} query
 * @param {number} [limit]
 * @returns {OrcIndexEntry[]}
 */
export function searchOrc(boats, query, limit = 50) {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(' ');
  const compactQ = q.replace(/ /g, '');
  /** @type {[number, OrcIndexEntry][]} */
  const hits = [];
  for (const b of boats) {
    const [sn, name, type] = b;
    const snNorm = normalize(sn.replace('/', ' '));
    const hay = `${normalize(name)} ${snNorm} ${normalize(type)} ${sn.split('/')[1]?.toLowerCase() ?? ''}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const snNumber = (sn.split('/')[1] ?? '').toLowerCase();
    let score = 3;
    if (snNumber === compactQ || snNumber.replace(/^[a-z]+/, '') === compactQ) score = 0;
    else if (normalize(name) === q) score = 1;
    else if (normalize(name).startsWith(q)) score = 2;
    hits.push([score, b]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  return hits.slice(0, limit).map((h) => h[1]);
}

/**
 * Scheda ORC di una barca.
 * @param {string} sailnumber es. "ITA/ITA15598"
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<any>}
 */
export async function fetchOrcBoat(sailnumber, fetchFn = fetch) {
  if (!/^[A-Z]{3}\/[A-Za-z0-9_.-]+$/.test(sailnumber)) throw new Error('Numero velico non valido');
  let lastErr = null;
  for (const url of BOAT_URLS) {
    try {
      const r = await fetchFn(url(sailnumber));
      if (r.ok) return await r.json();
      lastErr = new Error(`Scheda ORC non trovata (HTTP ${r.status})`);
    } catch (err) {
      lastErr = new Error('Sito orc-data non raggiungibile');
    }
  }
  throw lastErr;
}

/** @param {unknown} x */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * Converte la VPP di una scheda orc-data nel formato interno (set "full": vele da regata, SPEC §5.4).
 * Gli ottimi di bolina e poppa sono VMG: la velocità della barca si ricava dividendo per il coseno.
 * @param {any} boat
 * @returns {import('./polar.js').Polar}
 */
export function orcToPolar(boat) {
  const v = boat?.vpp;
  if (!v || !Array.isArray(v.angles) || !Array.isArray(v.speeds)) throw new Error('Scheda ORC senza VPP');
  const tws = v.speeds.map(Number);
  const twa = v.angles.map(Number);
  const bsp = twa.map((a) => {
    const row = v[String(a)];
    if (!Array.isArray(row) || row.length !== tws.length) throw new Error(`VPP incompleta a ${a}°`);
    return row.map((x) => (num(x) && x > 0 ? x : null));
  });
  const rad = (d) => (d * Math.PI) / 180;
  /** @type {import('./polar.js').Polar} */
  const polar = { version: 1, tws, twa, bsp };
  const section = (angles, vmgs, sign) => {
    if (!Array.isArray(angles) || !Array.isArray(vmgs) || angles.length !== tws.length || vmgs.length !== tws.length) return undefined;
    const t = angles.map((a) => num(a));
    const b = t.map((a, j) => {
      const vmg = num(vmgs[j]);
      const c = a === null ? 0 : sign * Math.cos(rad(a));
      return vmg !== null && vmg > 0 && c > 1e-3 ? Math.round((vmg / c) * 100) / 100 : null;
    });
    return { twa: t, bsp: b };
  };
  const beat = section(v.beat_angle, v.beat_vmg, 1);
  const run = section(v.run_angle, v.run_vmg, -1);
  if (beat) polar.beat = beat;
  if (run) polar.run = run;
  return polar;
}

/**
 * Dati della barca per la tabella boats (SPEC §4.2).
 * @param {any} boat
 * @param {number | null} vppYear
 * @returns {{name: string, model: string | null, loa_m: number | null, source: 'orc', orc_ref: string, orc_year: number | null}}
 */
export function orcBoatRecord(boat, vppYear) {
  const loa = num(boat?.boat?.sizes?.loa);
  return {
    name: (boat?.name || boat?.boat?.type || boat?.sailnumber || 'Barca ORC').trim().slice(0, 100),
    model: (boat?.boat?.type || '').trim().slice(0, 100) || null,
    loa_m: loa !== null && loa >= 2 && loa <= 100 ? Math.round(loa * 100) / 100 : null,
    source: 'orc',
    orc_ref: String(boat?.sailnumber ?? '').slice(0, 100),
    orc_year: vppYear,
  };
}
