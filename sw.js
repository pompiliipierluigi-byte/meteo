// Service worker: cache della shell dell'app e delle tile di mappa già viste.
// Percorsi relativi allo scope (sottopercorso /meteo/ su GitHub Pages).
// I dati meteo non passano da qui: sono in IndexedDB (js/weather/cache.js), consultabili offline.

const VERSION = '0.1.0-11';
const SHELL_CACHE = `shell-${VERSION}`;
/** Cache delle tile (conservata tra le versioni), con numero massimo di elementi. */
const TILE_CACHE = 'tiles-v1';
const TILE_MAX_ENTRIES = 800;
/** Host delle tile servite con CORS (risposte non opache: occupano lo spazio reale). */
const TILE_HOSTS = /(^|\.)basemaps\.cartocdn\.com$|^tile\.openstreetmap\.org$/;

/** File della shell precaricati all'installazione. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './js/main.js',
  './js/config.js',
  './js/i18n/it.js',
  './js/ui/disclaimer.js',
  './js/ui/side-menu.js',
  './js/lib/prefs.js',
  './js/map/map.js',
  './js/weather/grid.js',
  './js/weather/openmeteo.js',
  './js/weather/cache.js',
  './js/lib/idb.js',
  './js/lib/format.js',
  './js/lib/text.js',
  './js/weather/models.js',
  './js/weather/weather-service.js',
  './js/ui/notice.js',
  './js/ui/model-picker.js',
  './js/ui/time-slider.js',
  './js/map/canvas-layer.js',
  './js/map/colors.js',
  './js/map/weather-layers.js',
  './js/map/wind-field.js',
  './js/map/wind-arrows.js',
  './js/map/wind-particles.js',
  './js/map/wave-layer.js',
  './js/ui/legend.js',
  './js/ui/probe.js',
  './vendor/leaflet/leaflet-src.esm.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
];

/** Attesa massima della rete prima di servire la copia in cache (ms). */
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
  } else if (TILE_HOSTS.test(url.hostname)) {
    event.respondWith(tileCacheFirst(req));
  }
});

/**
 * Tile: cache se presente (consultazione offline delle zone già viste), altrimenti rete.
 * Nessun precaricamento di tile non richieste (policy dei fornitori).
 * @param {Request} req
 * @returns {Promise<Response>}
 */
async function tileCacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'cors') {
    await cache.put(req, res.clone());
    trimCache(cache, TILE_MAX_ENTRIES);
  }
  return res;
}

/**
 * Elimina gli elementi più vecchi oltre il limite (ordine di inserimento).
 * @param {Cache} cache
 * @param {number} max
 */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/**
 * Rete con timeout, poi cache. Le risposte valide aggiornano la cache.
 * @param {Request} req
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw err;
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
