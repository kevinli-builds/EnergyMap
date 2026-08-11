'use client';

import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { CAPACITY_FACTOR, Tech, TECHS } from '../components/shared';
import type { PointFeature } from '../components/mapLayers';
import { solarIntensity, subsolarPoint } from '../lib/solar';

// Peak solar factor: the ~0.20 average capacity factor with a ×2 midday
// weighting, so a farm at local noon reads ~0.40 and one at dusk ~0.
const SOLAR_PEAK = 0.4;

// §4 D2 "generating now" ticker. Each second, sum the instantaneous output of
// the OPERATING projects in view — capacity × per-tech capacity factor, with
// solar tracking the sun and storage (battery/pumped hydro) excluded — and
// accrue MWh. The total climbs for the whole page visit ("since you arrived");
// it pauses (but never resets) while the Projects view is hidden. Rough estimate.
export function useGenerationTicker(
  mapRef: React.MutableRefObject<maplibregl.Map | null>,
  filteredRef: React.MutableRefObject<Record<Tech, PointFeature[]>>,
  ready: boolean,
  active: boolean
) {
  const [mwh, setMwh] = useState(0);

  useEffect(() => {
    if (!ready || !active) return;
    let last = performance.now();
    const id = setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      const now = performance.now();
      const dtHours = (now - last) / 3_600_000;
      last = now;
      const sub = subsolarPoint(new Date());
      const bounds = map.getBounds();
      let rateMW = 0;
      for (const tech of TECHS) {
        const cf = CAPACITY_FACTOR[tech];
        for (const f of filteredRef.current[tech]) {
          if (f.properties.status !== 'operating') continue; // only what's actually running
          const [lng, lat] = f.geometry.coordinates;
          if (!bounds.contains([lng, lat])) continue;
          const mw = f.properties.capacityMW ?? 0;
          if (tech === 'solar') rateMW += mw * SOLAR_PEAK * solarIntensity(lng, lat, sub);
          else if (cf != null) rateMW += mw * cf; // wind/geothermal/nuclear; storage has no cf
        }
      }
      setMwh((prev) => prev + rateMW * dtHours);
    }, 1000);
    return () => clearInterval(id);
  }, [ready, active, mapRef, filteredRef]);

  return mwh;
}
