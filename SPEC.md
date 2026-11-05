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

**Utenti**: uso personale e di pochi amici/equipaggio (2–4 persone), **non commerciale**. Ogni utente ha il proprio account e i propri dati.

**Escluso da questa versione (fasi 1–4)**: file GRIB, AIS, tracciamento in tempo reale, notifiche push, integrazione con strumenti di bordo (NMEA), condivisione di rotte dentro l'app.

**Previsto dopo le fasi 1–4**: esportazione del routage per condivisione e consultazione offline (PDF/JPG/altro, da definire); confronto esplicito tra modelli (stessa rotta calcolata con due modelli, sovrapposta).

---

## 2. Requisiti funzionali

### 2.1 Mappa

- Mappa Leaflet a tutto schermo, centrata su `BBOX`, con limiti di pan (`maxBounds` = BBOX + margine).
- Mappa base: **CARTO chiara** (predefinita) o **OpenStreetMap** standard; overlay **OpenSeaMap** (segnalamenti) attivabile. CARTO richiede una chiave gratuita (`CARTO_BASEMAPS_KEY` in `config.js`, parametro `key` nelle URL delle tile): senza chiave il menu offre solo OpenStreetMap, che diventa la predefinita.
- **Menu laterale a scomparsa** con: mappa base, overlay, layer meteo (vento, onda totale, onda da vento, swell, correnti), modello, opacità.
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
- Tre layer attivabili dal menu: **onda totale**, **onda da vento**, **swell** (ciascuno con altezza, direzione, periodo).
- Layer **correnti** superficiali (velocità in nodi e direzione di destinazione), da fase 3.

### 2.4 Cursore temporale e modello

- Cursore orario dall'ora corrente fino a **+5 giorni** (orizzonte massimo per mappa e routing); pulsanti ±1 h, ±1 giorno, "play".
- Orari mostrati in ora locale `Europe/Rome`; internamente tutto in UTC.
- Selettore modello:
  - **Auto** (predefinito): ICON-2I per le prime 72 h, ECMWF oltre.
  - **ICON-2I** (solo).
  - **ECMWF** (solo).
  - **GFS** (selezionabile come gli altri; confronto esplicito previsto dopo le fasi 1–4).
- Indicazione visibile del modello effettivo per l'ora selezionata e dell'orario di emissione (run) del dato.

### 2.5 Barche e polari

- Elenco barche dell'utente; una barca attiva alla volta.
- Creazione barca da:
  1. **Importazione ORC** da `https://jieter.github.io/orc-data/site/` (ricerca per nome, numero velico, nazione).
  2. **Inserimento manuale** (tabella editabile TWA × TWS).
  3. **Importazione CSV** (formato in §5.3).
- Due set di polari: **full** (con spi/gennaker) e **vele bianche**. Le vele bianche si ricavano in automatico dalla full (§5.2); in alternativa si può inserire una polare vele bianche propria.
- **Correttivi nella pagina profilo** (valori dell'utente, modificabili, applicati a tutte le sue barche):
  - **efficienza crociera** in % della polare, separata per **bolina** (TWA < 90°) e **portanti** (TWA ≥ 90°); default **80 %** (−20 %: una barca da crociera rende meno della stessa barca in configurazione da regata del certificato ORC);
  - **riduzione vele bianche** nelle portanti, default **50 %**, che si moltiplica all'efficienza → con i default le portanti a vele bianche valgono 80 % × 50 % = **40 %** della polare ORC;
  - **soglia motore** con due modalità a scelta (§5.2):
    - **"Soglia velocità"**: motore se la migliore velocità a vela possibile è sotto *X* nodi;
    - **"Soglia VMG"**: motore se la migliore VMG a vela verso l'arrivo (o verso il prossimo waypoint, se la rotta ne ha) è sotto *X* nodi (es. controvento, bolina a 7 kn ma VMG 4 kn, soglia 3 → si resta a vela; VMG 2.5 → motore);
  - valori ammessi: efficienza 30–120 %, riduzione vele bianche 20–100 %, soglia 0–10 kn.
- Per ogni barca: **velocità a motore** *Y* (nodi) e flag "applica efficienza crociera" (default sì per barche ORC, no per polari manuali/CSV, che si presume siano già quelle reali).
- Anteprima grafica della polare (diagramma polare, una curva per TWS) con i correttivi applicati, full e vele bianche a confronto.

### 2.6 Routing

- Input: partenza, arrivo, eventuali **waypoint intermedi**, ora di partenza, barca, set di polari (**scelto dall'utente a ogni calcolo**: full / vele bianche), modello.
- **Partenza**: tocco su mappa oppure posizione GPS (`navigator.geolocation`). **Arrivo** e **waypoint**: tocco su mappa. Marcatori trascinabili; waypoint riordinabili ed eliminabili.
- **Correnti** superficiali incluse nel calcolo (§6.2).
- **Limiti** opzionali di vento, raffica e onda (profilo, disattivati di default): il routing evita le zone oltre limite.
- **Margine dalla costa** 0.3 NM (profilo, regolabile).
- **Motore vicino a terra** (profilo, disattivato di default): sotto *D* NM dalla terra si procede a motore.
- **Avvisi sulla rotta** (tratti evidenziati + riepilogo):
  - onda oltre l'altezza di avviso impostata nel profilo;
  - **attendibilità ridotta** nei tratti a meno di *A* NM dalla costa o tra le isole (default 1 NM): traffico e orografia locale rendono il routage poco affidabile.
- Se un punto cade a terra: spostamento automatico al punto di mare più vicino, con avviso.
- Calcolo a isocrone in **Web Worker** (§6), senza bloccare l'interfaccia, con barra di avanzamento e possibilità di annullare.
- Evitamento della terra con linea di costa OSM ad alta risoluzione (§7).
- Output su mappa: rotta, isocrone (opzionali), punti orari con etichette.
- Output tabellare: per ogni passo orario → ora, posizione, rotta vera, velocità, TWS, TWA, raffica, onda, vela/motore.
- Riepilogo: durata, distanza percorsa (NM), ore di motore, vento max, raffica max, onda max, ora di arrivo.

### 2.7 Finestra di partenza

- Una simulazione per ogni ora delle prossime 24 h (24 run), stessa configurazione.
- Grafico (asse X = ora di partenza) con: durata, ore di motore, vento max, raffica max, onda max.
- Tutte le 24 partenze visibili; quattro **categorie** evidenziate (una partenza può averne più di una), poi sceglie l'utente:
  - **Speedy** — durata minima;
  - **Shorty** — distanza minima;
  - **Windy** — meno ore di motore;
  - **Lazy** — navigazione più comoda: meno ore di bolina, onda più bassa (vento in poppa/lasco o motore contano come comodi). Formula in §6.7.
- Le partenze oltre i limiti impostati sono segnate come "fuori limite".
- Tocco su una colonna del grafico → mostra quella rotta su mappa.
- Run eseguiti nel worker in sequenza (o in un pool di 2 worker se `navigator.hardwareConcurrency ≥ 4`), con avanzamento "n/24".

### 2.8 Avviso di sicurezza

- Al primo avvio: finestra modale da accettare esplicitamente ("Ho capito"), memorizzata in locale con versione del testo.
- Testo fisso, sempre visibile, nella barra inferiore: *"Solo pianificazione — non usare per la navigazione"*.
- Ripetuto nel riepilogo di ogni rotta e nella finestra di partenza.
- Testo proposto per la modale:
  > Questa app fornisce stime basate su modelli meteorologici e sulle polari che hai inserito. Le previsioni possono essere sbagliate, la linea di costa è semplificata e non sono considerati fondali, ostacoli, correnti, traffico, zone vietate o condizioni locali. Usala solo per pianificare. Le decisioni in mare spettano allo skipper, sulla base dei bollettini ufficiali e delle carte nautiche.

### 2.9 Account e dati utente

- Login con Supabase Auth: **email + password** e **Google** (OAuth).
- **Login obbligatorio** per tutto ciò che si salva: impostazioni del profilo, barche, polari, rotte (con eventuale finestra di partenza). Senza login si consultano solo mappa e meteo.
- Row Level Security su tutte le tabelle (§4).
- Pagina **profilo**: nome, correttivi polari e soglia motore (§2.5), preferenze (modello, layer).
- Nessuna condivisione dentro l'app: per condividere e consultare offline si userà l'**esportazione del routage** (PDF, JPG o altro), da definire dopo le fasi 1–4.

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
| Vento 0–72 h | Forecast API | ICON-2I (ItaliaMeteo-ARPAE, ~2.2 km): `italia_meteo_arpae_icon_2i` | Ultima ora valida ricavata dai dati (valori non nulli). |
| Vento > 72 h | Forecast API | ECMWF IFS 9 km: `ecmwf_ifs` | Fino a +5 giorni. Run 00/06/12/18 UTC. |
| Confronto | Forecast API | GFS 0.25°: `gfs025` | |
| Onda e correnti | Marine API | modello predefinito (best match) | `wave_*`, `wind_wave_*`, `swell_wave_*` (altezza, direzione, periodo); `ocean_current_velocity`, `ocean_current_direction`. |

Variabili vento: `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, con `wind_speed_unit=kn`, `timezone=GMT`, `timeformat=unixtime` e `cell_selection=sea` (cella di mare più vicina: evita valori ridotti dall'orografia).

**Ultimo run disponibile**: `https://api.open-meteo.com/data/<modello>/static/meta.json` (`marine-api.` per l'onda), campo `last_run_initialisation_time`; nomi: `italia_meteo_arpae_icon_2i`, `ecmwf_ifs`, `ncep_gfs025`, `meteofrance_wave` (onda). File statico, non pesa sulla quota.

**Griglia di campionamento** (Open-Meteo restituisce punti, non campi):

- **Griglia panoramica** per la mappa: passo 0.25° sulla BBOX (25 × 32 = 800 punti), ridotta ai soli punti di mare (+ un anello di punti costieri) → stima ≈ 400–450 punti. Finché la linea di costa non è disponibile (fase 3), la maschera mare si ricava dalla prima richiesta Marine sull'intera griglia (punti con onda sempre nulla = terra) e resta in cache senza scadenza.
- **Griglia di corridoio** per il routing: passo fine (0.05°–0.1°, da tarare) solo nel corridoio tra partenza e arrivo (ellisse con fuochi in partenza/arrivo e margine). Necessaria per risolvere i canali tra le isole croate e gli effetti locali di ICON-2I.
- Richieste con più coordinate per chiamata (liste `latitude`/`longitude` separate da virgola), suddivise in blocchi (dimensione da tarare per lunghezza URL e peso in quota); blocchi da 100 punti. **Limitatore** a finestra mobile: al massimo 500 chiamate/min (ogni punto = 1 chiamata; limite gratuito 600/min); su errore 429 "Minutely" si attende un minuto e si riprova. Il primo avvio (maschera + onda 800 punti, vento Auto ~680) richiede quindi circa 2 minuti, con conto alla rovescia visibile; i successivi usano la cache.
- Memorizzazione in `Float32Array` per variabile, indicizzate `[t][y][x]`; componenti vento convertite in `u`,`v` per l'interpolazione (la direzione non si interpola direttamente).
- **Modello Auto**: fusione lato client — per ogni ora t si usa ICON-2I se t ≤ ultima ora valida di ICON-2I, altrimenti ECMWF. Possibile discontinuità al passaggio: segnalata sul cursore temporale.
- **Punti costieri senza onda**: il modello marino può restituire `null` vicino a costa; si usa il valore valido più vicino (max 2 celle), altrimenti "n.d.".

**Cache**: IndexedDB, chiave = (modello, griglia, run). Nuovo download **solo quando è disponibile un run più recente** (orari dei run per modello in `config.js`); pulsante "aggiorna" manuale.

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
| `upwind_eff_pct` | numeric(5,1) | efficienza crociera in bolina, default 80, `check between 30 and 120` |
| `downwind_eff_pct` | numeric(5,1) | efficienza crociera nelle portanti, default 80, `check between 30 and 120` |
| `white_downwind_pct` | numeric(5,1) | riduzione vele bianche nelle portanti, default 50, `check between 20 and 100` |
| `split_twa_deg` | numeric(4,1) | confine bolina/portanti, default 90 |
| `motor_mode` | text | `check in ('speed','vmg')`, default `'vmg'` |
| `motor_threshold_kn` | numeric(4,1) | soglia X, default 3.0 |
| `motor_near_land` | boolean | motore sotto una distanza da terra, default `false` |
| `motor_near_land_nm` | numeric(4,2) | distanza D, default 0.5 |
| `coast_margin_nm` | numeric(4,2) | margine dalla costa, default 0.3 |
| `coast_warning_nm` | numeric(4,2) | distanza per avviso "attendibilità ridotta", default 1.0 |
| `wave_warning_m` | numeric(4,1) | altezza onda di avviso, default 2.0 |
| `limit_tws_kn`, `limit_gust_kn`, `limit_wave_m` | numeric | limiti di navigabilità, nullable (null = disattivato) |
| `settings` | jsonb | default `{}` (layer attivi, modello preferito, criteri finestra) |
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
| `apply_efficiency` | boolean | applica l'efficienza crociera del profilo; default `true` se `source = 'orc'`, altrimenti `false` |
| `motor_speed_kn` | numeric(4,1) | velocità a motore Y, default 6.0 |
| `tack_penalty_s` | int | penalità virata/strambata, default 0 (vedi §6.5) |
| `created_at`, `updated_at` | timestamptz | |

### 4.3 `polars`

| Campo | Tipo | Vincoli / note |
|---|---|---|
| `id` | uuid | PK |
| `boat_id` | uuid | FK → `boats.id`, `on delete cascade`, `not null` |
| `user_id` | uuid | FK → `auth.users.id`, `not null`, default `auth.uid()` (denormalizzato per RLS semplice) |
| `kind` | text | `check in ('full','white')`; la riga `white` è facoltativa (se manca, vele bianche derivate dalla full) |
| `data` | jsonb | polare nel formato interno (§5.1) |
| `source` | text | `orc` / `manual` / `csv` |
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
| `waypoints` | jsonb | array `[{lat, lon}]` intermedi, default `[]` |
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
- **Velocità a vela effettiva** (correttivi del profilo, §4.1):
  - `eff` = `upwind_eff_pct` se TWA < `split_twa_deg`, altrimenti `downwind_eff_pct` (solo se la barca ha `apply_efficiency`, altrimenti 100 %);
  - set full: `bsp = bsp_polare × eff`;
  - set vele bianche senza polare propria: `bsp = bsp_full × eff × white_downwind_pct` per TWA ≥ `split_twa_deg`, uguale al full in bolina;
  - set vele bianche con polare propria: `bsp = bsp_white × eff`.
  - Esempio con i default: portanti a vele bianche = 0.80 × 0.50 = 40 % della polare ORC.
- **Motore**, deciso per ogni punto dell'isocrona (non per singola prua):
  - modalità `speed`: se la massima velocità a vela su tutte le prue < `motor_threshold_kn` → motore;
  - modalità `vmg`: se la massima VMG a vela verso la meta corrente — arrivo o prossimo waypoint — (VMC: `bsp × cos(rotta − rilevamento della meta)`) < `motor_threshold_kn` → motore;
  - a motore: `bsp = motor_speed_kn` su qualsiasi prua (anche controvento); il passo è contato nelle ore di motore.

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
- Set **vele bianche**: non fornito da ORC → derivato con la riduzione del profilo (§5.2); l'utente può sostituirlo con una polare propria.

---

## 6. Algoritmo di routing a isocrone

### 6.1 Ingressi

Partenza P0, waypoint W1…Wn, arrivo P1, ora di partenza t0, polare (set scelto) + correttivi + parametri motore, campo meteo (u, v, raffica, onda, corrente) sulla griglia di corridoio, linea di costa (indice spaziale), parametri:

| Parametro | Default | Note |
|---|---|---|
| Passo temporale Δt | 30 min | 15 min nelle prime 2 h e vicino all'arrivo (da tarare) |
| Passo di prua | 5° | 72 prue per punto, ridotte se fuori settore utile |
| Cella di potatura | 0.5 NM | |
| Max punti per isocrona | 1500 | |
| Durata massima | 120 h (orizzonte di 5 giorni) | |

### 6.2 Espansione

Per ogni punto dell'isocrona corrente (posizione, tempo, prua precedente, stato vela/motore):

1. Si interpola il vento (u, v) nello spazio (bilineare) e nel tempo (lineare) → TWS, TWD.
2. Per ogni prua candidata: TWA, velocità dalla polare con correttivi e regola motore.
3. Corrente: velocità sul fondo = vettore barca (`bsp`, prua) + vettore corrente; nuova posizione = spostamento per `SOG × Δt` lungo `COG` (sottopassi se Δt lungo e il campo varia).
4. Scarto se il segmento interseca la terra o il margine di costa (§7), esce dalla BBOX, o attraversa zone oltre i limiti di vento/raffica/onda impostati.
5. Motore forzato se attivo `motor_near_land` e la distanza da terra < `motor_near_land_nm`.

### 6.3 Potatura

- La potatura classica per settori angolari dalla partenza funziona male con isole e penisole (le rotte che aggirano un ostacolo vengono scartate). Si usa invece una **griglia di celle** (lato 0.5 NM): per ogni cella si tiene solo il punto raggiunto per primo.
- Ulteriore limite: se i punti superano il massimo, si tengono quelli con minore stima "tempo trascorso + distanza residua / velocità massima della polare" (euristica tipo A*).
- Le celle già raggiunte in isocrone precedenti restano bloccate (evita di tornare indietro).

### 6.4 Arrivo e waypoint

- Con waypoint il calcolo procede **a tratti**: P0→W1, W1→W2, …, Wn→P1; ogni tratto parte all'ora d'arrivo del precedente. La "meta corrente" per la regola motore VMG è il punto di arrivo del tratto.


- Quando un segmento passa entro `bsp × Δt` da P1 si calcola il tempo esatto di arrivo diretto a P1 (se il segmento verso P1 non interseca terra).
- Si completa l'isocrona corrente e si sceglie l'arrivo più rapido; ricostruzione della traccia tramite puntatori al genitore.
- Nessun arrivo entro la durata massima → errore "Rotta non trovata entro l'orizzonte meteo".

### 6.5 Dettagli

- Penalità virata/strambata: se il lato del vento cambia tra genitore e figlio si aggiunge `tack_penalty_s` (default 0, quindi disattivata).
- Passaggio vela ↔ motore senza penalità.
- Onda: **nessuna riduzione di velocità**; registrata per statistiche e avvisi (soglia `wave_warning_m`).
- Avviso "attendibilità ridotta": punti a distanza da terra < `coast_warning_nm`.
- Nessuna penalità per virate/strambate.
- Distanze: formula dell'haversine / ortodromia su sfera di raggio 3440.065 NM.

### 6.6 Uscita

Traccia = array di punti `{t, lat, lon, heading, bsp, cog, sog, tws, twd, twa, gust, wave_h, wave_dir, wave_per, cur_kn, cur_dir, motor, dist_land_nm, warn}`; riepilogo: durata, distanza, ore di motore, massimi di TWS/raffica/onda lungo la traccia (campionati ad ogni passo). Isocrone (polilinee) opzionali per la visualizzazione.

### 6.7 Finestra di partenza

- 24 run con t0 = ora intera successiva + k h, k = 0…23; stesso campo meteo caricato una sola volta nel worker.
- Per ogni run: durata, distanza, ore di motore, ore di bolina (a vela con TWA < `split_twa_deg`), vento/raffica/onda massimi, flag "fuori limite".
- Categorie, calcolate tra i run non fuori limite:
  - **Speedy**: `duration_h` minima;
  - **Shorty**: `distance_nm` minima;
  - **Windy**: `motor_h` minime (a parità, durata minore);
  - **Lazy**: punteggio di disagio minimo = ore di bolina / durata + `max_wave_m` / `wave_warning_m` (pesi da tarare; vento in poppa/lasco e motore non pesano).

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
3. **Si tengono tutte le isole e gli scogli** presenti in OSM.
4. Esportazione in GeoJSON con coordinate arrotondate a 5 decimali (~1 m), **suddivisa in tasselli 1°×1°** caricati su richiesta (mappa visibile, corridoio della rotta).
5. Procedura documentata in `tools/coastline/README.md` (strumenti: ogr2ogr/mapshaper, eseguiti a mano, non parte dell'app). Dimensione obiettivo: tassello medio < 500 KB compresso.

### 7.3 Uso nel worker

- Indice spaziale a griglia (celle 0.05°): ogni cella elenca i segmenti di costa che la toccano, più un flag "tutta terra / tutta mare / mista".
- Test segmento-terra: celle attraversate dal segmento → intersezione con i soli segmenti di costa delle celle miste; celle "tutta terra" → scarto immediato.
- Test punto-in-terra (spostamento di partenza/arrivo): ray casting sui poligoni delle celle vicine.
- Margine dalla costa (`coast_margin_nm`, default 0.3 NM) e distanza da terra per avvisi/motore: calcolati sulla distanza punto-segmento dalla costa più vicina (celle vicine dell'indice).

---

## 8. Limiti noti

- **Open-Meteo (piano gratuito)**: solo uso **non commerciale**; limiti indicativi 600 chiamate/min, 5 000/h, 10 000/giorno **per IP**; le richieste con molte coordinate o molte variabili sono conteggiate come più chiamate (peso da verificare). Un aggiornamento completo (griglia panoramica × 3 modelli + onda + corridoio) può pesare nell'ordine delle migliaia di chiamate equivalenti → cache aggressiva, modelli caricati su richiesta, corridoio solo al calcolo. Uso commerciale = piano a pagamento.
- **Supabase (piano gratuito)**: progetto **messo in pausa dopo 7 giorni senza attività** (riattivazione manuale dalla dashboard; in pausa login e salvataggi non funzionano → l'app deve restare utilizzabile per mappa/meteo e mostrare un errore chiaro); 500 MB di database; invio email di autenticazione con SMTP integrato fortemente limitato (poche email/ora) → per uso reale serve SMTP proprio.
- **Risoluzione meteo**: anche ICON-2I (~2.2 km) non risolve tutti gli effetti locali (bora nei canali, rinforzi di capo, brezze); ECMWF e GFS molto più grossolani. La griglia di campionamento aggiunge un'ulteriore interpolazione.
- **Onda vicino a costa**: dati mancanti o poco affidabili sotto costa e nei canali tra le isole.
- **Linea di costa**: semplificata; non considera fondali, secche, scogli piccoli, zone interdette, parchi marini, dighe e porti.
- **Polari**: le ORC sono teoriche (barca da regata, equipaggio esperto, mare piatto); correttivi e assenza dell'effetto onda rendono le durate stime ottimistiche.
- **Correnti**: solo superficiali, a bassa risoluzione; nei canali stretti poco affidabili.
- **GitHub Pages**: nessun backend, nessuna variabile segreta; tutte le chiamate partono dal browser.
- **iOS**: limiti di storage e di esecuzione in background per le PWA; il calcolo si interrompe se l'app va in background.

---

## 9. Decisioni (ex domande aperte)

Tutte le domande sono state chiuse il 2026-11-04. Numeri mantenuti perché richiamati da PIANO.md.

| # | Tema | Decisione |
|---|---|---|
| 1 | Indirizzo | `pompiliipierluigi-byte.github.io/meteo/` |
| 2 | Utenti | Tu + amici/equipaggio (2–4), non commerciale |
| 3 | Mappa | CARTO chiara predefinita (con chiave CARTO Basemaps; senza chiave OSM), OSM alternativa, OpenSeaMap attivabile; menu laterale a scomparsa |
| 4 | GFS | Selezionabile subito; confronto rotte tra modelli dopo le fasi 1–4 |
| 5 | Orizzonte | 5 giorni per mappa e routing (Auto: ICON-2I 0–72 h, ECMWF oltre) |
| 6 | Griglia | Larga (~0.25°) per la mappa, fine solo nel corridoio della rotta; download solo a nuovo run |
| 7 | Onda | Layer separati: totale, da vento, swell |
| 8 | Motore | Modalità "Soglia velocità" / "Soglia VMG" (VMG verso arrivo o prossimo waypoint), default VMG |
| 9 | Vele bianche | Derivate: efficienza crociera 80 % × vele bianche 50 % nelle portanti = 40 %, nel profilo |
| 10 | Set vele | Scelto dall'utente a ogni calcolo |
| 11 | Correttivi | Nel profilo; confine bolina/portanti 90° regolabile |
| 12 | Limiti e virate | Limiti vento/raffica/onda opzionali (il routing li evita); nessuna penalità virate |
| 13 | Onda e velocità | Nessuna riduzione; avviso se l'onda supera l'altezza impostata |
| 14 | Costa | Margine 0.3 NM regolabile; avviso "attendibilità ridotta" vicino a costa/isole; opzione motore sotto D NM da terra |
| 15 | Scogli | Tenuti tutti; costa a tasselli 1°×1° |
| 16 | Finestra | Tutte le partenze visibili; categorie Speedy, Shorty, Windy, Lazy |
| 17 | Correnti | Incluse nel routing dalla fase 3, con layer sulla mappa |
| 18 | Waypoint | Sì, in fase 3, calcolo a tratti |
| 19 | Login | Email + password e Google |
| 20 | Senza login | Solo mappa e meteo; login obbligatorio per profilo, barche, polari, rotte |
| 21 | Supabase | Progetto da creare in fase 2; SQL nel repo con guida passo passo (`supabase/README.md`) |
| 22 | Condivisione | Nessuna nell'app; si useranno le esportazioni |
| 23 | Dati ORC | Uso non commerciale tra pochi utenti: ok |

### Da verificare in sviluppo (non servono tue risposte)

- ~~Identificativi esatti dei modelli Open-Meteo, orizzonte di ICON-2I, risoluzione ECMWF.~~ Verificati in fase 1 (§3.4).
- Peso in quota delle richieste multi-punto Open-Meteo.
- Struttura dei file di orc-data.
- Pesi del punteggio "Lazy" (proposta da validare sui primi casi reali).
