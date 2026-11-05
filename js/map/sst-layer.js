// Temperatura superficiale del mare (°C): campo colorato con la scala SST_STOPS.

import { FieldLayer } from './wind-field.js';
import { sstRamp } from './colors.js';

/**
 * @param {{pane: string, opacity?: number}} opts
 */
export function sstLayer(opts) {
  return new FieldLayer({ ...opts, ramp: sstRamp, value: (s, lat, lon) => s('sst', lat, lon) });
}
