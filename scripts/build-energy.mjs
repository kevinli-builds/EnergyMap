// Fetches per-country electricity mix from Our World in Data (owid/energy-data,
// CC BY) and writes data/energy-mix.json — the latest year per country with a
// clean/fossil breakdown. Run occasionally to refresh: `npm run energy`.
// The result is committed, so the app/build never depends on a network call.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv';

// quote-aware split of a single CSV line
function splitLine(line) {
  const out = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

console.log('Fetching OWID energy data…');
const res = await fetch(URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const lines = (await res.text()).split('\n');
const header = splitLine(lines[0]);
const col = (name) => header.indexOf(name);
const iC = col('country'),
  iIso = col('iso_code'),
  iYear = col('year'),
  iRen = col('renewables_share_elec'),
  iNuc = col('nuclear_share_elec'),
  iLow = col('low_carbon_share_elec'),
  iFos = col('fossil_share_elec'),
  iDemand = col('electricity_demand'),
  iGen = col('electricity_generation');

const num = (v) => (v === '' || v == null ? null : Math.round(parseFloat(v) * 10) / 10);
const twh = (v) => (v === '' || v == null ? null : Math.round(parseFloat(v)));
const latest = new Map();
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = splitLine(lines[i]);
  const iso = c[iIso];
  // real countries only: 3-letter ISO, skip OWID aggregates (OWID_WRL, etc.)
  if (!iso || iso.length !== 3 || !/^[A-Z]{3}$/.test(iso)) continue;
  if (c[iRen] === '' && c[iLow] === '') continue;
  const year = +c[iYear];
  const prev = latest.get(c[iC]);
  if (!prev || year > prev.year) {
    latest.set(c[iC], {
      iso,
      year,
      renewables: num(c[iRen]),
      nuclear: num(c[iNuc]),
      lowCarbon: num(c[iLow]),
      fossil: num(c[iFos]),
      demand: twh(c[iDemand]),
      generation: twh(c[iGen]),
    });
  }
}

const out = {};
for (const name of [...latest.keys()].sort()) out[name] = latest.get(name);
writeFileSync(join(root, 'data/energy-mix.json'), JSON.stringify(out, null, 0) + '\n');
console.log(`Wrote data/energy-mix.json — ${Object.keys(out).length} countries (latest ${Math.max(...[...latest.values()].map((v) => v.year))}).`);
