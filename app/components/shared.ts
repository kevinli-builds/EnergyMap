export type Tech = 'solar' | 'wind' | 'battery' | 'geothermal' | 'hydro' | 'nuclear';
export type StatusFilter = 'all' | 'operating' | 'construction';

// Order here drives the layer/legend/chip order in the UI.
export const TECHS: Tech[] = ['solar', 'wind', 'battery', 'geothermal', 'hydro', 'nuclear'];

export const COLORS: Record<Tech | 'company' | 'park' | 'coal', string> = {
  solar: '#fbbf24',
  wind: '#38bdf8',
  battery: '#34d399',
  geothermal: '#fb7185',
  hydro: '#22d3ee',
  nuclear: '#e879f9',
  company: '#c084fc',
  park: '#22c55e',
  coal: '#a8a29e', // ash grey — the contrast layer, deliberately drab next to the clean techs
};

export const TECH_LABEL: Record<Tech, string> = {
  solar: '☀️ Solar',
  wind: '💨 Wind',
  battery: '🔋 Battery',
  geothermal: '♨️ Geothermal',
  hydro: '💧 Pumped hydro',
  nuclear: '☢️ Nuclear',
};

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Everything interpolated into popup HTML goes through this — project data is
// curated today, but a future GEM import makes it effectively untrusted input.
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// Country choropleths (§9 L1). Each metric recolours the world by a property
// baked into boundaries.geojson (build-boundaries.mjs). Stops were chosen from
// the built distribution (p50/p75/p90). Countries with no value get NODATA.
export type Metric = 'off' | 'gwPerM' | 'renew' | 'pipeline';
export const METRICS: { id: Exclude<Metric, 'off'>; label: string; unit: string; ramp: [number, string][] }[] = [
  {
    id: 'gwPerM',
    label: 'Per-capita build',
    unit: 'GW per million people',
    ramp: [[0, '#0b3b2e'], [0.1, '#12715a'], [0.25, '#1aa179'], [0.5, '#34d399'], [1, '#a7f3d0']],
  },
  {
    id: 'renew',
    label: 'Renewable share',
    unit: '% of electricity from renewables',
    ramp: [[0, '#565f6b'], [25, '#4d7d6b'], [50, '#3f9e6e'], [75, '#2bbf80'], [100, '#34d399']],
  },
  {
    id: 'pipeline',
    label: 'Pipeline ratio',
    unit: 'GW building ÷ GW operating',
    ramp: [[0, '#3a3226'], [0.25, '#8a6a1e'], [0.5, '#d99a1e'], [1, '#fbbf24'], [2, '#f97316']],
  },
];
const NODATA_FILL = 'rgba(125,135,150,0.06)';

// Build the data-driven fill-color expression for a metric: NODATA where the
// property is absent, otherwise the interpolated ramp.
export function choroplethColor(metric: Exclude<Metric, 'off'>): unknown {
  const m = METRICS.find((x) => x.id === metric)!;
  const interp: unknown = ['interpolate', ['linear'], ['coalesce', ['get', metric], 0], ...m.ramp.flatMap(([v, c]) => [v, c])];
  return ['case', ['==', ['coalesce', ['get', metric], -1], -1], NODATA_FILL, interp];
}

// "Powers ~N homes" translation (§4 D3). Annual generation ≈ capacity × its
// capacity factor × 8760 h, divided by a typical household's yearly use. Storage
// (battery, pumped hydro) shifts energy rather than generating it, so it has no
// figure — left out of the map here on purpose. Deliberately a rough estimate.
export const CAPACITY_FACTOR: Partial<Record<Tech, number>> = {
  solar: 0.2,
  wind: 0.35,
  geothermal: 0.75,
  nuclear: 0.9,
};
const MWH_PER_HOME = 10.5; // ~US average annual household electricity use

// Raw estimated households powered, or null when it doesn't apply (storage, or
// missing/zero capacity). Used both for the popup line and to compare projects.
export function homesPowered(capacityMW?: number | null, tech?: Tech): number | null {
  const cf = tech ? CAPACITY_FACTOR[tech] : undefined;
  if (!capacityMW || capacityMW <= 0 || cf == null) return null;
  return (capacityMW * cf * 8760) / MWH_PER_HOME;
}

// Friendly, deliberately-rounded household count (e.g. "480,000"), or null.
export function fmtHomes(capacityMW?: number | null, tech?: Tech): string | null {
  const h = homesPowered(capacityMW, tech);
  if (h == null) return null;
  const rounded =
    h >= 1_000_000
      ? Math.round(h / 100_000) * 100_000
      : h >= 100_000
        ? Math.round(h / 10_000) * 10_000
        : h >= 10_000
          ? Math.round(h / 1_000) * 1_000
          : Math.max(100, Math.round(h / 100) * 100);
  return rounded.toLocaleString();
}

export function fmtCapacity(mw?: number | null, mwh?: number | null): string {
  const parts: string[] = [];
  if (mw != null) {
    parts.push(
      mw >= 1000
        ? `${(mw / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GW`
        : `${mw.toLocaleString()} MW`
    );
  }
  if (mwh != null) {
    parts.push(
      mwh >= 1000
        ? `${(mwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GWh`
        : `${mwh.toLocaleString()} MWh`
    );
  }
  return parts.join(' · ') || 'Capacity n/a';
}
