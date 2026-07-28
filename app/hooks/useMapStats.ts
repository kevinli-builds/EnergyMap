'use client';

import { useCallback, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { Tech, TECHS } from '../components/shared';
import type { PointFeature } from '../components/mapLayers';

export type Stats = {
  count: number;
  gw: number;
  byTech: { tech: Tech; gw: number }[];
  byCountry: { country: string; gw: number; count: number }[];
};

// In-view totals for the stats panel. Reads filteredRef (the filter-accurate
// per-tech feature lists) so the numbers always match what's on the globe.
export function useMapStats(
  mapRef: React.MutableRefObject<maplibregl.Map | null>,
  filteredRef: React.MutableRefObject<Record<Tech, PointFeature[]>>
) {
  const [stats, setStats] = useState<Stats>({ count: 0, gw: 0, byTech: [], byCountry: [] });

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
    // mapRef/filteredRef are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { stats, recomputeStats };
}
