import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoatsRepo, cleanBoat, toBoat, ValidationError } from '../js/data/boats-repo.js';

const POLAR = { version: 1, tws: [6, 10], twa: [52, 90], bsp: [[5, 6], [6, 7]] };

/** Finto client Supabase: registra le chiamate e risponde con dati in memoria. */
function fakeClient({ failPolars = false } = {}) {
  const calls = [];
  const db = { boats: [], polars: [] };
  let nextId = 1;
  const builder = (table) => {
    const q = { table, op: 'select', filters: [], payload: null };
    const exec = async () => {
      calls.push({ ...q });
      if (q.op === 'insert') {
        if (table === 'polars' && failPolars) return { data: null, error: { message: 'violates row-level security' } };
        const rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: String(nextId++), ...r }));
        db[table].push(...rows);
        return { data: q.single ? rows[0] : rows, error: null };
      }
      if (q.op === 'delete') {
        db[table] = db[table].filter((r) => !q.filters.every(([k, v]) => r[k] === v));
        return { data: null, error: null };
      }
      if (q.op === 'update' || q.op === 'upsert') return { data: null, error: null };
      let rows = db[table].filter((r) => q.filters.every(([k, v]) => r[k] === v));
      if (table === 'boats') rows = rows.map((b) => ({ ...b, polars: db.polars.filter((p) => p.boat_id === b.id) }));
      return { data: q.maybe ? rows[0] ?? null : rows, error: null };
    };
    const api = {
      select() { return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order() { return api; },
      single() { q.single = true; return api; },
      maybeSingle() { q.maybe = true; return api; },
      then(res, rej) { return exec().then(res, rej); },
    };
    return api;
  };
  return { client: { from: builder }, calls, db };
}

test('validazione dei campi barca', () => {
  assert.deepEqual(cleanBoat({ name: '  Ali ', source: 'orc', loa_m: '11.92' }).value, { name: 'Ali', source: 'orc', loa_m: 11.92 });
  assert.ok(cleanBoat({ name: '', source: 'orc' }).errors.length === 1);
  assert.ok(cleanBoat({ name: 'x', source: 'altro' }).errors.length === 1);
  assert.ok(cleanBoat({ name: 'x', source: 'csv', motor_speed_kn: 0 }).errors.some((e) => /motore/.test(e)));
  assert.deepEqual(cleanBoat({ motor_speed_kn: '6.5' }, true), { value: { motor_speed_kn: 6.5 }, errors: [] });
  assert.equal(cleanBoat({ loa_m: '' }, true).value.loa_m, null);
});

test('creazione con polare: barca e polari inserite, poi riletta', async () => {
  const f = fakeClient();
  const repo = createBoatsRepo(async () => f.client);
  const b = await repo.create({ name: 'Ali', source: 'orc' }, { full: { data: POLAR, source: 'orc' } });
  assert.equal(b.name, 'Ali');
  assert.equal(b.polars.full.data, POLAR);
  assert.equal(b.polars.white, undefined);
  assert.deepEqual(f.calls.map((c) => `${c.table}.${c.op}`), ['boats.insert', 'polars.insert', 'boats.select']);
});

test('creazione annullata se la polare non si salva', async () => {
  const f = fakeClient({ failPolars: true });
  const repo = createBoatsRepo(async () => f.client);
  await assert.rejects(repo.create({ name: 'Ali', source: 'csv' }, { full: { data: POLAR, source: 'csv' } }), (e) => /row-level/.test(e.message));
  assert.equal(f.db.boats.length, 0);
});

test('polare non valida: nessuna chiamata al server', async () => {
  const f = fakeClient();
  const repo = createBoatsRepo(async () => f.client);
  await assert.rejects(repo.create({ name: 'Ali', source: 'csv' }, { full: { data: { ...POLAR, tws: [10, 6] }, source: 'csv' } }), ValidationError);
  await assert.rejects(repo.savePolar('1', 'white', { version: 2 }, 'manual'), ValidationError);
  assert.equal(f.calls.length, 0);
});

test('salvataggio polare con upsert su (boat_id, kind)', async () => {
  const f = fakeClient();
  const repo = createBoatsRepo(async () => f.client);
  await repo.savePolar('7', 'white', POLAR, 'manual');
  assert.equal(f.calls[0].op, 'upsert');
  assert.deepEqual(f.calls[0].opts, { onConflict: 'boat_id,kind' });
  assert.equal(f.calls[0].payload.kind, 'white');
});

test('toBoat raggruppa le polari per tipo', () => {
  const b = toBoat({ id: '1', name: 'x', polars: [{ kind: 'full', data: POLAR }, { kind: 'white', data: POLAR }] });
  assert.ok(b.polars.full && b.polars.white);
});
