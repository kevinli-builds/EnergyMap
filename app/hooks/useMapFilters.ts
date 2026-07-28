'use client';

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { choroplethColor, Metric, StatusFilter, Tech, TECHS } from '../components/shared';
import type { FC, LineFC, PointFeature } from '../components/mapLayers';

// The one "sync the map to the current filter state" effect: rebuilds each
// tech's source, gates every layer's visibility by the active tab, and applies
// the shared status/capacity/year predicate to projects, coal and footprints.
// Writes filteredRef (which the stats + live layers read) and recomputes stats.
export function useMapFilters(opts: {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  dataRef: React.MutableRefObject<{ projects: FC; companies: FC; transmission: LineFC } | null>;
  filteredRef: React.MutableRefObject<Record<Tech, PointFeature[]>>;
  coalRef: React.MutableRefObject<FC | null>;
  footprintsRef: React.MutableRefObject<LineFC | null>;
  ready: boolean;
  techOn: Record<Tech, boolean>;
  status: StatusFilter;
  minCap: number;
  companiesOn: boolean;
  gridOn: boolean;
  liveOn: boolean;
  metric: Metric;
  boundariesReady: boolean;
  coalOn: boolean;
  coalReady: boolean;
  year: number;
  yearMax: number;
  tab: 'projects' | 'jobs' | 'parks';
  showAll: boolean;
  visitableOnly: boolean;
  footprintsReady: boolean;
  refreshLive: () => void;
  recomputeStats: () => void;
}) {
  const {
    mapRef, dataRef, filteredRef, coalRef, footprintsRef,
    ready, techOn, status, minCap, companiesOn, gridOn, liveOn, metric,
    boundariesReady, coalOn, coalReady, year, yearMax, tab, showAll,
    visitableOnly, footprintsReady, refreshLive, recomputeStats,
  } = opts;

  useEffect(() => {
    const map = mapRef.current;
    const data = dataRef.current;
    if (!ready || !map || !data) return;
    const yearActive = year < yearMax; // "All" position applies no year filter
    // The active tab decides which half of the globe is shown; "show all" un-gates both.
    const showProjects = tab === 'projects' || showAll;
    const showJobs = tab === 'jobs' || showAll;
    // Status/capacity/year predicate shared by clean projects AND the coal layer,
    // so the timeline and filters tell one consistent story across both fleets.
    const passesBase = (props: Record<string, any>) =>
      (status === 'all' || props.status === status) &&
      (props.capacityMW ?? 0) >= minCap &&
      (!yearActive || props.year == null || props.year <= year);
    // Same predicate for a project's dot and its footprint, so they stay in sync.
    const passes = (props: Record<string, any>) => techOn[props.tech as Tech] && passesBase(props);
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
    // Day/night: the shade is global ambiance (any tab); the solar glow only
    // makes sense over visible solar dots. refreshLive fills both sources.
    if (map.getLayer('night-fill')) {
      map.setLayoutProperty('night-fill', 'visibility', liveOn ? 'visible' : 'none');
    }
    if (map.getLayer('solar-glow')) {
      map.setLayoutProperty('solar-glow', 'visibility', liveOn && showProjects && techOn.solar ? 'visible' : 'none');
    }
    if (liveOn) refreshLive();
    // Country choropleth: shown on the Projects view when a metric is picked.
    const showChoro = metric !== 'off' && showProjects;
    for (const id of ['choropleth-fill', 'choropleth-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showChoro ? 'visible' : 'none');
    }
    if (metric !== 'off' && map.getLayer('choropleth-fill')) {
      map.setPaintProperty('choropleth-fill', 'fill-color', choroplethColor(metric));
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
    // Coal follows the Projects tab, its own chip, and the shared status/capacity/
    // year filters — the tech chips don't apply, it IS the contrast to all of them.
    if (coalRef.current) {
      const feats = coalOn ? coalRef.current.features.filter((f) => passesBase(f.properties)) : [];
      (map.getSource('coal') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: feats,
      } as any);
      for (const id of ['coal-cluster', 'coal-count', 'coal-pt']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showProjects && coalOn ? 'visible' : 'none');
      }
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
  }, [
    ready, techOn, status, minCap, companiesOn, gridOn, liveOn, metric, boundariesReady,
    coalOn, coalReady, year, yearMax, tab, showAll, visitableOnly, footprintsReady,
    refreshLive, recomputeStats, mapRef, dataRef, filteredRef, coalRef, footprintsRef,
  ]);
}
