'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import Controls from './Controls';
import FeaturedPanel, { FeaturedLookup } from './FeaturedPanel';
import DetailPanel from './DetailPanel';
import JobsPanel, { CompanyProps } from './JobsPanel';
import ParksPanel, { ParkProps } from './ParksPanel';
import Intro from './Intro';
import CountryPanel from './CountryPanel';
import featured from '../../data/featured.json';
import { COLORS, esc, fmtCapacity, StatusFilter, Tech, TECH_LABEL, TECHS } from './shared';

type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, any>;
};
type FC = { type: 'FeatureCollection'; features: PointFeature[] };
type LineFC = { type: 'FeatureCollection'; features: any[] };

// GEM/curated country names → Our World in Data names (the few that differ).
const COUNTRY_ALIAS: Record<string, string> = {
  Türkiye: 'Turkey',
  'DR Congo': 'Democratic Republic of Congo',
};

const GRID_COLOR = '#fb923c';

// Commissioning-year timeline. Projects without a year are always shown (curated
// flagships lack one) — see the note in the UI. Max sits a few years ahead so
// under-construction projects with future start years aren't clipped at "All".
const YEAR_MIN = 2000;
const YEAR_MAX = new Date().getFullYear() + 3;

type ClickHandlers = {
  selectProject: (p: Record<string, any>) => void;
  selectCompany: (coords: [number, number], p: Record<string, any>) => void;
  selectPark: (coords: [number, number], p: Record<string, any>) => void;
  selectFootprint: (slug: string) => void;
};

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

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

function openTransmissionPopup(map: maplibregl.Map, lngLat: maplibregl.LngLatLike, p: Record<string, any>) {
  const statusHtml =
    p.status === 'operating'
      ? '<span class="badge op">Operating</span>'
      : '<span class="badge uc">Under construction</span>';
  const kind = p.type === 'interconnector' ? 'Interconnector' : 'Transmission line';
  const route = p.from && p.to ? `${esc(p.from)} → ${esc(p.to)}` : '';
  const html = `<div class="pp">
    <div class="pp-title">${esc(p.name)}</div>
    <div class="pp-sub">${kind}${route ? ' · ' + route : ''}</div>
    <div class="pp-cap">${esc(fmtCapacity(p.capacityMW))}</div>
    ${statusHtml}
    ${p.note ? `<div class="pp-note">${esc(p.note)}</div>` : ''}
  </div>`;
  new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(lngLat).setHTML(html).addTo(map);
}

function openParkPopup(map: maplibregl.Map, coords: [number, number], p: Record<string, any>) {
  const visit = p.visitable
    ? '<span class="badge op">✓ Open to visitors</span>'
    : '<span class="badge uc">Restricted access</span>';
  // Prefer an official site; else link the Wikipedia article if OSM has one.
  let link = '';
  if (p.website) {
    link = `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Official site ↗</a>`;
  } else if (p.wikipedia) {
    // OSM wikipedia tag is "lang:Title"
    const [lang, ...rest] = String(p.wikipedia).split(':');
    const title = rest.join(':') || lang;
    const url = `https://${rest.length ? lang : 'en'}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    link = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>`;
  }
  const html = `<div class="pp">
    <div class="pp-title">${esc(p.name)}</div>
    <div class="pp-sub">${esc(p.type)}</div>
    ${visit}
    ${link}
  </div>`;
  new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(coords).setHTML(html).addTo(map);
}

// Per-tech fill/line colour for footprint polygons.
const techColorMatch = ['match', ['get', 'tech'], ...TECHS.flatMap((t) => [t, COLORS[t]]), '#888'] as any;

function addLayers(map: maplibregl.Map, companies: FC, transmission: LineFC, handlers: React.MutableRefObject<ClickHandlers>) {
  // Transmission lines first, so project dots draw on top of them.
  map.addSource('transmission', { type: 'geojson', data: transmission as any });
  const lineWidth = ['interpolate', ['linear'], ['zoom'], 2, 1.6, 6, 3.6] as any;
  // Soft glow so the thin lines read on the dark globe at any zoom.
  map.addLayer({
    id: 'transmission-glow',
    type: 'line',
    source: 'transmission',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': GRID_COLOR,
      'line-opacity': 0.25,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 11] as any,
      'line-blur': 4,
    },
  });
  map.addLayer({
    id: 'transmission-op',
    type: 'line',
    source: 'transmission',
    filter: ['==', ['get', 'status'], 'operating'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': GRID_COLOR, 'line-opacity': 0.95, 'line-width': lineWidth },
  });
  map.addLayer({
    id: 'transmission-uc',
    type: 'line',
    source: 'transmission',
    filter: ['==', ['get', 'status'], 'construction'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': GRID_COLOR, 'line-opacity': 0.95, 'line-width': lineWidth, 'line-dasharray': [1.5, 1.5] },
  });
  // Wide, invisible line for an easier click/hover target.
  map.addLayer({
    id: 'transmission-hit',
    type: 'line',
    source: 'transmission',
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 },
  });
  map.on('mouseenter', 'transmission-hit', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'transmission-hit', () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('click', 'transmission-hit', (e) => {
    const f = e.features?.[0];
    if (f) openTransmissionPopup(map, e.lngLat, f.properties as any);
  });

  // Project footprints — the real land area each project covers (OSM power=plant
  // polygons). Empty until lazily loaded, and only visible once you zoom in
  // (minzoom 9), where clusters have already broken apart into individual dots.
  // Drawn here, beneath the dots, so each dot still sits on top of its area.
  map.addSource('footprints', { type: 'geojson', data: EMPTY as any });
  map.addLayer({
    id: 'footprints-fill',
    type: 'fill',
    source: 'footprints',
    minzoom: 9,
    paint: {
      'fill-color': techColorMatch,
      // fade the fill in as you zoom past the cluster-break so it doesn't pop.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 11, 0.35] as any,
    },
  });
  map.addLayer({
    id: 'footprints-line',
    type: 'line',
    source: 'footprints',
    minzoom: 9,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': techColorMatch,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 13, 2] as any,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 11, 0.9] as any,
    },
  });

  // Protected areas (national parks, reserves) — clustered like projects. The
  // source starts empty and is filled lazily when the Parks tab is first opened,
  // so the ~9 MB dataset never touches the initial page load. Hidden by default.
  map.addSource('parks', {
    type: 'geojson',
    data: EMPTY as any,
    cluster: true,
    clusterMaxZoom: 7,
    clusterRadius: 44,
  });
  map.addLayer({
    id: 'parks-cluster',
    type: 'circle',
    source: 'parks',
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': COLORS.park,
      'circle-opacity': 0.45,
      'circle-stroke-color': COLORS.park,
      'circle-stroke-width': 1.4,
      'circle-stroke-opacity': 0.85,
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 12, 50, 20, 1000, 32],
    } as any,
  });
  map.addLayer({
    id: 'parks-count',
    type: 'symbol',
    source: 'parks',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 11,
      'text-font': ['Montserrat Regular'],
      visibility: 'none',
    } as any,
    paint: { 'text-color': '#0b0e14' } as any,
  });
  map.addLayer({
    id: 'parks-pt',
    type: 'circle',
    source: 'parks',
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 8, 5],
      // visitable = filled green; restricted/strict = hollow ring
      'circle-color': ['case', ['get', 'visitable'], COLORS.park, 'rgba(0,0,0,0)'],
      'circle-opacity': 0.85,
      'circle-stroke-color': COLORS.park,
      'circle-stroke-width': ['case', ['get', 'visitable'], 0.6, 1.6],
    } as any,
  });

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

  const pointLayers = [
    ...TECHS.map((t) => `proj-${t}-pt`),
    ...TECHS.map((t) => `proj-${t}-cluster`),
    'companies-pt',
    'parks-pt',
    'parks-cluster',
  ];
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
  map.on('click', 'parks-cluster', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const src = map.getSource('parks') as maplibregl.GeoJSONSource;
    const zoom = await src.getClusterExpansionZoom((f.properties as any).cluster_id);
    map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.5 });
  });
  map.on('click', 'parks-pt', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    handlers.current.selectPark((f.geometry as any).coordinates, f.properties as any);
  });

  // Clicking a footprint opens the same detail panel as its dot (by slug).
  map.on('mouseenter', 'footprints-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'footprints-fill', () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('click', 'footprints-fill', (e) => {
    const f = e.features?.[0];
    if (f) handlers.current.selectFootprint((f.properties as any).slug);
  });
}

export default function MapApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataRef = useRef<{ projects: FC; companies: FC; transmission: LineFC } | null>(null);
  const footprintsRef = useRef<LineFC | null>(null);
  const footprintsLoadedRef = useRef(false);
  const filteredRef = useRef<Record<Tech, PointFeature[]>>(
    Object.fromEntries(TECHS.map((t) => [t, [] as PointFeature[]])) as Record<Tech, PointFeature[]>
  );
  const handlersRef = useRef<ClickHandlers>({
    selectProject: () => {},
    selectCompany: () => {},
    selectPark: () => {},
    selectFootprint: () => {},
  });

  const [ready, setReady] = useState(false);
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
  const [year, setYear] = useState(YEAR_MAX);
  const [playing, setPlaying] = useState(false);
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [countryName, setCountryName] = useState<string | null>(null);
  const [companiesList, setCompaniesList] = useState<CompanyProps[]>([]);
  const [parksList, setParksList] = useState<ParkProps[]>([]);
  const [parksLoading, setParksLoading] = useState(false);
  const [visitableOnly, setVisitableOnly] = useState(false);
  const [footprintsReady, setFootprintsReady] = useState(false);
  const parksLoadedRef = useRef(false);
  const [hudOpen, setHudOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 640));
  const [statsOpen, setStatsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [tourOn, setTourOn] = useState(false);
  const [tourItem, setTourItem] = useState<{ name: string; blurb: string } | null>(null);
  const [stats, setStats] = useState<{
    count: number;
    gw: number;
    byTech: { tech: Tech; gw: number }[];
    byCountry: { country: string; gw: number; count: number }[];
  }>({ count: 0, gw: 0, byTech: [], byCountry: [] });

  const recomputeStats = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    let count = 0;
    let mw = 0;
    const techMw: Record<string, number> = {};
    const countryMw = new Map<string, { gw: number; count: number }>();
    for (const tech of TECHS) {
      for (const f of filteredRef.current[tech]) {
        if (!bounds.contains(f.geometry.coordinates)) continue;
        const m = f.properties.capacityMW ?? 0;
        count++;
        mw += m;
        techMw[tech] = (techMw[tech] ?? 0) + m;
        const c = f.properties.country || '—';
        const e = countryMw.get(c) ?? { gw: 0, count: 0 };
        e.gw += m / 1000;
        e.count++;
        countryMw.set(c, e);
      }
    }
    const byTech = TECHS.map((t) => ({ tech: t, gw: (techMw[t] ?? 0) / 1000 }))
      .filter((x) => x.gw > 0)
      .sort((a, b) => b.gw - a.gw);
    const byCountry = [...countryMw.entries()]
      .map(([country, v]) => ({ country, gw: v.gw, count: v.count }))
      .sort((a, b) => b.gw - a.gw)
      .slice(0, 8);
    setStats({ count, gw: mw / 1000, byTech, byCountry });
  }, []);

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

  const closeDetail = useCallback(() => {
    setSelected(null);
    setParams({ p: null });
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
  handlersRef.current = { selectProject, selectCompany, selectPark, selectFootprint };

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
          'Projects: <a href="https://globalenergymonitor.org/" target="_blank" rel="noopener">Global Energy Monitor</a> (CC BY 4.0) + curated set · Footprints & parks: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> contributors (ODbL)',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Fetch the data in parallel with the style load — it doesn't depend on the map.
    const dataPromise = Promise.all([
      fetch('/data/projects.geojson').then((r) => r.json() as Promise<FC>),
      fetch('/data/companies.geojson').then((r) => r.json() as Promise<FC>),
      fetch('/data/transmission.geojson').then((r) => r.json() as Promise<LineFC>),
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
      const [projects, companies, transmission] = await dataPromise;
      dataRef.current = { projects, companies, transmission };
      addLayers(map, companies, transmission, handlersRef);
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
    const yearActive = year < YEAR_MAX; // "All" position applies no year filter
    // The active tab decides which half of the globe is shown; "show all" un-gates both.
    const showProjects = tab === 'projects' || showAll;
    const showJobs = tab === 'jobs' || showAll;
    // Same predicate for a project's dot and its footprint, so they stay in sync.
    const passes = (props: Record<string, any>) =>
      techOn[props.tech as Tech] &&
      (status === 'all' || props.status === status) &&
      (props.capacityMW ?? 0) >= minCap &&
      (!yearActive || props.year == null || props.year <= year);
    for (const tech of TECHS) {
      const feats = techOn[tech]
        ? data.projects.features.filter((f) => f.properties.tech === tech && passes(f.properties))
        : [];
      filteredRef.current[tech] = feats;
      (map.getSource(`proj-${tech}`) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: feats,
      } as any);
      // Source data stays filter-accurate (stats read it); the tab gates visibility.
      for (const suffix of ['pt', 'cluster', 'count']) {
        const id = `proj-${tech}-${suffix}`;
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showProjects ? 'visible' : 'none');
      }
    }
    if (map.getLayer('companies-pt')) {
      map.setLayoutProperty('companies-pt', 'visibility', showJobs && companiesOn ? 'visible' : 'none');
    }
    for (const id of ['transmission-glow', 'transmission-op', 'transmission-uc', 'transmission-hit']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showProjects && gridOn ? 'visible' : 'none');
    }
    const showParks = tab === 'parks' || showAll;
    for (const id of ['parks-cluster', 'parks-count', 'parks-pt']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showParks ? 'visible' : 'none');
    }
    if (map.getLayer('parks-pt')) {
      map.setFilter(
        'parks-pt',
        visitableOnly
          ? ['all', ['!', ['has', 'point_count']], ['==', ['get', 'visitable'], true]]
          : ['!', ['has', 'point_count']]
      );
    }
    // Footprints follow the Projects tab and the same tech/status/capacity/year
    // filters as the dots (only relevant once the polygons have loaded).
    if (footprintsRef.current) {
      const feats = footprintsRef.current.features.filter((f) => passes(f.properties));
      (map.getSource('footprints') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: feats,
      } as any);
      for (const id of ['footprints-fill', 'footprints-line']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showProjects ? 'visible' : 'none');
      }
    }
    recomputeStats();
  }, [ready, techOn, status, minCap, companiesOn, gridOn, year, tab, showAll, visitableOnly, footprintsReady, recomputeStats]);

  // Lazy-load the ~9 MB protected-areas dataset the first time the Parks tab (or
  // "show all") needs it, then feed it into the map source + the panel list. Kept
  // off the initial page load since most visitors never open Parks.
  useEffect(() => {
    if (!ready) return;
    if ((tab !== 'parks' && !showAll) || parksLoadedRef.current) return;
    parksLoadedRef.current = true;
    setParksLoading(true);
    fetch('/data/parks.geojson')
      .then((r) => r.json() as Promise<FC>)
      .then((fc) => {
        const map = mapRef.current;
        (map?.getSource('parks') as maplibregl.GeoJSONSource | undefined)?.setData(fc as any);
        // Nudge a repaint after the big source update. NOTE: in the automated
        // test harness the globe can sit blank until the first real scroll/drag
        // (a synthetic wheel event does NOT wake it, only CDP-level input does) —
        // this appears to be a harness rendering quirk, not a real-browser bug.
        // Left as a plain repaint; revisit only if it reproduces on real devices.
        map?.triggerRepaint();
        setParksList(
          fc.features.map((f) => ({
            name: f.properties.name,
            type: f.properties.type,
            visitable: !!f.properties.visitable,
            coordinates: f.geometry.coordinates,
            iucn: f.properties.iucn,
            website: f.properties.website,
            wikipedia: f.properties.wikipedia,
          }))
        );
      })
      .catch(() => {
        parksLoadedRef.current = false; // let a later activation retry
      })
      .finally(() => setParksLoading(false));
  }, [ready, tab, showAll]);

  // Lazy-load the project footprints the first time the Projects view is active.
  // They only render once zoomed in (minzoom 9), so the fetch is deferred off the
  // first paint; when it lands, footprintsReady re-runs the filter effect which
  // fills the source and shows/hides it per the current filters.
  useEffect(() => {
    if (!ready) return;
    if ((tab !== 'projects' && !showAll) || footprintsLoadedRef.current) return;
    footprintsLoadedRef.current = true;
    fetch('/data/footprints.geojson')
      .then((r) => r.json() as Promise<LineFC>)
      .then((fc) => {
        footprintsRef.current = fc;
        setFootprintsReady(true);
      })
      .catch(() => {
        footprintsLoadedRef.current = false; // let a later activation retry
      });
  }, [ready, tab, showAll]);

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
        <DetailPanel project={selected} onClose={closeDetail} />
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
        <button className="stats" onClick={() => setStatsOpen((v) => !v)}>
          {ready ? `${stats.count} projects · ${stats.gw.toFixed(1)} GW in view` : 'Loading data…'}
          <span className="stats-caret">{statsOpen ? '▾' : '▴'}</span>
        </button>
      </div>
      )}
    </div>
  );
}
