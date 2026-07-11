// Builds public/data/footprints.geojson — the real geographic outline of each
// project, so that as you zoom in the dots resolve into the actual land area a
// solar farm / reservoir / nuclear site covers.
//
// GEM gives us a point per project; the polygons come from OpenStreetMap
// (`power=plant` ways/relations) via Overpass. For every project we ask Overpass
// for plant polygons near its coordinates, then match the closest polygon whose
// `plant:source` is compatible with the project's tech (so a coal plant next
// door never gets drawn around a solar farm). Refresh occasionally:
//   npm run footprints    (then `npm run data` is not needed — this writes
//                          straight to public/data/)
//
// Data © OpenStreetMap contributors (ODbL) — attribution shown on the map.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// How far from a project point we'll look for its plant polygon. Sprawling
// solar/wind farms can have a centroid a couple km from GEM's labelled point.
const RADIUS_M = 3500;
// Projects per Overpass request (each contributes 2 clauses). Kept small so a
// single request stays well under the mirrors' load limits.
const BATCH = 40;
// Abandon a single request after this long and fall through to the next mirror.
const REQ_TIMEOUT_MS = 90000;
// Accept an unsourced (no plant:source tag) polygon only if it's very close.
const UNSOURCED_MAX_M = 1200;

// Which OSM plant:source values count as "the same energy" as our tech.
const SOURCE_OK = {
  solar: ['solar'],
  wind: ['wind'],
  nuclear: ['nuclear'],
  geothermal: ['geothermal'],
  hydro: ['hydro', 'water', 'pumped_hydro', 'pumped_storage'],
  battery: ['battery', 'storage'],
};

const args = process.argv.slice(2);
const arg = (flag, fb) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fb;
};
const limit = Number(arg('--limit', '0')) || 0; // 0 = all (for quick testing)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function haversine(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'EnergyMap/1.0 (project footprints; https://energy-mapper.vercel.app)',
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal,
        });
        if ([429, 503, 504].includes(res.status)) throw new Error(`HTTP ${res.status} (busy)`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    const wait = 15 * (attempt + 1);
    console.log(`  all mirrors busy — waiting ${wait}s…`);
    await sleep(wait * 1000);
  }
  throw lastErr;
}

const rnd = (v) => Number(v.toFixed(5));
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Close a coordinate list into a ring (>= 3 distinct points), or null.
function closeRing(coords) {
  if (coords.length < 3) return null;
  const r = coords.slice();
  if (!same(r[0], r[r.length - 1])) r.push([r[0][0], r[0][1]]);
  return r.length >= 4 ? r : null;
}

// A relation's outer boundary is often split into several ways ("segments").
// Stitch segments end-to-end into closed rings (flipping as needed) so we get
// real polygons instead of one bogus ring per segment.
function stitchRings(segments) {
  const segs = segments
    .map((g) => g.map((p) => [rnd(p.lon), rnd(p.lat)]))
    .filter((s) => s.length >= 2);
  const rings = [];
  while (segs.length) {
    let line = segs.shift().slice();
    let extended = true;
    while (extended && !same(line[0], line[line.length - 1])) {
      extended = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = line[line.length - 1];
        if (same(end, s[0])) line.push(...s.slice(1));
        else if (same(end, s[s.length - 1])) line.push(...s.slice().reverse().slice(1));
        else continue;
        segs.splice(i, 1);
        extended = true;
        break;
      }
    }
    const r = closeRing(line);
    if (r) rings.push(r);
  }
  return rings;
}

// Turn an OSM element into a GeoJSON geometry + its rings (for centroid), or null.
function toGeometry(el) {
  if (el.type === 'way' && el.geometry) {
    const r = closeRing(el.geometry.map((p) => [rnd(p.lon), rnd(p.lat)]));
    return r ? { geometry: { type: 'Polygon', coordinates: [r] }, rings: [r] } : null;
  }
  if (el.type === 'relation' && el.members) {
    const outer = el.members.filter((m) => m.role !== 'inner' && Array.isArray(m.geometry)).map((m) => m.geometry);
    const rings = stitchRings(outer);
    if (!rings.length) return null;
    if (rings.length === 1) return { geometry: { type: 'Polygon', coordinates: [rings[0]] }, rings };
    return { geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) }, rings };
  }
  return null;
}

function centroid(rings) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const r of rings)
    for (const [lng, lat] of r) {
      x += lng;
      y += lat;
      n++;
    }
  return [x / n, y / n];
}

const projects = JSON.parse(readFileSync(join(root, 'data/projects.json'), 'utf8'));
// A stable slug identical to build-data.mjs so footprints link to the same detail.
const slugCounts = new Map();
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const uniqueSlug = (name) => {
  const base = slugify(name) || 'project';
  const n = slugCounts.get(base) || 0;
  slugCounts.set(base, n + 1);
  return n ? `${base}-${n + 1}` : base;
};
for (const p of projects) p._slug = uniqueSlug(p.name);

const pool = (limit ? projects.slice(0, limit) : projects).filter(
  (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
);

console.log(`Matching footprints for ${pool.length} projects (radius ${RADIUS_M} m, batch ${BATCH})…`);

const features = [];
let matched = 0;
for (let i = 0; i < pool.length; i += BATCH) {
  const batch = pool.slice(i, i + BATCH);
  const clauses = batch
    .map(
      (p) =>
        `way(around:${RADIUS_M},${p.lat},${p.lng})["power"="plant"];` +
        `relation(around:${RADIUS_M},${p.lat},${p.lng})["power"="plant"];`
    )
    .join('\n');
  const query = `[out:json][timeout:300];\n(\n${clauses}\n);\nout geom tags;`;

  let data;
  try {
    data = await overpass(query);
  } catch (err) {
    console.warn(`  batch ${i / BATCH + 1}: failed (${err.message ?? err}) — skipping`);
    continue;
  }

  // Prepare candidate polygons once per batch.
  const polys = [];
  for (const el of data.elements || []) {
    const g = toGeometry(el);
    if (!g) continue;
    const c = centroid(g.rings);
    polys.push({
      id: `${el.type[0]}${el.id}`,
      source: (el.tags?.['plant:source'] || '').toLowerCase(),
      geometry: g.geometry,
      clng: c[0],
      clat: c[1],
    });
  }

  // Greedy nearest matching: each project ↔ one polygon, each polygon used once.
  const pairs = [];
  for (const p of batch) {
    const ok = SOURCE_OK[p.tech] || [];
    for (const poly of polys) {
      const dist = haversine(p.lat, p.lng, poly.clat, poly.clng);
      if (dist > RADIUS_M) continue;
      const sourceMatch = poly.source && ok.includes(poly.source);
      const unsourced = !poly.source && dist <= UNSOURCED_MAX_M;
      if (!sourceMatch && !unsourced) continue;
      // Sourced matches rank ahead of unsourced ones at the same distance.
      pairs.push({ p, poly, score: dist + (sourceMatch ? 0 : 500) });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const usedProj = new Set();
  const usedPoly = new Set();
  for (const { p, poly } of pairs) {
    if (usedProj.has(p._slug) || usedPoly.has(poly.id)) continue;
    usedProj.add(p._slug);
    usedPoly.add(poly.id);
    features.push({
      type: 'Feature',
      geometry: poly.geometry,
      properties: {
        slug: p._slug,
        name: p.name,
        tech: p.tech,
        status: p.status,
        capacityMW: p.capacityMW ?? null,
        year: p.year ?? null,
      },
    });
    matched++;
  }

  console.log(
    `  batch ${i / BATCH + 1}/${Math.ceil(pool.length / BATCH)}: ${polys.length} polygons → ${matched} matched so far`
  );
  await sleep(1000); // be polite to the shared mirrors
}

const fc = { type: 'FeatureCollection', features };
mkdirSync(join(root, 'public/data'), { recursive: true });
const outPath = join(root, 'public/data/footprints.geojson');
writeFileSync(outPath, JSON.stringify(fc));
const bytes = Buffer.byteLength(JSON.stringify(fc));
const byTech = features.reduce((m, f) => ((m[f.properties.tech] = (m[f.properties.tech] || 0) + 1), m), {});
console.log(`\nWrote public/data/footprints.geojson — ${matched}/${pool.length} projects matched, ${(bytes / 1e6).toFixed(1)} MB`);
for (const [k, v] of Object.entries(byTech)) console.log(`  ${k}: ${v}`);
