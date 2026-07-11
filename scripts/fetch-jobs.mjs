// Fetches live open-role counts for companies whose careers site runs on
// Greenhouse, Lever, or Ashby (all expose free public JSON endpoints — no key,
// no scraping). Companies opt in via an "ats" block in data/companies.json:
//   { "ats": { "type": "greenhouse" | "lever" | "ashby", "slug": "formenergy" } }
// (An Ashby slug is the path at jobs.ashbyhq.com/<slug> — verify it returns
// JSON at https://api.ashbyhq.com/posting-api/job-board/<slug>.)
// Writes data/jobs.json; run `npm run data` afterwards to bake counts into
// the map. Failures are per-company and non-fatal.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const companies = JSON.parse(readFileSync(join(root, 'data/companies.json'), 'utf8'));

const counts = {};
for (const c of companies) {
  if (!c.ats) continue;
  try {
    let n;
    if (c.ats.type === 'greenhouse') {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${c.ats.slug}/jobs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      n = (await res.json()).jobs.length;
    } else if (c.ats.type === 'lever') {
      const res = await fetch(`https://api.lever.co/v0/postings/${c.ats.slug}?mode=json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      n = (await res.json()).length;
    } else if (c.ats.type === 'ashby') {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${c.ats.slug}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      n = (await res.json()).jobs.length;
    } else {
      continue;
    }
    counts[c.name] = n;
    console.log(`  ${c.name}: ${n} open roles`);
  } catch (err) {
    console.warn(`  ${c.name}: skipped (${err.message ?? err})`);
  }
}

writeFileSync(join(root, 'data/jobs.json'), JSON.stringify(counts, null, 2) + '\n');
console.log(`Wrote data/jobs.json (${Object.keys(counts).length} companies). Now run: npm run data`);
