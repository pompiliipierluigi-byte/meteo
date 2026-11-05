#!/usr/bin/env python3
"""Linea di costa a tasselli 1°x1° per l'app (SPEC §7.2). Eseguire a mano, non fa parte dell'app.

Ingresso: i "land polygons" OpenStreetMap (versione split, WGS84) di https://osmdata.openstreetmap.de,
ritagliati sull'area e convertiti in GeoJSON con ogr2ogr (vedi README.md e il workflow
.github/workflows/coastline.yml, che esegue tutta la procedura).

Uso (richiede Python 3 e shapely >= 2):
  python3 tools/coastline/make-tiles.py land.geojson data/coastline [tolleranza_m]

Per ogni tassello: unione dei poligoni (la versione "split" è divisa in quadrati), semplificazione con
tolleranza ~20 m (default), arrotondamento a 5 decimali. Si tengono tutte le isole e gli scogli.

Per ogni tassello (file <lat>_<lon>.geojson, lat/lon = angolo sud-ovest) scrive i poligoni di terra
ritagliati sul tassello, coordinate arrotondate a 5 decimali (~1 m). I lati dei poligoni che giacciono sul
bordo del tassello sono artificiali (dovuti al ritaglio) e non sono costa: chi legge i tasselli li ignora.
Scrive anche index.json con l'elenco dei tasselli e le loro proprietà.
"""
import json
import math
import sys
from datetime import date
from pathlib import Path

from shapely import make_valid, set_precision, unary_union
from shapely.geometry import box, mapping, shape, Polygon, MultiPolygon, GeometryCollection
from shapely.strtree import STRtree

BBOX = dict(lat_min=39.8, lat_max=45.8, lon_min=12.0, lon_max=19.7)
MARGIN = 0.2  # SPEC §7.2: BBOX + 0.2°
GRID = 1e-5   # 5 decimali
MIN_AREA_DEG2 = 1e-10  # scarta frammenti degeneri dopo l'arrotondamento (~1 m²)
DEG_PER_M = 1 / 111320


def polygons(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def main(src, out_dir, tol_m=20.0):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    area = box(BBOX['lon_min'] - MARGIN, BBOX['lat_min'] - MARGIN, BBOX['lon_max'] + MARGIN, BBOX['lat_max'] + MARGIN)
    data = json.loads(Path(src).read_text())
    feats = data['features'] if data.get('type') == 'FeatureCollection' else [data]
    land = []
    for f in feats:
        g = f['geometry'] if 'geometry' in f else f
        for p in polygons(shape(g)):
            if p.intersects(area):
                if not p.is_valid:
                    land.extend(q for q in polygons(make_valid(p)))
                else:
                    land.append(p)
    print(f'{len(land)} poligoni nell\'area', file=sys.stderr)
    tree = STRtree(land)
    lat0, lat1 = math.floor(area.bounds[1]), math.ceil(area.bounds[3])
    lon0, lon1 = math.floor(area.bounds[0]), math.ceil(area.bounds[2])
    tiles = []
    for lat in range(lat0, lat1):
        for lon in range(lon0, lon1):
            tb = box(lon, lat, lon + 1, lat + 1).intersection(area)
            if tb.is_empty:
                continue
            pieces = []
            for i in tree.query(tb):
                pieces.extend(polygons(land[i].intersection(tb)))
            merged = unary_union(pieces) if pieces else None
            parts = []
            if merged is not None and not merged.is_empty:
                # Tolleranza in gradi: sulla latitudine del tassello (lon più fitte del fattore cos lat).
                simp = merged.simplify(tol_m * DEG_PER_M, preserve_topology=True)
                for p in polygons(simp):
                    for r in polygons(make_valid(set_precision(p, GRID))):
                        if r.area > MIN_AREA_DEG2:
                            parts.append(r)
            name = f'{lat}_{lon}'
            land_frac = sum(p.area for p in parts) / tb.area
            kind = 'sea' if not parts else ('land' if land_frac > 0.999999 else 'mixed')
            vertices = sum(len(p.exterior.coords) + sum(len(h.coords) for h in p.interiors) for p in parts)
            entry = {
                'id': name,
                'bounds': [round(v, 5) for v in tb.bounds],  # [lon_min, lat_min, lon_max, lat_max]
                'kind': kind,
                'polygons': len(parts),
                'vertices': vertices,
            }
            if kind == 'mixed':
                fc = {
                    'type': 'FeatureCollection',
                    'bbox': entry['bounds'],
                    'features': [{'type': 'Feature', 'properties': {}, 'geometry': mapping(MultiPolygon(parts))}],
                }
                text = json.dumps(fc, separators=(',', ':'))
                # Coordinate a 5 decimali anche nel testo (mapping può rendere 13.300000000000001).
                text = round_numbers(text)
                (out / f'{name}.geojson').write_text(text)
                entry['bytes'] = len(text.encode())
            tiles.append(entry)
            print(f'{name}: {kind}, {len(parts)} poligoni, {vertices} vertici', file=sys.stderr)
    index = {
        'source': 'OpenStreetMap land polygons (© OpenStreetMap contributors, ODbL), via ' + Path(src).name,
        'generated': date.today().isoformat(),
        'tileDeg': 1,
        'precisionDeg': GRID,
        'toleranceM': tol_m,
        'note': 'Lati sul bordo del tassello = ritaglio, non costa.',
        'tiles': tiles,
    }
    (out / 'index.json').write_text(json.dumps(index, indent=1))


def round_numbers(text):
    import re
    return re.sub(r'-?\d+\.\d{6,}', lambda m: f'{float(m.group(0)):.5f}'.rstrip('0').rstrip('.'), text)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 20.0)
