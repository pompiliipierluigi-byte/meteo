import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolarCsv, polarToCsv, formatCsvError } from '../js/boats/polar-csv.js';
import { validatePolar } from '../js/boats/polar.js';

// Esempio nel formato qtVlm (.pol): tabulazioni, prima riga TWA\TWS.
const QTVLM = [
  'TWA\\TWS\t6\t8\t10\t12\t14\t16\t20',
  '0\t0\t0\t0\t0\t0\t0\t0',
  '52\t5.1\t5.9\t6.4\t6.7\t6.8\t6.9\t6.9',
  '60\t5.4\t6.2\t6.7\t7.0\t7.1\t7.2\t7.3',
  '90\t5.8\t6.8\t7.3\t7.6\t7.8\t8.0\t8.3',
  '120\t5.3\t6.4\t7.1\t7.6\t8.0\t8.4\t9.1',
  '150\t4.2\t5.3\t6.2\t6.9\t7.4\t7.9\t8.9',
  '180\t3.6\t4.6\t5.5\t6.3\t6.9\t7.4\t8.3',
  '',
].join('\n');

test('qtVlm: lettura e riesportazione identica', () => {
  const r = parsePolarCsv(QTVLM);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(validatePolar(r.polar), []);
  assert.deepEqual(r.polar.tws, [6, 8, 10, 12, 14, 16, 20]);
  assert.deepEqual(r.polar.twa, [52, 60, 90, 120, 150, 180]);
  assert.equal(r.polar.bsp[2][3], 7.6);
  assert.equal(r.format.separator, '\t');
  // La riga TWA 0 tutta nulla non entra nella polare ma si riesporta: file identico.
  assert.equal(polarToCsv(r.polar, r.format), QTVLM);
});

test('punto e virgola con virgola decimale, CRLF, valori vuoti e zeri', () => {
  const text = 'TWA\\TWS;6;10\r\n52;5,1;\r\n90;0;7,30\r\n';
  const r = parsePolarCsv(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.format.decimal, ',');
  assert.deepEqual(r.polar.bsp, [[5.1, null], [null, 7.3]]);
  assert.equal(polarToCsv(r.polar, r.format), 'TWA\\TWS;6;10\n52;5,10;0\n90;0;7,30\n');
});

test('virgola come separatore (Expedition/OpenCPN)', () => {
  const r = parsePolarCsv('twa/tws,6,10\n45,4.5,5.5\n90,6,7\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.polar.bsp, [[4.5, 5.5], [6, 7]]);
  assert.equal(polarToCsv(r.polar), 'TWA\\TWS;6;10\n45;4.5;5.5\n90;6.0;7.0\n');
});

test('errori con riga e colonna', () => {
  const r = parsePolarCsv('TWA\\TWS;6;10\n52;5.1;abc\n40;5;6\n');
  assert.equal(r.polar, null);
  const msgs = r.errors.map(formatCsvError);
  assert.ok(msgs.includes('Riga 2, colonna 3: velocità: valore non numerico «abc»'), msgs.join(' | '));
  assert.ok(msgs.some((m) => m.startsWith('Riga 3, colonna 1: TWA 40 non crescente')), msgs.join(' | '));
});

test('altri errori: TWS non crescenti, valori in eccesso, file vuoto', () => {
  assert.ok(parsePolarCsv('TWA\\TWS;10;6\n52;5;6\n').errors.some((e) => e.column === 3 && /non crescente/.test(e.message)));
  assert.ok(parsePolarCsv('TWA\\TWS;6\n52;5;6\n').errors.some((e) => e.line === 2 && /intestazione ha 1/.test(e.message)));
  assert.ok(parsePolarCsv('').errors.length === 1);
  assert.ok(parsePolarCsv('TWA\\TWS;6;10\n52;0;0\n').errors.some((e) => /nulle/.test(e.message)));
  assert.ok(parsePolarCsv('TWA\\TWS;6\n200;5\n').errors.some((e) => /0–180/.test(e.message)));
});
