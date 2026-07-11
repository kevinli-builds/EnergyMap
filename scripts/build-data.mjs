// Converts data/*.json (source of truth) into the GeoJSON files the map loads.
// Runs automatically before `npm run dev` and `npm run build`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// Keep in sync with TECHS in app/components/shared.ts
const TECHS = ['solar', 'wind', 'battery', 'geothermal', 'hydro', 'nuclear'];
const STATUSES = ['operating', 'construction'];

const projects = read('data/projects.json');
const companies = read('data/companies.json');
const jobs = existsSync(join(root, 'data/jobs.json')) ? read('data/jobs.json') : {};
const transmission = existsSync(join(root, 'data/transmission.json')) ? read('data/transmission.json') : [];

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
for (const [i, t] of transmission.entries()) {
  const label = t.name || `transmission #${i}`;
  if (!t.name) errors.push(`${label}: missing name`);
  if (!STATUSES.includes(t.status)) errors.push(`${label}: status must be one of ${STATUSES.join('/')}`);
  if (!Array.isArray(t.coords) || t.coords.length < 2) errors.push(`${label}: needs >= 2 coords`);
  else if (t.coords.some((c) => !Array.isArray(c) || c.length !== 2 || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180)) {
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

// Stable, unique per-project slug — powers the ?p=<slug> shareable deep links.
const slugCounts = new Map();
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const uniqueSlug = (name) => {
  const base = slugify(name) || 'project';
  const n = slugCounts.get(base) || 0;
  slugCounts.set(base, n + 1);
  return n ? `${base}-${n + 1}` : base;
};

const projectsFC = fc(
  projects.map((p) =>
    point(p.lng, p.lat, {
      slug: uniqueSlug(p.name),
      name: p.name,
      tech: p.tech,
      status: p.status,
      capacityMW: p.capacityMW ?? null,
      energyMWh: p.energyMWh ?? null,
      country: p.country,
      owner: p.owner ?? null,
      operator: p.operator ?? null,
      year: p.year ?? null,
      note: p.note ?? null,
      url: p.url ?? null,
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

const transmissionFC = fc(
  transmission.map((t) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: t.coords },
    properties: {
      name: t.name,
      type: t.type ?? 'transmission',
      status: t.status,
      capacityMW: t.capacityMW ?? null,
      from: t.from ?? null,
      to: t.to ?? null,
      note: t.note ?? null,
    },
  }))
);

mkdirSync(join(root, 'public/data'), { recursive: true });
writeFileSync(join(root, 'public/data/projects.geojson'), JSON.stringify(projectsFC));
writeFileSync(join(root, 'public/data/companies.geojson'), JSON.stringify(companiesFC));
writeFileSync(join(root, 'public/data/transmission.geojson'), JSON.stringify(transmissionFC));

const gw = (list) => (list.reduce((s, p) => s + (p.capacityMW || 0), 0) / 1000).toFixed(1);
console.log('Wrote public/data/{projects,companies}.geojson');
for (const t of TECHS) {
  const l = projects.filter((p) => p.tech === t);
  console.log(`  ${t}: ${l.length} projects, ${gw(l)} GW`);
}
const withRoles = Object.keys(jobs).length;
console.log(`  companies: ${companies.length}${withRoles ? ` (${withRoles} with live role counts)` : ''}`);
console.log(`  transmission: ${transmission.length} lines`);
