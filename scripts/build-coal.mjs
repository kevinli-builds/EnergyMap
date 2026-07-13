// Fetches the world's coal power plants from Global Energy Monitor's public REST
// API (the one GEM tracker that's fully automatable — no form-gated download) and
// writes public/data/coal.geojson. Drawn as the grey "contrast layer": the fleet
// the clean build-out is displacing.
//
// The API serves unit-level rows; this script aggregates them to one point per
// plant (location) with summed capacity, CO2, start year and planned retirement.
// Refresh anytime with:  npm run coal   (safe to automate — keyless, ~15 requests)
//
// Data © Global Energy Monitor, Global Coal Plant Tracker (CC BY 4.0) —
// attribution is shown on the map.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const API = 'https://api.globalenergymonitor.org';
const PAGE = 500; // API maximum
// Plant-level floor (total MW across units). 200 matches the solar floor, so the
// grey fleet and the clean fleet are an apples-to-apples comparison.
const argMin = process.argv.indexOf('--min');
const MIN_MW = argMin > -1 ? Number(process.argv[argMin + 1]) : 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'EnergyMap/1.0 (coal layer build; https://energy-mapper.vercel.app)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`  ${err.message ?? err} — retrying…`);
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Release date for the attribution line, e.g. "January 2026" out of
// "… Global Coal Plant Tracker, January 2026 release. …"
async function fetchRelease() {
  try {
    const meta = await getJson(`${API}/catalog/metadata`);
    const coal = (meta.trackers ?? []).find((t) => t.slug === 'coal-plants');
    return coal?.citation?.copyright?.match(/Tracker,\s*([^.]+?)\s*release/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchUnits() {
  // NOTE: `construction` is a *sub*-status in GEM's taxonomy (group: planned) —
  // operating_status=construction silently matches nothing.
  const query =
    'asset_type=coal-plant&operating_sub_status=operating&operating_sub_status=construction' +
    `&include_type_fields=true&limit=${PAGE}`;
  const units = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await getJson(`${API}/assets?${query}&offset=${offset}`);
    units.push(...page.results);
    console.log(`  ${units.length}/${page.total} units`);
    if (units.length >= page.total || page.results.length === 0) return units;
    await sleep(150); // courtesy gap
  }
}

const num = (v) => {
  if (v == null || v === '') return null; // Number(null) is 0, not NaN
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

console.log('Fetching Global Coal Plant Tracker from api.globalenergymonitor.org …');
const [release, units] = await Promise.all([fetchRelease(), fetchUnits()]);

// Aggregate units → plants, keyed by GEM's location id.
const plants = new Map();
for (const u of units) {
  const tf = u.type_fields ?? {};
  const lat = num(u.latitude);
  const lng = num(u.longitude);
  if (lat == null || lng == null) continue;
  let p = plants.get(u.location_id);
  if (!p) {
    p = {
      name: u.project_name || tf.plant_name || u.asset_name,
      country: u.country,
      lat,
      lng,
      units: 0,
      capacityMW: 0,
      operating: 0,
      co2Mt: 0,
      year: null,
      retirement: null,
      conversions: new Set(),
      owner: tf.owner ? String(tf.owner).replace(/\s*\[[^\]]*\]/g, '') : null,
      wiki: u.wiki_url || null,
    };
    plants.set(u.location_id, p);
  }
  p.units++;
  p.capacityMW += num(u.capacity_value) ?? 0;
  if (u.operating_sub_status === 'operating') p.operating++;
  p.co2Mt += num(tf.annual_co2_million_tonnes__annum) ?? 0;
  const start = num(tf.start_year);
  if (start != null && (p.year == null || start < p.year)) p.year = start;
  // Plant counts as retiring when its *last* unit has a planned retirement year.
  const ret = num(tf.planned_retirement);
  if (ret != null && (p.retirement == null || ret > p.retirement)) p.retirement = ret;
  if (tf.conversion_to_fuel) p.conversions.add(String(tf.conversion_to_fuel));
}

const features = [...plants.values()]
  .filter((p) => p.capacityMW >= MIN_MW)
  .sort((a, b) => b.capacityMW - a.capacityMW)
  .map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(p.lng.toFixed(5)), Number(p.lat.toFixed(5))] },
    properties: {
      name: p.name,
      country: p.country,
      // any operating unit → the plant is burning coal today; else it's new-build
      status: p.operating > 0 ? 'operating' : 'construction',
      capacityMW: Math.round(p.capacityMW),
      units: p.units,
      ...(p.co2Mt > 0 ? { co2Mt: Number(p.co2Mt.toFixed(1)) } : {}),
      ...(p.year != null ? { year: p.year } : {}),
      ...(p.retirement != null ? { retirement: p.retirement } : {}),
      ...(p.conversions.size ? { conversion: [...p.conversions].join(', ') } : {}),
      ...(p.owner ? { owner: p.owner } : {}),
      ...(p.wiki ? { wiki: p.wiki } : {}),
    },
  }));

const fc = {
  type: 'FeatureCollection',
  meta: {
    source: 'Global Energy Monitor, Global Coal Plant Tracker',
    ...(release ? { release } : {}),
    license: 'CC BY 4.0',
    url: 'https://globalenergymonitor.org/projects/global-coal-plant-tracker/',
  },
  features,
};

mkdirSync(join(root, 'public/data'), { recursive: true });
writeFileSync(join(root, 'public/data/coal.geojson'), JSON.stringify(fc));

const gw = features.reduce((s, f) => s + f.properties.capacityMW, 0) / 1000;
const uc = features.filter((f) => f.properties.status === 'construction').length;
const retiring = features.filter((f) => f.properties.retirement != null).length;
const bytes = Buffer.byteLength(JSON.stringify(fc));
console.log(
  `\nWrote public/data/coal.geojson — ${features.length} plants ≥ ${MIN_MW} MW, ` +
    `${gw.toFixed(0)} GW, ${(bytes / 1e6).toFixed(1)} MB` +
    (release ? ` (GEM ${release} release)` : '')
);
console.log(`  under construction: ${uc}`);
console.log(`  with a planned retirement year: ${retiring}`);
