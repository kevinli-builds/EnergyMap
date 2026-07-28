'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { ParkProps } from '../components/ParksPanel';
import type { FC, LineFC } from '../components/mapLayers';

// The heavy datasets — parks (~9 MB), coal (~0.6 MB), boundaries (~180 KB),
// footprints — are fetched lazily the first time each is actually needed, so
// they never touch the initial page load. This hook owns those loaders and the
// refs/flags the filter effect reads back. On failure a loaded-flag is reset so
// a later activation retries.
export function useLazyLayers(opts: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  ready: boolean;
  tab: 'projects' | 'jobs' | 'parks';
  showAll: boolean;
  metric: string;
  coalOn: boolean;
}) {
  const { mapRef, ready, tab, showAll, metric, coalOn } = opts;

  const coalRef = useRef<FC | null>(null);
  const coalLoadedRef = useRef(false);
  const footprintsRef = useRef<LineFC | null>(null);
  const footprintsLoadedRef = useRef(false);
  const parksLoadedRef = useRef(false);
  const boundariesLoadedRef = useRef(false);

  const [parksList, setParksList] = useState<ParkProps[]>([]);
  const [parksLoading, setParksLoading] = useState(false);
  const [coalReady, setCoalReady] = useState(false);
  const [footprintsReady, setFootprintsReady] = useState(false);
  const [boundariesReady, setBoundariesReady] = useState(false);

  // Parks (~9 MB) — first time the Parks tab (or "show all") needs it.
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
  }, [ready, tab, showAll, mapRef]);

  // Coal fleet (~0.6 MB) — first time the Coal chip is switched on.
  useEffect(() => {
    if (!ready || !coalOn || coalLoadedRef.current) return;
    coalLoadedRef.current = true;
    fetch('/data/coal.geojson')
      .then((r) => r.json() as Promise<FC>)
      .then((fc) => {
        coalRef.current = fc;
        setCoalReady(true);
      })
      .catch(() => {
        coalLoadedRef.current = false; // let a later toggle retry
      });
  }, [ready, coalOn]);

  // Country-boundaries choropleth (~180 KB) — first time a metric is picked.
  useEffect(() => {
    if (!ready || metric === 'off' || boundariesLoadedRef.current) return;
    boundariesLoadedRef.current = true;
    fetch('/data/boundaries.geojson')
      .then((r) => r.json() as Promise<any>)
      .then((fc) => {
        (mapRef.current?.getSource('boundaries') as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        setBoundariesReady(true);
      })
      .catch(() => {
        boundariesLoadedRef.current = false; // let a later pick retry
      });
  }, [ready, metric, mapRef]);

  // Project footprints — first time the Projects view is active. They only
  // render once zoomed in (minzoom 9), so the fetch is deferred off first paint;
  // when it lands, footprintsReady re-runs the filter effect which fills the
  // source and shows/hides it per the current filters.
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

  return { coalRef, footprintsRef, parksList, parksLoading, coalReady, footprintsReady, boundariesReady };
}
