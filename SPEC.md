# SPEC — Weather routing Adriatico (PWA)

Versione documento: 0.1 (bozza da brief) · Data: 2026-11-04

> **Avviso**: l'app è uno strumento di **pianificazione**, non di sicurezza. Non sostituisce bollettini ufficiali, carte nautiche, strumenti di bordo né il giudizio dello skipper. L'avviso è parte dei requisiti (vedi §2.8).

---

## 1. Obiettivo e perimetro

PWA per pianificare traversate a vela in Adriatico, sul modello di PredictWind, Squid e Windy:

- mostrare vento e onda previsti su mappa, nel tempo e per modello;
- calcolare la rotta più rapida tra due punti con le polari della propria barca;
- confrontare gli orari di partenza nelle prossime 24 ore;
- salvare barche, polari e rotte su un account personale.

**Area**: lat 39.8–45.8 N, lon 12.0–19.7 E (bounding box `BBOX`). Comprende il Canale d'Otranto settentrionale, la costa italiana da Santa Maria di Leuca a Trieste, la costa slovena, croata (isole comprese), montenegrina e albanese settentrionale.

**Escluso da questa versione**: file GRIB, correnti marine (vedi Domande aperte), AIS, tracciamento in tempo reale, notifiche push, integrazione con strumenti di bordo (NMEA).

---

## 2. Requisiti funzionali

### 2.1 Mappa

- Mappa Leaflet a tutto schermo, centrata su `BBOX`, con limiti di pan (`maxBounds` = BBOX + margine).
- Mappa base: tile raster (fornitore da decidere, vedi Domande aperte), con overlay opzionale OpenSeaMap (segnalamenti).
- Tocco su un punto → popup "sonda" con i valori all'ora selezionata: vento (nodi, direzione di provenienza), raffica, onda (m, direzione di provenienza, periodo s), modello usato.

### 2.2 Layer vento

- **Particelle animate** su canvas: velocità e direzione derivate dal campo di vento interpolato; colore per intensità.
- **Frecce/barbe** su griglia regolare, diradate in base allo zoom, colorate con la stessa scala.
- **Campo colorato** (heatmap) di intensità, opacità regolabile.
- Scala colori in nodi, con legenda: 0–5–10–15–20–25–30–35+ kn.
- Ogni sotto-layer attivabile singolarmente.

### 2.3 Layer onda

- Campo colorato per altezza significativa (m), scala 0–0.5–1–1.5–2–3–4+ m.
- Frecce di direzione di provenienza.
- Periodo (s) visibile nella sonda e, opzionalmente, come etichette su griglia diradata.
- Usa la variabile combinata (mare totale); onda da vento e swell separati disponibili solo nella sonda (se forniti dall'API).

### 2.4 Cursore temporale e modello

- Cursore orario dall'ora corrente fino alla fine dell'orizzonte del modello scelto; pulsanti ±1 h, ±1 giorno, "play".
- Orari mostrati in ora locale `Europe/Rome`; internamente tutto in UTC.
- Selettore modello:
  - **Auto** (predefinito): ICON-2I per le prime 72 h, ECMWF oltre.
  - **ICON-2I** (solo).
  - **ECMWF** (solo).
  - **GFS** (confronto).
- Indicazione visibile del modello effettivo per l'ora selezionata e dell'orario di emissione (run) del dato.

### 2.5 Barche e polari

- Elenco barche dell'utente; una barca attiva alla volta.
- Creazione barca da:
  1. **Importazione ORC** da `https://jieter.github.io/orc-data/site/` (ricerca per nome, numero velico, nazione).
  2. **Inserimento manuale** (tabella editabile TWA × TWS).
  3. **Importazione CSV** (formato in §5.3).
- Per ogni barca:
  - correttivo % **bolina** (TWA < soglia, default 90°) e correttivo % **portanti** (TWA ≥ soglia); valori ammessi −50 % … +30 %;
  - due set di polari: **full** (con spi/gennaker) e **vele bianche**;
  - **soglia motore**: se la velocità stimata a vela è inferiore a *X* nodi, la barca procede a motore a *Y* nodi (X, Y per barca).
- Anteprima grafica della polare (diagramma polare, una curva per TWS) con correttivi applicati.

### 2.6 Routing

- Input: partenza, arrivo, ora di partenza, barca, set di polari (full / vele bianche), modello.
- **Partenza**: tocco su mappa oppure posizione GPS (`navigator.geolocation`). **Arrivo**: tocco su mappa. Marcatori trascinabili.
- Se un punto cade a terra: spostamento automatico al punto di mare più vicino, con avviso.
- Calcolo a isocrone in **Web Worker** (§6), senza bloccare l'interfaccia, con barra di avanzamento e possibilità di annullare.
- Evitamento della terra con linea di costa OSM ad alta risoluzione (§7).
- Output su mappa: rotta, isocrone (opzionali), punti orari con etichette.
- Output tabellare: per ogni passo orario → ora, posizione, rotta vera, velocità, TWS, TWA, raffica, onda, vela/motore.
- Riepilogo: durata, distanza percorsa (NM), ore di motore, vento max, raffica max, onda max, ora di arrivo.

### 2.7 Finestra di partenza

- Una simulazione per ogni ora delle prossime 24 h (24 run), stessa configurazione.
- Grafico (asse X = ora di partenza) con: durata, ore di motore, vento max, raffica max, onda max.
- **Partenza migliore** evidenziata (criterio in §6.7, da confermare).
- Tocco su una colonna del grafico → mostra quella rotta su mappa.
- Run eseguiti nel worker in sequenza (o in un pool di 2 worker se `navigator.hardwareConcurrency ≥ 4`), con avanzamento "n/24".

### 2.8 Avviso di sicurezza

- Al primo avvio: finestra modale da accettare esplicitamente ("Ho capito"), memorizzata in locale con versione del testo.
- Testo fisso, sempre visibile, nella barra inferiore: *"Solo pianificazione — non usare per la navigazione"*.
- Ripetuto nel riepilogo di ogni rotta e nella finestra di partenza.
- Testo proposto per la modale:
  > Questa app fornisce stime basate su modelli meteorologici e sulle polari che hai inserito. Le previsioni possono essere sbagliate, la linea di costa è semplificata e non sono considerati fondali, ostacoli, correnti, traffico, zone vietate o condizioni locali. Usala solo per pianificare. Le decisioni in mare spettano allo skipper, sulla base dei bollettini ufficiali e delle carte nautiche.

### 2.9 Account e dati utente

- Login con Supabase Auth (metodo da decidere, vedi Domande aperte).
- Dati utente salvati su Supabase: barche, polari, rotte salvate (con eventuale finestra di partenza).
- Row Level Security su tutte le tabelle (§4).
- Senza login: consultazione mappa e meteo disponibile; barche/rotte → da decidere (vedi Domande aperte).

### 2.10 PWA

- `manifest.webmanifest` con `start_url` e `scope` relativi (`./`), icone 192/512 e maskable.
- Service worker: cache della shell (HTML, CSS, JS, librerie, linea di costa); dati meteo in cache con scadenza; ultima previsione consultabile offline con banner "dati del …".
- Installabile su Android e iOS.

### 2.11 Interfaccia e unità

- Interfaccia **in italiano**.
- Unità: velocità in **nodi**, distanze in **miglia nautiche**, altezza onda in **metri**, periodo in **secondi**, direzioni in **gradi veri** (vento e onda: direzione di provenienza; rotta: direzione di destinazione).
- Coordinate visualizzate in gradi e minuti decimali (es. `43°30.25'N 016°26.10'E`).
- Layout mobile-first (uso principale da smartphone/tablet), funzionante anche su desktop.

---

## 3. Architettura

### 3.1 Vincoli

- **Hosting**: GitHub Pages sotto il sottopercorso `/meteo/` → **solo percorsi relativi** in HTML, CSS, JS, manifest e service worker.
- **Nessuna build**: ES modules nativi, file serviti così come sono.
- **Librerie**: solo se necessarie e motivate, **copiate in `vendor/`** con versione fissata (niente CDN a runtime, per affidabilità offline e cache del service worker).

### 3.2 Librerie previste

| Libreria | Uso | Motivazione |
|---|---|---|
| Leaflet 1.9.x | Mappa | Richiesta dal brief; leggera, stabile. |
| supabase-js v2 (bundle ESM) | Auth + database | Client ufficiale; gestione sessione e token non banale da riscrivere. |

Da **non** usare salvo necessità emersa in sviluppo: librerie per particelle (es. leaflet-velocity: richiede formato grib2json e non è più mantenuta → layer particelle scritto in proprio su canvas), librerie per grafici (il grafico della finestra di partenza è in SVG scritto a mano), indici spaziali (griglia a bucket scritta in proprio, §7.3).

### 3.3 Componenti

```
┌──────────────────────── Thread principale ────────────────────────┐
│ UI (pannelli, cursore, grafici)   Mappa Leaflet + layer canvas     │
│ Servizio meteo (fetch, cache IndexedDB, griglie Float32Array)      │
│ Gestione barche/polari   Client Supabase (auth, CRUD)              │
└───────────────┬──────────────────────────────────────▲────────────┘
                │ postMessage (griglie transferable,   │ avanzamento,
                │ polari, parametri, linea di costa)   │ risultati
┌───────────────▼──────────────────────────────────────┴────────────┐
│ Web Worker routing: isocrone, interpolazione meteo, test terra,    │
│ finestra di partenza (24 run)                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 3.4 Dati meteo

**Fonti** (Open-Meteo, accesso diretto dal browser, CORS consentito):

| Uso | Endpoint | Modello (parametro `models`) | Note |
|---|---|---|---|
| Vento 0–72 h | Forecast API | ICON-2I (ItaliaMeteo-ARPAE, ~2.2 km) | Identificativo esatto da verificare in fase 1. |
| Vento > 72 h | Forecast API | ECMWF IFS | Risoluzione disponibile da verificare (0.25° o 9 km). |
| Confronto | Forecast API | GFS | ~0.25°. |
| Onda | Marine API | modello predefinito (best match) | `wave_height`, `wave_direction`, `wave_period`; opzionali onda da vento/swell. |

Variabili vento: `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, con `wind_speed_unit=kn` e `timezone=GMT`.

**Griglia di campionamento** (Open-Meteo restituisce punti, non campi):

- **Griglia panoramica** per la mappa: passo 0.25° sulla BBOX (≈ 25 × 32 = 800 punti), ridotta ai soli punti di mare (+ un anello di punti costieri) con la maschera della linea di costa → stima ≈ 400–450 punti.
- **Griglia di corridoio** per il routing: passo fine (0.05°–0.1°, da tarare) solo nel corridoio tra partenza e arrivo (ellisse con fuochi in partenza/arrivo e margine). Necessaria per risolvere i canali tra le isole croate e gli effetti locali di ICON-2I.
- Richieste con più coordinate per chiamata (liste `latitude`/`longitude` separate da virgola), suddivise in blocchi (dimensione da tarare per lunghezza URL e peso in quota).
- Memorizzazione in `Float32Array` per variabile, indicizzate `[t][y][x]`; componenti vento convertite in `u`,`v` per l'interpolazione (la direzione non si interpola direttamente).
- **Modello Auto**: fusione lato client — per ogni ora t si usa ICON-2I se t ≤ ultima ora valida di ICON-2I, altrimenti ECMWF. Possibile discontinuità al passaggio: segnalata sul cursore temporale.
- **Punti costieri senza onda**: il modello marino può restituire `null` vicino a costa; si usa il valore valido più vicino (max 2 celle), altrimenti "n.d.".

**Cache**: IndexedDB, chiave = (modello, griglia, run). Validità: fino al successivo aggiornamento atteso del modello (orari da configurare), comunque max 3 h. Pulsante "aggiorna" manuale.

### 3.5 Sicurezza e chiavi

- La chiave `anon` di Supabase è pubblica per costruzione: la protezione dei dati è affidata solo alla RLS.
- Nessuna chiave `service_role` nel repository o nel client.
- Configurazione (URL Supabase, chiave anon) in un unico file `js/config.js`.

---

## 4. Modello dati Supabase

Schema `public`. Tutte le tabelle hanno RLS attiva; chiavi primarie `uuid` (`gen_random_uuid()`); timestamp `timestamptz` in UTC.

### 4.1 `profiles`

| Campo | Tipo | Vincoli / note |
|---|---|---|
| `id` | uuid | PK, = `auth.users.id`, `on delete cascade` |
| `display_name` | text | nullable |
| `default_boat_id` | uuid | FK → `boats.id`, `on delete set null`, nullable |
| `settings` | jsonb | default `{}` (es. layer attivi, modello preferito, criteri finestra) |
| `disclaimer_version` | int | ultima versione dell'avviso accettata |
| `created_at`, `updated_at` | timestamptz | default `now()` |

Riga creata da trigger su inserimento in `auth.users`.

### 4.2 `boats`

| Campo | Tipo | Vincoli / note |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `auth.users.id`, `not null`, default `auth.uid()` |
| `name` | text | `not null` |
| `model` | text | es. "First 40.7" |
| `loa_m` | numeric(5,2) | nullable |
| `source` | text | `check in ('orc','manual','csv')` |
| `orc_ref` | text | identificativo ORC (numero velico/riferimento), nullable |
| `orc_year` | int | anno del certificato, nullable |
| `upwind_corr_pct` | numeric(5,1) | default 0, `check between -50 and 30` |
| `downwind_corr_pct` | numeric(5,1) | default 0, `check between -50 and 30` |
| `split_twa_deg` | numeric(4,1) | default 90 — soglia bolina/portanti |
| `motor_threshold_kn` | numeric(4,1) | X, default 3.0 |
| `motor_speed_kn` | numeric(4,1) | Y, default 6.0 |
| `tack_penalty_s` | int | penalità virata/strambata, default 0 (vedi §6.5) |
| `created_at`, `updated_at` | timestamptz | |

### 4.3 `polars`

| Campo | Tipo | Vincoli / note |
|---|---|---|
| `id` | uuid | PK |
| `boat_id` | uuid | FK → `boats.id`, `on delete cascade`, `not null` |
| `user_id` | uuid | FK → `auth.users.id`, `not null`, default `auth.uid()` (denormalizzato per RLS semplice) |
| `kind` | text | `check in ('full','white')` |
| `data` | jsonb | polare nel formato interno (§5.1) |
| `source` | text | `orc` / `manual` / `csv` / `derived` |
| `notes` | text | nullable |
| `created_at`, `updated_at` | timestamptz | |
| | | `unique (boat_id, kind)` |

### 4.4 `routes`

| Campo | Tipo | Vincoli / note |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK, `not null`, default `auth.uid()` |
| `boat_id` | uuid | FK → `boats.id`, `on delete set null` |
| `name` | text | `not null` |
| `start_lat`, `start_lon`, `end_lat`, `end_lon` | double precision | |
| `departure_at` | timestamptz | ora di partenza scelta |
| `model` | text | `auto` / `icon2i` / `ecmwf` / `gfs` |
| `forecast_run_at` | timestamptz | run del modello usato |
| `polar_kind` | text | `full` / `white` |
| `params` | jsonb | parametri di calcolo + **copia di polare e correttivi** usati (riproducibilità se la barca cambia) |
| `track` | jsonb | array di punti (§6.6) |
| `duration_h`, `distance_nm`, `motor_h` | numeric | riepilogo |
| `max_tws_kn`, `max_gust_kn`, `max_wave_m` | numeric | riepilogo |
| `window` | jsonb | nullable — risultati della finestra di partenza (24 riepiloghi, senza tracce) |
| `created_at` | timestamptz | |

### 4.5 Policy RLS

Per `boats`, `polars`, `routes`:

- `select`, `update`, `delete`: `using (user_id = auth.uid())`
- `insert`, `update`: `with check (user_id = auth.uid())`
- `polars`, `routes`: in `with check` anche verifica che `boat_id` appartenga a `auth.uid()` (sottoquery su `boats`).

Per `profiles`: `select`/`update` con `id = auth.uid()`; `insert` solo da trigger (`security definer`).

Trigger `updated_at` su tutte le tabelle con quel campo. Indici su `user_id` e `boat_id`. Migrazioni SQL versionate in `supabase/migrations/`.

---

## 5. Formato polari

### 5.1 Formato interno (JSON, unico per tutte le fonti)

```json
{
  "version": 1,
  "tws": [6, 8, 10, 12, 14, 16, 20],
  "twa": [52, 60, 75, 90, 110, 120, 135, 150, 165, 180],
  "bsp": [[5.1, 5.9, "…"], "…"],
  "beat": { "twa": [43.0, 41.5, "…"], "bsp": [4.9, 5.6, "…"] },
  "run":  { "twa": [140.0, 145.0, "…"], "bsp": [5.0, 6.1, "…"] }
}
```

- `tws` (nodi) e `twa` (gradi, 0–180) crescenti; `bsp[i][j]` = velocità in nodi a `twa[i]`, `tws[j]`.
- `beat` / `run`: angolo e velocità ottimi di bolina e poppa per ogni TWS (opzionali: se assenti si calcolano dalla polare massimizzando la VMG).
- Simmetria mure dritta/sinistra assunta.
- Valori `null` = non definito.

### 5.2 Interpolazione e uso

- Bilineare su (TWA, TWS).
- TWS < minimo tabella: interpolazione lineare verso 0 a TWS = 0. TWS > massimo: valore al massimo (nessuna estrapolazione).
- TWA < angolo di bolina ottimo: zona morta, velocità a vela = 0 (la barca deve bordeggiare).
- Correttivi: `bsp × (1 + upwind_corr_pct/100)` se TWA < `split_twa_deg`, altrimenti `downwind_corr_pct`.
- Motore: se `bsp_vela < motor_threshold_kn` → `bsp = motor_speed_kn` in qualsiasi direzione e il passo è contato come "motore" (interpretazione da confermare, vedi Domande aperte).

### 5.3 CSV

Formato compatibile con i `.pol`/`.csv` più diffusi (qtVlm, Expedition, OpenCPN):

```
TWA\TWS;6;8;10;12;14;16;20
52;5.1;5.9;6.4;6.7;6.8;6.9;6.9
60;5.4;6.2;6.7;7.0;7.1;7.2;7.3
…
```

- Separatore `;`, `,` o tabulazione (riconoscimento automatico); decimale `.` (e `,` se il separatore è `;`).
- Prima riga: intestazione con i TWS; prima colonna: TWA.
- `0` o vuoto = non definito.
- Validazione con messaggi in italiano (riga/colonna dell'errore). Esportazione nello stesso formato.

### 5.4 Importazione ORC

- Indice e dati da `https://jieter.github.io/orc-data/site/` (struttura dei file da verificare in fase 2: indice delle barche + un JSON per barca con sezione VPP: angoli, TWS, velocità, angoli/velocità ottimi di bolina e poppa).
- Ricerca client-side sull'indice (cache IndexedDB).
- Le polari ORC sono calcolate con vele da regata (spinnaker/gennaker nelle portanti) → importate come set **full**.
- Set **vele bianche**: non fornito da ORC → derivato (proposta: stessa polare con riduzione nelle portanti oltre un TWA, editabile) oppure inserito a mano. Da confermare.

---

## 6. Algoritmo di routing a isocrone

### 6.1 Ingressi

Partenza P0, arrivo P1, ora di partenza t0, polare (set scelto) + correttivi + parametri motore, campo meteo (u, v, raffica, onda) sulla griglia di corridoio, linea di costa (indice spaziale), parametri:

| Parametro | Default | Note |
|---|---|---|
| Passo temporale Δt | 30 min | 15 min nelle prime 2 h e vicino all'arrivo (da tarare) |
| Passo di prua | 5° | 72 prue per punto, ridotte se fuori settore utile |
| Cella di potatura | 0.5 NM | |
| Max punti per isocrona | 1500 | |
| Durata massima | fine orizzonte meteo o 120 h | |

### 6.2 Espansione

Per ogni punto dell'isocrona corrente (posizione, tempo, prua precedente, stato vela/motore):

1. Si interpola il vento (u, v) nello spazio (bilineare) e nel tempo (lineare) → TWS, TWD.
2. Per ogni prua candidata: TWA, velocità dalla polare con correttivi e regola motore.
3. Nuova posizione = spostamento lungo l'ortodromia per `bsp × Δt` (sottopassi se Δt lungo e il vento varia).
4. Scarto se il segmento interseca la terra (§7) o esce dalla BBOX.

### 6.3 Potatura

- La potatura classica per settori angolari dalla partenza funziona male con isole e penisole (le rotte che aggirano un ostacolo vengono scartate). Si usa invece una **griglia di celle** (lato 0.5 NM): per ogni cella si tiene solo il punto raggiunto per primo.
- Ulteriore limite: se i punti superano il massimo, si tengono quelli con minore stima "tempo trascorso + distanza residua / velocità massima della polare" (euristica tipo A*).
- Le celle già raggiunte in isocrone precedenti restano bloccate (evita di tornare indietro).

### 6.4 Arrivo

- Quando un segmento passa entro `bsp × Δt` da P1 si calcola il tempo esatto di arrivo diretto a P1 (se il segmento verso P1 non interseca terra).
- Si completa l'isocrona corrente e si sceglie l'arrivo più rapido; ricostruzione della traccia tramite puntatori al genitore.
- Nessun arrivo entro la durata massima → errore "Rotta non trovata entro l'orizzonte meteo".

### 6.5 Dettagli

- Penalità virata/strambata: se il lato del vento cambia tra genitore e figlio si aggiunge `tack_penalty_s` (default 0, quindi disattivata).
- Passaggio vela ↔ motore senza penalità.
- Onda: in questa versione **solo registrata** per le statistiche (nessuna riduzione di velocità; vedi Domande aperte).
- Distanze: formula dell'haversine / ortodromia su sfera di raggio 3440.065 NM.

### 6.6 Uscita

Traccia = array di punti `{t, lat, lon, cog, bsp, tws, twd, twa, gust, wave_h, wave_dir, wave_per, motor}`; riepilogo: durata, distanza, ore di motore, massimi di TWS/raffica/onda lungo la traccia (campionati ad ogni passo). Isocrone (polilinee) opzionali per la visualizzazione.

### 6.7 Finestra di partenza

- 24 run con t0 = ora intera successiva + k h, k = 0…23; stesso campo meteo caricato una sola volta nel worker.
- Criterio "migliore" proposto: **durata minima** tra i run che rispettano limiti opzionali (raffica max, onda max, ore di motore max impostabili dall'utente); a parità (±5 %) meno ore di motore. Da confermare.

### 6.8 Obiettivi di prestazione

- Rotta singola ~100 NM: < 3 s su smartphone di fascia media.
- Finestra di 24 run: < 60 s, interfaccia sempre reattiva, annullabile.

---

## 7. Linea di costa

### 7.1 Fonte

OSM land polygons (osmdata.openstreetmap.de, versione "split", WGS84, licenza ODbL → attribuzione "© OpenStreetMap contributors" obbligatoria nell'app).

### 7.2 Preparazione (offline, una tantum)

1. Ritaglio sulla BBOX + margine 0.2°.
2. Semplificazione con tolleranza ~20–30 m (da tarare: bilanciare dimensione file e canali stretti tra le isole).
3. Esclusione isole/scogli sotto un'area minima (da decidere; proposta: tenere tutto ciò che è > 0.01 km², gli scogli più piccoli restano un limite noto).
4. Esportazione in GeoJSON con coordinate arrotondate a 5 decimali (~1 m), eventualmente suddivisa in tasselli 1°×1° caricabili su richiesta.
5. Procedura documentata in `tools/coastline/README.md` (strumenti: ogr2ogr/mapshaper, eseguiti a mano, non parte dell'app). Dimensione obiettivo: < 3 MB compressi.

### 7.3 Uso nel worker

- Indice spaziale a griglia (celle 0.05°): ogni cella elenca i segmenti di costa che la toccano, più un flag "tutta terra / tutta mare / mista".
- Test segmento-terra: celle attraversate dal segmento → intersezione con i soli segmenti di costa delle celle miste; celle "tutta terra" → scarto immediato.
- Test punto-in-terra (spostamento di partenza/arrivo): ray casting sui poligoni delle celle vicine.
- Margine di sicurezza dalla costa opzionale (buffer, default 0) — vedi Domande aperte.

---

## 8. Limiti noti

- **Open-Meteo (piano gratuito)**: solo uso **non commerciale**; limiti indicativi 600 chiamate/min, 5 000/h, 10 000/giorno **per IP**; le richieste con molte coordinate o molte variabili sono conteggiate come più chiamate (peso da verificare). Un aggiornamento completo (griglia panoramica × 3 modelli + onda + corridoio) può pesare nell'ordine delle migliaia di chiamate equivalenti → cache aggressiva, modelli caricati su richiesta, corridoio solo al calcolo. Uso commerciale = piano a pagamento.
- **Supabase (piano gratuito)**: progetto **messo in pausa dopo 7 giorni senza attività** (riattivazione manuale dalla dashboard; in pausa login e salvataggi non funzionano → l'app deve restare utilizzabile per mappa/meteo e mostrare un errore chiaro); 500 MB di database; invio email di autenticazione con SMTP integrato fortemente limitato (poche email/ora) → per uso reale serve SMTP proprio.
- **Risoluzione meteo**: anche ICON-2I (~2.2 km) non risolve tutti gli effetti locali (bora nei canali, rinforzi di capo, brezze); ECMWF e GFS molto più grossolani. La griglia di campionamento aggiunge un'ulteriore interpolazione.
- **Onda vicino a costa**: dati mancanti o poco affidabili sotto costa e nei canali tra le isole.
- **Linea di costa**: semplificata; non considera fondali, secche, scogli piccoli, zone interdette, parchi marini, dighe e porti.
- **Polari**: le ORC sono teoriche (barca da regata, equipaggio esperto, mare piatto); correttivi e assenza dell'effetto onda rendono le durate stime ottimistiche.
- **Correnti**: non considerate.
- **GitHub Pages**: nessun backend, nessuna variabile segreta; tutte le chiamate partono dal browser.
- **iOS**: limiti di storage e di esecuzione in background per le PWA; il calcolo si interrompe se l'app va in background.

---

## 9. Domande aperte

**Hosting e progetto**
1. Il repository si chiama `Meteo-`: GitHub Pages lo pubblicherebbe su `/Meteo-/`, non `/meteo/`. Come si ottiene `/meteo/`? (rinominare il repo in `meteo`, cartella `meteo/` dentro il repo del sito utente `<utente>.github.io`, dominio personalizzato?) I percorsi relativi funzionano comunque, ma serve per il `redirect` di Supabase Auth e lo `scope` del service worker.
2. Uso solo personale o anche di altre persone? Possibile uso commerciale (cambia le condizioni Open-Meteo)?

**Meteo**
3. Mappa base: OSM standard (policy d'uso restrittiva), CARTO, Esri Ocean, altro? Overlay OpenSeaMap sì/no?
4. "GFS come confronto": basta poterlo selezionare come modello, o vuoi un confronto esplicito (due modelli affiancati, differenza, rotta calcolata con entrambi)?
5. Orizzonte massimo da mostrare/usare per il routing (ECMWF arriva a ~10–15 giorni, ma oltre 5 giorni ha poco senso per il routing)?
6. Passo della griglia: accetti 0.25° per la mappa panoramica e una griglia fine solo nel corridoio di rotta, per restare nelle quote?
7. Onda: basta l'onda totale o vuoi anche onda da vento e swell separati come layer?

**Polari e barca**
8. Regola motore: va applicata **per prua** (in zona morta o con poco vento su quella prua si va a motore → anche controvento diretto) oppure solo quando **nessuna** prua a vela supera X nodi (calma)? Cambia molto il risultato di bolina.
9. Set "vele bianche": come lo otteniamo se la fonte è ORC? (derivato con riduzione automatica nelle portanti / inserito a mano / copia del full da modificare)
10. Quale set usa il routing: scelto dall'utente per ogni calcolo, oppure passaggio automatico (es. vele bianche sopra una certa TWS)?
11. Soglia bolina/portanti fissa a 90° TWA o configurabile per barca? Correttivo a gradino o raccordato?
12. Vuoi una penalità per virate/strambate? Limiti di sicurezza (vento max, raffica max, onda max) che rendano un tratto **non navigabile** per il routing, oltre che come filtri nella finestra di partenza?
13. Vuoi una riduzione della velocità in funzione dell'onda (es. % per metro d'onda di prua)?

**Routing**
14. Distanza minima dalla costa da mantenere (es. 0.2 NM) o solo "non attraversare la terra"?
15. Isole/scogli minimi: va bene ignorare quelli sotto ~0.01 km² (≈ 100 × 100 m)?
16. Criterio di "partenza migliore": durata minima? minimo motore? punteggio combinato con pesi tuoi?
17. Correnti: escluse anche in futuro, o da prevedere (Open-Meteo Marine fornisce le correnti superficiali)?
18. Punti di passaggio intermedi (waypoint obbligati) servono?

**Account e dati**
19. Metodo di login: magic link via email, email+password, Google? (il magic link con SMTP gratuito Supabase è limitato)
20. Senza login l'app deve permettere di usare barche e routing salvando in locale (IndexedDB), con sincronizzazione al login? Oppure login obbligatorio per barche/rotte?
21. Il progetto Supabase esiste già? Mi servono URL e chiave anon (pubblica) quando arriviamo alla fase 2. Chi applica le migrazioni SQL?
22. Le rotte salvate vanno condivise (link pubblico in sola lettura)? Cambierebbe le policy RLS.

**Dati esterni**
23. Licenza/condizioni dei dati ORC (jieter/orc-data): uso personale ok? Per un'app pubblica va verificato.
