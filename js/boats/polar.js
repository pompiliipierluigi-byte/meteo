// Polari: formato interno, interpolazione, angoli ottimi, correttivi del profilo e regola motore
// (SPEC §5.1–5.2). Modulo puro: nessun DOM, usato anche dal worker di routing.

/**
 * Polare nel formato interno (SPEC §5.1).
 * @typedef {Object} Polar
 * @property {1} version
 * @property {number[]} tws nodi, crescenti
 * @property {number[]} twa gradi 0–180, crescenti
 * @property {(number|null)[][]} bsp bsp[i][j] = velocità (kn) a twa[i], tws[j]; null = non definito
 * @property {{twa: (number|null)[], bsp: (number|null)[]}} [beat] angolo e velocità di bolina ottimi per TWS
 * @property {{twa: (number|null)[], bsp: (number|null)[]}} [run] angolo e velocità di poppa ottimi per TWS
 */

/**
 * Correttivi del profilo e della barca (SPEC §4.1, §4.2).
 * @typedef {Object} Corrections
 * @property {boolean} applyEfficiency
 * @property {number} upwindEffPct
 * @property {number} downwindEffPct
 * @property {number} whiteDownwindPct
 * @property {number} splitTwaDeg
 */

/** Correttivi neutri (polare così com'è). @type {Corrections} */
export const NO_CORRECTIONS = Object.freeze({
  applyEfficiency: false, upwindEffPct: 100, downwindEffPct: 100, whiteDownwindPct: 100, splitTwaDeg: 90,
});

/** Correttivi di default del profilo (SPEC §2.5). @type {Corrections} */
export const DEFAULT_CORRECTIONS = Object.freeze({
  applyEfficiency: true, upwindEffPct: 80, downwindEffPct: 80, whiteDownwindPct: 50, splitTwaDeg: 90,
});

/** @param {unknown} x */
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Controlla la struttura di una polare. Restituisce l'elenco degli errori (vuoto se valida).
 * @param {any} p
 * @returns {string[]}
 */
export function validatePolar(p) {
  const err = [];
  if (!p || typeof p !== 'object') return ['Polare mancante'];
  if (p.version !== 1) err.push('Versione del formato non supportata');
  const inc = (a) => Array.isArray(a) && a.length > 0 && a.every(isNum) && a.every((v, i) => i === 0 || v > a[i - 1]);
  if (!inc(p.tws)) err.push('TWS mancanti o non crescenti');
  else if (p.tws[0] <= 0) err.push('TWS devono essere positivi');
  if (!inc(p.twa)) err.push('TWA mancanti o non crescenti');
  else if (p.twa[0] < 0 || p.twa[p.twa.length - 1] > 180) err.push('TWA fuori dall\'intervallo 0–180°');
  if (!Array.isArray(p.bsp) || (inc(p.twa) && p.bsp.length !== p.twa.length)) err.push('Righe della tabella diverse dal numero di TWA');
  else if (inc(p.tws)) {
    p.bsp.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== p.tws.length) err.push(`Riga ${i + 1}: colonne diverse dal numero di TWS`);
      else if (row.some((v) => v !== null && (!isNum(v) || v < 0 || v > 60))) err.push(`Riga ${i + 1}: velocità non valide`);
    });
  }
  for (const k of ['beat', 'run']) {
    const o = p[k];
    if (o === undefined) continue;
    if (!o || !Array.isArray(o.twa) || !Array.isArray(o.bsp) || o.twa.length !== (p.tws?.length ?? -1) || o.bsp.length !== o.twa.length) {
      err.push(`Sezione ${k} non coerente con i TWS`);
    }
  }
  return err;
}

/**
 * Posizione in un vettore crescente: indice inferiore e peso, con il valore riportato nell'intervallo.
 * @param {number[]} axis
 * @param {number} v
 * @returns {{i: number, w: number}}
 */
function locate(axis, v) {
  const n = axis.length;
  if (n === 1 || v <= axis[0]) return { i: 0, w: 0 };
  if (v >= axis[n - 1]) return { i: n - 2, w: 1 };
  let i = 0;
  while (axis[i + 1] < v) i++;
  return { i, w: (v - axis[i]) / (axis[i + 1] - axis[i]) };
}

/**
 * Media pesata dei valori definiti (null esclusi, pesi rinormalizzati); NaN se nessuno.
 * @param {[number|null|undefined, number][]} pairs valore, peso
 */
function weighted(pairs) {
  let s = 0;
  let ws = 0;
  for (const [v, w] of pairs) {
    if (isNum(v) && w > 0) {
      s += v * w;
      ws += w;
    }
  }
  return ws > 1e-12 ? s / ws : NaN;
}

/**
 * Riporta un angolo qualsiasi a TWA 0–180 (simmetria mure).
 * @param {number} twaDeg
 */
export function foldTwa(twaDeg) {
  let a = ((twaDeg % 360) + 360) % 360;
  if (a > 180) a = 360 - a;
  return a;
}

/**
 * Valore di una tabella per TWS alla velocità del vento: lineare, verso 0 sotto il minimo (se `toZero`),
 * costante oltre il massimo.
 * @param {number[]} tws
 * @param {(number|null)[]} values
 * @param {number} twsKn
 * @param {boolean} toZero
 */
function alongTws(tws, values, twsKn, toZero) {
  if (twsKn <= 0) return toZero ? 0 : values.find(isNum) ?? NaN;
  if (twsKn < tws[0]) {
    const v0 = values[0];
    return toZero ? (isNum(v0) ? (v0 * twsKn) / tws[0] : NaN) : v0 ?? NaN;
  }
  const { i, w } = locate(tws, twsKn);
  if (tws.length === 1) return values[0] ?? NaN;
  return weighted([[values[i], 1 - w], [values[i + 1], w]]);
}

/**
 * Velocità della tabella (bilineare su TWA, TWS), senza zona morta né correttivi.
 * TWS < minimo: lineare verso 0 a TWS = 0; TWS > massimo: valore al massimo (SPEC §5.2).
 * TWA fuori tabella: valore della riga estrema.
 * @param {Polar} p
 * @param {number} twaDeg 0–180
 * @param {number} twsKn
 * @returns {number} NaN se non definita
 */
export function tableBsp(p, twaDeg, twsKn) {
  const a = locate(p.twa, twaDeg);
  const rowAt = (i) => alongTws(p.tws, p.bsp[i], twsKn, true);
  if (p.twa.length === 1) return rowAt(0);
  return weighted([[rowAt(a.i), 1 - a.w], [rowAt(a.i + 1), a.w]]);
}

/**
 * Angolo/velocità ottimi di bolina e poppa a un TWS: dalla polare se presenti, altrimenti
 * massimizzando la VMG sulla tabella (passo 0.5°).
 * @param {Polar} p
 * @param {number} twsKn
 * @returns {{beatTwa: number, beatBsp: number, runTwa: number, runBsp: number}}
 */
export function optimalAngles(p, twsKn) {
  // Memoria per polare e TWS (arrotondato a 0.01 kn): il routing la chiede milioni di volte.
  let memo = OPT_CACHE.get(p);
  if (!memo) {
    memo = new Map();
    OPT_CACHE.set(p, memo);
  }
  const key = Math.round(twsKn * 100);
  let hit = memo.get(key);
  if (!hit) {
    hit = computeOptimalAngles(p, key / 100);
    if (memo.size > 5000) memo.clear();
    memo.set(key, hit);
  }
  return hit;
}

/** @type {WeakMap<object, Map<number, {beatTwa: number, beatBsp: number, runTwa: number, runBsp: number}>>} */
const OPT_CACHE = new WeakMap();

/**
 * @param {Polar} p
 * @param {number} twsKn
 */
function computeOptimalAngles(p, twsKn) {
  const fromTable = (section, toZero) => (section
    ? { twa: alongTws(p.tws, section.twa, twsKn, false), bsp: alongTws(p.tws, section.bsp, twsKn, toZero) }
    : null);
  let beat = fromTable(p.beat, true);
  let run = fromTable(p.run, true);
  if (!beat || !isNum(beat.twa) || !isNum(beat.bsp) || !run || !isNum(run.twa) || !isNum(run.bsp)) {
    let bestUp = { twa: p.twa[0], bsp: 0, vmg: -Infinity };
    let bestDown = { twa: 180, bsp: 0, vmg: -Infinity };
    for (let twa = p.twa[0]; twa <= p.twa[p.twa.length - 1] + 1e-9; twa += 0.5) {
      const v = tableBsp(p, twa, twsKn);
      if (!isNum(v)) continue;
      const c = Math.cos((twa * Math.PI) / 180) * v;
      if (c > bestUp.vmg) bestUp = { twa, bsp: v, vmg: c };
      if (-c > bestDown.vmg) bestDown = { twa, bsp: v, vmg: -c };
    }
    if (!beat || !isNum(beat.twa) || !isNum(beat.bsp)) beat = { twa: bestUp.twa, bsp: bestUp.bsp };
    if (!run || !isNum(run.twa) || !isNum(run.bsp)) run = { twa: bestDown.twa, bsp: bestDown.bsp };
  }
  return { beatTwa: beat.twa, beatBsp: beat.bsp, runTwa: run.twa, runBsp: run.bsp };
}

/**
 * Velocità a vela della polare (senza correttivi) con zona morta: 0 sotto l'angolo di bolina ottimo;
 * tra l'angolo di bolina e la prima riga della tabella, lineare tra il punto di bolina e la tabella.
 * Oltre l'ultima riga (es. le tabelle ORC finiscono a 150°): se il punto di poppa ottimo è più largo,
 * lineare fino a quel punto e poi a VMG di poppa costante fino a 180°; altrimenti valore dell'ultima riga.
 * @param {Polar} p
 * @param {number} twaDeg qualsiasi (ripiegato su 0–180)
 * @param {number} twsKn
 * @returns {number} kn, ≥ 0
 */
export function polarBsp(p, twaDeg, twsKn) {
  if (!(twsKn > 0)) return 0;
  const twa = foldTwa(twaDeg);
  const opt = optimalAngles(p, twsKn);
  if (twa < opt.beatTwa) return 0;
  const first = p.twa[0];
  if (twa < first && opt.beatTwa < first) {
    const atFirst = tableBsp(p, first, twsKn);
    const k = (twa - opt.beatTwa) / (first - opt.beatTwa);
    const v = opt.beatBsp + ((isNum(atFirst) ? atFirst : opt.beatBsp) - opt.beatBsp) * k;
    return Math.max(0, v);
  }
  const last = p.twa[p.twa.length - 1];
  if (twa > last && opt.runTwa > last && opt.runTwa < 180 && isNum(opt.runBsp)) {
    if (twa <= opt.runTwa) {
      const atLast = tableBsp(p, last, twsKn);
      const k = (twa - last) / (opt.runTwa - last);
      return Math.max(0, (isNum(atLast) ? atLast : opt.runBsp) + (opt.runBsp - (isNum(atLast) ? atLast : opt.runBsp)) * k);
    }
    const rad = (d) => (d * Math.PI) / 180;
    return Math.max(0, (opt.runBsp * Math.cos(rad(180 - opt.runTwa))) / Math.cos(rad(180 - twa)));
  }
  const v = tableBsp(p, twa, twsKn);
  return isNum(v) ? Math.max(0, v) : 0;
}

/**
 * Velocità a vela effettiva con i correttivi del profilo (SPEC §5.2).
 * @param {{full: Polar, white?: Polar | null}} polars
 * @param {'full' | 'white'} kind set di vele scelto per il calcolo
 * @param {number} twaDeg
 * @param {number} twsKn
 * @param {Corrections} c
 * @returns {number}
 */
export function sailSpeed(polars, kind, twaDeg, twsKn, c) {
  const twa = foldTwa(twaDeg);
  const downwind = twa >= c.splitTwaDeg;
  const eff = c.applyEfficiency ? (downwind ? c.downwindEffPct : c.upwindEffPct) / 100 : 1;
  if (kind === 'white' && polars.white) return polarBsp(polars.white, twa, twsKn) * eff;
  const base = polarBsp(polars.full, twa, twsKn) * eff;
  if (kind === 'white' && downwind) return base * (c.whiteDownwindPct / 100);
  return base;
}

/**
 * Migliori prestazioni a vela da un punto: massima velocità su tutte le prue e massima VMC verso la meta.
 * @param {(twaDeg: number) => number} speedAt velocità a vela per TWA (es. sailSpeed già legata)
 * @param {number} twdDeg direzione di provenienza del vento
 * @param {number} bearingDeg rilevamento della meta corrente (arrivo o prossimo waypoint)
 * @param {number} [stepDeg]
 * @returns {{maxBsp: number, maxVmc: number}}
 */
export function bestSailing(speedAt, twdDeg, bearingDeg, stepDeg = 5) {
  let maxBsp = 0;
  let maxVmc = -Infinity;
  for (let h = 0; h < 360; h += stepDeg) {
    const v = speedAt(h - twdDeg);
    if (v > maxBsp) maxBsp = v;
    const vmc = v * Math.cos(((h - bearingDeg) * Math.PI) / 180);
    if (vmc > maxVmc) maxVmc = vmc;
  }
  return { maxBsp, maxVmc: Math.max(0, maxVmc) };
}

/**
 * Regola motore (SPEC §5.2), decisa per punto dell'isocrona.
 * @param {{maxBsp: number, maxVmc: number}} best
 * @param {{mode: 'speed' | 'vmg', thresholdKn: number}} cfg
 * @returns {boolean} true = a motore
 */
export function useMotor(best, cfg) {
  return cfg.mode === 'speed' ? best.maxBsp < cfg.thresholdKn : best.maxVmc < cfg.thresholdKn;
}
