#!/usr/bin/env python3
"""Poligoni di terra dalle linee di costa OpenStreetMap (natural=coastline), per quando i "land polygons"
di osmdata.openstreetmap.de non sono disponibili. Eseguire a mano o dal workflow coastline.yml.

Ingresso: GeoJSON di linee (vie natural=coastline intere che toccano l'area, es. da Overpass + ogr2ogr).
Uscita: GeoJSON di poligoni di terra ritagliati sull'area, nello stesso formato atteso da make-tiles.py.

Metodo: le linee ritagliate sull'area e il bordo dell'area si "poligonizzano" in facce; ogni faccia è terra
se la linea di costa più vicina la lascia a sinistra (convenzione OSM: terra a sinistra del verso della via).

Uso: python3 tools/coastline/land-from-coastline.py coast-lines.geojson land.geojson [lon_min lat_min lon_max lat_max]
"""
import json
import sys

from shapely import polygonize, unary_union, make_valid
from shapely.geometry import box, shape, mapping, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection
from shapely.strtree import STRtree


def lines_of(g):
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, (MultiLineString, GeometryCollection)):
        return [x for s in g.geoms for x in lines_of(s)]
    return []


def polygons_of(g):
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        return [x for s in g.geoms for x in polygons_of(s)]
    return []


def main(src, dst, bounds):
    area = box(*bounds)
    data = json.loads(open(src).read())
    raw = []
    for f in data['features']:
        for ln in lines_of(shape(f['geometry'])):
            if len(ln.coords) >= 2 and ln.intersects(area):
                raw.append(ln)
    print(f'{len(raw)} vie di costa', file=sys.stderr)

    # Segmenti orientati (verso della via) per la regola "terra a sinistra".
    segs = []
    for ln in raw:
        c = list(ln.coords)
        for a, b in zip(c, c[1:]):
            if a != b:
                segs.append((a, b))
    seg_geoms = [LineString(s) for s in segs]
    tree = STRtree(seg_geoms)

    clipped = [g for ln in raw for g in lines_of(ln.intersection(area))]
    noded = unary_union(clipped + [area.exterior])
    faces = [p for p in polygons_of(polygonize(lines_of(noded)))]
    print(f'{len(faces)} facce', file=sys.stderr)

    land = []
    for face in faces:
        p = face.representative_point()
        i = tree.nearest(p)
        (ax, ay), (bx, by) = segs[int(i)]
        cross = (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)
        if cross > 0:
            land.append(face)
    merged = make_valid(unary_union(land))
    out = [{'type': 'Feature', 'properties': {}, 'geometry': mapping(p)} for p in polygons_of(merged)]
    json.dump({'type': 'FeatureCollection', 'features': out}, open(dst, 'w'), separators=(',', ':'))
    print(f'{len(out)} poligoni di terra', file=sys.stderr)


if __name__ == '__main__':
    b = [float(x) for x in sys.argv[3:7]] if len(sys.argv) >= 7 else [11.8, 39.6, 19.9, 46.0]
    main(sys.argv[1], sys.argv[2], b)
