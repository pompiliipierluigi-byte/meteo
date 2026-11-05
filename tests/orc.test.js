import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orcToPolar, orcBoatRecord, searchOrc, normalize, fetchOrcBoat } from '../js/boats/orc.js';
import { validatePolar, polarBsp, tableBsp, optimalAngles, sailSpeed, DEFAULT_CORRECTIONS } from '../js/boats/polar.js';

const boat = JSON.parse(readFileSync(new URL('./fixtures/orc-ITA15598.json', import.meta.url), 'utf8'));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('ORC: polare valida che riproduce la VPP nei nodi della tabella', () => {
  const p = orcToPolar(boat);
  assert.deepEqual(validatePolar(p), []);
  assert.deepEqual(p.tws, boat.vpp.speeds);
  assert.deepEqual(p.twa, boat.vpp.angles);
  for (const a of boat.vpp.angles) {
    boat.vpp.speeds.forEach((s, j) => {
      close(tableBsp(p, a, s), boat.vpp[a][j]);
      close(polarBsp(p, a, s), boat.vpp[a][j]);
    });
  }
});

test('ORC: ottimi di bolina e poppa da VMG a velocità barca', () => {
  const p = orcToPolar(boat);
  const j = boat.vpp.speeds.indexOf(10);
  const o = optimalAngles(p, 10);
  close(o.beatTwa, boat.vpp.beat_angle[j]);
  close(o.beatBsp * Math.cos((o.beatTwa * Math.PI) / 180), boat.vpp.beat_vmg[j], 0.01);
  close(o.runTwa, boat.vpp.run_angle[j]);
  close(-o.runBsp * Math.cos((o.runTwa * Math.PI) / 180), boat.vpp.run_vmg[j], 0.01);
});

test('ORC: oltre 150° fino al punto di poppa e a VMG costante fino a 180°', () => {
  const p = orcToPolar(boat);
  const o = optimalAngles(p, 20); // poppa a 163.7°
  close(polarBsp(p, o.runTwa, 20), o.runBsp);
  const vmgRun = o.runBsp * -Math.cos((o.runTwa * Math.PI) / 180);
  close(polarBsp(p, 180, 20), vmgRun, 1e-9);
  const mid = polarBsp(p, 157, 20);
  assert.ok(mid < 8.82 + 1e-9 && mid > o.runBsp - 1e-9);
  // Poppa più stretta della tabella (TWS 10: 149.3°): oltre 150° vale l'ultima riga.
  close(polarBsp(p, 170, 10), boat.vpp['150'][boat.vpp.speeds.indexOf(10)]);
});

test('ORC con i correttivi di default: 80 % e vele bianche 40 %', () => {
  const p = orcToPolar(boat);
  close(sailSpeed({ full: p }, 'full', 90, 12, DEFAULT_CORRECTIONS), boat.vpp['90'][4] * 0.8);
  close(sailSpeed({ full: p }, 'white', 135, 12, DEFAULT_CORRECTIONS), boat.vpp['135'][4] * 0.4);
});

test('dati barca per la tabella boats', () => {
  assert.deepEqual(orcBoatRecord(boat, 2025), {
    name: 'ALI', model: 'First 40.7', loa_m: 11.92, source: 'orc', orc_ref: 'ITA/ITA15598', orc_year: 2025,
  });
});

const IDX = [
  ['ITA/ITA15598', 'ALI', 'First 40.7', 1997, 11.9],
  ['FIN/FIN11955', 'Accablant', 'First 40.7', 1997, 11.9],
  ['ITA/ITA14000', 'Alì Babà', 'Dufour 40', 2005, 12],
  ['CRO/CRO123', 'Bura', 'Salona 38', 2010, 11.5],
];

test('ricerca: nome, numero velico, nazione, tipo; accenti ignorati', () => {
  assert.equal(normalize('Alì Babà'), 'ali baba');
  assert.deepEqual(searchOrc(IDX, '15598').map((b) => b[0]), ['ITA/ITA15598']);
  assert.deepEqual(searchOrc(IDX, 'ITA15598').map((b) => b[0]), ['ITA/ITA15598']);
  assert.deepEqual(searchOrc(IDX, 'first 40.7 ita').map((b) => b[0]), ['ITA/ITA15598']);
  assert.deepEqual(searchOrc(IDX, 'ali').map((b) => b[1]), ['ALI', 'Alì Babà']);
  assert.deepEqual(searchOrc(IDX, 'cro').map((b) => b[0]), ['CRO/CRO123']);
  assert.deepEqual(searchOrc(IDX, 'a'), []);
});

test('scheda: secondo indirizzo se il sito non risponde; numero velico validato', async () => {
  const urls = [];
  const fetchFn = async (u) => {
    urls.push(u);
    if (u.includes('jieter.github.io')) throw new TypeError('rete');
    return { ok: true, json: async () => boat };
  };
  assert.equal((await fetchOrcBoat('ITA/ITA15598', fetchFn)).name, 'ALI');
  assert.equal(urls.length, 2);
  await assert.rejects(fetchOrcBoat('../x', fetchFn), /non valido/);
});
