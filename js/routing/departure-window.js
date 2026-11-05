// Finestra di partenza (SPEC §2.7, §6.7): 24 run orari con lo stesso meteo di corridoio, eseguiti nel
// worker di routing (o in due worker se il dispositivo ha almeno 4 core). Nessun DOM.

import { RoutingClient } from './client.js';

/** Numero di partenze della finestra. */
export const WINDOW_RUNS = 24;

/**
 * Risultato di un run.
 * @typedef {Object} WindowRun
 * @property {number} departMs
 * @property {import('./isochrone.js').TrackPoint[]} [track]
 * @property {ReturnType<typeof import('./isochrone.js').summarize>} [summary]
 * @property {{message: string, code: string}} [error] rotta non trovata o errore del run
 */

/**
 * Orari di partenza: ora intera successiva a `fromMs` (o `fromMs` stesso se già intero) + k h.
 * @param {number} fromMs
 * @param {number} [n]
 * @returns {number[]}
 */
export function departureTimes(fromMs, n = WINDOW_RUNS) {
  const first = Math.ceil(fromMs / 3600e3) * 3600e3;
  return Array.from({ length: n }, (_, k) => first + k * 3600e3);
}

/**
 * Suddivisione delle partenze tra i worker, alternata (ogni worker copre tutta la finestra: i risultati
 * arrivano distribuiti sul grafico).
 * @param {number[]} departures
 * @param {number} workers
 * @returns {{index: number, departMs: number}[][]}
 */
export function splitDepartures(departures, workers) {
  const out = Array.from({ length: Math.max(1, workers) }, () => /** @type {{index: number, departMs: number}[]} */ ([]));
  departures.forEach((departMs, index) => out[index % out.length].push({ index, departMs }));
  return out.filter((l) => l.length);
}

/** Worker da usare: 2 se `hardwareConcurrency ≥ 4`, altrimenti 1. */
export function poolSize() {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
  return n >= 4 ? 2 : 1;
}

/**
 * Esegue la finestra di partenza.
 * @param {Object} o
 * @param {import('./run.js').RouteRequest} o.request configurazione comune (departMs ignorato)
 * @param {{wind: import('../weather/grid.js').WeatherField, marine: import('../weather/grid.js').WeatherField | null}} o.weather
 * @param {number[]} o.departures
 * @param {RoutingClient} o.primary worker già in uso (tasselli di costa in memoria)
 * @param {(index: number, run: WindowRun) => void} [o.onRun]
 * @param {(done: number, total: number, fraction: number) => void} [o.onProgress]
 * @param {number} [o.workers]
 * @returns {{done: Promise<WindowRun[]>, cancel: () => void}}
 */
export function runDepartureWindow(o) {
  const groups = splitDepartures(o.departures, o.workers ?? poolSize());
  const clients = groups.map((_, i) => (i === 0 ? o.primary : new RoutingClient()));
  /** @type {WindowRun[]} */
  const runs = new Array(o.departures.length);
  const partial = groups.map(() => 0);
  let done = 0;
  const report = () => {
    const f = partial.reduce((a, b) => a + b, 0) / groups.length;
    o.onProgress?.(done, o.departures.length, Math.max(f, done / o.departures.length));
  };
  const jobs = groups.map((g, i) => clients[i].window(o.request, o.weather, g, (m) => {
    const { index, departMs, track, summary, error } = m;
    runs[index] = error ? { departMs, error } : { departMs, track, summary };
    done++;
    o.onRun?.(index, runs[index]);
    report();
  }, (f) => {
    partial[i] = f;
    report();
  }));
  const release = () => clients.slice(1).forEach((c) => c.reset());
  return {
    done: Promise.all(jobs).then(() => runs, (err) => {
      clients.forEach((c) => c.cancel());
      throw err;
    }).finally(release),
    cancel: () => clients.forEach((c) => c.cancel()),
  };
}
