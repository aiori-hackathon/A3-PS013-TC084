#!/usr/bin/env python3
"""Regenerate frontend/src/landmask.js from Natural Earth coastline data.

The globe on the overview draws its continents from a packed bitmap rather
than from hand-written geography. This is what builds that bitmap.

    python3 scripts/build-landmask.py

It fetches world-atlas' 110m land TopoJSON, decodes the delta-encoded arcs,
rasterises the polygons onto a 288x144 lat/lon grid and packs one bit per
cell. Expect roughly 29-30% of cells to come out as land; Earth's real figure
is 29.2%, and a result far from it means something went wrong in decoding.
"""
import base64, json, urllib.request
from pathlib import Path

SRC = "https://unpkg.com/world-atlas@2.0.2/land-110m.json"
W, H = 288, 144
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "landmask.js"


def load():
    with urllib.request.urlopen(SRC, timeout=60) as r:
        return json.load(r)


def polygons(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(indices):
        out = []
        for i in indices:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            out.extend(a if not out else a[1:])
        return out

    polys = []
    for g in topo["objects"]["land"]["geometries"]:
        if g["type"] == "Polygon":
            polys.append([ring(r) for r in g["arcs"]])
        elif g["type"] == "MultiPolygon":
            for p in g["arcs"]:
                polys.append([ring(r) for r in p])
    return polys


def inside(pt, ring_pts):
    x, y = pt
    c = False
    n = len(ring_pts)
    for i in range(n):
        x1, y1 = ring_pts[i]
        x2, y2 = ring_pts[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
    return c


def rasterise(polys):
    boxes = []
    for p in polys:
        xs = [q[0] for q in p[0]]
        ys = [q[1] for q in p[0]]
        boxes.append((min(xs), max(xs), min(ys), max(ys)))

    bits = bytearray(W * H // 8)
    land = 0
    for j in range(H):
        lat = 90 - (j + 0.5) * (180 / H)
        for i in range(W):
            lon = -180 + (i + 0.5) * (360 / W)
            for p, (x0, x1, y0, y1) in zip(polys, boxes):
                if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                    continue
                if inside((lon, lat), p[0]) and not any(inside((lon, lat), h) for h in p[1:]):
                    land += 1
                    k = j * W + i
                    bits[k >> 3] |= 1 << (k & 7)
                    break
    return bits, land


if __name__ == "__main__":
    polys = polygons(load())
    bits, land = rasterise(polys)
    pct = 100 * land / (W * H)
    print(f"{len(polys)} polygons, {land} land cells of {W * H} ({pct:.1f}%)")
    if not 25 <= pct <= 35:
        raise SystemExit(f"land fraction {pct:.1f}% is implausible; not writing output")
    print(f"base64 is {len(base64.b64encode(bytes(bits)))} chars; paste into {OUT}")
