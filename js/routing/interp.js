// Interpolazione del meteo per il routing (SPEC §6.2): vento (u, v), raffica, onda e corrente nello spazio
// (bilineare) e nel tempo (lineare). Le direzioni si interpolano come vettori. Modulo puro (worker).

import { sample, uvToWind } from '../weather/grid.js';

/**
 * Condizioni in un punto e istante.
 * @typedef {Object} Conditions
 * @property {number} twsKn vento reale
 * @property {number} twdDeg direzione di provenienza del vento
 * @property {number} gustKn
 * @property {number} waveHeightM onda totale (NaN se non disponibile)
 * @property {number} waveDirDeg provenienza dell'onda
 * @property {number} wavePeriodS
 * @property {number} curKn velocità della corrente (0 se non disponibile)
 * @property {number} curDirDeg direzione verso cui va la corrente
 * @property {number} curU componente est della corrente (kn)
 * @property {number} curV componente nord della corrente (kn)
 */

/**
 * @param {{wind: import('../weather/grid.js').WeatherField, marine?: import('../weather/grid.js').WeatherField | null}} fields
 *   wind: u, v, gust (kn); marine: wave_h, wave_dx, wave_dy, wave_per e, se presenti, cur_u, cur_v (kn, verso)
 * @returns {(lat: number, lon: number, tMs: number) => Conditions | null} null se manca il vento nel punto
 */
export function createSampler(fields) {
  const { wind, marine } = fields;
  const hasCurrents = Boolean(marine?.vars.cur_u && marine?.vars.cur_v);
  return (lat, lon, tMs) => {
    const u = sample(wind, 'u', lat, lon, tMs);
    const v = sample(wind, 'v', lat, lon, tMs);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const w = uvToWind(u, v);
    const gust = sample(wind, 'gust', lat, lon, tMs);
    let waveHeightM = NaN;
    let waveDirDeg = NaN;
    let wavePeriodS = NaN;
    let curU = 0;
    let curV = 0;
    if (marine) {
      waveHeightM = sample(marine, 'wave_h', lat, lon, tMs);
      wavePeriodS = sample(marine, 'wave_per', lat, lon, tMs);
      const dx = sample(marine, 'wave_dx', lat, lon, tMs);
      const dy = sample(marine, 'wave_dy', lat, lon, tMs);
      if (Number.isFinite(dx) && Math.hypot(dx, dy) > 1e-3) {
        waveDirDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
        if (waveDirDeg < 0) waveDirDeg += 360;
      }
      if (hasCurrents) {
        const cu = sample(marine, 'cur_u', lat, lon, tMs);
        const cv = sample(marine, 'cur_v', lat, lon, tMs);
        if (Number.isFinite(cu) && Number.isFinite(cv)) {
          curU = cu;
          curV = cv;
        }
      }
    }
    const curKn = Math.hypot(curU, curV);
    let curDirDeg = (Math.atan2(curU, curV) * 180) / Math.PI;
    if (curDirDeg < 0) curDirDeg += 360;
    return {
      twsKn: w.speed,
      twdDeg: w.fromDeg,
      gustKn: Number.isFinite(gust) ? gust : w.speed,
      waveHeightM,
      waveDirDeg,
      wavePeriodS,
      curKn,
      curDirDeg: curKn > 0 ? curDirDeg : 0,
      curU,
      curV,
    };
  };
}
