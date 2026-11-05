import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlace, createPlacesRepo, toSearchPlace } from '../js/data/places-repo.js';
import { ValidationError } from '../js/data/boats-repo.js';

/** Finto client: registra le operazioni. */
function fake(rows = []) {
  const calls = [];
  const client = {
    from(table) {
      const q = { table, filters: [] };
      const api = {
        select() { q.op ??= 'select'; return api; },
        insert(p) { q.op = 'insert'; q.payload = p; return api; },
        update(p) { q.op = 'update'; q.payload = p; return api; },
        delete() { q.op = 'delete'; return api; },
        eq(k, v) { q.filters.push([k, v]); return api; },
        order() { return api; },
        single() { return api; },
        then(res) {
          calls.push(q);
          const data = q.op === 'select' ? rows : q.op === 'insert' ? { id: 'n', ...q.payload } : null;
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return api;
    },
  };
  return { client, calls };
}

test('validazione dei campi', () => {
  assert.deepEqual(cleanPlace({ name: ' Base ', lat: '42.75', lon: 13.97 }), { name: 'Base', lat: 42.75, lon: 13.97 });
  assert.throws(() => cleanPlace({ name: '', lat: 1, lon: 1 }), ValidationError);
  assert.throws(() => cleanPlace({ name: 'x', lat: 95, lon: 1 }), ValidationError);
  assert.deepEqual(cleanPlace({ name: 'y' }, true), { name: 'y' });
});

test('porto base: prima si toglie il vecchio, poi si imposta il nuovo', async () => {
  const f = fake();
  await createPlacesRepo(async () => f.client).setHome('p2');
  assert.deepEqual(f.calls.map((c) => [c.op, c.payload, c.filters]), [
    ['update', { is_home: false }, [['is_home', true]]],
    ['update', { is_home: true }, [['id', 'p2']]],
  ]);
});

test('elenco con il porto base per primo; creazione mai come porto base', async () => {
  const f = fake([{ id: 'a', name: 'Ancona', is_home: false }, { id: 'g', name: 'Giulianova', is_home: true }]);
  const repo = createPlacesRepo(async () => f.client);
  assert.deepEqual((await repo.list()).map((p) => p.id), ['g', 'a']);
  const c = await repo.create({ name: 'Tremiti', lat: 42.12, lon: 15.5 });
  assert.equal(c.is_home, false);
  assert.equal(toSearchPlace({ id: 'g', name: 'G', lat: 1, lon: 2, note: null, is_home: true }).home, true);
});
