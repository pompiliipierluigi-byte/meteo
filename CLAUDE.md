# CLAUDE.md

Istruzioni per chi sviluppa in questo repository (persone e agenti). Requisiti in [SPEC.md](SPEC.md), fasi in [PIANO.md](PIANO.md).

## Progetto

PWA di weather routing per barca a vela in Adriatico (lat 39.8–45.8, lon 12.0–19.7). Strumento di **pianificazione, non di sicurezza**: l'avviso nell'app non va mai rimosso o nascosto.

## Stack

- HTML + CSS + JavaScript (ES2022, ES modules nativi). **Nessuna build**, nessun bundler, nessun transpiler.
- Mappa: Leaflet 1.9.x.
- Dati meteo: Open-Meteo Forecast (ICON-2I, ECMWF, GFS) e Marine. Niente GRIB.
- Backend: Supabase (Auth + Postgres con RLS) via supabase-js v2.
- Routing: Web Worker (modulo).
- Hosting: GitHub Pages, sottopercorso `/meteo/`.

## Vincoli

- **Solo percorsi relativi** ovunque (`./js/main.js`, `../lib/x.js`, `start_url: "./"`, registrazione SW con `./sw.js`). Mai `/` iniziale, mai URL assoluti verso il proprio sito.
- **Librerie solo se necessarie**, con motivazione scritta in SPEC §3.2. Si copiano in `vendor/<nome>/` con versione nel nome della cartella o in un `VERSION`; niente CDN a runtime.
- Nessun segreto nel repository. La chiave anon Supabase è pubblica; la sicurezza dei dati dipende dalla RLS: ogni nuova tabella nasce con RLS attiva e policy.
- Interfaccia **in italiano**; testi centralizzati in `js/i18n/it.js`.
- Unità: nodi, miglia nautiche, metri, secondi, gradi veri. Vento/onda = direzione di provenienza. Orari interni UTC, mostrati in `Europe/Rome`.
- Rispettare le quote Open-Meteo: niente chiamate in loop, sempre cache prima della rete, richieste multi-punto a blocchi.
- Attribuzioni obbligatorie visibili: OpenStreetMap (ODbL), Open-Meteo e modelli, fornitore tile, ORC/orc-data.

## Convenzioni di codice

- Identificatori e nomi file in inglese (`kebab-case.js`); commenti e messaggi utente in italiano.
- Un modulo = una responsabilità; funzioni pure dove possibile (polari, geodesia, routing) per testarle senza browser.
- Tipi documentati con JSDoc.
- Variabili con unità nel nome quando ambiguo: `speedKn`, `distNm`, `heightM`, `twaDeg`, `tUtcMs`.
- Griglie meteo in `Float32Array`; vento interpolato in componenti u/v.
- Nessuna dipendenza da DOM nel worker e nei moduli di `js/routing/`, `js/boats/polar*.js`.
- Formattazione: 2 spazi, punto e virgola, apici singoli.

## Test

- Test dei moduli puri con il test runner integrato di Node (`node --test tests/*.test.js`), senza dipendenze npm.
- Verifiche manuali dell'interfaccia descritte nel criterio di "fatto" di ogni fase.

## Struttura dei file

```
index.html
manifest.webmanifest
sw.js
css/
  app.css
icons/
js/
  main.js            avvio app
  config.js          BBOX, URL API, URL/chiave anon Supabase, costanti
  i18n/it.js         testi interfaccia
  lib/               utilità (idb, formattazione unità/coordinate, eventi)
  map/               mappa e layer (vento, onda, rotta, colori)
  weather/           Open-Meteo, griglie, cache, modelli, corridoio
  boats/             polari, CSV, importazione ORC
  routing/           geodesia, terra, interpolazione, isocrone, worker, finestra
  data/              Supabase e repository (boats, routes)
  ui/                pannelli, cursore, sonda, grafici, avviso
data/
  coastline/         linea di costa OSM ritagliata e semplificata
vendor/
  leaflet/
  supabase/
supabase/
  migrations/        SQL versionato (0001_init.sql, …)
tools/
  coastline/         procedura di preparazione (non eseguita dall'app)
tests/               test Node dei moduli puri
SPEC.md  PIANO.md  CLAUDE.md  README.md
```

## Flusso di lavoro

- **Un commit per passo**: ogni passo numerato di PIANO.md è un commit a sé, piccolo e funzionante, con messaggio descrittivo in italiano (`Fase 1.3: mappa Leaflet con BBOX e attribuzioni`). Non accorpare passi, non lasciare commit che rompono l'app.
- Le decisioni sono in SPEC §9: rispettarle; per ogni nuovo dubbio di prodotto chiedere prima di implementare.
- Se un'implementazione richiede di cambiare la SPEC, aggiornare la SPEC nello stesso commit.
- Una PR per fase verso `main`.
