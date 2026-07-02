// Import projects from a Global Energy Monitor tracker export.
//
// 1. Download a tracker from https://globalenergymonitor.org/projects/
//    (Global Solar Power Tracker, Global Wind Power Tracker, ... — free .xlsx
//    downloads after a short form).
// 2. Open the main data sheet in Excel and save it as CSV (UTF-8).
// 3. Run:   npm run import:gem -- --file solar.csv --tech solar
// 4. Rebuild the map data:   npm run data
//
// Only rows with status operating/construction and capacity >= --min (default
// 200 MW) are imported, to keep the map fast and the dataset meaningful.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Column headers as they appear in GEM tracker exports. Adjust if GEM renames them.
const COLS = {
  name: ['Project Name', 'Project name'],
  capacity: ['Capacity (MW)', 'Capacity Rating (MW)'],
  status: ['Status'],
  country: ['Country/Area', 'Country'],
  lat: ['Latitude'],
  lng: ['Longitude'],
  owner: ['Owner'],
};
const STATUS_MAP = { operating: 'operating', construction: 'construction' };

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const file = arg('--file');
const tech = arg('--tech');
const minMW = Number(arg('--min', '200'));
if (!file || !['solar', 'wind', 'battery'].includes(tech)) {
  console.error('Usage: npm run import:gem -- --file <export.csv> --tech <solar|wind|battery> [--min 200]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const header = rows.shift().map((h) => h.trim());
const idx = {};
for (const [key, names] of Object.entries(COLS)) {
  idx[key] = header.findIndex((h) => names.includes(h));
}
for (const key of ['name', 'capacity', 'status', 'lat', 'lng']) {
  if (idx[key] === -1) {
    console.error(`Column for "${key}" not found. Header row was:\n  ${header.join(' | ')}`);
    process.exit(1);
  }
}

const projectsPath = join(root, 'data/projects.json');
const projects = JSON.parse(readFileSync(projectsPath, 'utf8'));
const existing = new Set(projects.map((p) => p.name.toLowerCase()));

let added = 0;
let skipped = 0;
for (const row of rows) {
  const name = String(row[idx.name] ?? '').trim();
  const status = STATUS_MAP[String(row[idx.status] ?? '').trim().toLowerCase()];
  const capacityMW = Number(row[idx.capacity]);
  const lat = Number(row[idx.lat]);
  const lng = Number(row[idx.lng]);
  if (
    !name ||
    !status ||
    !Number.isFinite(capacityMW) ||
    capacityMW < minMW ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    existing.has(name.toLowerCase())
  ) {
    skipped++;
    continue;
  }
  existing.add(name.toLowerCase());
  const p = {
    name,
    tech,
    status,
    capacityMW: Math.round(capacityMW),
    country: String(row[idx.country] ?? '').trim() || 'Unknown',
    lat: +lat.toFixed(4),
    lng: +lng.toFixed(4),
    source: 'gem',
  };
  const owner = idx.owner >= 0 ? String(row[idx.owner] ?? '').trim() : '';
  if (owner) p.owner = owner;
  projects.push(p);
  added++;
}

writeFileSync(projectsPath, JSON.stringify(projects, null, 2) + '\n');
console.log(`Imported ${added} ${tech} projects (skipped ${skipped} rows). Now run: npm run data`);
