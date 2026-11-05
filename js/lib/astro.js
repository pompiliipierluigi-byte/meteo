// Sole e luna (SPEC §2.12): alba, tramonto, crepuscoli, sorgere e tramonto della luna, fase.
// Formule a bassa precisione (Astronomical Almanac per il sole, termini principali di Meeus per la
// luna): errori di pochi minuti, sufficienti per pianificare. Modulo puro, tempi in ms UTC.

const RAD = Math.PI / 180;
const DAY_MS = 86400e3;
const J2000 = 2451545.0;

/** @param {number} tMs */
const daysSinceJ2000 = (tMs) => tMs / DAY_MS + 2440587.5 - J2000;
/** @param {number} x */
const norm360 = (x) => ((x % 360) + 360) % 360;

/**
 * Coordinate equatoriali da eclittiche.
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} d giorni da J2000
 */
function toEquatorial(lonDeg, latDeg, d) {
  const e = (23.439 - 0.0000004 * d) * RAD;
  const l = lonDeg * RAD;
  const b = latDeg * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra, dec };
}

/** Longitudine eclittica del sole (gradi). @param {number} d */
export function sunLongitude(d) {
  const L = 280.460 + 0.9856474 * d;
  const g = (357.528 + 0.9856003 * d) * RAD;
  return norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
}

/**
 * Posizione eclittica della luna (gradi) e distanza (km).
 * @param {number} d giorni da J2000
 */
export function moonEcliptic(d) {
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.229350 * d) * RAD;
  const D = (297.850 + 12.190749 * d) * RAD;
  const Ms = (357.529 + 0.98560028 * d) * RAD;
  const lon = L + 6.289 * Math.sin(M) - 1.274 * Math.sin(M - 2 * D) + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F)
    - 0.059 * Math.sin(2 * M - 2 * D) - 0.057 * Math.sin(M - 2 * D + Ms) + 0.053 * Math.sin(M + 2 * D)
    + 0.046 * Math.sin(2 * D - Ms) + 0.041 * Math.sin(M - Ms);
  const lat = 5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F);
  const distKm = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D);
  return { lon: norm360(lon), lat, distKm };
}

/**
 * Altezza (gradi) di un corpo dato in coordinate equatoriali.
 * @param {{ra: number, dec: number}} eq
 * @param {number} d
 * @param {number} latDeg
 * @param {number} lonDeg est positivo
 */
function altitude(eq, d, latDeg, lonDeg) {
  const gmst = (280.46061837 + 360.98564736629 * d) * RAD;
  const H = gmst + lonDeg * RAD - eq.ra;
  const phi = latDeg * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(H)) / RAD;
}

/** Altezza del centro del sole (gradi, senza rifrazione). */
export function sunAltitude(tMs, latDeg, lonDeg) {
  const d = daysSinceJ2000(tMs);
  return altitude(toEquatorial(sunLongitude(d), 0, d), d, latDeg, lonDeg);
}

/**
 * Altezza della luna corretta per l'altezza di sorgere/tramonto: > 0 = luna sopra l'orizzonte apparente.
 * Soglia di Meeus h0 = 0.7275·parallasse − 0°34′.
 */
export function moonAltitudeAboveHorizon(tMs, latDeg, lonDeg) {
  const d = daysSinceJ2000(tMs);
  const m = moonEcliptic(d);
  const parallax = Math.asin(6378.14 / m.distKm) / RAD;
  const h0 = 0.7275 * parallax - 34 / 60;
  return altitude(toEquatorial(m.lon, m.lat, d), d, latDeg, lonDeg) - h0;
}

/**
 * Istanti in cui f(t) cambia segno in [t0, t1): ricerca a passi e bisezione al secondo.
 * @param {(t: number) => number} f
 * @param {number} t0
 * @param {number} t1
 * @param {number} [stepMs]
 * @returns {{t: number, rising: boolean}[]}
 */
export function crossings(f, t0, t1, stepMs = 10 * 60e3) {
  const out = [];
  let a = t0;
  let fa = f(a);
  while (a < t1) {
    const b = Math.min(a + stepMs, t1);
    const fb = f(b);
    if ((fa < 0) !== (fb < 0)) {
      let lo = a;
      let hi = b;
      let flo = fa;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if ((fm < 0) === (flo < 0)) {
          lo = mid;
          flo = fm;
        } else hi = mid;
      }
      out.push({ t: Math.round((lo + hi) / 2), rising: fa < 0 });
    }
    a = b;
    fa = fb;
  }
  return out;
}

/** Soglie del sole (gradi): alba/tramonto con rifrazione e semidiametro, crepuscoli. */
export const SUN_LEVELS = { horizon: -0.833, civil: -6, nautical: -12 };

/**
 * Effemeridi del giorno [dayStartMs, dayStartMs + 24 h) per un punto.
 * @param {number} dayStartMs inizio del giorno (mezzanotte locale, in ms UTC)
 * @param {number} latDeg
 * @param {number} lonDeg
 */
export function dayEphemeris(dayStartMs, latDeg, lonDeg) {
  const end = dayStartMs + DAY_MS;
  const sun = (h0) => {
    const c = crossings((t) => sunAltitude(t, latDeg, lonDeg) - h0, dayStartMs, end);
    return { rise: c.find((x) => x.rising)?.t ?? null, set: c.find((x) => !x.rising)?.t ?? null };
  };
  const moon = crossings((t) => moonAltitudeAboveHorizon(t, latDeg, lonDeg), dayStartMs, end);
  // Mezzogiorno vero: massimo dell'altezza del sole (passo 1 min attorno alla stima).
  let noon = dayStartMs + DAY_MS / 2 - (lonDeg / 15) * 3600e3;
  let best = -Infinity;
  for (let t = noon - 3600e3; t <= noon + 3600e3; t += 60e3) {
    const h = sunAltitude(t, latDeg, lonDeg);
    if (h > best) {
      best = h;
      noon = t;
    }
  }
  return {
    sun: sun(SUN_LEVELS.horizon),
    civil: sun(SUN_LEVELS.civil),
    nautical: sun(SUN_LEVELS.nautical),
    noon,
    noonAltDeg: best,
    moon: { rise: moon.find((x) => x.rising)?.t ?? null, set: moon.find((x) => !x.rising)?.t ?? null },
    phase: moonPhase(dayStartMs + DAY_MS / 2),
  };
}

/**
 * Fase della luna.
 * @param {number} tMs
 * @returns {{age: number, illumination: number, name: 'new'|'waxingCrescent'|'firstQuarter'|'waxingGibbous'|'full'|'waningGibbous'|'lastQuarter'|'waningCrescent'}}
 *   age: 0 = nuova, 0.25 = primo quarto, 0.5 = piena, 0.75 = ultimo quarto; illumination 0–1
 */
export function moonPhase(tMs) {
  const d = daysSinceJ2000(tMs);
  const elong = norm360(moonEcliptic(d).lon - sunLongitude(d));
  const age = elong / 360;
  const illumination = (1 - Math.cos(elong * RAD)) / 2;
  // Fasi principali entro ±1 giorno circa (12.2° di elongazione al giorno).
  const near = (x) => Math.abs(((elong - x + 540) % 360) - 180) < 6;
  /** @type {any} */
  let name;
  if (near(0)) name = 'new';
  else if (near(90)) name = 'firstQuarter';
  else if (near(180)) name = 'full';
  else if (near(270)) name = 'lastQuarter';
  else name = elong < 90 ? 'waxingCrescent' : elong < 180 ? 'waxingGibbous' : elong < 270 ? 'waningGibbous' : 'waningCrescent';
  return { age, illumination, name };
}

/**
 * Prossime fasi principali dopo `fromMs` (nuova, primo quarto, piena, ultimo quarto).
 * @param {number} fromMs
 * @returns {{name: 'new'|'firstQuarter'|'full'|'lastQuarter', t: number}[]} in ordine di tempo
 */
export function nextPhases(fromMs) {
  const elong = (t) => {
    const d = daysSinceJ2000(t);
    return norm360(moonEcliptic(d).lon - sunLongitude(d));
  };
  /** @type {{name: any, t: number}[]} */
  const out = [];
  const targets = /** @type {const} */ ([[0, 'new'], [90, 'firstQuarter'], [180, 'full'], [270, 'lastQuarter']]);
  for (const [deg, name] of targets) {
    // Funzione con segno continuo vicino al bersaglio: (elongazione − bersaglio) in (−180, 180].
    const f = (t) => ((elong(t) - deg + 540) % 360) - 180;
    const c = crossings(f, fromMs, fromMs + 31 * DAY_MS, 6 * 3600e3).find((x) => x.rising);
    if (c) out.push({ name, t: c.t });
  }
  return out.sort((a, b) => a.t - b.t);
}
