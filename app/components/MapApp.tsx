'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import Controls from './Controls';
import FeaturedPanel, { FeaturedLookup } from './FeaturedPanel';
import DetailPanel from './DetailPanel';
import JobsPanel from './JobsPanel';
import ParksPanel, { ParkProps } from './ParksPanel';
import Intro from './Intro';
import CountryPanel from './CountryPanel';
import CompareCard from './CompareCard';
import featured from '../../data/featured.json';
import energyMix from '../../data/energy-mix.json';
import { COLORS, fmtEnergy, Metric, StatusFilter, Tech, TECH_LABEL, TECHS } from './shared';
import { openCoalPopup, openCompanyPopup, openParkPopup } from './mapLayers';
import type { ClickHandlers, FC, LineFC, PointFeature } from './mapLayers';
import { useMapStats } from '../hooks/useMapStats';
import { useMapInit } from '../hooks/useMapInit';
import { useLiveLayer } from '../hooks/useLiveLayer';
import { useLazyLayers } from '../hooks/useLazyLayers';
import { useMapFilters } from '../hooks/useMapFilters';
import { useGenerationTicker } from '../hooks/useGenerationTicker';

// ISO-A3 → OWID country name, so a click on a choropleth country (which carries
// only its ISO) can open the energy-mix panel (keyed by name).
const ISO_TO_NAME: Record<string, string> = {};
for (const [name, m] of Object.entries(energyMix as Record<string, { iso?: string }>)) {
  if (m.iso) ISO_TO_NAME[m.iso] = name;
}

// GEM/curated country names → Our World in Data names (the few that differ).
const COUNTRY_ALIAS: Record<string, string> = {
  Türkiye: 'Turkey',
  'DR Congo': 'Democratic Republic of Congo',
};

// Commissioning-year timeline. Projects without a year are always shown (curated
// flagships lack one) — see the note in the UI. Max sits a few years ahead so
// under-construction projects with future start years aren't clipped at "All".
const YEAR_MIN = 2000;
const YEAR_MAX = new Date().getFullYear() + 3;

// Reflect the open panel in the URL (?p=<slug> for a project, ?c=<country> for the
// energy-mix panel) without touching the map position hash. null clears a param.
function setParams(params: Record<string, string | null>) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(null, '', url.toString());
}

export default function MapApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataRef = useRef<{ projects: FC; companies: FC; transmission: LineFC } | null>(null);
  const filteredRef = useRef<Record<Tech, PointFeature[]>>(
    Object.fromEntries(TECHS.map((t) => [t, [] as PointFeature[]])) as Record<Tech, PointFeature[]>
  );
  const handlersRef = useRef<ClickHandlers>({
    selectProject: () => {},
    selectCompany: () => {},
    selectPark: () => {},
    selectCoal: () => {},
    selectFootprint: () => {},
    selectBoundary: () => {},
  });

  const [tab, setTab] = useState<'projects' | 'jobs' | 'parks'>('projects');
  // Each tab owns its slice of the globe; `showAll` un-gates them all at once.
  const [showAll, setShowAll] = useState(false);
  const [techOn, setTechOn] = useState<Record<Tech, boolean>>(
    () => Object.fromEntries(TECHS.map((t) => [t, true])) as Record<Tech, boolean>
  );
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minCap, setMinCap] = useState(0);
  const [companiesOn, setCompaniesOn] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const [metric, setMetric] = useState<Metric>('off');
  const [coalOn, setCoalOn] = useState(false);
  const [year, setYear] = useState(YEAR_MAX);
  const [playing, setPlaying] = useState(false);
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [countryName, setCountryName] = useState<string | null>(null);
  const [visitableOnly, setVisitableOnly] = useState(false);
  const [hudOpen, setHudOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 640));
  const [statsOpen, setStatsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [tourOn, setTourOn] = useState(false);
  const [tourItem, setTourItem] = useState<{ name: string; blurb: string } | null>(null);
  // §4 D4: up to two projects staged for the head-to-head compare card.
  const [compare, setCompare] = useState<Record<string, any>[]>([]);

  // Map lifecycle, data, and layer sync are split into focused hooks (see app/hooks).
  const { stats, recomputeStats } = useMapStats(mapRef, filteredRef);
  const { ready, companiesList } = useMapInit({ containerRef, mapRef, dataRef, handlersRef, recomputeStats });
  const { liveOn, setLiveOn, refreshLive } = useLiveLayer(mapRef, ready, filteredRef);
  const { coalRef, footprintsRef, parksList, parksLoading, coalReady, footprintsReady, boundariesReady } =
    useLazyLayers({ mapRef, ready, tab, showAll, metric, coalOn });
  useMapFilters({
    mapRef, dataRef, filteredRef, coalRef, footprintsRef,
    ready, techOn, status, minCap, companiesOn, gridOn, liveOn, metric, boundariesReady,
    coalOn, coalReady, year, yearMax: YEAR_MAX, tab, showAll, visitableOnly, footprintsReady,
    refreshLive, recomputeStats,
  });
  // §4 D2 "generating now" ticker — runs while the Projects view is showing.
  const genMwh = useGenerationTicker(mapRef, filteredRef, ready, tab === 'projects' || showAll);

  const selectProject = useCallback((p: Record<string, any>) => {
    setTourOn(false);
    setFeaturedOpen(false);
    setCountryName(null);
    setSelected(p);
    setParams({ p: p.slug ?? null, c: null });
  }, []);

  // A footprint carries only a slug — resolve it to the full project so the
  // detail panel shows owner/note/links just like clicking the dot.
  const selectFootprint = useCallback(
    (slug: string) => {
      const f = dataRef.current?.projects.features.find((x) => x.properties.slug === slug);
      if (f) selectProject(f.properties);
    },
    [selectProject]
  );

  // Open the country energy-mix panel (input is a project country name).
  const openCountry = useCallback((projectCountry: string) => {
    const owid = COUNTRY_ALIAS[projectCountry] ?? projectCountry;
    setTourOn(false);
    setSelected(null);
    setFeaturedOpen(false);
    setCountryName(owid);
    setParams({ c: owid, p: null });
  }, []);

  // Clicking a choropleth country → open its energy-mix panel (ISO → OWID name).
  const selectBoundary = useCallback((iso: string) => {
    const name = ISO_TO_NAME[iso];
    if (!name) return;
    setTourOn(false);
    setSelected(null);
    setFeaturedOpen(false);
    setCountryName(name);
    setParams({ c: name, p: null });
  }, []);

  // Switch the country shown in the already-open panel (keeps ?c= in sync).
  const changeCountry = useCallback((owidName: string) => {
    setCountryName(owidName);
    setParams({ c: owidName });
  }, []);

  const closeCountry = useCallback(() => {
    setCountryName(null);
    setParams({ c: null });
  }, []);

  const togglePlay = () => {
    if (!playing && year >= YEAR_MAX) setYear(YEAR_MIN); // rewind if starting from the end
    setPlaying((p) => !p);
  };

  const selectCompany = useCallback((coords: [number, number], p: Record<string, any>) => {
    const map = mapRef.current;
    if (map) openCompanyPopup(map, coords, p);
  }, []);

  const selectPark = useCallback((coords: [number, number], p: Record<string, any>) => {
    const map = mapRef.current;
    if (map) openParkPopup(map, coords, p);
  }, []);

  const selectCoal = useCallback((coords: [number, number], p: Record<string, any>) => {
    const map = mapRef.current;
    if (map) openCoalPopup(map, coords, p);
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setParams({ p: null });
  }, []);

  // Stage a project for compare: a third pick starts a fresh pair; re-staging the
  // same project is a no-op. Two staged → the head-to-head card renders.
  const addCompare = useCallback((p: Record<string, any>) => {
    setCompare((prev) => {
      if (prev.length >= 2) return [p];
      if (prev.some((x) => x.slug === p.slug)) return prev;
      return [...prev, p];
    });
  }, []);

  // First visit: show the welcome overlay once (unless arriving on a ?p= deep
  // link — don't cover the project someone was sent to look at).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const deepLinked = q.has('p') || q.has('c');
      if (!deepLinked && !localStorage.getItem('em.introSeen')) setIntroOpen(true);
    } catch {
      // storage unavailable (private mode) — skip the intro rather than loop it
    }
  }, []);

  const closeIntro = useCallback(() => {
    setIntroOpen(false);
    try {
      localStorage.setItem('em.introSeen', '1');
    } catch {}
  }, []);

  // Keep the map's click handlers pointing at the latest callbacks.
  handlersRef.current = { selectProject, selectCompany, selectPark, selectCoal, selectFootprint, selectBoundary };

  // Resolve deep links once data is ready: ?p=<slug> opens a project (and flies
  // there); otherwise ?c=<country> opens the energy-mix panel.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('p');
    if (slug) {
      const f = dataRef.current?.projects.features.find((x) => x.properties.slug === slug);
      if (f) {
        setSelected(f.properties);
        mapRef.current?.flyTo({ center: f.geometry.coordinates, zoom: 6, duration: 2000 });
      }
      return;
    }
    const c = params.get('c');
    if (c) setCountryName(COUNTRY_ALIAS[c] ?? c);
  }, [ready]);

  // Featured "tour": auto-fly between highlights every 8s, blurb overlaid.
  useEffect(() => {
    if (!tourOn) return;
    setFeaturedOpen(false);
    setSelected(null);
    setCountryName(null);
    setParams({ p: null, c: null });
    let i = 0;
    const step = () => {
      const item = featured[i % featured.length];
      i++;
      setTourItem(item);
      const f = dataRef.current?.projects.features.find((x) => x.properties.name === item.name);
      if (f) mapRef.current?.flyTo({ center: f.geometry.coordinates, zoom: 5.5, duration: 4000 });
    };
    step();
    const id = setInterval(step, 8000);
    return () => clearInterval(id);
  }, [tourOn]);

  // Timeline playback: advance the year each tick while playing, stop at the end.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setYear((y) => Math.min(YEAR_MAX, y + 1)), 650);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    if (playing && year >= YEAR_MAX) setPlaying(false);
  }, [playing, year]);

  const lookupFeatured = useCallback((name: string): FeaturedLookup | null => {
    const f = dataRef.current?.projects.features.find((x) => x.properties.name === name);
    if (!f) return null;
    const p = f.properties;
    return { country: p.country, capacityMW: p.capacityMW, energyMWh: p.energyMWh, tech: p.tech, status: p.status };
  }, []);

  const flyToFeatured = useCallback((name: string) => {
    const map = mapRef.current;
    const f = dataRef.current?.projects.features.find((x) => x.properties.name === name);
    if (!map || !f) return;
    setFeaturedOpen(false);
    setCountryName(null);
    setSelected(f.properties);
    setParams({ p: f.properties.slug ?? null, c: null });
    map.flyTo({ center: f.geometry.coordinates, zoom: 6.5, duration: 2200 });
  }, []);

  const flyToCompany = useCallback((name: string) => {
    const map = mapRef.current;
    const f = dataRef.current?.companies.features.find((x) => x.properties.name === name);
    if (!map || !f) return;
    map.flyTo({ center: f.geometry.coordinates, zoom: 5, duration: 1800 });
    map.once('moveend', () => openCompanyPopup(map, f.geometry.coordinates, f.properties));
  }, []);

  const flyToPark = useCallback((p: ParkProps) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: p.coordinates, zoom: 6, duration: 1800 });
    map.once('moveend', () => openParkPopup(map, p.coordinates, p as any));
  }, []);

  return (
    <div className="map-root">
      <div ref={containerRef} className="map-canvas" />
      <div className={`hud ${hudOpen ? '' : 'collapsed'}`}>
        <div className="hud-head">
          <h1>⚡ Energy Map</h1>
          <div className="hud-btns">
            <button className="hud-toggle" onClick={() => setIntroOpen(true)} aria-label="About this map">
              ?
            </button>
            <button className="hud-toggle" onClick={() => setHudOpen((v) => !v)} aria-label="Toggle panel">
              {hudOpen ? '▾' : '☰'}
            </button>
          </div>
        </div>

        {hudOpen && (
          <>
            <p className="tagline">The world’s biggest clean-energy projects — and who’s building them</p>

            <div className="tabs">
              <button className={tab === 'projects' ? 'on' : ''} onClick={() => setTab('projects')}>
                🗺 Projects
              </button>
              <button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>
                🏢 Jobs
              </button>
              <button className={tab === 'parks' ? 'on' : ''} onClick={() => setTab('parks')}>
                🌲 Parks
              </button>
            </div>

            <label className="show-all" title="Show projects, jobs and parks on the globe at once">
              <input type="checkbox" checked={showAll} onChange={() => setShowAll((v) => !v)} />
              Show all on the globe
            </label>

            {tab === 'projects' ? (
              <Controls
                techOn={techOn}
                onTech={(t) => setTechOn((s) => ({ ...s, [t]: !s[t] }))}
                gridOn={gridOn}
                onGrid={() => setGridOn((v) => !v)}
                coalOn={coalOn}
                onCoal={() => setCoalOn((v) => !v)}
                liveOn={liveOn}
                onLive={() => setLiveOn((v) => !v)}
                metric={metric}
                onMetric={setMetric}
                status={status}
                onStatus={setStatus}
                minCap={minCap}
                onMinCap={setMinCap}
                year={year}
                yearMin={YEAR_MIN}
                yearMax={YEAR_MAX}
                onYear={(y) => {
                  setPlaying(false);
                  setYear(y);
                }}
                playing={playing}
                onPlay={togglePlay}
                onFeatured={() => setFeaturedOpen((v) => !v)}
              />
            ) : tab === 'jobs' ? (
              <JobsPanel
                companies={companiesList}
                companiesOn={companiesOn}
                onToggle={() => setCompaniesOn((v) => !v)}
                onSelect={flyToCompany}
              />
            ) : (
              <ParksPanel
                parks={parksList}
                loading={parksLoading}
                visitableOnly={visitableOnly}
                onToggleVisitable={() => setVisitableOnly((v) => !v)}
                onSelect={flyToPark}
              />
            )}
          </>
        )}
      </div>

      {!tourOn && selected ? (
        <DetailPanel
          project={selected}
          onClose={closeDetail}
          onCompare={addCompare}
          staged={compare.some((x) => x.slug === selected.slug)}
        />
      ) : !tourOn && countryName ? (
        <CountryPanel country={countryName} onCountry={changeCountry} onClose={closeCountry} />
      ) : !tourOn && featuredOpen ? (
        <FeaturedPanel
          lookup={lookupFeatured}
          onSelect={flyToFeatured}
          onClose={() => setFeaturedOpen(false)}
          onTour={() => setTourOn(true)}
        />
      ) : null}

      {compare.length === 2 && <CompareCard a={compare[0]} b={compare[1]} onClose={() => setCompare([])} />}

      {introOpen && (
        <Intro
          onClose={closeIntro}
          onTour={() => {
            closeIntro();
            setTourOn(true);
          }}
        />
      )}

      {tourOn && tourItem && (
        <div className="tour-caption">
          <div className="tc-name">★ {tourItem.name}</div>
          <div className="tc-blurb">{tourItem.blurb}</div>
          <button className="tc-stop" onClick={() => setTourOn(false)}>
            ■ Stop tour
          </button>
        </div>
      )}

      {(tab === 'projects' || showAll) && (
      <div className="stats-wrap">
        {statsOpen && ready && (
          <div className="stats-panel">
            <div className="sp-section">
              <div className="sp-title">Capacity by technology · in view</div>
              {stats.byTech.length ? (
                stats.byTech.map((t) => (
                  <div className="sp-bar-row" key={t.tech}>
                    <span className="sp-bar-label">{TECH_LABEL[t.tech]}</span>
                    <span className="sp-bar">
                      <span
                        className="sp-bar-fill"
                        style={{ width: `${(t.gw / (stats.byTech[0].gw || 1)) * 100}%`, background: COLORS[t.tech] }}
                      />
                    </span>
                    <span className="sp-bar-val">{t.gw.toFixed(1)} GW</span>
                  </div>
                ))
              ) : (
                <div className="sp-empty">Nothing in view.</div>
              )}
            </div>
            <div className="sp-section">
              <div className="sp-title">Top countries · in view</div>
              <table className="sp-table">
                <tbody>
                  {stats.byCountry.map((c) => (
                    <tr key={c.country}>
                      <td>
                        <button className="sp-country" onClick={() => openCountry(c.country)} title="Show energy mix">
                          {c.country}
                        </button>
                      </td>
                      <td>{c.count}</td>
                      <td>{c.gw.toFixed(1)} GW</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="sp-country-more" onClick={() => openCountry(stats.byCountry[0]?.country || 'United States')}>
                🌍 Country energy mix — green vs. fossil →
              </button>
            </div>
          </div>
        )}
        {ready && genMwh > 0 && (
          <div
            className="gen-ticker"
            title="Rough estimate: in-view operating projects × per-technology capacity factor. Solar tracks the sun."
          >
            ⚡ ≈ <b>{fmtEnergy(genMwh)}</b> generated in view <span className="gt-since">since you arrived</span>
          </div>
        )}
        <button className="stats" onClick={() => setStatsOpen((v) => !v)}>
          {ready ? `${stats.count} projects · ${stats.gw.toFixed(1)} GW in view` : 'Loading data…'}
          <span className="stats-caret">{statsOpen ? '▾' : '▴'}</span>
        </button>
      </div>
      )}
    </div>
  );
}
