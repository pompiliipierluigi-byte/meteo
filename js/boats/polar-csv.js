// Polari in CSV/POL (qtVlm, Expedition, OpenCPN): lettura con validazione ed esportazione (SPEC §5.3).
// Modulo puro.
//
// Formato: prima riga "TWA\TWS;6;8;10…", poi una riga per TWA: "52;5.1;5.9;…".
// Separatore ";", "," o tabulazione (anche spazi), riconosciuto in automatico; decimale "." o ","
// (la virgola decimale solo con separatore ";"). "0" o vuoto = non definito.

import { validatePolar } from './polar.js';

/**
 * Come è scritto il file: serve a riesportarlo nella stessa forma.
 * @typedef {Object} CsvFormat
 * @property {';' | ',' | '\t' | ' '} separator
 * @property {'.' | ','} decimal
 * @property {number} decimals cifre decimali delle velocità
 * @property {string} corner testo della prima cella (es. "TWA\TWS")
 * @property {boolean} [zeroRow] il file aveva la riga TWA 0 tutta a zero (tolta dalla polare, rimessa in esportazione)
 */

/**
 * Errore con posizione (righe e colonne contate da 1).
 * @typedef {{line: number, column?: number, message: string}} CsvError
 */

/**
 * @param {string} line
 * @returns {CsvFormat['separator']}
 */
function detectSeparator(line) {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) return ',';
  return ' ';
}

/**
 * @param {string} line
 * @param {CsvFormat['separator']} sep
 */
function splitCells(line, sep) {
  if (sep === ' ') return line.trim().split(/\s+/);
  const cells = line.split(sep).map((c) => c.trim());
  // Separatore finale ("…;7.3;") o spazi dopo il separatore.
  while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * Legge un testo CSV/POL.
 * @param {string} text
 * @returns {{polar: import('./polar.js').Polar | null, format: CsvFormat | null, errors: CsvError[]}}
 */
export function parsePolarCsv(text) {
  /** @type {CsvError[]} */
  const errors = [];
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  /** @type {{n: number, text: string}[]} */
  const rows = [];
  lines.forEach((l, i) => {
    if (l.trim() === '' || /^\s*[#!]/.test(l)) return;
    rows.push({ n: i + 1, text: l });
  });
  if (rows.length < 2) {
    return { polar: null, format: null, errors: [{ line: rows[0]?.n ?? 1, message: 'Il file deve avere l\'intestazione dei TWS e almeno una riga di TWA' }] };
  }

  const separator = detectSeparator(rows[0].text);
  const decimalComma = separator === ';' && rows.some((r) => /\d,\d/.test(r.text));
  /** @type {CsvFormat['decimal']} */
  const decimal = decimalComma ? ',' : '.';
  let decimals = 0;

  /**
   * @param {string} cell
   * @param {number} line
   * @param {number} column
   * @param {string} what
   * @returns {number | null | undefined} null = non definito, undefined = errore
   */
  const num = (cell, line, column, what) => {
    if (cell === '') return null;
    const norm = decimal === ',' ? cell.replace(',', '.') : cell;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(norm)) {
      errors.push({ line, column, message: `${what}: valore non numerico «${cell}»` });
      return undefined;
    }
    const d = norm.includes('.') ? norm.split('.')[1].length : 0;
    if (what === 'velocità' && d > decimals) decimals = d;
    return Number(norm);
  };

  // Intestazione.
  const head = splitCells(rows[0].text, separator);
  const corner = head[0];
  /** @type {number[]} */
  const tws = [];
  for (let c = 1; c < head.length; c++) {
    const v = num(head[c], rows[0].n, c + 1, 'TWS');
    if (v === undefined) continue;
    if (v === null || v <= 0) {
      errors.push({ line: rows[0].n, column: c + 1, message: 'TWS mancante o non positivo' });
      continue;
    }
    if (tws.length && v <= tws[tws.length - 1]) {
      errors.push({ line: rows[0].n, column: c + 1, message: `TWS ${v} non crescente` });
    }
    tws.push(v);
  }
  if (head.length < 2) errors.push({ line: rows[0].n, message: 'Intestazione senza valori di TWS' });

  /** @type {number[]} */
  const twa = [];
  /** @type {(number|null)[][]} */
  const bsp = [];
  for (const r of rows.slice(1)) {
    const cells = splitCells(r.text, separator);
    const a = num(cells[0], r.n, 1, 'TWA');
    if (a === undefined) continue;
    if (a === null || a < 0 || a > 180) {
      errors.push({ line: r.n, column: 1, message: 'TWA mancante o fuori dall\'intervallo 0–180°' });
      continue;
    }
    if (twa.length && a <= twa[twa.length - 1]) errors.push({ line: r.n, column: 1, message: `TWA ${a} non crescente` });
    if (cells.length - 1 > head.length - 1) {
      errors.push({ line: r.n, message: `${cells.length - 1} valori, ma l'intestazione ha ${head.length - 1} TWS` });
    }
    /** @type {(number|null)[]} */
    const row = [];
    for (let c = 1; c < head.length; c++) {
      const v = num(cells[c] ?? '', r.n, c + 1, 'velocità');
      if (v === undefined) {
        row.push(null);
        continue;
      }
      if (v !== null && (v < 0 || v > 60)) errors.push({ line: r.n, column: c + 1, message: `velocità ${v} fuori dall'intervallo 0–60 kn` });
      row.push(v === 0 ? null : v);
    }
    twa.push(a);
    bsp.push(row);
  }
  // TWA = 0 con tutti valori nulli (riga presente in molti .pol): non porta informazioni.
  const zeroRow = twa[0] === 0 && bsp[0].every((v) => v === null);
  if (zeroRow) {
    twa.shift();
    bsp.shift();
  }
  if (!twa.length) errors.push({ line: rows[rows.length - 1].n, message: 'Nessuna riga di TWA valida' });
  if (bsp.length && bsp.every((r) => r.every((v) => v === null))) errors.push({ line: rows[1].n, message: 'Tutte le velocità sono nulle' });

  if (errors.length) return { polar: null, format: null, errors };
  /** @type {import('./polar.js').Polar} */
  const polar = { version: 1, tws, twa, bsp };
  const structural = validatePolar(polar);
  if (structural.length) return { polar: null, format: null, errors: structural.map((message) => ({ line: 1, message })) };
  return { polar, format: { separator, decimal, decimals, corner, zeroRow }, errors: [] };
}

/**
 * Testo di un errore con posizione, per l'interfaccia.
 * @param {CsvError} e
 * @returns {string}
 */
export function formatCsvError(e) {
  return e.column ? `Riga ${e.line}, colonna ${e.column}: ${e.message}` : `Riga ${e.line}: ${e.message}`;
}

/**
 * Numero con decimali fissi e separatore decimale indicato.
 * @param {number} v
 * @param {number} decimals
 * @param {'.' | ','} decimal
 */
function fmt(v, decimals, decimal) {
  const s = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v * 100) / 100);
  return decimal === ',' ? s.replace('.', ',') : s;
}

/**
 * Esporta una polare (solo tabella: TWA × TWS). I valori non definiti diventano "0".
 * @param {import('./polar.js').Polar} polar
 * @param {Partial<CsvFormat>} [format] di default: ";" e "." con 1 decimale, "TWA\TWS"
 * @returns {string}
 */
export function polarToCsv(polar, format = {}) {
  const sep = format.separator ?? ';';
  const dec = format.decimal ?? '.';
  const decimals = format.decimals ?? 1;
  const corner = format.corner ?? 'TWA\\TWS';
  const axis = (v) => fmt(v, 0, dec);
  const lines = [[corner, ...polar.tws.map(axis)].join(sep)];
  if (format.zeroRow && polar.twa[0] !== 0) lines.push(['0', ...polar.tws.map(() => '0')].join(sep));
  polar.twa.forEach((a, i) => {
    lines.push([axis(a), ...polar.bsp[i].map((v) => (v === null ? '0' : fmt(v, decimals, dec)))].join(sep));
  });
  return `${lines.join('\n')}\n`;
}
