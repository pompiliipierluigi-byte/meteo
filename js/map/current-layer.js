// Layer correnti superficiali: frecce nel verso della corrente, lunghezza e colore per velocità (nodi).

import { ArrowLayer } from './wind-arrows.js';
import { currentRamp } from './colors.js';

/** Sotto questa velocità la freccia non si disegna (kn). */
const MIN_KN = 0.05;

/**
 * @param {{pane: string}} opts
 */
export function currentLayer(opts) {
  return new ArrowLayer({
    ...opts,
    spacing: 40,
    ramp: currentRamp,
    vector: (s, lat, lon) => {
      const u = s('cur_u', lat, lon);
      const v = s('cur_v', lat, lon);
      const mag = Math.hypot(u, v);
      if (!Number.isFinite(mag) || mag < MIN_KN) return null;
      return { dx: u / mag, dy: -v / mag, mag };
    },
    lengthFn: (kn) => 10 + Math.min(kn, 2) * 10,
  });
}
