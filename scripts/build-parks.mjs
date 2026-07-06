// Fetches the world's national parks, nature reserves and protected areas from
// OpenStreetMap via the Overpass API and writes public/data/parks.geojson as
// point centroids (one representative point per area — no heavy polygons).
//
// Each area is tagged `visitable` when it's the kind of place the public can go:
// national parks and reserves that aren't strict-wilderness zones and don't
// forbid access. Refresh anytime with:  npm run parks
//
// Data © OpenStreetMap contributors (ODbL) — attribution is shown on the map.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Public Overpass mirrors, cycled through (any one is often busy/rate-limited).
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// `out center tags` returns a single centroid + the tags for each way/relation,
// which keeps the payload small. We require a name and skip tiny way-level
// nature_reserves (relations are the notable, mappable ones) to bound the size.
const QUERY = `
[out:json][timeout:900];
(
  relation["boundary"="national_park"]["name"];
  way["boundary"="national_park"]["name"];
  relation["boundary"="protected_area"]["protect_class"~"^(2|II)$"]["name"];
  relation["leisure"="nature_reserve"]["name"];
);
out center tags;
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass() {
  let lastErr;
  // A few passes over the mirror list, backing off when they're busy (429/504).
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`Querying ${url} …`);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass rejects header-less clients (406); identify ourselves.
            'User-Agent': 'EnergyMap/1.0 (parks layer build; https://energy-mapper.vercel.app)',
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(QUERY),
        });
        if (res.status === 429 || res.status === 504 || res.status === 503) {
          throw new Error(`HTTP ${res.status} (busy)`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn(`  failed: ${err.message ?? err}`);
        lastErr = err;
      }
    }
    if (attempt < 2) {
      const wait = 15 * (attempt + 1);
      console.log(`  all mirrors busy — waiting ${wait}s before retrying…`);
      await sleep(wait * 1000);
    }
  }
  throw lastErr;
}

// access values that mean "you can't just show up"
const RESTRICTED = new Set(['no', 'private', 'permit', 'customers']);

function classify(tags = {}) {
  let type;
  if (tags.boundary === 'national_park') type = 'National park';
  else if (tags.leisure === 'nature_reserve') type = 'Nature reserve';
  else type = 'Protected area';

  // IUCN Ia/Ib (strict nature reserve / wilderness) are not open to casual visits.
  const pc = String(tags.protect_class || tags.iucn_level || '').toLowerCase();
  const strict = ['1', '1a', '1b', 'ia', 'ib'].includes(pc);
  const accessBlocked = RESTRICTED.has(String(tags.access || '').toLowerCase());
  const visitable = !strict && !accessBlocked;
  return { type, visitable };
}

const data = await fetchOverpass();

const seen = new Set();
const features = [];
for (const el of data.elements || []) {
  const tags = el.tags || {};
  const name = tags.name;
  const lat = el.center?.lat ?? el.lat;
  const lon = el.center?.lon ?? el.lon;
  if (!name || lat == null || lon == null) continue;
  // A big park often exists as both a way and a relation — dedupe by name+cell.
  const key = `${name}@${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const { type, visitable } = classify(tags);
  const website = tags.website || tags['contact:website'];
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(5)), Number(lat.toFixed(5))] },
    properties: {
      name,
      type,
      visitable,
      ...(tags.protect_class ? { iucn: tags.protect_class } : {}),
      ...(website ? { website } : {}),
      ...(tags.wikipedia ? { wikipedia: tags.wikipedia } : {}),
    },
  });
}

features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
const fc = { type: 'FeatureCollection', features };

mkdirSync(join(root, 'public/data'), { recursive: true });
const outPath = join(root, 'public/data/parks.geojson');
writeFileSync(outPath, JSON.stringify(fc));

const byType = features.reduce((m, f) => ((m[f.properties.type] = (m[f.properties.type] || 0) + 1), m), {});
const visitable = features.filter((f) => f.properties.visitable).length;
const bytes = Buffer.byteLength(JSON.stringify(fc));
console.log(`\nWrote public/data/parks.geojson — ${features.length} areas, ${(bytes / 1e6).toFixed(1)} MB`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k}: ${v}`);
console.log(`  visitable: ${visitable}`);
