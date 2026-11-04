// Avvio dell'app.

import { APP_VERSION } from './config.js';
import { it } from './i18n/it.js';
import { initDisclaimer } from './ui/disclaimer.js';
import { createMap } from './map/map.js';
import { createSideMenu, radioGroup, checkbox } from './ui/side-menu.js';

/** Registra il service worker (percorso relativo, scope = cartella dell'app). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}

function start() {
  document.documentElement.dataset.version = APP_VERSION;
  registerServiceWorker();

  const topbar = document.getElementById('topbar');
  const title = document.createElement('h1');
  title.className = 'app-title';
  title.textContent = it.app.title;
  topbar.append(title);

  initDisclaimer(document.getElementById('bottombar'));

  const mapCtl = createMap(document.getElementById('map'));
  const menu = createSideMenu(topbar);

  radioGroup(menu.addSection(it.menu.basemap), 'basemap', [
    { value: 'carto', label: it.map.carto },
    { value: 'osm', label: it.map.osm },
  ], mapCtl.getBasemap(), (v) => mapCtl.setBasemap(/** @type {any} */ (v)));

  checkbox(menu.addSection(it.menu.overlays), it.map.openseamap, mapCtl.getSeamarks(),
    (on) => mapCtl.setSeamarks(on));
}

start();
