// Rotte salvate su Supabase (tabella routes, SPEC §4.4). Una rotta salvata contiene la traccia, il
// riepilogo, i parametri di calcolo con la copia della polare e dei correttivi (si riapre identica anche
// se la barca cambia o viene eliminata) e, se c'era, la finestra di partenza (solo riepiloghi).

import { ValidationError } from './boats-repo.js';

/**
 * Campi numerici della traccia (SPEC §6.6). Valori a precisione piena: arrotondarli qui e poi di nuovo
 * nella tabella cambierebbe qualche cifra mostrata (la rotta deve riaprirsi identica).
 */
const TRACK_NUM = ['t', 'lat', 'lon', 'heading', 'bsp', 'cog', 'sog', 'tws', 'twd', 'twa', 'gust',
  'wave_h', 'wave_dir', 'wave_per', 'cur_kn', 'cur_dir', 'dist_land_nm'];

/** Campi del riepilogo conservati nella finestra di partenza. */
const SUMMARY_KEYS = ['departure_ms', 'arrival_ms', 'duration_h', 'distance_nm', 'motor_h', 'beat_h', 'max_tws_kn', 'max_gust_kn', 'max_wave_m', 'warnings'];

/** @param {number} x @param {number} d */
const round = (x, d) => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

/**
 * Traccia → JSON: NaN/Infinito come null.
 * @param {import('../routing/isochrone.js').TrackPoint[]} track
 */
export function packTrack(track) {
  return track.map((p) => {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of TRACK_NUM) o[k] = Number.isFinite(p[k]) ? p[k] : null;
    o.motor = Boolean(p.motor);
    o.warn = [...(p.warn ?? [])];
    if (p.leg !== undefined) o.leg = p.leg;
    return o;
  });
}

/**
 * JSON salvato → traccia (null → NaN, come la produce il routing; distanza da terra sconosciuta = ∞).
 * @param {any[]} rows
 * @returns {import('../routing/isochrone.js').TrackPoint[]}
 */
export function unpackTrack(rows) {
  return (rows ?? []).map((r) => {
    /** @type {Record<string, any>} */
    const o = { ...r };
    for (const k of TRACK_NUM) {
      if (o[k] === null || o[k] === undefined) o[k] = k === 'dist_land_nm' ? Infinity : k === 'cur_kn' || k === 'cur_dir' ? 0 : NaN;
    }
    o.motor = Boolean(o.motor);
    o.warn = Array.isArray(o.warn) ? o.warn : [];
    return /** @type {any} */ (o);
  });
}

/**
 * @param {Record<string, any> | undefined} s
 */
function packSummary(s) {
  if (!s) return null;
  return Object.fromEntries(SUMMARY_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, Number.isNaN(s[k]) ? null : s[k]]));
}

/**
 * Rotta da salvare.
 * @typedef {Object} RouteToSave
 * @property {string} name
 * @property {string | null} boatId
 * @property {string} boatName
 * @property {{lat: number, lon: number}[]} route partenza, waypoint…, arrivo
 * @property {import('../weather/models.js').ModelChoice} model
 * @property {Record<string, number>} runs run dei modelli usati (ms UTC)
 * @property {import('../routing/run.js').RouteRequest} request
 * @property {import('../routing/isochrone.js').TrackPoint[]} track
 * @property {ReturnType<typeof import('../routing/isochrone.js').summarize>} summary
 * @property {{departures: number[], runs: (import('../routing/departure-window.js').WindowRun | undefined)[], selected: number | null,
 *   limits: any, waveWarningM: number} | null} [window]
 */

/**
 * Rotta salvata, come riaperta.
 * @typedef {Object} SavedRoute
 * @property {string} id
 * @property {string} name
 * @property {string | null} boat_id
 * @property {string} created_at
 * @property {number} departMs
 * @property {{lat: number, lon: number}[]} route
 * @property {string} model
 * @property {'full' | 'white'} polar_kind
 * @property {Record<string, any>} params
 * @property {import('../routing/isochrone.js').TrackPoint[]} track
 * @property {ReturnType<typeof import('../routing/isochrone.js').summarize>} summary
 * @property {{departures: number[], runs: ({summary?: any, error?: any} | null)[], selected: number | null, limits: any, waveWarningM: number} | null} window
 */

/**
 * Riga per l'inserimento (stessi vincoli della migrazione SQL).
 * @param {RouteToSave} r
 * @returns {Record<string, any>}
 */
export function toRow(r) {
  const name = String(r.name ?? '').trim();
  const errors = [];
  if (!name || name.length > 100) errors.push('Nome della rotta obbligatorio (max 100 caratteri)');
  if (!r.route || r.route.length < 2) errors.push('Servono partenza e arrivo');
  if (!r.track?.length || !r.summary) errors.push('Nessuna rotta calcolata da salvare');
  if (errors.length) throw new ValidationError(errors);
  const start = r.route[0];
  const end = r.route[r.route.length - 1];
  const runValues = Object.values(r.runs ?? {}).filter(Number.isFinite);
  const { route: _route, departMs: _d, keepIsochrones: _k, ...params } = r.request;
  const s = r.summary;
  return {
    boat_id: r.boatId,
    name,
    start_lat: start.lat,
    start_lon: start.lon,
    end_lat: end.lat,
    end_lon: end.lon,
    waypoints: r.route.slice(1, -1).map((p) => ({ lat: p.lat, lon: p.lon })),
    departure_at: new Date(s.departure_ms).toISOString(),
    model: r.model,
    forecast_run_at: runValues.length ? new Date(Math.min(...runValues)).toISOString() : null,
    polar_kind: r.request.sails,
    // Copia di polari, correttivi, motore, limiti e soglie: la rotta resta riproducibile.
    params: { ...params, boatName: r.boatName, runs: r.runs ?? {}, summary: packSummary(s) },
    track: packTrack(r.track),
    duration_h: round(s.duration_h, 2),
    distance_nm: round(s.distance_nm, 2),
    motor_h: round(s.motor_h, 2),
    max_tws_kn: round(s.max_tws_kn, 1),
    max_gust_kn: round(s.max_gust_kn, 1),
    max_wave_m: round(s.max_wave_m, 1),
    departure_window: r.window ? {
      departures: r.window.departures,
      runs: r.window.departures.map((_, i) => {
        const w = r.window?.runs[i];
        if (!w) return null;
        return w.error ? { error: { code: w.error.code, message: w.error.message } } : { summary: packSummary(w.summary) };
      }),
      selected: r.window.selected,
      limits: r.window.limits,
      waveWarningM: r.window.waveWarningM,
    } : null,
  };
}

/**
 * Riga dal database → rotta riaperta.
 * @param {any} row
 * @returns {SavedRoute}
 */
export function fromRow(row) {
  const route = [{ lat: row.start_lat, lon: row.start_lon }, ...(row.waypoints ?? []), { lat: row.end_lat, lon: row.end_lon }];
  const track = unpackTrack(row.track);
  const num = (v) => (v === null || v === undefined ? NaN : Number(v));
  const first = track[0];
  const last = track[track.length - 1];
  // Riepilogo salvato nei parametri; in mancanza, ricostruito dalle colonne.
  const saved = row.params?.summary;
  const summary = saved ? { ...saved, warnings: saved.warnings ?? [] } : {
    departure_ms: Date.parse(row.departure_at),
    arrival_ms: last ? last.t : Date.parse(row.departure_at) + num(row.duration_h) * 3600e3,
    duration_h: num(row.duration_h),
    distance_nm: num(row.distance_nm),
    motor_h: num(row.motor_h),
    beat_h: NaN,
    max_tws_kn: num(row.max_tws_kn),
    max_gust_kn: num(row.max_gust_kn),
    max_wave_m: num(row.max_wave_m),
    warnings: [...new Set(track.flatMap((p) => p.warn))],
  };
  if (first && !Number.isFinite(summary.departure_ms)) summary.departure_ms = first.t;
  return {
    id: row.id,
    name: row.name,
    boat_id: row.boat_id ?? null,
    created_at: row.created_at,
    departMs: summary.departure_ms,
    route,
    model: row.model,
    polar_kind: row.polar_kind,
    params: row.params ?? {},
    track,
    summary,
    window: row.departure_window ?? null,
  };
}

/** Colonne per l'elenco (senza traccia, parametri e finestra). */
const LIST = 'id, name, boat_id, departure_at, model, polar_kind, duration_h, distance_nm, motor_h, max_tws_kn, created_at, boat_name:params->>boatName';

/**
 * @param {{error: any}} res
 */
function check(res) {
  if (res.error) throw res.error;
  return res;
}

/**
 * @param {() => Promise<any>} getClient client Supabase (iniettato: nei test un finto client)
 */
export function createRoutesRepo(getClient) {
  return {
    /** @returns {Promise<any[]>} rotte dell'utente, dalla più recente */
    async list() {
      const sb = await getClient();
      return check(await sb.from('routes').select(LIST).order('created_at', { ascending: false })).data;
    },

    /**
     * @param {string} id
     * @returns {Promise<SavedRoute | null>}
     */
    async get(id) {
      const sb = await getClient();
      const res = check(await sb.from('routes').select('*').eq('id', id).maybeSingle());
      return res.data ? fromRow(res.data) : null;
    },

    /**
     * @param {RouteToSave} r
     * @returns {Promise<string>} id della rotta salvata
     */
    async save(r) {
      const row = toRow(r);
      const sb = await getClient();
      return check(await sb.from('routes').insert(row).select('id').single()).data.id;
    },

    /** @param {string} id */
    async remove(id) {
      const sb = await getClient();
      check(await sb.from('routes').delete().eq('id', id));
    },
  };
}
