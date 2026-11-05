// Configurazione centrale dell'app. Nessun segreto: la chiave anon Supabase è pubblica.

/**
 * Versione dell'app, mostrata nel footer. Incrementarla a ogni pubblicazione insieme a
 * `VERSION` in sw.js (che deve iniziare con lo stesso valore: lo verifica tests/sw-shell.test.js).
 */
export const APP_VERSION = '1.8';

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

/**
 * Chiave CARTO Basemaps (gratuita, uso non commerciale: https://carto.com/basemaps/apikey).
 * È pubblica per natura (finisce nelle URL delle tile); limitarla al dominio dell'app.
 * Vuota → la mappa CARTO non è disponibile e si usa OpenStreetMap.
 */
export const CARTO_BASEMAPS_KEY = 'cb1_52ji_1_36a0d8b38bab12caa7225495';

/** Supabase (fase 2). */
export const SUPABASE = Object.freeze({
  url: 'https://athokhwpylevhhczuytv.supabase.co',
  // Chiave publishable: pubblica per costruzione, i dati sono protetti dalla RLS.
  anonKey: 'sb_publishable_yyKxrKeFA2OvzmPMP4Gkpg_wb3ykqF4',
});

/** Open-Meteo: endpoint e parametri delle richieste. */
export const OPEN_METEO = Object.freeze({
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  marineUrl: 'https://marine-api.open-meteo.com/v1/marine',
  /** Giorni richiesti (≤ 14 per non aumentare il peso in quota); si tagliano poi a HORIZON_H. */
  forecastDays: 6,
  /** Punti per richiesta multi-coordinata (lunghezza URL contenuta). */
  chunkSize: 50,
  /** Pausa tra due blocchi consecutivi (ms). */
  chunkPauseMs: 500,
  /**
   * Budget di chiamate al minuto (limite gratuito: 600/min, ogni punto = 1 chiamata, ×2 oltre
   * 10 variabili). Margine per altre schede o ricariche.
   */
  callsPerMinute: 300,
  /** Tentativi su errore 429 della quota al minuto (attesa di un minuto tra uno e l'altro). */
  maxMinuteRetries: 3,
});

/** Passo della griglia panoramica per la mappa (gradi). */
export const PANORAMIC_STEP_DEG = 0.25;

/**
 * Modelli di vento. `api` = parametro `models` della Forecast API; `meta` = nome usato in
 * `/data/<meta>/static/meta.json` per conoscere l'ultimo run disponibile.
 * `runHoursUtc` e `availDelayH` (ritardo tipico di pubblicazione) servono a stimare quando
 * cercare un run nuovo: valori indicativi, il dato certo viene da meta.json.
 * @type {Readonly<Record<'icon2i'|'ecmwf'|'gfs', {label: string, api: string, meta: string, runHoursUtc: number[], availDelayH: number}>>}
 */
export const MODELS = Object.freeze({
  icon2i: { label: 'ICON-2I', api: 'italia_meteo_arpae_icon_2i', meta: 'italia_meteo_arpae_icon_2i', runHoursUtc: [0, 12], availDelayH: 4 },
  ecmwf: { label: 'ECMWF IFS', api: 'ecmwf_ifs', meta: 'ecmwf_ifs', runHoursUtc: [0, 6, 12, 18], availDelayH: 7 },
  gfs: { label: 'GFS', api: 'gfs025', meta: 'ncep_gfs025', runHoursUtc: [0, 6, 12, 18], availDelayH: 5 },
});

/** Modello d'onda (Marine API, "best match"); meta.json del modello principale per il Mediterraneo. */
export const MARINE = Object.freeze({
  label: 'Open-Meteo Marine',
  meta: 'meteofrance_wave',
  runHoursUtc: [0, 12],
  availDelayH: 8,
});
