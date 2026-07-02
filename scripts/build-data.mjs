// Converts data/*.json (source of truth) into the GeoJSON files the map loads.
// Runs automatically before `npm run dev` and `npm run build`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const TECHS = ['solar', 'wind', 'battery'];
const STATUSES = ['operating', 'construction'];

const projects = read('data/projects.json');
const companies = read('data/companies.json');
const jobs = existsSync(join(root, 'data/jobs.json')) ? read('data/jobs.json') : {};

const errors = [];
const seen = new Set();
for (const [i, p] of projects.entries()) {
  const label = p.name || `entry #${i}`;
  if (!p.name) errors.push(`${label}: missing name`);
  if (seen.has(p.name)) errors.push(`${label}: duplicate name`);
  seen.add(p.name);
  if (!TECHS.includes(p.tech)) errors.push(`${label}: tech must be one of ${TECHS.join('/')}`);
  if (!STATUSES.includes(p.status)) errors.push(`${label}: status must be one of ${STATUSES.join('/')}`);
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
    errors.push(`${label}: bad coordinates`);
  }
}
if (errors.length) {
  console.error('Data validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const fc = (features) => ({ type: 'FeatureCollection', features });
const point = (lng, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
});

const projectsFC = fc(
  projects.map((p) =>
    point(p.lng, p.lat, {
      name: p.name,
      tech: p.tech,
      status: p.status,
      capacityMW: p.capacityMW ?? null,
      energyMWh: p.energyMWh ?? null,
      country: p.country,
      owner: p.owner ?? null,
      note: p.note ?? null,
    })
  )
);

const companiesFC = fc(
  companies.map((c) =>
    point(c.lng, c.lat, {
      name: c.name,
      focus: c.focus,
      hq: c.hq,
      careersUrl: c.careersUrl,
      openRoles: jobs[c.name] ?? null,
    })
  )
);

mkdirSync(join(root, 'public/data'), { recursive: true });
writeFileSync(join(root, 'public/data/projects.geojson'), JSON.stringify(projectsFC));
writeFileSync(join(root, 'public/data/companies.geojson'), JSON.stringify(companiesFC));

const gw = (list) => (list.reduce((s, p) => s + (p.capacityMW || 0), 0) / 1000).toFixed(1);
console.log('Wrote public/data/{projects,companies}.geojson');
for (const t of TECHS) {
  const l = projects.filter((p) => p.tech === t);
  console.log(`  ${t}: ${l.length} projects, ${gw(l)} GW`);
}
const withRoles = Object.keys(jobs).length;
console.log(`  companies: ${companies.length}${withRoles ? ` (${withRoles} with live role counts)` : ''}`);
