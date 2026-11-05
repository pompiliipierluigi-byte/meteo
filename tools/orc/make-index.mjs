// Genera data/orc/index.json, l'indice di ricerca delle barche ORC, dalle schede di orc-data
// (https://github.com/jieter/orc-data, cartella site/data). L'indice pubblicato da orc-data
// (site/index.json) è incompleto, per questo se ne costruisce uno proprio. Eseguire a mano:
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/jieter/orc-data.git /tmp/orc-data
//   git -C /tmp/orc-data sparse-checkout set site/data
//   node tools/orc/make-index.mjs /tmp/orc-data/site/data 2025 > data/orc/index.json
//   (2025 = anno VPP dei certificati, variabile YEAR nel Makefile di orc-data)
//
// Formato: {"source", "generated", "vppYear", "boats": [[numero velico, nome, tipo, anno, LOA m], …]} ordinato per nome.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const vppYear = Number(process.argv[3]) || null;
const boats = [];
let skipped = 0;
for (const country of readdirSync(root)) {
  for (const file of readdirSync(join(root, country))) {
    if (!file.endsWith('.json')) continue;
    try {
      const b = JSON.parse(readFileSync(join(root, country, file), 'utf8'));
      const v = b.vpp;
      if (!v || !Array.isArray(v.angles) || !Array.isArray(v.speeds) || !v.angles.every((a) => Array.isArray(v[a]))) {
        skipped++;
        continue;
      }
      boats.push([b.sailnumber, (b.name || '').trim(), (b.boat?.type || '').trim(), b.boat?.year ?? null, b.boat?.sizes?.loa ?? null]);
    } catch {
      skipped++;
    }
  }
}
boats.sort((a, b) => a[1].localeCompare(b[1], 'it') || a[0].localeCompare(b[0]));
process.stderr.write(`${boats.length} barche, ${skipped} schede scartate\n`);
process.stdout.write(`${JSON.stringify({
  source: 'https://github.com/jieter/orc-data (site/data), dati ORC',
  generated: new Date().toISOString().slice(0, 10),
  vppYear,
  boats,
})}\n`);
