# Linea di costa

Tasselli 1°×1° con i poligoni di terra OpenStreetMap usati per evitare la terra nel routing e per i test
terra/mare (SPEC §7). Dati © OpenStreetMap contributors, licenza **ODbL**: l'attribuzione è visibile nell'app.

## Generazione (automatica)

La procedura gira su GitHub Actions (`.github/workflows/coastline.yml`):

1. scarica `land-polygons-split-4326.zip` da https://osmdata.openstreetmap.de (≈ 900 MB) e ritaglia sull'area
   dell'app più 0.2° (lat 39.6–46.0, lon 11.8–19.9) con `ogr2ogr`;
2. se osmdata non risponde (succede anche da GitHub), prende le vie `natural=coastline` dagli estratti **Geofabrik**
   dei paesi costieri (Italia nord-est/centro/sud, Slovenia, Croazia, Bosnia, Montenegro, Albania) con `osmium`
   (ultima alternativa: **Overpass** a blocchi) e ricostruisce i poligoni di terra con `land-from-coastline.py` (le linee di costa ritagliate e il bordo dell'area
   si dividono in facce; una faccia è terra se la costa più vicina la lascia a sinistra, convenzione OSM);
3. esegue `make-tiles.py`, che per ogni tassello unisce i poligoni (la versione *split* è divisa in quadrati),
   semplifica con tolleranza ~20 m mantenendo la topologia, arrotonda a 5 decimali (~1 m) e tiene tutte
   le isole e gli scogli;
4. salva `data/coastline/<lat>_<lon>.geojson` e `data/coastline/index.json` sul ramo.

Si avvia da **Actions → Linea di costa → Run workflow** (si può cambiare la tolleranza) oppure con un push che
modifica questa cartella. Per aggiornare la costa basta rilanciarlo.

## Generazione a mano

Con GDAL e Python 3 + shapely ≥ 2:

```sh
curl -LO https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip && unzip land-polygons-split-4326.zip
ogr2ogr -f GeoJSON -spat 11.8 39.6 19.9 46.0 -clipsrc 11.8 39.6 19.9 46.0 land.geojson land-polygons-split-4326/land_polygons.shp
python3 tools/coastline/make-tiles.py land.geojson data/coastline 20
```

## Formato

- `<lat>_<lon>.geojson`: angolo sud-ovest del tassello; un `MultiPolygon` con la terra ritagliata sul tassello.
  I lati che giacciono sul bordo del tassello sono dovuti al ritaglio e **non sono costa**: `js/routing/land.js`
  li ignora nei test di attraversamento e nelle distanze.
- `index.json`: per ogni tassello `id`, `bounds` [lon_min, lat_min, lon_max, lat_max], `kind`
  (`sea` = nessuna terra, nessun file; `land` = tutto terra, nessun file; `mixed` = file presente),
  numero di poligoni e vertici, dimensione.

Obiettivo: tassello medio < 500 KB compresso (SPEC §7.2).

## Note

- Laguna di Venezia e lagune chiuse dai lidi: in OSM sono acqua interna, quindi "terra" per il routing.

## Fonti scartate

- `@geo-maps/earth-lands-10m` (npm): troppo semplificata per i canali tra le isole (segmento mediano ~600 m,
  22 poligoni nel tassello di Spalato).
