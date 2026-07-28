// Map sources, layers, and popup builders for MapApp. Pure map setup — no React
// state — extracted so the component keeps to its state/effects wiring.
import maplibregl from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import { COLORS, esc, fmtCapacity, TECHS } from './shared';


export type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, any>;
};
export type FC = { type: 'FeatureCollection'; features: PointFeature[] };
export type LineFC = { type: 'FeatureCollection'; features: any[] };

const GRID_COLOR = '#fb923c';

export type ClickHandlers = {
  selectProject: (p: Record<string, any>) => void;
  selectCompany: (coords: [number, number], p: Record<string, any>) => void;
  selectPark: (coords: [number, number], p: Record<string, any>) => void;
  selectCoal: (coords: [number, number], p: Record<string, any>) => void;
  selectFootprint: (slug: string) => void;
  selectBoundary: (iso: string) => void;
};

const EMPTY: FC = { type: 'FeatureCollection', features: [] };

// Day/night "live" layer (§4 D1). The solar-glow halo breathes between these two
// radius/opacity keyframes on a slow paint transition — sunlit solar farms feel
// like they're generating right now. Radius scales with capacity like the dots.
export const GLOW_SMALL = ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'capacityMW'], 50]], 3, 7, 60, 20] as any;
export const GLOW_BIG = ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'capacityMW'], 50]], 3, 12, 60, 32] as any;
export const PULSE_MS = 1800;
const NODATA_FILL = 'rgba(125,135,150,0.06)';

export function openCompanyPopup(map: maplibregl.Map, coords: [number, number], p: Record<string, any>) {
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

export function openCoalPopup(map: maplibregl.Map, coords: [number, number], p: Record<string, any>) {
  const statusHtml =
    p.status === 'operating'
      ? '<span class="badge op">Operating</span>'
      : '<span class="badge uc">Under construction</span>';
  // Retirement is the plant's *last* planned unit retirement — "coal-free by".
  const retire = p.retirement
    ? `<span class="badge op">Retiring by ${esc(p.retirement)}</span>`
    : p.status === 'operating'
      ? '<span class="badge uc">No retirement plan</span>'
      : '';
  const facts: string[] = [];
  if (p.year) facts.push(`since ${esc(p.year)}`);
  if (p.units > 1) facts.push(`${esc(p.units)} units`);
  if (p.co2Mt) facts.push(`≈ ${esc(p.co2Mt)} Mt CO₂/yr`);
  const html = `<div class="pp">
    <div class="pp-title">${esc(p.name)}</div>
    <div class="pp-sub">Coal power station · ${esc(p.country)}${p.owner ? ' · ' + esc(p.owner) : ''}</div>
    <div class="pp-cap">${esc(fmtCapacity(p.capacityMW))}${facts.length ? ' · ' + facts.join(' · ') : ''}</div>
    ${statusHtml} ${retire}
    ${p.conversion ? `<div class="pp-note">Converting to: ${esc(p.conversion)}</div>` : ''}
    ${p.wiki ? `<a href="${esc(p.wiki)}" target="_blank" rel="noopener noreferrer">GEM wiki ↗</a>` : ''}
  </div>`;
  new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(coords).setHTML(html).addTo(map);
}

export function openParkPopup(map: maplibregl.Map, coords: [number, number], p: Record<string, any>) {
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

export function addLayers(map: maplibregl.Map, companies: FC, transmission: LineFC, handlers: MutableRefObject<ClickHandlers>) {
  // Day/night shade (§4 D1) — a translucent polygon over the night hemisphere,
  // added first so every data layer draws on top of it. Hidden until the 🌞 Live
  // toggle is switched on; the source is refreshed each minute from the clock.
  map.addSource('night', { type: 'geojson', data: EMPTY as any });
  map.addLayer({
    id: 'night-fill',
    type: 'fill',
    source: 'night',
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#04060d', 'fill-opacity': 0.34 },
  });

  // Country choropleth (§9 L1) — recolours whole countries by a chosen metric.
  // Added just above the night shade so transmission lines and every dot draw on
  // top. Source is empty + hidden until a metric is picked (lazy-loaded then).
  map.addSource('boundaries', { type: 'geojson', data: EMPTY as any });
  map.addLayer({
    id: 'choropleth-fill',
    type: 'fill',
    source: 'boundaries',
    layout: { visibility: 'none' },
    paint: { 'fill-color': NODATA_FILL, 'fill-opacity': 0.6, 'fill-antialias': true },
  });
  map.addLayer({
    id: 'choropleth-line',
    type: 'line',
    source: 'boundaries',
    layout: { visibility: 'none' },
    paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 0.5 },
  });
  map.on('mouseenter', 'choropleth-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'choropleth-fill', () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('click', 'choropleth-fill', (e) => {
    const f = e.features?.[0];
    if (f) handlers.current.selectBoundary((f.properties as any).iso);
  });

  // Transmission lines next, so project dots draw on top of them.
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

  // Coal — the grey contrast layer (GEM Global Coal Plant Tracker). Same clustered
  // treatment as the clean techs so like compares with like, but added before them
  // so clean-project dots always draw on top of the fleet they're displacing.
  // Source starts empty; filled lazily the first time the Coal chip is switched on.
  map.addSource('coal', {
    type: 'geojson',
    data: EMPTY as any,
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 42,
  });
  map.addLayer({
    id: 'coal-cluster',
    type: 'circle',
    source: 'coal',
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': COLORS.coal,
      'circle-opacity': 0.5,
      'circle-stroke-color': COLORS.coal,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.85,
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 13, 30, 22, 200, 32],
    } as any,
  });
  map.addLayer({
    id: 'coal-count',
    type: 'symbol',
    source: 'coal',
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
    id: 'coal-pt',
    type: 'circle',
    source: 'coal',
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: 'none' },
    paint: {
      // same sqrt(MW) sizing as project dots, so grey and clean compare honestly
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['coalesce', ['get', 'capacityMW'], 50]], 3, 4, 60, 15],
      'circle-color': ['case', ['==', ['get', 'status'], 'operating'], COLORS.coal, 'rgba(0,0,0,0)'],
      'circle-opacity': 0.85,
      'circle-stroke-color': COLORS.coal,
      'circle-stroke-width': ['case', ['==', ['get', 'status'], 'operating'], 1, 2],
    } as any,
  });

  // "Generating now" glow (§4 D1): a soft, breathing halo behind each solar
  // project that's currently in daylight. The source holds only the sunlit subset
  // (recomputed each minute); the pulse is driven by paint transitions. Added
  // before the tech dots so the crisp dot always sits on top of its glow.
  map.addSource('solar-glow', { type: 'geojson', data: EMPTY as any });
  map.addLayer({
    id: 'solar-glow',
    type: 'circle',
    source: 'solar-glow',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': COLORS.solar,
      'circle-blur': 1,
      'circle-radius': GLOW_SMALL,
      'circle-opacity': 0.42,
      'circle-radius-transition': { duration: PULSE_MS, delay: 0 },
      'circle-opacity-transition': { duration: PULSE_MS, delay: 0 },
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
    'coal-pt',
    'coal-cluster',
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
  map.on('click', 'coal-cluster', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const src = map.getSource('coal') as maplibregl.GeoJSONSource;
    const zoom = await src.getClusterExpansionZoom((f.properties as any).cluster_id);
    map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.5 });
  });
  map.on('click', 'coal-pt', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    handlers.current.selectCoal((f.geometry as any).coordinates, f.properties as any);
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

