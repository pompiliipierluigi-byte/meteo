// Client del worker di routing (thread principale): richieste con Promise, avanzamento, annullamento.

/** Errore restituito dal worker. */
export class RoutingError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

export class RoutingClient {
  constructor() {
    /** @type {Worker | null} */
    this.worker = null;
    this.seq = 0;
    /** @type {Map<number, {resolve: Function, reject: Function, onProgress?: (f: number) => void}>} */
    this.pending = new Map();
  }

  /** @returns {Worker} */
  ensure() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e) => this.onMessage(e.data));
      this.worker.addEventListener('error', (e) => {
        const err = new RoutingError(e.message || 'Errore del calcolo', 'worker');
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.reset();
      });
    }
    return this.worker;
  }

  /** @param {any} m */
  onMessage(m) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') {
      p.onProgress?.(m.fraction);
      return;
    }
    this.pending.delete(m.id);
    if (m.type === 'error') p.reject(new RoutingError(m.message, m.code));
    else p.resolve(m);
  }

  /**
   * @param {object} msg
   * @param {(f: number) => void} [onProgress]
   * @returns {Promise<any>}
   */
  send(msg, onProgress) {
    const id = ++this.seq;
    const w = this.ensure();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ ...msg, id });
    });
  }

  /**
   * Calcolo della rotta.
   * @param {import('./run.js').RouteRequest} request
   * @param {{wind: import('../weather/grid.js').WeatherField, marine: import('../weather/grid.js').WeatherField | null}} weather
   * @param {(f: number) => void} [onProgress]
   * @returns {Promise<{track: import('./isochrone.js').TrackPoint[], summary: any, isochrones: [number, number][][]}>}
   */
  route(request, weather, onProgress) {
    return this.send({ type: 'route', request, weather }, onProgress);
  }

  /**
   * Punti a terra spostati al mare più vicino.
   * @param {{lat: number, lon: number}[]} points
   * @param {number} [offsetNm]
   * @returns {Promise<({lat: number, lon: number, moved: boolean, distNm: number} | null)[]>}
   */
  async snap(points, offsetNm) {
    const r = await this.send({ type: 'snap', points, offsetNm });
    return r.points;
  }

  /** Annulla il calcolo in corso (il worker è sincrono: lo si termina e si ricrea al prossimo uso). */
  cancel() {
    const err = new RoutingError('Calcolo annullato', 'cancelled');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.reset();
  }

  reset() {
    this.worker?.terminate();
    this.worker = null;
  }
}
