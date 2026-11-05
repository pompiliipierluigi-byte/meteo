// Preferenze locali del visitatore (comodità: layer attivi, modello, ecc.).
// Lo storage può mancare (navigazione privata): ogni accesso è protetto.

const PREFIX = 'meteo.pref.';

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function getPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignorato: la preferenza vale solo per la sessione.
  }
}
