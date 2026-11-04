# Meteo — weather routing Adriatico

PWA di weather routing per barca a vela in Adriatico: mappa di vento e onda (Open-Meteo), polari della barca, rotte a isocrone, finestra di partenza.

> Strumento di pianificazione, **non di sicurezza**.

- [SPEC.md](SPEC.md) — requisiti, architettura, dati, algoritmo, limiti, decisioni
- [PIANO.md](PIANO.md) — fasi di sviluppo e criteri di completamento
- [CLAUDE.md](CLAUDE.md) — stack, vincoli, convenzioni, struttura dei file

## Sviluppo

Nessuna build: i file si servono così come sono. Per provare in locale con lo stesso sottopercorso di GitHub Pages, dalla cartella **che contiene** il repository:

```sh
python3 -m http.server 8000
# poi aprire http://localhost:8000/meteo/
```

Test dei moduli puri (Node ≥ 22, nessuna dipendenza):

```sh
node --test tests/*.test.js
```

Quando si aggiunge un file all'app va aggiunto anche all'elenco `SHELL` di `sw.js` (il test `tests/sw-shell.test.js` lo verifica) e va incrementata `VERSION` in `sw.js`.

## Pubblicazione

GitHub Pages dal ramo `main`, cartella radice (Settings → Pages → *Deploy from a branch*). L'app risponde su `https://pompiliipierluigi-byte.github.io/meteo/`.
