// Client Supabase: caricamento su richiesta della libreria, sessione e messaggi d'errore in italiano.
// Mappa e meteo non dipendono da questo modulo: se Supabase manca o è in pausa, l'app resta usabile.

import { SUPABASE } from '../config.js';
import { it } from '../i18n/it.js';

/** Percorso relativo a questo modulo (funziona anche nel sottopercorso /meteo/). */
const LIB_URL = new URL('../../vendor/supabase/supabase.js', import.meta.url).href;

/** @type {Promise<any> | null} */
let clientPromise = null;

/** @returns {boolean} true se URL e chiave sono impostati in config.js */
export function isConfigured() {
  return Boolean(SUPABASE.url && SUPABASE.anonKey);
}

/** Carica il bundle UMD (definisce la globale `supabase`). */
function loadLibrary() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_URL;
    s.async = true;
    s.onload = () => (globalThis.supabase?.createClient ? resolve(globalThis.supabase) : reject(new Error('supabase-js non valido')));
    s.onerror = () => reject(new Error(it.auth.errLibrary));
    document.head.append(s);
  });
}

/**
 * Client Supabase condiviso (creato al primo uso).
 * @returns {Promise<any>}
 */
export function getClient() {
  if (!isConfigured()) return Promise.reject(new Error(it.auth.errNotConfigured));
  if (!clientPromise) {
    clientPromise = loadLibrary().then((lib) => lib.createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * Messaggio d'errore leggibile per un errore di Supabase o di rete.
 * @param {any} err
 * @returns {string}
 */
export function errorMessage(err) {
  const t = it.auth;
  const msg = String(err?.message ?? err ?? '');
  const code = err?.code ?? '';
  if (err?.name === 'TypeError' || /fetch|network|load failed/i.test(msg) || err?.status === 0) return t.errNetwork;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return t.errCredentials;
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return t.errNotConfirmed;
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return t.errExists;
  if (code === 'weak_password' || /password should be/i.test(msg)) return t.errWeakPassword;
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(msg)) return t.errRateLimit;
  if (err?.status >= 500 || /paused|project is paused|503|502/i.test(msg)) return t.errPaused;
  return msg || t.errGeneric;
}
