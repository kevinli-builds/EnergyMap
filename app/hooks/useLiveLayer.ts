'use client';

import { useCallback, useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { Tech } from '../components/shared';
import { GLOW_BIG, GLOW_SMALL, PULSE_MS, PointFeature } from '../components/mapLayers';
import { isSunlit, nightPolygon, subsolarPoint } from '../lib/solar';

// Day/night "live" layer (§4 D1): owns the toggle, recomputes the terminator +
// sunlit-solar subset each minute, and breathes the solar glow between its two
// keyframes on the paint transition. Reads filteredRef so the glow honours the
// active tech/status/year filters. `refreshLive` is also called by the filter
// effect so a filter change re-derives the sunlit set immediately.
export function useLiveLayer(
  mapRef: React.MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  filteredRef: React.MutableRefObject<Record<Tech, PointFeature[]>>
) {
  const [liveOn, setLiveOn] = useState(false);

  const refreshLive = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('night')) return;
    const sub = subsolarPoint(new Date());
    (map.getSource('night') as maplibregl.GeoJSONSource).setData(nightPolygon(sub) as any);
    const lit = filteredRef.current.solar.filter((f) =>
      isSunlit(f.geometry.coordinates[0], f.geometry.coordinates[1], sub)
    );
    (map.getSource('solar-glow') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: lit,
    } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !liveOn) return;
    refreshLive();
    const clock = setInterval(refreshLive, 60_000);
    let big = false;
    const pulse = setInterval(() => {
      const map = mapRef.current;
      if (!map || !map.getLayer('solar-glow')) return;
      big = !big;
      map.setPaintProperty('solar-glow', 'circle-radius', big ? GLOW_BIG : GLOW_SMALL);
      map.setPaintProperty('solar-glow', 'circle-opacity', big ? 0.16 : 0.42);
    }, PULSE_MS);
    return () => {
      clearInterval(clock);
      clearInterval(pulse);
    };
  }, [ready, liveOn, refreshLive, mapRef]);

  return { liveOn, setLiveOn, refreshLive };
}
