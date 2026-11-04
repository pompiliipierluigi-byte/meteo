// Configurazione centrale dell'app. Nessun segreto: la chiave anon Supabase è pubblica.

/** Versione dell'app (usata anche per il nome della cache del service worker). */
export const APP_VERSION = '0.1.0';

/**
 * Area di lavoro (gradi).
 * @type {{latMin: number, latMax: number, lonMin: number, lonMax: number}}
 */
export const BBOX = Object.freeze({ latMin: 39.8, latMax: 45.8, lonMin: 12.0, lonMax: 19.7 });

/** Margine (gradi) oltre la BBOX consentito al pan della mappa. */
export const MAP_BOUNDS_MARGIN_DEG = 1.5;

/** Fuso orario di visualizzazione; internamente tutto è in UTC. */
export const TIMEZONE = 'Europe/Rome';

/** Orizzonte massimo di mappa e routing (ore). */
export const HORIZON_H = 120;

/** Supabase (fase 2). */
export const SUPABASE = Object.freeze({ url: '', anonKey: '' });
