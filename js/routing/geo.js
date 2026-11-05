// Geodesia per il routing (SPEC §6.5): ortodromia su sfera di raggio 3440.065 NM.
// Modulo puro. Angoli in gradi veri (0 = nord, senso orario), distanze in miglia nautiche.

/** Raggio terrestre medio in miglia nautiche. */
export const EARTH_RADIUS_NM = 3440.065;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Normalizza un angolo in [0, 360).
 * @param {number} deg
 */
export function norm360(deg) {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Differenza angolare con segno in (-180, 180]: b − a.
 * @param {number} aDeg
 * @param {number} bDeg
 */
export function angleDiff(aDeg, bDeg) {
  let d = norm360(bDeg - aDeg);
  if (d > 180) d -= 360;
  return d;
}

/**
 * Distanza ortodromica (haversine).
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} NM
 */
export function distanceNm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = (lat2 - lat1) * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Rotta iniziale (rilevamento) da 1 a 2.
 * @returns {number} gradi veri [0, 360)
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) * DEG);
}

/**
 * Punto raggiunto partendo da (lat, lon) con rotta e distanza date (ortodromia).
 * @param {number} lat
 * @param {number} lon
 * @param {number} courseDeg
 * @param {number} distNm
 * @returns {{lat: number, lon: number}}
 */
export function destination(lat, lon, courseDeg, distNm) {
  const d = distNm / EARTH_RADIUS_NM;
  const t = courseDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sp2);
  return { lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 };
}

/**
 * Somma di due vettori dati come (velocità, direzione di destinazione): es. barca + corrente.
 * @param {number} s1 @param {number} dir1Deg @param {number} s2 @param {number} dir2Deg
 * @returns {{speed: number, dirDeg: number}}
 */
export function addVectors(s1, dir1Deg, s2, dir2Deg) {
  const x = s1 * Math.sin(dir1Deg * RAD) + s2 * Math.sin(dir2Deg * RAD);
  const y = s1 * Math.cos(dir1Deg * RAD) + s2 * Math.cos(dir2Deg * RAD);
  return { speed: Math.hypot(x, y), dirDeg: norm360(Math.atan2(x, y) * DEG) };
}
