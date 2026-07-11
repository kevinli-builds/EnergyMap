# Data sources & refresh guide

Every layer on the map, where its data comes from, the license, how fresh it stays, and how
to refresh it — automated where the source allows, documented manual steps where it doesn't.
Facts below (endpoints, licenses, release dates) were verified July 2026.

## At a glance

| Layer | Source | License | Source cadence | Refresh |
|---|---|---|---|---|
| Projects (solar/wind/geo/hydro/…) | [Global Energy Monitor](https://globalenergymonitor.org/projects/) trackers | CC BY 4.0 | ~1–2 releases/yr per tracker | **Manual** (`npm run import:gem`) — see below |
| Country energy mix | [OWID energy-data](https://github.com/owid/energy-data) (CSV on GitHub) | CC BY | ~monthly–quarterly commits | **Automated** (`npm run energy`) |
| Parks & protected areas | OpenStreetMap via Overpass API | ODbL | continuous | **Automated** (`npm run parks`) |
| Open-role counts | Greenhouse / Lever public JSON | free public endpoints | live | **Automated** (nightly GitHub Action) |
| Transmission lines | hand-curated `data/transmission.json` | n/a | manual | **Manual** (OSM automation possible — see below) |

---

## 1. Projects — Global Energy Monitor (GEM)

**Status: best-in-class and free, but the download is not yet automatable.**

- All trackers (Solar, Wind, Hydropower, Geothermal, Nuclear, Bioenergy, Integrated Power)
  are **CC BY 4.0** — free to use and republish with attribution.
- Downloads are gated behind a short form at
  [globalenergymonitor.org/projects](https://globalenergymonitor.org/projects/) — GEM emails
  you a link to the `.xlsx`. No stable direct URL, so this step can't be scripted.
- Release cadence is roughly twice a year per tracker (as of mid-2026: Solar/Wind — Feb 2026,
  Hydro/Geothermal/Integrated — Mar 2026, Nuclear — Sep 2025).

### Manual refresh (≈2×/year, ~15 min)

1. Request the tracker(s) from GEM's site; download the `.xlsx` from the emailed link into
   `GEM data/`.
2. Import (operating/construction only, capacity floor per tech):

   ```bash
   npm run import:gem -- --file "GEM data/Global-Solar-Power-Tracker-<date>.xlsx" --tech solar
   npm run import:gem -- --file "GEM data/Global-Wind-Power-Tracker-<date>.xlsx"  --tech wind --min 300
   npm run import:gem -- --file "GEM data/Geothermal-Power-Tracker-<date>.xlsx"   --tech geothermal --min 50
   npm run data
   ```
3. Commit `data/projects.json` + `public/data/*.geojson`.

### Watch: GEM's REST API (future automation)

GEM is building a public API at `https://api.globalenergymonitor.org` (see their
[download experiments](https://globalenergymonitor.org/download-experiments) page). As of
July 2026:

- **Read endpoints need no auth** — `GET /assets`, `GET /catalog/metadata`,
  `GET /catalog/asset-classes`, ownership tracing, etc. (self-documented at `/openapi.json`).
- **But coverage is coal + ownership only** (~57k assets: coal plants/mines). No solar or
  wind asset classes yet.
- The bulk `POST /download` endpoint exists but requires a JWT token issued via their web
  form — not usable headlessly.

**Re-check `GET /catalog/metadata` at each GEM refresh** — the moment solar/wind trackers
appear there, `import-gem.mjs` can be replaced with a fully automated fetch.

### US-only enrichment (fully automatable, public domain)

USGS publishes two continuously maintained, quarterly-updated databases with direct
downloads (GeoJSON, ~2 MB) and REST services — no form, no key, public domain:

- [USWTDB](https://energy.usgs.gov/uswtdb/data/) — every utility-scale wind turbine in the US
- [USPVDB](https://energy.usgs.gov/uspvdb/data/) — every large-scale US solar PV site

Useful if you ever want turbine/site-level detail for the US beyond GEM's project points.

### Avoid

- **WRI Global Power Plant Database** — the classic free alternative, but frozen since 2021.
  GEM has superseded it.

---

## 2. Country energy mix — OWID (current) / Ember (upgrade path)

**Current source is solid; keep it.** `scripts/build-energy.mjs` pulls
`owid-energy-data.csv` straight from GitHub — no key, CC BY, and the repo is actively
maintained (last data update Apr 2026). OWID's electricity figures are themselves sourced
from [Ember](https://ember-energy.org/data/) and the Energy Institute, so you're already on
the authoritative chain.

- Refresh: `npm run energy && npm run data`, commit `data/energy-mix.json`. Safe to automate
  monthly (workflow snippet at the bottom).

**Upgrade option — Ember direct.** Ember's [free API](https://ember-energy.org/data/api/)
(CC BY 4.0, free API key on registration) serves yearly data for 200+ geographies and
**monthly** data for 88 countries, updated twice a month. Worth switching only if you want
monthly granularity or fresher-than-OWID numbers; costs you an API key as a repo secret.
Ember also publishes plain CSV downloads (yearly/monthly) with stable URLs if you want
fresher data without the key.

---

## 3. Parks, reserves & protected land — OSM (current) vs WDPA

**Recommendation: stay on OpenStreetMap.** The licensing, not the data quality, is the
deciding factor:

| | OSM Overpass (current) | WDPA / Protected Planet |
|---|---|---|
| Coverage | very good, community-maintained | authoritative — 312k+ protected areas + 7.4k OECMs (May 2026) |
| License | **ODbL — redistribution fine** with attribution | **non-commercial only; redistributing the dataset requires UNEP-WCMC written permission** |
| Automation | yes — public Overpass mirrors (already built) | monthly releases; API v4 at [api.protectedplanet.net](https://api.protectedplanet.net/) (free token on request) |

This site serves `parks.geojson` publicly, which for WDPA is redistribution — a license
problem. OSM has no such issue. If you ever want WDPA's rigor (official IUCN categories,
designation status), use it as a *cross-check/enrichment* source rather than the published
dataset, or email protectedareas@unep-wcmc.org for permission.

- Refresh: `npm run parks` (script already rotates across 4 Overpass mirrors with backoff).
- **Cadence: monthly is plenty and polite** — Overpass mirrors are shared community
  infrastructure; don't put this in `prebuild` or a daily job.
- US-only alternative: [PAD-US](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download)
  (USGS, public domain) if you ever need parcel-level US detail.

---

## 4. Green jobs — ATS public endpoints

Already fully automated (nightly `refresh-jobs.yml`). Greenhouse and Lever are wired; these
ATSes also expose free, keyless public JSON and are easy adds in `fetch-jobs.mjs` when a
company's careers page uses them:

| ATS | Public endpoint | Careers URL tell |
|---|---|---|
| Greenhouse ✅ | `boards-api.greenhouse.io/v1/boards/<slug>/jobs` | `boards.greenhouse.io/<slug>` |
| Lever ✅ | `api.lever.co/v0/postings/<slug>?mode=json` | `jobs.lever.co/<slug>` |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<slug>` | `jobs.ashbyhq.com/<slug>` |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/<company>/postings` | `careers.smartrecruiters.com/<company>` |
| Recruitee | `<slug>.recruitee.com/api/offers/` | `<slug>.recruitee.com` |
| Workable | `apply.workable.com/api/v1/widget/accounts/<slug>` | `apply.workable.com/<slug>` |

There is no good free *aggregate* "green jobs" dataset (LinkedIn/Indeed data is paid or
scraping-prohibited); per-company ATS endpoints remain the robust free approach.

---

## 5. Transmission lines — automation option

`data/transmission.json` is hand-curated (good for the storytelling HVDC set). If you want
breadth, OSM is the only free global source, queryable via the same Overpass setup as parks:

```
relation["route"="power"]["frequency"="0"]["name"];   // HVDC links
way["power"="line"]["voltage"~"^[4-9][0-9]{5}"]["name"];  // ≥400 kV named lines
```

Caveats: line geometries are much heavier than points (simplify or filter hard — HVDC +
≥400 kV keeps it sane), and metadata (capacity MW) is spottier than your curated notes.
[Open Infrastructure Map](https://openinframap.org/) is the reference rendering of this
data but publishes no bulk extracts — query OSM directly. A hybrid works well: keep curated
notes/capacities keyed by name, auto-refresh geometries from OSM.

---

## Project footprints (polygons at high zoom) — **implemented**

Built by `npm run footprints` (`scripts/build-footprints.mjs`) → `public/data/footprints.geojson`,
drawn as filled polygons that fade in past zoom 9. For each project the script asks Overpass
for `power=plant` polygons near its coordinates and keeps the closest one whose `plant:source`
matches the project's tech — so a neighbouring coal plant never gets drawn around a solar
farm. Projects OSM hasn't mapped simply stay as dots. Refresh cadence: occasional (OSM
coverage grows slowly); safe to fold into the same monthly workflow as parks, but it's a
long job (dozens of Overpass queries), so a manual/quarterly run is fine.

GEM trackers provide **points only** — footprint geometry comes from a second source
and is matched to projects (nearest polygon within a few km + matching tech):

| Source | Coverage | License | Notes |
|---|---|---|---|
| OSM `power=plant` polygons | global, all techs | ODbL | queryable with the existing Overpass setup (`way/relation["power"="plant"]`, `out geom`); coverage strongest for large plants — exactly the ≥200 MW set on this map |
| [TZ-SAM](https://www.transitionzero.org/products/solar-asset-mapper) (TransitionZero Solar Asset Mapper) | global **solar**, 191 countries, quarterly ML/satellite updates | **CC BY-NC 4.0** | polygons as GeoPackage (~30 MB); catches plants OSM misses; NC clause fine for a free site, but note it if the project ever becomes commercial |
| [USPVDB](https://energy.usgs.gov/uspvdb/data/) | US solar | public domain | georectified footprint polygons |
| [USWTDB](https://energy.usgs.gov/uswtdb/data/) | US wind | public domain | *turbine points*, not polygons — for wind, dots-per-turbine is more honest than a farm outline |

Wind farms are scattered turbines, so a farm-boundary polygon is often misleading; hydro
reservoirs and solar/geothermal plants polygon well. Keep footprints in a separate
prebuilt `footprints.geojson` (simplified geometry), shown only at high zoom.

## Possible new layers (all free, automatable)

- **Nuclear / bioenergy / more hydro projects** — the GEM tracker `.xlsx` files are already
  sitting in `GEM data/` (Nuclear Sep 2025, Bioenergy V3, Hydro Mar 2026); `import-gem.mjs`
  just needs a `--tech` mapping for them.
- **Facility-level emissions** — [Climate TRACE](https://climatetrace.org/data) (CC BY 4.0,
  bulk country/sector downloads, updated ~annually with monthly estimates for power).
  Would make a striking "dirty vs clean" contrast layer.
- **Live grid carbon intensity** — [Electricity Maps](https://portal.electricitymaps.com/)
  has a free tier (personal/non-commercial, API key, one zone per key) — fine for a demo
  widget, not for a full layer. Ember monthly data is the free-and-open alternative at
  monthly rather than live resolution.

---

## Automation playbook

Already automated: **jobs** (daily workflow). Worth adding one monthly workflow for
**energy mix + parks** — same commit-if-changed pattern as `refresh-jobs.yml`:

```yaml
name: Refresh energy mix + parks
on:
  schedule:
    - cron: '43 5 3 * *'   # monthly, 3rd at 05:43 UTC
  workflow_dispatch: {}
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/build-energy.mjs
      - run: node scripts/build-parks.mjs   # Overpass can be busy; script retries 3×
      - run: node scripts/build-data.mjs
      - name: Commit and push if changed
        run: |
          if [ -n "$(git status --porcelain data public/data)" ]; then
            git config user.name "energymap-bot"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add data public/data
            git commit -m "chore: monthly data refresh (energy mix, parks) [skip ci]"
            git push
          else
            echo "No data changes."
          fi
```

Stays manual (with instructions above):

1. **GEM tracker refresh** — ~2×/year, form-gated email download (§1). Re-check their API
   coverage each time.
2. **Transmission curation** — unless/until you adopt the OSM geometry refresh (§5).
