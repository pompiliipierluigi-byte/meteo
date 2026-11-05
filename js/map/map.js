// Mappa Leaflet: BBOX, mappe base, overlay OpenSeaMap, attribuzioni.

import * as L from '../../vendor/leaflet/leaflet-src.esm.js';
import { BBOX, MAP_BOUNDS_MARGIN_DEG, CARTO_BASEMAPS_KEY } from '../config.js';
import { it } from '../i18n/it.js';
import { getPref, setPref } from '../lib/prefs.js';

export { L };

/** @typedef {'carto' | 'osm'} BasemapId */

/** @type {Partial<Record<BasemapId, () => import('../../vendor/leaflet/leaflet-src.esm.js').TileLayer>>} */
const BASEMAPS = {
  carto: () => L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_BASEMAPS_KEY)}`, {
    subdomains: 'abcd',
    maxZoom: 18,
    crossOrigin: true,
    attribution: `${it.attribution.osm} ${it.attribution.carto}`,
  }),
  osm: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    crossOrigin: true,
    attribution: it.attribution.osm,
  }),
};
// Senza chiave CARTO restituisce solo tile "API KEY REQUIRED": la mappa non si offre.
if (!CARTO_BASEMAPS_KEY) delete BASEMAPS.carto;

/** Mappe base disponibili, nell'ordine del menu (la prima è la predefinita). */
export const AVAILABLE_BASEMAPS = /** @type {BasemapId[]} */ (['carto', 'osm'].filter((id) => id in BASEMAPS));

/**
 * Crea la mappa nel contenitore indicato.
 * @param {HTMLElement} el
 * @returns {{
 *   map: import('../../vendor/leaflet/leaflet-src.esm.js').Map,
 *   setBasemap: (id: BasemapId) => void,
 *   getBasemap: () => BasemapId,
 *   setSeamarks: (on: boolean) => void,
 *   getSeamarks: () => boolean,
 * }}
 */
export function createMap(el) {
  const bbox = L.latLngBounds([BBOX.latMin, BBOX.lonMin], [BBOX.latMax, BBOX.lonMax]);
  const m = MAP_BOUNDS_MARGIN_DEG;
  const maxBounds = L.latLngBounds(
    [BBOX.latMin - m, BBOX.lonMin - m],
    [BBOX.latMax + m, BBOX.lonMax + m],
  );

  const map = L.map(el, {
    minZoom: 5,
    maxZoom: 16,
    maxBounds,
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: false,
  });
  map.fitBounds(bbox);
  // La mappa cambia altezza quando si aprono pannelli in basso (rotta): Leaflet va avvisato.
  if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(el);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.attribution({ position: 'bottomright', prefix: it.attribution.openmeteo }).addTo(map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);

  /** @type {BasemapId} */
  let basemapId = getPref('basemap', AVAILABLE_BASEMAPS[0]);
  if (!(basemapId in BASEMAPS)) basemapId = AVAILABLE_BASEMAPS[0];
  let basemap = BASEMAPS[basemapId]().addTo(map);

  const seamarks = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: it.attribution.openseamap,
    zIndex: 10,
  });
  let seamarksOn = getPref('seamarks', false);
  if (seamarksOn) seamarks.addTo(map);

  return {
    map,
    setBasemap(id) {
      if (id === basemapId || !(id in BASEMAPS)) return;
      map.removeLayer(basemap);
      basemapId = id;
      basemap = BASEMAPS[id]().addTo(map);
      basemap.bringToBack();
      setPref('basemap', id);
    },
    getBasemap: () => basemapId,
    setSeamarks(on) {
      seamarksOn = on;
      if (on) seamarks.addTo(map); else map.removeLayer(seamarks);
      setPref('seamarks', on);
    },
    getSeamarks: () => seamarksOn,
  };
}
