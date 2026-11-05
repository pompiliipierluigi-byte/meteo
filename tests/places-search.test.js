import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, searchKnown, parseGeocoding, searchOnline } from '../js/places/search.js';

const ports = JSON.parse(fs.readFileSync(new URL('../data/places/ports.json', import.meta.url))).ports;

test('normalizzazione: accenti e diacritici croati', () => {
  assert.equal(normalize('Šibenik'), 'sibenik');
  assert.equal(normalize('Durrës'), 'durres');
  assert.equal(normalize('  Lussinpiccolo / Mali Lošinj '), 'lussinpiccolo mali losinj');
});

test('ricerca nei porti: nome, alias italiano, parola interna', () => {
  assert.equal(searchKnown('Giulianova', ports)[0].name, 'Giulianova');
  assert.equal(searchKnown('giuli', ports)[0].name, 'Giulianova');
  assert.equal(searchKnown('Zara', ports)[0].name, 'Zara / Zadar');
  assert.equal(searchKnown('spalato', ports)[0].name, 'Spalato / Split');
  assert.equal(searchKnown('losinj', ports)[0].name, 'Lussinpiccolo / Mali Lošinj');
  assert.equal(searchKnown('Tronto', ports)[0].name, 'San Benedetto del Tronto');
  assert.deepEqual(searchKnown('g', ports), []);
  assert.deepEqual(searchKnown('zzzz', ports), []);
});

test('luoghi salvati prima dei porti', () => {
  const saved = [{ name: 'Gita Giulianova nord', lat: 42.8, lon: 14, kind: 'saved', id: '1' }];
  const r = searchKnown('giulianova', ports, /** @type {any} */ (saved));
  assert.equal(r[0].kind, 'saved');
  assert.equal(r[1].name, 'Giulianova');
});

test('porti dentro l\'area di lavoro e con coordinate valide', () => {
  assert.ok(ports.length >= 80);
  for (const p of ports) assert.ok(p.lat >= 39.8 && p.lat <= 45.8 && p.lon >= 12 && p.lon <= 19.7, p.name);
});

test('ricerca online: solo risultati nell\'area, errori leggibili', async () => {
  const json = { results: [
    { name: 'Giulianova', latitude: 42.75, longitude: 13.96, admin1: 'Abruzzo', country_code: 'IT' },
    { name: 'Giulianova', latitude: -10, longitude: 50, country_code: 'XX' },
  ] };
  assert.equal(parseGeocoding(json).length, 1);
  assert.equal(parseGeocoding({}).length, 0);
  let url = '';
  const r = await searchOnline('Giulianova', { fetchFn: async (u) => { url = String(u); return new Response(JSON.stringify(json)); } });
  assert.equal(r[0].detail, 'Abruzzo, IT');
  assert.match(url, /name=Giulianova/);
  assert.match(url, /language=it/);
  await assert.rejects(searchOnline('Giulianova', { fetchFn: async () => { throw new TypeError('x'); } }), /non disponibile/);
});
