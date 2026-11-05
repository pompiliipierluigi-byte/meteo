// Punti della rotta sulla mappa: partenza (tocco o GPS), waypoint intermedi e arrivo (tocco).
// Marcatori trascinabili; waypoint riordinabili ed eliminabili; punti a terra spostati al mare più vicino.

import { it } from '../i18n/it.js';
import { formatLatLon } from '../lib/format.js';
import { BBOX } from '../config.js';

/** @typedef {'start' | 'end' | 'waypoint'} PointRole */
/** @typedef {{lat: number, lon: number}} LatLon */

/**
 * @typedef {Object} RoutePoints
 * @property {() => LatLon[]} route partenza, waypoint, arrivo (vuoto se manca partenza o arrivo)
 * @property {() => {start: LatLon | null, end: LatLon | null, waypoints: LatLon[]}} get
 * @property {(role: PointRole | null) => void} pick attende un tocco sulla mappa per quel punto (null = annulla)
 * @property {() => PointRole | 'consumed' | null} picking ('consumed' = tocco appena usato per un punto)
 * @property {() => Promise<void>} useGps partenza dalla posizione GPS
 * @property {(i: number, delta: number) => void} moveWaypoint
 * @property {(i: number) => void} removeWaypoint
 * @property {() => void} clear
 * @property {(fn: () => void) => void} onChange
 */

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {typeof import('../../vendor/leaflet/leaflet-src.esm.js')} L
 * @param {{snap: (pts: LatLon[]) => Promise<({lat: number, lon: number, moved: boolean, distNm: number} | null)[]>,
 *   notify: (text: string, kind?: 'info'|'warn'|'error') => void}} deps
 * @returns {RoutePoints}
 */
export function createRoutePoints(map, L, deps) {
  const t = it.routePoints;
  /** @type {LatLon | null} */
  let start = null;
  /** @type {LatLon | null} */
  let end = null;
  /** @type {LatLon[]} */
  let waypoints = [];
  /** @type {PointRole | null} */
  let pickRole = null;
  /** @type {(() => void)[]} */
  const listeners = [];
  const layer = L.layerGroup().addTo(map);

  const icon = (cls, label) => L.divIcon({ className: `rp-icon ${cls}`, html: `<span>${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });

  const changed = () => {
    render();
    listeners.forEach((fn) => fn());
  };

  function render() {
    layer.clearLayers();
    const all = [start, ...waypoints, end].filter(Boolean);
    if (all.length >= 2) {
      L.polyline(all.map((p) => [p.lat, p.lon]), { color: '#0e4c7a', weight: 1.5, dashArray: '4 6', opacity: 0.8, interactive: false }).addTo(layer);
    }
    const add = (p, cls, label, onMove) => {
      const m = L.marker([p.lat, p.lon], { icon: icon(cls, label), draggable: true, keyboard: false, title: formatLatLon(p.lat, p.lon) });
      m.on('dragend', async () => {
        const ll = m.getLatLng();
        const fixed = await toSea({ lat: ll.lat, lon: ll.lng });
        if (fixed) onMove(fixed);
        changed();
      });
      m.addTo(layer);
    };
    if (start) add(start, 'rp-start', 'P', (q) => { start = q; });
    waypoints.forEach((w, i) => add(w, 'rp-way', String(i + 1), (q) => { waypoints[i] = q; }));
    if (end) add(end, 'rp-end', 'A', (q) => { end = q; });
  }

  /**
   * Punto valido: dentro l'area e in mare (altrimenti spostato, con avviso).
   * @param {LatLon} p
   * @returns {Promise<(LatLon & {moved?: boolean}) | null>}
   */
  async function toSea(p) {
    if (p.lat < BBOX.latMin || p.lat > BBOX.latMax || p.lon < BBOX.lonMin || p.lon > BBOX.lonMax) {
      deps.notify(t.outside, 'warn');
      return null;
    }
    try {
      const [s] = await deps.snap([p]);
      if (!s) {
        deps.notify(t.noSea, 'error');
        return null;
      }
      if (s.moved) deps.notify(`${t.moved} (${s.distNm.toFixed(2)} NM)`, 'warn');
      return { lat: s.lat, lon: s.lon, moved: s.moved };
    } catch (err) {
      // Costa non disponibile: si accetta il punto così com'è.
      console.warn('Controllo terra non disponibile:', err);
      return p;
    }
  }

  /** Il tocco appena usato per un punto non deve aprire anche la sonda (gli altri gestori lo vedono dopo). */
  let consumed = false;

  map.on('click', async (e) => {
    if (!pickRole) return;
    const role = pickRole;
    pickRole = null;
    consumed = true;
    setTimeout(() => { consumed = false; }, 0);
    map.getContainer().classList.remove('picking');
    const p = await toSea({ lat: e.latlng.lat, lon: e.latlng.lng });
    if (!p) {
      changed();
      return;
    }
    const q = { lat: p.lat, lon: p.lon };
    if (role === 'start') start = q;
    else if (role === 'end') end = q;
    else waypoints.push(q);
    if (!p.moved) deps.notify('');
    changed();
  });

  return {
    route: () => (start && end ? [start, ...waypoints, end] : []),
    get: () => ({ start, end, waypoints: [...waypoints] }),
    pick(role) {
      pickRole = role;
      map.getContainer().classList.toggle('picking', Boolean(role));
      if (role) deps.notify(t.tapMap[role]);
      listeners.forEach((fn) => fn());
    },
    picking: () => pickRole ?? (consumed ? 'consumed' : null),
    async useGps() {
      if (!('geolocation' in navigator)) {
        deps.notify(t.noGps, 'error');
        return;
      }
      deps.notify(t.gpsWait);
      try {
        const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
        const p = await toSea({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (p) {
          start = p;
          map.panTo([p.lat, p.lon]);
          deps.notify(t.gpsOk);
        }
        changed();
      } catch (err) {
        deps.notify(t.gpsError, 'error');
      }
    },
    moveWaypoint(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= waypoints.length) return;
      [waypoints[i], waypoints[j]] = [waypoints[j], waypoints[i]];
      changed();
    },
    removeWaypoint(i) {
      waypoints.splice(i, 1);
      changed();
    },
    clear() {
      start = null;
      end = null;
      waypoints = [];
      changed();
    },
    onChange: (fn) => { listeners.push(fn); },
  };
}
