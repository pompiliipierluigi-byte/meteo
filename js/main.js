// Avvio dell'app.

import { APP_VERSION } from './config.js';

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
}

start();
