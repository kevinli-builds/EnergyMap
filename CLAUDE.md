# Energy Map — Claude Context

## Notes & handoff — READ FIRST when told to "go through your notes"
**`OPUS_BRIEF.md`** (repo root, **gitignored / local-only** by design) is the
roadmap of record — product thesis, design/engineering audits, the §4 delight
ideas, the §9 depth roadmap, and a **status ledger at the top** (shipped vs
next). When asked to pick up the next enhancement: (1) read the brief; (2) run
`git log --oneline -20` + `git status` — a dirty working tree means another agent
is mid-flight (though `data/jobs.json` is *expected* dirty — it's the nightly
jobs bot's); (3) confirm the item is not already built; (4) build it with the
house conventions (verify, then commit + push).

## Concept
An interactive globe of the world's biggest solar / wind / battery / geothermal /
pumped-hydro / nuclear projects — operating or under construction — plus the
companies building them that are hiring. Two audiences: climate-curious browsers
and clean-energy job-seekers. The hiring layer is the differentiator.

## Stack
- **Next.js 16** (App Router, **static export** → `out/`), **React 19**,
  **TypeScript**, **MapLibre GL JS** (globe projection, dark Carto basemap).
- **No backend, no database, no API keys, no secrets.** Deploys anywhere static
  files go. The no-backend design is a feature — keep it that way.
- Hand-written CSS in `app/globals.css`.

## How the data works
Source of truth is plain JSON in `data/`. `scripts/build-data.mjs` (runs on
`predev`/`prebuild`) validates it and writes `public/data/{projects,companies,
transmission}.geojson`, which the map fetches at runtime. The other `build-*`
scripts fetch **public datasets** and bake committed GeoJSON/JSON — run them
occasionally, they are not part of the build:
- `npm run energy` → `data/energy-mix.json` (OWID/Ember per-country mix)
- `npm run coal` → `public/data/coal.geojson` (GEM coal plants ≥200 MW)
- `npm run parks` → `public/data/parks.geojson` (OSM protected areas)
- `npm run footprints` → `public/data/footprints.geojson` (OSM plant outlines)
- `npm run boundaries` → `public/data/boundaries.geojson` + `data/country-buildout.json`
  (Natural Earth 110m countries; **run `npm run data` first** — it point-in-polygon-joins projects to countries)
- `npm run jobs` → `data/jobs.json` (live open-role counts; also a nightly Action)
Keep every new build script the same shape: curated/public sources → numeric/text
output React escapes on render. Attribution is required (GEM/OWID CC BY 4.0, OSM
ODbL, Natural Earth public domain) — it's in the map's `customAttribution`.
Full source docs: `docs/DATA_SOURCES.md`.

## Architecture
```
app/
├── components/
│   ├── MapApp.tsx      Orchestrator (~456 lines): state + hooks + JSX
│   ├── mapLayers.ts    Pure map setup — addLayers (all sources/layers) + popup
│   │                   HTML builders + layer constants/types
│   ├── shared.ts       COLORS/TECHS, esc, fmtCapacity, choropleth METRICS + ramp
│   ├── Controls.tsx    HUD: tech chips, Live, metric picker, status, timeline
│   ├── CountryPanel.tsx  Energy-mix + §9 L2 build-out chart (country-buildout.json)
│   └── DetailPanel / FeaturedPanel / JobsPanel / ParksPanel / Intro
├── hooks/              Map wiring, one concern each:
│   ├── useMapInit      create map, load data, addLayers on style.load
│   ├── useMapStats     in-view totals
│   ├── useMapFilters   sync every layer's data/visibility to the filter state
│   ├── useLiveLayer    §4 D1 day/night toggle + terminator/glow timers
│   └── useLazyLayers   parks/coal/boundaries/footprints lazy loaders + flags
└── lib/solar.ts        Solar-position math for the day/night layer (dep-free)
```

## Run / dev
```
npm run dev        # http://localhost:3010 (regenerates data first)
npm run build      # static export → out/
npm run test:xlsx  # the only test — the dependency-free .xlsx reader
```

## Verifying changes (the globe won't composite in the preview pane)
Static export, so skip launch.json: `npm run build`, then
`npx serve out -l <port>` + open that URL. The **WebGL globe doesn't composite**
in the pane (screenshots time out), so verify numerically — prove geometry in a
node script against `out/data/*.geojson`, and use `get_page_text`/`read_page` for
the HUD/legend DOM + `read_console_messages` (a bad source id or paint expression
throws synchronously and shows there).

## Conventions
- Commit and push without asking; end commit messages with the Co-Authored-By line.
- Label estimates honestly ("rough estimate") — capacity-factor / CAGR / homes-powered numbers are never exact.
- Validate a build script's upstream response before baking (a GEM/ATS/NE schema change should fail loud, not ship a silently-broken layer).
- Keep `OPUS_BRIEF.md` gitignored and update its status ledger after shipping.

## Git / deploy
- **GitHub**: https://github.com/kevinli-builds/EnergyMap (branch `main`)
- **Live**: https://energy-mapper.vercel.app (Vercel, static export, no env vars).
  **Every push to `main` auto-deploys** — pushing = going live. The nightly
  jobs-bot commits are `[skip ci]`, so only a real push triggers a deploy.
