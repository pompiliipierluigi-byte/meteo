// Motore di routing a isocrone (SPEC §6): espansione per prue, correnti, regola motore, limiti, costa,
// potatura a celle, arrivo esatto, tratti con waypoint. Modulo puro (nessun DOM): gira nel Web Worker.

import { distanceNm, bearingDeg, destination, angleDiff, norm360 } from './geo.js';
import { bestSailing, useMotor } from '../boats/polar.js';

const MIN = 60e3;

/** Errore di routing con messaggio per l'utente. */
export class RouteError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
  }
}

/**
 * Parametri del calcolo.
 * @typedef {Object} RouteParams
 * @property {{lat: number, lon: number}[]} route partenza, waypoint…, arrivo
 * @property {number} departMs
 * @property {(twaDeg: number, twsKn: number) => number} sailSpeed velocità a vela con correttivi (kn)
 * @property {number} maxSailKn velocità massima della polare con correttivi (euristica di potatura)
 * @property {(lat: number, lon: number, tMs: number) => import('./interp.js').Conditions | null} sampler
 * @property {{segmentHitsLand: Function, distanceToCoastNm: Function} | null} [land]
 * @property {{mode: 'speed'|'vmg', thresholdKn: number, speedKn: number, nearLand: boolean, nearLandNm: number}} motor
 * @property {{twsKn: number|null, gustKn: number|null, waveM: number|null}} [limits]
 * @property {number} [coastMarginNm]
 * @property {number} [coastWarningNm]
 * @property {number} [waveWarningM]
 * @property {number} [splitTwaDeg] confine bolina/portanti per le ore di bolina
 * @property {{latMin: number, latMax: number, lonMin: number, lonMax: number}} [bbox]
 * @property {number} [dtMin] passo (min), default 30
 * @property {number} [dtFineMin] passo fine nelle prime 2 h e vicino all'arrivo, default 15
 * @property {number} [headingStepDeg] default 5
 * @property {number} [sectorDeg] semiampiezza del settore di prue intorno alla meta, default 140
 * @property {number} [cellNm] lato della cella di potatura, default 0.5
 * @property {number} [maxPoints] default 1500
 * @property {number} [maxHours] default 120
 * @property {boolean} [keepIsochrones] restituisce le isocrone per la mappa
 * @property {(fraction: number) => void} [onProgress]
 * @property {() => boolean} [isCancelled]
 */

/**
 * Punto della traccia (SPEC §6.6).
 * @typedef {Object} TrackPoint
 * @property {number} t ms UTC
 * @property {number} lat
 * @property {number} lon
 * @property {number} heading prua (gradi veri)
 * @property {number} bsp velocità sull'acqua (kn)
 * @property {number} cog rotta sul fondo
 * @property {number} sog velocità sul fondo (kn)
 * @property {number} tws
 * @property {number} twd
 * @property {number} twa con segno: negativo = vento da sinistra (mure a sinistra)
 * @property {number} gust
 * @property {number} wave_h
 * @property {number} wave_dir
 * @property {number} wave_per
 * @property {number} cur_kn
 * @property {number} cur_dir
 * @property {boolean} motor
 * @property {number} dist_land_nm
 * @property {string[]} warn 'wave' (onda oltre l'avviso), 'coast' (attendibilità ridotta)
 * @property {number} [leg] indice del tratto
 */

/**
 * Nodo dell'isocrona.
 * @typedef {{lat: number, lon: number, t: number, parent: Node | null, heading: number, bsp: number, sog: number,
 *   cog: number, motor: boolean, cond: import('./interp.js').Conditions | null}} Node
 */

/**
 * Calcola la rotta più rapida (tutti i tratti).
 * @param {RouteParams} p
 * @returns {{track: TrackPoint[], summary: ReturnType<typeof summarize>, isochrones: [number, number][][]}}
 */
export function computeRoute(p) {
  if (p.route.length < 2) throw new RouteError('Servono partenza e arrivo', 'input');
  const maxMs = (p.maxHours ?? 120) * 3600e3;
  const legs = p.route.length - 1;
  /** @type {TrackPoint[]} */
  let track = [];
  /** @type {[number, number][][]} */
  const isochrones = [];
  let t = p.departMs;
  for (let leg = 0; leg < legs; leg++) {
    const res = computeLeg(p, p.route[leg], p.route[leg + 1], t, p.departMs + maxMs, (f) => p.onProgress?.((leg + f) / legs));
    const pts = res.track.map((q) => ({ ...q, leg }));
    track = track.length ? track.concat(pts.slice(1)) : pts;
    isochrones.push(...res.isochrones);
    t = res.arrivalMs;
  }
  return { track, summary: summarize(track, p), isochrones };
}

/**
 * Un tratto: da `from` a `to` partendo all'istante `t0`.
 * @param {RouteParams} p
 * @param {{lat: number, lon: number}} from
 * @param {{lat: number, lon: number}} to
 * @param {number} t0
 * @param {number} tLimit
 * @param {(f: number) => void} progress
 */
function computeLeg(p, from, to, t0, tLimit, progress) {
  const dtMs = (p.dtMin ?? 30) * MIN;
  const dtFineMs = (p.dtFineMin ?? 15) * MIN;
  const step = p.headingStepDeg ?? 5;
  const sector = p.sectorDeg ?? 140;
  const cellNm = p.cellNm ?? 0.5;
  const maxPoints = p.maxPoints ?? 1500;
  const margin = p.coastMarginNm ?? 0;
  const land = p.land ?? null;
  const limits = p.limits ?? { twsKn: null, gustKn: null, waveM: null };
  const hasLimits = limits.twsKn !== null || limits.gustKn !== null || limits.waveM !== null;
  const total = distanceNm(from.lat, from.lon, to.lat, to.lon);
  if (land?.segmentHitsLand(from.lat, from.lon, from.lat, from.lon)) throw new RouteError('Punto di partenza a terra', 'land');

  // Proiezione locale per le celle di potatura.
  const kx = Math.cos((from.lat * Math.PI) / 180) * 60;
  const cellOf = (lat, lon) => `${Math.round(((lon - from.lon) * kx) / cellNm)},${Math.round(((lat - from.lat) * 60) / cellNm)}`;
  const blocked = new Set([cellOf(from.lat, from.lon)]);

  /** @type {Node} */
  const start = { lat: from.lat, lon: from.lon, t: t0, parent: null, heading: 0, bsp: 0, sog: 0, cog: 0, motor: false, cond: null };
  let front = [start];
  /** @type {[number, number][][]} */
  const isos = [];
  /** @type {{node: Node, t: number} | null} */
  let best = null;

  while (front.length) {
    if (p.isCancelled?.()) throw new RouteError('Calcolo annullato', 'cancelled');
    const t = front[0].t;
    if (t - t0 > 0) {
      const remaining = Math.min(...front.map((n) => distanceNm(n.lat, n.lon, to.lat, to.lon)));
      progress(Math.max(0, Math.min(0.99, 1 - remaining / Math.max(total, 1e-6))));
    }
    if (t > tLimit) break;
    const fine = t - t0 < 2 * 3600e3 || front.some((n) => distanceNm(n.lat, n.lon, to.lat, to.lon) < p.maxSailKn * (dtMs / 3600e3) * 2);
    const dt = fine ? dtFineMs : dtMs;
    const dtH = dt / 3600e3;
    /** @type {Map<string, Node>} */
    const next = new Map();

    for (const n of front) {
      const c = p.sampler(n.lat, n.lon, n.t);
      if (!c) continue;
      const goalBrg = bearingDeg(n.lat, n.lon, to.lat, to.lon);
      const distGoal = distanceNm(n.lat, n.lon, to.lat, to.lon);
      const distLand = land ? land.distanceToCoastNm(n.lat, n.lon, Math.max(p.motor.nearLandNm, 1)) : Infinity;
      // Regola motore decisa per punto (SPEC §5.2), o motore forzato vicino a terra.
      const best0 = bestSailing((twa) => p.sailSpeed(twa, c.twsKn), c.twdDeg, goalBrg, step);
      const motor = (p.motor.nearLand && distLand < p.motor.nearLandNm) || useMotor(best0, p.motor);

      // Ultimo tratto corto (sotto due celle): si arriva alla migliore VMC verso la meta.
      if (distGoal <= 2 * cellNm) {
        const curAlong = c.curU * Math.sin((goalBrg * Math.PI) / 180) + c.curV * Math.cos((goalBrg * Math.PI) / 180);
        const vmc = (motor ? p.motor.speedKn : best0.maxVmc) + curAlong;
        if (vmc > 0.05 && (!land || !land.segmentHitsLand(n.lat, n.lon, to.lat, to.lon))) {
          const tArr = n.t + (distGoal / vmc) * 3600e3;
          if (!best || tArr < best.t) {
            best = { t: tArr, node: { lat: to.lat, lon: to.lon, t: tArr, parent: n, heading: goalBrg, bsp: motor ? p.motor.speedKn : best0.maxVmc, sog: vmc, cog: goalBrg, motor, cond: c } };
          }
        }
      }

      const headings = [goalBrg];
      for (let off = step; off <= sector; off += step) headings.push(norm360(goalBrg + off), norm360(goalBrg - off));
      for (const h of headings) {
        const bsp = motor ? p.motor.speedKn : p.sailSpeed(h - c.twdDeg, c.twsKn);
        if (!(bsp > 0.05)) continue;
        // Velocità sul fondo = barca + corrente.
        const vx = bsp * Math.sin((h * Math.PI) / 180) + c.curU;
        const vy = bsp * Math.cos((h * Math.PI) / 180) + c.curV;
        const sog = Math.hypot(vx, vy);
        if (sog < 0.05) continue;
        const cog = norm360((Math.atan2(vx, vy) * 180) / Math.PI);
        const travel = sog * dtH;

        // Arrivo nel passo: se la meta è più vicina dello spostamento, nella sua direzione.
        if (travel >= distGoal && Math.abs(angleDiff(cog, goalBrg)) <= step * 0.75) {
          if (!land || !land.segmentHitsLand(n.lat, n.lon, to.lat, to.lon)) {
            const tArr = n.t + (distGoal / sog) * 3600e3;
            if (!best || tArr < best.t) {
              best = { t: tArr, node: { lat: to.lat, lon: to.lon, t: tArr, parent: n, heading: h, bsp, sog, cog, motor, cond: c } };
            }
          }
          continue;
        }
        const q = destination(n.lat, n.lon, cog, travel);
        if (p.bbox && (q.lat < p.bbox.latMin || q.lat > p.bbox.latMax || q.lon < p.bbox.lonMin || q.lon > p.bbox.lonMax)) continue;
        const key = cellOf(q.lat, q.lon);
        if (blocked.has(key)) continue;
        if (land) {
          if (land.segmentHitsLand(n.lat, n.lon, q.lat, q.lon)) continue;
          // Margine dalla costa, non applicato vicino a partenza e arrivo (porti, ridossi).
          if (margin > 0 && distanceNm(q.lat, q.lon, from.lat, from.lon) > 2 * margin + 0.5
            && distanceNm(q.lat, q.lon, to.lat, to.lon) > 2 * margin + 0.5
            && land.distanceToCoastNm(q.lat, q.lon, margin) < margin) continue;
        }
        if (hasLimits) {
          const cq = p.sampler(q.lat, q.lon, n.t + dt);
          if (cq && ((limits.twsKn !== null && cq.twsKn > limits.twsKn)
            || (limits.gustKn !== null && cq.gustKn > limits.gustKn)
            || (limits.waveM !== null && cq.waveHeightM > limits.waveM))) continue;
        }
        const node = { lat: q.lat, lon: q.lon, t: n.t + dt, parent: n, heading: h, bsp, sog, cog, motor, cond: c };
        const prev = next.get(key);
        // A parità di tempo, nella stessa cella si tiene il punto più vicino alla meta.
        if (!prev || distanceNm(q.lat, q.lon, to.lat, to.lon) < distanceNm(prev.lat, prev.lon, to.lat, to.lon)) next.set(key, node);
      }
    }

    // Si completa l'isocrona corrente e si sceglie l'arrivo più rapido (SPEC §6.4).
    if (best) break;
    let list = [...next.values()];
    for (const k of next.keys()) blocked.add(k);
    if (list.length > maxPoints) {
      // Euristica tipo A*: tempo trascorso + distanza residua / velocità massima (tempo uguale per tutti).
      list.sort((a, b) => distanceNm(a.lat, a.lon, to.lat, to.lon) - distanceNm(b.lat, b.lon, to.lat, to.lon));
      list = list.slice(0, maxPoints);
    }
    if (p.keepIsochrones) isos.push(list.map((n) => [n.lat, n.lon]));
    front = list;
  }

  if (!best) {
    throw new RouteError(front.length ? 'Rotta non trovata entro l\'orizzonte meteo' : 'Rotta non trovata: nessun passaggio a mare (costa, limiti o assenza di vento)', 'notfound');
  }
  progress(1);
  // Ricostruzione della traccia tramite i puntatori al genitore.
  /** @type {Node[]} */
  const nodes = [];
  for (let n = best.node; n; n = n.parent) nodes.unshift(n);
  return { track: toTrack(nodes, p), arrivalMs: best.t, isochrones: isos };
}

/**
 * Nodi → punti della traccia: ogni punto ha i dati del tratto che parte da lì (l'ultimo quelli dell'arrivo).
 * @param {Node[]} nodes
 * @param {RouteParams} p
 * @returns {TrackPoint[]}
 */
function toTrack(nodes, p) {
  return nodes.map((n, i) => {
    const seg = nodes[i + 1] ?? n;
    const c = seg.cond ?? p.sampler(n.lat, n.lon, n.t);
    const twa = c ? angleDiff(c.twdDeg, seg.heading) : NaN;
    const distLand = p.land ? p.land.distanceToCoastNm(n.lat, n.lon, Math.max(p.coastWarningNm ?? 1, 1) * 3) : Infinity;
    const warn = [];
    if (c && p.waveWarningM && c.waveHeightM > p.waveWarningM) warn.push('wave');
    if (p.coastWarningNm && distLand < p.coastWarningNm) warn.push('coast');
    return {
      t: n.t,
      lat: n.lat,
      lon: n.lon,
      heading: seg.heading,
      bsp: seg.bsp,
      cog: seg.cog,
      sog: seg.sog,
      tws: c?.twsKn ?? NaN,
      twd: c?.twdDeg ?? NaN,
      // Con segno: vento da dritta positivo (mure a dritta), da sinistra negativo.
      twa: Number.isFinite(twa) ? -twa : NaN,
      gust: c?.gustKn ?? NaN,
      wave_h: c?.waveHeightM ?? NaN,
      wave_dir: c?.waveDirDeg ?? NaN,
      wave_per: c?.wavePeriodS ?? NaN,
      cur_kn: c?.curKn ?? 0,
      cur_dir: c?.curDirDeg ?? 0,
      motor: seg.motor,
      dist_land_nm: distLand,
      warn,
    };
  });
}

/**
 * Riepilogo (SPEC §2.6, §6.6, §6.7): durata, distanza, ore di motore e di bolina, massimi, arrivo.
 * @param {TrackPoint[]} track
 * @param {{splitTwaDeg?: number}} p
 */
export function summarize(track, p = {}) {
  const split = p.splitTwaDeg ?? 90;
  let distance = 0;
  let motorMs = 0;
  let beatMs = 0;
  let maxTws = 0;
  let maxGust = 0;
  let maxWave = 0;
  const warnings = new Set();
  for (let i = 0; i < track.length; i++) {
    const a = track[i];
    if (Number.isFinite(a.tws)) maxTws = Math.max(maxTws, a.tws);
    if (Number.isFinite(a.gust)) maxGust = Math.max(maxGust, a.gust);
    if (Number.isFinite(a.wave_h)) maxWave = Math.max(maxWave, a.wave_h);
    a.warn.forEach((w) => warnings.add(w));
    const b = track[i + 1];
    if (!b) continue;
    distance += distanceNm(a.lat, a.lon, b.lat, b.lon);
    const dt = b.t - a.t;
    if (a.motor) motorMs += dt;
    else if (Math.abs(a.twa) < split) beatMs += dt;
  }
  const first = track[0];
  const last = track[track.length - 1];
  return {
    departure_ms: first.t,
    arrival_ms: last.t,
    duration_h: (last.t - first.t) / 3600e3,
    distance_nm: distance,
    motor_h: motorMs / 3600e3,
    beat_h: beatMs / 3600e3,
    max_tws_kn: maxTws,
    max_gust_kn: maxGust,
    max_wave_m: maxWave,
    warnings: [...warnings],
  };
}
