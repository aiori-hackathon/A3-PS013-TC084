#!/usr/bin/env node
/**
 * Regenerate frontend/src/landmask.js from Natural Earth coastline data.
 *
 * The globe on the overview draws its continents from a packed bitmap rather
 * than from hand-written geography. This is what builds that bitmap.
 *
 *     node scripts/build-landmask.js
 *
 * It fetches world-atlas' 110m land TopoJSON, decodes the delta-encoded arcs,
 * rasterises the polygons onto a 288x144 lat/lon grid and packs one bit per
 * cell. Expect roughly 29-30% of cells to come out as land; Earth's real figure
 * is 29.2%, and a result far from it means something went wrong in decoding.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = 'https://unpkg.com/world-atlas@2.0.2/land-110m.json';
const W = 288;
const H = 144;
const OUT = path.resolve(__dirname, '..', 'frontend', 'src', 'landmask.js');

async function load() {
  const res = await fetch(SRC);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SRC}: HTTP ${res.status}`);
  }
  return await res.json();
}

function polygons(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = [];

  for (const arc of topo.arcs) {
    let x = 0;
    let y = 0;
    const pts = [];
    for (const [dx, dy] of arc) {
      x += dx;
      y += dy;
      pts.push([x * sx + tx, y * sy + ty]);
    }
    arcs.push(pts);
  }

  function ring(indices) {
    const out = [];
    for (const i of indices) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      if (out.length === 0) {
        out.push(...a);
      } else {
        out.push(...a.slice(1));
      }
    }
    return out;
  }

  const polys = [];
  for (const g of topo.objects.land.geometries) {
    if (g.type === 'Polygon') {
      polys.push(g.arcs.map(r => ring(r)));
    } else if (g.type === 'MultiPolygon') {
      for (const p of g.arcs) {
        polys.push(p.map(r => ring(r)));
      }
    }
  }
  return polys;
}

function inside([x, y], ringPts) {
  let c = false;
  const n = ringPts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ringPts[i];
    const [x2, y2] = ringPts[(i + 1) % n];
    if ((y1 > y) !== (y2 > y)) {
      if (x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
        c = !c;
      }
    }
  }
  return c;
}

function rasterise(polys) {
  const boxes = polys.map(p => {
    const xs = p[0].map(q => q[0]);
    const ys = p[0].map(q => q[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  });

  const bits = new Uint8Array((W * H) / 8);
  let land = 0;

  for (let j = 0; j < H; j++) {
    const lat = 90 - (j + 0.5) * (180 / H);
    for (let i = 0; i < W; i++) {
      const lon = -180 + (i + 0.5) * (360 / W);
      for (let pIdx = 0; pIdx < polys.length; pIdx++) {
        const p = polys[pIdx];
        const [x0, x1, y0, y1] = boxes[pIdx];
        if (lon < x0 || lon > x1 || lat < y0 || lat > y1) {
          continue;
        }
        if (inside([lon, lat], p[0]) && !p.slice(1).some(h => inside([lon, lat], h))) {
          land++;
          const k = j * W + i;
          bits[k >> 3] |= (1 << (k & 7));
          break;
        }
      }
    }
  }
  return { bits, land };
}

async function main() {
  const topo = await load();
  const polys = polygons(topo);
  const { bits, land } = rasterise(polys);
  const pct = (100 * land) / (W * H);
  console.log(`${polys.length} polygons, ${land} land cells of ${W * H} (${pct.toFixed(1)}%)`);
  if (pct < 25 || pct > 35) {
    console.error(`land fraction ${pct.toFixed(1)}% is implausible; not writing output`);
    process.exit(1);
  }
  const b64 = Buffer.from(bits).toString('base64');
  console.log(`base64 is ${b64.length} chars; paste into ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
