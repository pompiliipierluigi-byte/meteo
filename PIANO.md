# Piano di sviluppo a fasi

Riferimenti: [SPEC.md](SPEC.md) per i requisiti, [CLAUDE.md](CLAUDE.md) per convenzioni e struttura. Ogni passo numerato = **un commit**. Le fasi partono solo dopo la risposta alle Domande aperte che le riguardano (SPEC §9).

---

## Fase 1 — Mappa + meteo

**Obiettivo**: PWA installabile con mappa dell'Adriatico, layer vento e onda, cursore temporale e scelta del modello, avviso di sicurezza.

**Domande da chiudere prima**: 1, 3, 4, 5, 6, 7.

**Passi**
1. Scheletro PWA: `index.html`, `manifest.webmanifest`, `sw.js` (shell), `css/app.css`, icone, `js/main.js`, `js/config.js`.
2. Avviso di sicurezza (modale + barra fissa): `js/ui/disclaimer.js`, `js/i18n/it.js`.
3. Mappa Leaflet con BBOX, mappa base e attribuzioni: `vendor/leaflet/`, `js/map/map.js`.
4. Client Open-Meteo Forecast + Marine, griglia panoramica, conversione u/v: `js/weather/openmeteo.js`, `js/weather/grid.js`.
5. Cache IndexedDB dei dati meteo: `js/weather/cache.js`, `js/lib/idb.js`.
6. Fusione modello Auto (ICON-2I → ECMWF), selettore modello: `js/weather/models.js`, `js/ui/model-picker.js`.
7. Cursore temporale: `js/ui/time-slider.js`.
8. Layer vento: campo colorato, frecce, particelle: `js/map/wind-field.js`, `js/map/wind-arrows.js`, `js/map/wind-particles.js`, `js/map/colors.js`.
9. Layer onda (altezza, direzione, periodo) e legenda: `js/map/wave-layer.js`, `js/ui/legend.js`.
10. Sonda al tocco: `js/ui/probe.js`.
11. Service worker: cache dati meteo e modalità offline con banner.

**Fatto quando**
- L'app pubblicata su GitHub Pages si apre dal sottopercorso, è installabile (Lighthouse PWA senza errori bloccanti) e funziona con percorsi relativi.
- L'avviso compare al primo avvio e resta visibile nella barra.
- Vento (3 rappresentazioni) e onda si aggiornano al cambio di ora e modello; il modello effettivo e il run sono indicati.
- La sonda mostra valori coerenti con una chiamata manuale a Open-Meteo sullo stesso punto (scarto dovuto solo all'interpolazione).
- Un secondo avvio entro la validità della cache non fa nuove chiamate; offline si vede l'ultima previsione con banner.
- Animazione particelle fluida (≥ 30 fps) su smartphone di fascia media.

---

## Fase 2 — Barche e polari

**Obiettivo**: login, gestione barche e polari (ORC, manuale, CSV) salvate su Supabase.

**Domande da chiudere prima**: 2, 10, 19, 21, 23 (8, 9, 11, 20 decise).

**Passi**
1. Migrazione SQL: `profiles`, `boats`, `polars`, trigger, policy RLS: `supabase/migrations/0001_init.sql`.
2. Client Supabase e login/logout: `vendor/supabase/`, `js/data/supabase.js`, `js/ui/auth.js`.
3. Modello polare (formato interno, interpolazione, efficienza crociera, vele bianche derivate, regola motore "Soglia velocità"/"Soglia VMG"): `js/boats/polar.js` + test `tests/polar.test.js`.
4. Importazione/esportazione CSV con validazione: `js/boats/polar-csv.js` + test.
5. Importazione ORC (indice, ricerca, conversione): `js/boats/orc.js`.
6. CRUD barche e polari: `js/data/boats-repo.js`.
7. Interfaccia barche: elenco, form, tabella polare editabile, correttivi, motore: `js/ui/boats-panel.js`, `js/ui/polar-table.js`.
8. Pagina profilo: correttivi polari, soglia motore, preferenze: `js/ui/profile-panel.js`, `js/data/profile-repo.js`.
9. Diagramma polare in SVG (full e vele bianche a confronto): `js/ui/polar-chart.js`.

**Fatto quando**
- Due utenti di prova non vedono né modificano i dati l'uno dell'altro (verificato con chiamate dirette all'API REST con la chiave anon).
- Una barca ORC importata riproduce le velocità della fonte nei nodi della tabella (test).
- Un CSV di esempio (qtVlm/Expedition) si importa e riesporta identico; errori segnalati con riga/colonna.
- Con i default del profilo una polare ORC risulta all'80 % e le portanti a vele bianche al 40 % (test); modificando i valori nel profilo il diagramma si aggiorna subito.
- Con Supabase in pausa/irraggiungibile l'app mostra un errore chiaro e la mappa meteo resta utilizzabile.

---

## Fase 3 — Routing

**Obiettivo**: rotta a isocrone in Web Worker con evitamento della terra.

**Domande da chiudere prima**: 12, 13, 14, 15, 17, 18.

**Passi**
1. Preparazione linea di costa (procedura documentata, file dati): `tools/coastline/README.md`, `data/coastline/*.geojson`.
2. Indice spaziale e test terra/mare: `js/routing/land.js` + test.
3. Geodesia (haversine, spostamento, rotta): `js/routing/geo.js` + test.
4. Griglia meteo di corridoio e interpolazione spazio-tempo: `js/weather/corridor.js`, `js/routing/interp.js` + test.
5. Motore isocrone: `js/routing/isochrone.js` + test su casi sintetici (vento costante, ostacolo a isola).
6. Worker e protocollo messaggi (avvio, avanzamento, annulla, risultato): `js/routing/worker.js`, `js/routing/client.js`.
7. Selezione partenza (tocco/GPS) e arrivo (tocco), spostamento a mare: `js/ui/route-points.js`.
8. Visualizzazione rotta, isocrone, tabella e riepilogo: `js/map/route-layer.js`, `js/ui/route-panel.js`.

**Fatto quando**
- Con vento costante sintetico la rotta coincide con l'ottimo teorico (VMG di bolina/poppa) entro il 2 %.
- Nessuna traccia attraversa la terra in un set di prova di rotte (es. Ancona→Zara, Pescara→Vis, Spalato→Lastovo tra le isole, Trieste→Pola, Brindisi→Dubrovnik).
- Rotta Ancona→Zara (~85 NM) calcolata in < 3 s su smartphone di fascia media, interfaccia reattiva, annullabile.
- Riepilogo (durata, distanza, ore motore, massimi) coerente con la tabella dei passi.

---

## Fase 4 — Finestra di partenza e rotte salvate

**Obiettivo**: confronto delle 24 partenze orarie e salvataggio delle rotte.

**Domande da chiudere prima**: 16, 22.

**Passi**
1. Migrazione SQL: tabella `routes` + RLS: `supabase/migrations/0002_routes.sql`.
2. Esecuzione dei 24 run nel worker (eventuale pool da 2), avanzamento, annulla: `js/routing/departure-window.js`.
3. Criterio di scelta e filtri utente: `js/routing/best-departure.js` + test.
4. Grafico SVG della finestra (durata, motore, vento max, raffica max, onda max) con evidenza della migliore e selezione di una colonna: `js/ui/window-chart.js`.
5. Salvataggio, elenco, apertura ed eliminazione rotte: `js/data/routes-repo.js`, `js/ui/routes-panel.js`.

**Fatto quando**
- 24 run completati in < 60 s su smartphone di fascia media senza blocchi dell'interfaccia.
- La partenza evidenziata rispetta il criterio e i filtri impostati (test).
- Toccando una colonna si vede la rotta corrispondente.
- Una rotta salvata si riapre identica (traccia e riepilogo) anche dopo modifiche alla barca, grazie alla copia di polare e parametri.
- RLS verificata anche su `routes`.
