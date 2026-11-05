// Verifica che la shell precaricata dal service worker contenga tutti i file dell'app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** @param {string} dir */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('SHELL di sw.js elenca tutti i moduli JS, la CSS e Leaflet', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]));
  const expected = [
    ...walk(join(root, 'js')),
    ...walk(join(root, 'css')),
    ...walk(join(root, 'icons')),
    join(root, 'vendor/leaflet/leaflet-src.esm.js'),
    join(root, 'vendor/leaflet/leaflet.css'),
    ...walk(join(root, 'vendor/leaflet/images')),
  ].map((p) => `./${relative(root, p)}`);
  const missing = expected.filter((p) => !listed.has(p));
  assert.deepEqual(missing, []);
  for (const p of listed) {
    if (p === './') continue;
    assert.ok(statSync(join(root, p)).isFile(), `${p} non esiste`);
  }
});

test('nessun percorso assoluto verso il proprio sito', () => {
  const files = [join(root, 'index.html'), join(root, 'manifest.webmanifest'), join(root, 'sw.js'), ...walk(join(root, 'js')), ...walk(join(root, 'css'))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/(src|href)=["']\//.test(text), `${f}: src/href assoluto`);
    assert.ok(!/from ['"]\//.test(text), `${f}: import assoluto`);
    assert.ok(!/github\.io/.test(text), `${f}: URL del sito`);
  }
});
