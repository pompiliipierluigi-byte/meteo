// Rotta calcolata sulla mappa: traccia (vela/motore), tratti con avvisi, isocrone facoltative,
// punti orari con etichette e posizione della barca all'ora del cursore.

import { formatShortDateTime, localHour } from '../lib/format.js';

/** Colori della traccia. */
const SAIL = '#0b6e4f';
const MOTOR = '#7a3fb0';
const WARN = '#e8590c';

/**
 * @param {import('../../vendor/leaflet/leaflet-src.esm.js').Map} map
 * @param {typeof import('../../vendor/leaflet/leaflet-src.esm.js')} L
 */
export function createRouteLayer(map, L) {
  const group = L.layerGroup().addTo(map);
  const isoGroup = L.layerGroup();
  /** @type {import('../../vendor/leaflet/leaflet-src.esm.js').Marker | null} */
  let boat = null;
  /** @type {import('../routing/isochrone.js').TrackPoint[]} */
  let track = [];

  const boatIcon = L.divIcon({ className: 'route-boat', html: '<span>⛵</span>', iconSize: [26, 26], iconAnchor: [13, 13] });

  /**
   * @param {{track: import('../routing/isochrone.js').TrackPoint[], isochrones?: [number, number][][]}} result
   * @param {{showIsochrones?: boolean}} [opts]
   */
  function show(result, opts = {}) {
    clear();
    track = result.track;
    // Tratti consecutivi con lo stesso stato (vela/motore, avviso) in un'unica polilinea.
    let seg = [];
    let style = null;
    const flush = () => {
      if (seg.length > 1 && style) L.polyline(seg, style).addTo(group);
    };
    for (let i = 0; i + 1 < track.length; i++) {
      const a = track[i];
      const b = track[i + 1];
      const warn = a.warn.length > 0;
      const s = { color: a.motor ? MOTOR : SAIL, weight: warn ? 6 : 4, opacity: 0.9, dashArray: a.motor ? '8 6' : null, interactive: false };
      const sameStyle = style && style.color === s.color && style.weight === s.weight;
      if (!sameStyle) {
        flush();
        seg = [[a.lat, a.lon]];
        style = s;
      }
      seg.push([b.lat, b.lon]);
      if (warn) L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: WARN, weight: 10, opacity: 0.35, interactive: false }).addTo(group);
    }
    flush();
    // Punti alle ore intere con etichetta dell'ora locale.
    let lastHour = null;
    for (const p of track) {
      const h = Math.floor(p.t / 3600e3);
      if (h === lastHour) continue;
      lastHour = h;
      L.circleMarker([p.lat, p.lon], { radius: 3, color: '#fff', weight: 1, fillColor: p.motor ? MOTOR : SAIL, fillOpacity: 1 })
        .bindTooltip(`${String(localHour(p.t)).padStart(2, '0')}`, { permanent: true, direction: 'right', className: 'route-hour', offset: [4, 0] })
        .addTo(group);
    }
    const end = track[track.length - 1];
    L.circleMarker([end.lat, end.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#b3261e', fillOpacity: 1 })
      .bindTooltip(formatShortDateTime(end.t), { permanent: true, direction: 'top', className: 'route-eta' })
      .addTo(group);
    if (result.isochrones?.length) {
      for (const iso of result.isochrones) {
        if (iso.length > 1) {
          // Punti dell'isocrona ordinati per angolo dalla partenza, per una linea leggibile.
          const s0 = track[0];
          const pts = [...iso].sort((p, q) => Math.atan2(p[1] - s0.lon, p[0] - s0.lat) - Math.atan2(q[1] - s0.lon, q[0] - s0.lat));
          L.polyline(pts, { color: '#5b6878', weight: 1, opacity: 0.5, interactive: false }).addTo(isoGroup);
        }
      }
    }
    setIsochrones(Boolean(opts.showIsochrones));
  }

  /** @param {boolean} on */
  function setIsochrones(on) {
    if (on) isoGroup.addTo(map); else map.removeLayer(isoGroup);
  }

  /**
   * Posizione stimata della barca all'istante dato (interpolata lungo la traccia).
   * @param {number} tMs
   */
  function setTime(tMs) {
    if (!track.length) return;
    const first = track[0];
    const last = track[track.length - 1];
    if (tMs < first.t || tMs > last.t) {
      if (boat) {
        map.removeLayer(boat);
        boat = null;
      }
      return;
    }
    let i = 0;
    while (i + 1 < track.length && track[i + 1].t < tMs) i++;
    const a = track[i];
    const b = track[Math.min(i + 1, track.length - 1)];
    const k = b.t > a.t ? (tMs - a.t) / (b.t - a.t) : 0;
    const ll = [a.lat + (b.lat - a.lat) * k, a.lon + (b.lon - a.lon) * k];
    if (!boat) boat = L.marker(ll, { icon: boatIcon, interactive: false, keyboard: false }).addTo(map);
    else boat.setLatLng(ll);
  }

  function clear() {
    group.clearLayers();
    isoGroup.clearLayers();
    if (boat) {
      map.removeLayer(boat);
      boat = null;
    }
    track = [];
  }

  /** Inquadra la rotta. */
  function fit() {
    if (track.length) map.fitBounds(track.map((p) => [p.lat, p.lon]), { padding: [30, 30] });
  }

  return { show, clear, setIsochrones, setTime, fit };
}
