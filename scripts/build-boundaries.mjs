// Builds the country-choropleth layer (§9 L1) + the per-country buildout series
// (§9 L2). Joins projects to countries by point-in-polygon against Natural Earth
// 110m boundaries (public domain), so no country-name matching is needed, and
// reads population straight off Natural Earth's POP_EST. Renewable share is
// joined from data/energy-mix.json by ISO. Run occasionally to refresh:
//   npm run data && npm run boundaries
// Both outputs are committed, so the app/build never depends on a network call.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

// ---- point-in-polygon (ray casting; XOR over all rings handles holes) --------
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(x, y, rings) {
  let inside = false;
  for (const ring of rings) if (inRing(x, y, ring)) inside = !inside;
  return inside;
}
function bbox(geom) {
  let minX = 180,
    minY = 90,
    maxX = -180,
    maxY = -90;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  for (const poly of polys)
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}
function contains(geom, x, y) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  for (const rings of polys) if (inPolygon(x, y, rings)) return true;
  return false;
}

// ---- load inputs -------------------------------------------------------------
console.log('Fetching Natural Earth 110m country boundaries…');
const res = await fetch(NE_URL);
if (!res.ok) throw new Error(`Natural Earth HTTP ${res.status}`);
const ne = await res.json();
if (!ne.features?.length) throw new Error('Natural Earth response has no features');

const projects = read('data/projects.json');
const mix = existsSync(join(root, 'data/energy-mix.json')) ? read('data/energy-mix.json') : {};
const mixByIso = {};
for (const m of Object.values(mix)) if (m.iso) mixByIso[m.iso] = m;

const iso3 = (p) => {
  const a = p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3 : null;
  return a || (p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : null);
};

// Pre-compute each country's bbox once, then assign every project to a country.
const feats = ne.features
  .filter((f) => f.geometry && iso3(f.properties))
  .map((f) => ({ f, iso: iso3(f.properties), bb: bbox(f.geometry) }));

// Distance (degrees) from a point to a country's bbox — 0 if inside it. Used only
// as a fallback so offshore/coastal projects (offshore wind especially) still
// count toward their nearest country rather than vanishing.
const distToBB = (x, y, bb) => {
  const dx = Math.max(bb[0] - x, 0, x - bb[2]);
  const dy = Math.max(bb[1] - y, 0, y - bb[3]);
  return Math.hypot(dx, dy);
};
const NEAR_DEG = 2; // ~220 km — generous enough for offshore wind, tight enough to stay honest

const agg = {}; // iso -> { opGW, ucGW, byYear:{year:MW} }
const ensure = (iso) => (agg[iso] ||= { opMW: 0, ucMW: 0, byYear: {} });
let matched = 0;
let byFallback = 0;
for (const p of projects) {
  if (typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
  let hit = null;
  for (const c of feats) {
    if (p.lng < c.bb[0] || p.lng > c.bb[2] || p.lat < c.bb[1] || p.lat > c.bb[3]) continue;
    if (contains(c.f.geometry, p.lng, p.lat)) {
      hit = c.iso;
      break;
    }
  }
  if (!hit) {
    // Nearest-country fallback for points that fell outside every land polygon.
    let best = null,
      bestD = Infinity;
    for (const c of feats) {
      const d = distToBB(p.lng, p.lat, c.bb);
      if (d < bestD) {
        bestD = d;
        best = c.iso;
      }
    }
    if (best && bestD <= NEAR_DEG) {
      hit = best;
      byFallback++;
    }
  }
  if (!hit) continue;
  matched++;
  const a = ensure(hit);
  const mw = p.capacityMW || 0;
  if (p.status === 'construction') a.ucMW += mw;
  else a.opMW += mw;
  // Buildout series = operating capacity by commissioning year.
  if (p.status === 'operating' && p.year != null && mw > 0) a.byYear[p.year] = (a.byYear[p.year] || 0) + mw;
}
console.log(`Matched ${matched}/${projects.length} projects to a country (${byFallback} via nearest-coast fallback).`);

const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// CAGR of cumulative built GW, from the first year cumulative clears 1 GW to the
// latest year with data — avoids a tiny early base exploding the rate.
function cagr(byYear) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return { cagr: null, firstYear: null };
  let cum = 0;
  let baseCum = 0,
    baseYear = null;
  const cumByYear = {};
  for (const y of years) {
    cum += byYear[y];
    cumByYear[y] = cum;
    if (baseYear == null && cum >= 1000) {
      baseCum = cum;
      baseYear = y;
    }
  }
  const lastYear = years[years.length - 1];
  if (baseYear == null || lastYear - baseYear < 3) return { cagr: null, firstYear: years[0] };
  const rate = (cumByYear[lastYear] / baseCum) ** (1 / (lastYear - baseYear)) - 1;
  return { cagr: round(rate * 100, 1), firstYear: baseYear };
}

// ---- assemble outputs --------------------------------------------------------
const buildout = {}; // iso -> panel detail (L2)
const dist = { gwPerM: [], pipeline: [], renew: [] };

const outFeatures = feats.map(({ f, iso }) => {
  const a = agg[iso] || { opMW: 0, ucMW: 0, byYear: {} };
  const pop = Number(f.properties.POP_EST) || 0;
  const totalGW = (a.opMW + a.ucMW) / 1000;
  const opGW = a.opMW / 1000;
  const ucGW = a.ucMW / 1000;
  const gwPerM = pop > 0 && totalGW > 0 ? (totalGW / (pop / 1e6)) : null;
  const pipeline = opGW > 0 ? ucGW / opGW : null;
  const renew = mixByIso[iso]?.renewables ?? null;
  if (gwPerM != null) dist.gwPerM.push(gwPerM);
  if (pipeline != null) dist.pipeline.push(pipeline);
  if (renew != null) dist.renew.push(renew);

  const name = f.properties.NAME || f.properties.ADMIN || iso;
  const props = {
    iso,
    name,
    gwPerM: round(gwPerM),
    pipeline: round(pipeline, 3),
    renew: round(renew, 1),
    totalGW: round(totalGW),
  };

  // Per-country detail for the CountryPanel buildout chart + CAGR chip (L2).
  const byYearGW = {};
  for (const [y, mw] of Object.entries(a.byYear)) byYearGW[y] = round(mw / 1000);
  const { cagr: rate, firstYear } = cagr(a.byYear);
  if (totalGW > 0) {
    buildout[iso] = {
      name,
      opGW: round(opGW),
      ucGW: round(ucGW),
      totalGW: round(totalGW),
      gwPerM: round(gwPerM),
      pipeline: round(pipeline, 3),
      cagr: rate,
      firstYear,
      byYear: byYearGW,
    };
  }

  // Round geometry coordinates to ~1km — plenty for a globe-scale choropleth.
  const geo = roundGeom(f.geometry, 2);
  return { type: 'Feature', properties: props, geometry: geo };
});

function roundGeom(geom, d) {
  const r = (c) => [round(c[0], d), round(c[1], d)];
  const ring = (rg) => rg.map(r);
  const poly = (pg) => pg.map(ring);
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: poly(geom.coordinates) };
  return { type: 'MultiPolygon', coordinates: geom.coordinates.map(poly) };
}

writeFileSync(join(root, 'public/data/boundaries.geojson'), JSON.stringify({ type: 'FeatureCollection', features: outFeatures }));
writeFileSync(join(root, 'data/country-buildout.json'), JSON.stringify(buildout) + '\n');

// ---- report + distribution hints for choosing colour stops -------------------
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return round(s[Math.floor((s.length - 1) * p)], 2);
};
console.log(`Wrote public/data/boundaries.geojson — ${outFeatures.length} countries.`);
console.log(`Wrote data/country-buildout.json — ${Object.keys(buildout).length} countries with projects.`);
for (const [k, arr] of Object.entries(dist)) {
  console.log(`  ${k}: n=${arr.length}  p50=${q(arr, 0.5)}  p75=${q(arr, 0.75)}  p90=${q(arr, 0.9)}  max=${round(Math.max(...arr), 2)}`);
}
