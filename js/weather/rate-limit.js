// Limitatore delle richieste a Open-Meteo: finestra mobile di 60 s sul "peso" delle chiamate
// (ogni punto di una richiesta multi-punto conta come una chiamata). Modulo puro.

/**
 * @typedef {Object} RateLimiter
 * @property {(weight: number, onWait?: (waitMs: number) => void) => Promise<void>} acquire
 *   attende finché la richiesta rientra nel budget, poi la registra (richieste servite in ordine)
 * @property {() => void} saturate segna la finestra come piena (dopo un 429 della quota al minuto)
 */

/**
 * @param {{budget: number, windowMs: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} cfg
 * @returns {RateLimiter}
 */
export function createRateLimiter(cfg) {
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  /** @type {[number, number][]} istante, peso */
  const log = [];
  let chain = Promise.resolve();

  const used = (t) => {
    while (log.length && log[0][0] <= t - cfg.windowMs) log.shift();
    return log.reduce((s, e) => s + e[1], 0);
  };

  return {
    acquire(weight, onWait) {
      const p = chain.then(async () => {
        for (;;) {
          const t = now();
          // Una richiesta più pesante del budget passa da sola, a finestra vuota.
          if (used(t) + weight <= cfg.budget || log.length === 0) {
            log.push([t, weight]);
            return;
          }
          const waitMs = log[0][0] + cfg.windowMs - t + 100;
          onWait?.(waitMs);
          await sleep(waitMs);
        }
      });
      chain = p.catch(() => {});
      return p;
    },
    saturate() {
      log.push([now(), cfg.budget]);
    },
  };
}
