'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import Controls from './Controls';
import FeaturedPanel, { FeaturedLookup } from './FeaturedPanel';
import DetailPanel from './DetailPanel';
import JobsPanel, { CompanyProps } from './JobsPanel';
import { COLORS, esc, StatusFilter, Tech, TECHS } from './shared';

type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, any>;
};
type FC = { type: 'FeatureCollection'; features: PointFeature[] };

type ClickHandlers = {
  selectProject: (p: Record<string, any>) => void;
  selectCompany: (coords: [number, number], p: Record<string, any>) => void;
};

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

// Reflect the open project in the URL (?p=<slug>) without touching the map hash.
function setQueryParam(slug: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set('p', slug);
  else url.searchParams.delete('p');
  window.history.replaceState(null, '', url.toString());
}

function openCompanyPopup(map: maplibregl.Map, coords: [number, number], p: Record<string, any>) {
  const roles = p.openRoles != null ? `<div class="roles">${Number(p.openRoles)} open roles</div>` : '';
  const html = `<div class="pp">
    <div class="pp-title">${esc(p.name)}</div>
    <div class="pp-sub">${esc(p.focus)} · ${esc(p.hq)}</div>
    ${roles}
    <a href="${esc(p.careersUrl)}" target="_blank" rel="noopener noreferrer">View careers ↗</a>
  </div>`;
  new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(coords).setHTML(html).addTo(map);
}

function addLayers(map: maplibregl.Map, companies: FC, handlers: React.MutableRefObject<ClickHandlers>) {
  for (const tech of TECHS) {
    const color = COLORS[tech];
    map.addSource(`proj-${tech}`, {
      type: 'geojson',
      data: EMPTY as any,
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 42,
    });
    map.addLayer({
      id: `proj-${tech}-cluster`,
      type: 'circle',
      source: `proj-${tech}`,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-opacity': 0.55,
        'circle-stroke-color': color,
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.9,
        'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 13, 30, 22, 200, 32],
      } as any,
    });
    map.addLayer({
      id: `proj-${tech}-count`,
      type: 'symbol',
      source: `proj-${tech}`,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 11,
        'text-font': ['Montserrat Regular'],
      } as any,
      paint: { 'text-color': '#0b0e14' } as any,
    });
    map.addLayer({
      id: `proj-${tech}-pt`,
      type: 'circle',
      source: `proj-${tech}`,
      filter: ['!', ['has', 'point_count']],
      paint: {
        // dot area scales with sqrt(MW): 9 MW → 4px, 3600 MW → 15px (clamped beyond)
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'capacityMW'], 50]], 3, 4, 60, 15],
        // operating = filled, under construction = hollow ring
        'circle-color': ['case', ['==', ['get', 'status'], 'operating'], color, 'rgba(0,0,0,0)'],
        'circle-opacity': 0.9,
        'circle-stroke-color': color,
        'circle-stroke-width': ['case', ['==', ['get', 'status'], 'operating'], 1, 2],
      } as any,
    });
  }

  map.addSource('companies', { type: 'geojson', data: companies as any });
  map.addLayer({
    id: 'companies-pt',
    type: 'circle',
    source: 'companies',
    paint: {
      'circle-radius': 5,
      'circle-color': COLORS.company,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
    },
  });

  const pointLayers = [...TECHS.map((t) => `proj-${t}-pt`), ...TECHS.map((t) => `proj-${t}-cluster`), 'companies-pt'];
  for (const layer of pointLayers) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  for (const tech of TECHS) {
    map.on('click', `proj-${tech}-cluster`, async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource(`proj-${tech}`) as maplibregl.GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom((f.properties as any).cluster_id);
      map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.5 });
    });
    map.on('click', `proj-${tech}-pt`, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      handlers.current.selectProject(f.properties as any);
    });
  }
  map.on('click', 'companies-pt', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    handlers.current.selectCompany((f.geometry as any).coordinates, f.properties as any);
  });
}

export default function MapApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataRef = useRef<{ projects: FC; companies: FC } | null>(null);
  const filteredRef = useRef<Record<Tech, PointFeature[]>>(
    Object.fromEntries(TECHS.map((t) => [t, [] as PointFeature[]])) as Record<Tech, PointFeature[]>
  );
  const handlersRef = useRef<ClickHandlers>({ selectProject: () => {}, selectCompany: () => {} });

  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'map' | 'jobs'>('map');
  const [techOn, setTechOn] = useState<Record<Tech, boolean>>(
    () => Object.fromEntries(TECHS.map((t) => [t, true])) as Record<Tech, boolean>
  );
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minCap, setMinCap] = useState(0);
  const [companiesOn, setCompaniesOn] = useState(true);
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [companiesList, setCompaniesList] = useState<CompanyProps[]>([]);
  const [stats, setStats] = useState({ count: 0, gw: 0 });

  const recomputeStats = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    let count = 0;
    let mw = 0;
    for (const tech of TECHS) {
      for (const f of filteredRef.current[tech]) {
        if (bounds.contains(f.geometry.coordinates)) {
          count++;
          mw += f.properties.capacityMW ?? 0;
        }
      }
    }
    setStats({ count, gw: mw / 1000 });
  }, []);

  const selectProject = useCallback((p: Record<string, any>) => {
    setFeaturedOpen(false);
    setSelected(p);
    setQueryParam(p.slug ?? null);
  }, []);

  const selectCompany = useCallback((coords: [number, number], p: Record<string, any>) => {
    const map = mapRef.current;
    if (map) openCompanyPopup(map, coords, p);
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setQueryParam(null);
  }, []);

  // Keep the map's click handlers pointing at the latest callbacks.
  handlersRef.current = { selectProject, selectCompany };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [12, 22],
      zoom: 1.6,
      minZoom: 1.1,
      hash: true,
      attributionControl: {
        compact: true,
        customAttribution:
          'Projects: <a href="https://globalenergymonitor.org/" target="_blank" rel="noopener">Global Energy Monitor</a> (CC BY 4.0) + curated set',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Fetch the data in parallel with the style load — it doesn't depend on the map.
    const dataPromise = Promise.all([
      fetch('/data/projects.geojson').then((r) => r.json() as Promise<FC>),
      fetch('/data/companies.geojson').then((r) => r.json() as Promise<FC>),
    ]);

    // Add sources/layers on 'style.load' rather than 'load': 'load' waits for a first
    // render, which never happens if the map mounts in a zero-size or hidden container
    // (hidden tabs, CSS transitions, some preview harnesses). 'style.load' only needs
    // the style parsed, so it fires regardless of canvas size.
    let initialized = false;
    map.on('style.load', async () => {
      if (initialized) return;
      initialized = true;
      try {
        map.setProjection({ type: 'globe' });
      } catch {
        // older maplibre without globe support — flat map is fine
      }
      const [projects, companies] = await dataPromise;
      dataRef.current = { projects, companies };
      addLayers(map, companies, handlersRef);
      setCompaniesList(companies.features.map((f) => f.properties as CompanyProps));
      setReady(true);
    });
    map.on('moveend', recomputeStats);

    // Kick a resize when the container gains a real size, so rendering starts even if
    // the map was created while the container was zero-size/hidden. Ignore zero-size
    // and unchanged reports so a hidden/animating container can't thrash resize().
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      map.resize();
    });
    ro.observe(container);

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply filters by rebuilding each tech's source data
  useEffect(() => {
    const map = mapRef.current;
    const data = dataRef.current;
    if (!ready || !map || !data) return;
    for (const tech of TECHS) {
      const feats = techOn[tech]
        ? data.projects.features.filter(
            (f) =>
              f.properties.tech === tech &&
              (status === 'all' || f.properties.status === status) &&
              (f.properties.capacityMW ?? 0) >= minCap
          )
        : [];
      filteredRef.current[tech] = feats;
      (map.getSource(`proj-${tech}`) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: feats,
      } as any);
    }
    if (map.getLayer('companies-pt')) {
      map.setLayoutProperty('companies-pt', 'visibility', companiesOn ? 'visible' : 'none');
    }
    recomputeStats();
  }, [ready, techOn, status, minCap, companiesOn, recomputeStats]);

  // Resolve a ?p=<slug> deep link once data is ready: open its detail + fly there.
  useEffect(() => {
    if (!ready) return;
    const slug = new URLSearchParams(window.location.search).get('p');
    if (!slug) return;
    const f = dataRef.current?.projects.features.find((x) => x.properties.slug === slug);
    if (!f) return;
    setSelected(f.properties);
    mapRef.current?.flyTo({ center: f.geometry.coordinates, zoom: 6, duration: 2000 });
  }, [ready]);

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
    setSelected(f.properties);
    setQueryParam(f.properties.slug ?? null);
    map.flyTo({ center: f.geometry.coordinates, zoom: 6.5, duration: 2200 });
  }, []);

  const flyToCompany = useCallback((name: string) => {
    const map = mapRef.current;
    const f = dataRef.current?.companies.features.find((x) => x.properties.name === name);
    if (!map || !f) return;
    map.flyTo({ center: f.geometry.coordinates, zoom: 5, duration: 1800 });
    map.once('moveend', () => openCompanyPopup(map, f.geometry.coordinates, f.properties));
  }, []);

  return (
    <div className="map-root">
      <div ref={containerRef} className="map-canvas" />
      <div className="hud">
        <h1>⚡ Energy Map</h1>
        <p className="tagline">The world’s biggest clean-energy projects — and who’s building them</p>

        <div className="tabs">
          <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
            🗺 Map
          </button>
          <button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>
            🏢 Jobs
          </button>
        </div>

        {tab === 'map' ? (
          <Controls
            techOn={techOn}
            onTech={(t) => setTechOn((s) => ({ ...s, [t]: !s[t] }))}
            status={status}
            onStatus={setStatus}
            minCap={minCap}
            onMinCap={setMinCap}
            onFeatured={() => setFeaturedOpen((v) => !v)}
          />
        ) : (
          <JobsPanel
            companies={companiesList}
            companiesOn={companiesOn}
            onToggle={() => setCompaniesOn((v) => !v)}
            onSelect={flyToCompany}
          />
        )}
      </div>

      {selected ? (
        <DetailPanel project={selected} onClose={closeDetail} />
      ) : featuredOpen ? (
        <FeaturedPanel lookup={lookupFeatured} onSelect={flyToFeatured} onClose={() => setFeaturedOpen(false)} />
      ) : null}

      <div className="stats">
        {ready ? `${stats.count} projects · ${stats.gw.toFixed(1)} GW in view` : 'Loading data…'}
      </div>
    </div>
  );
}
