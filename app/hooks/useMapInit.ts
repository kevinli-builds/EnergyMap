'use client';

import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { CompanyProps } from '../components/JobsPanel';
import { addLayers, ClickHandlers, FC, LineFC } from '../components/mapLayers';

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Creates the MapLibre map once, wires the data fetch + layers on style.load,
// and keeps rendering alive if the container mounts hidden/zero-size. Populates
// dataRef and returns { ready, companiesList } for the rest of the app.
export function useMapInit(opts: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  dataRef: React.MutableRefObject<{ projects: FC; companies: FC; transmission: LineFC } | null>;
  handlersRef: React.MutableRefObject<ClickHandlers>;
  recomputeStats: () => void;
}) {
  const { containerRef, mapRef, dataRef, handlersRef, recomputeStats } = opts;
  const [ready, setReady] = useState(false);
  const [companiesList, setCompaniesList] = useState<CompanyProps[]>([]);

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
          'Projects & coal: <a href="https://globalenergymonitor.org/" target="_blank" rel="noopener">Global Energy Monitor</a> (CC BY 4.0) + curated set · Footprints & parks: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> contributors (ODbL)',
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

  return { ready, companiesList };
}
