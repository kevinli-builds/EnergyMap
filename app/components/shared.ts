export type Tech = 'solar' | 'wind' | 'battery' | 'geothermal' | 'hydro';
export type StatusFilter = 'all' | 'operating' | 'construction';

// Order here drives the layer/legend/chip order in the UI.
export const TECHS: Tech[] = ['solar', 'wind', 'battery', 'geothermal', 'hydro'];

export const COLORS: Record<Tech | 'company' | 'park', string> = {
  solar: '#fbbf24',
  wind: '#38bdf8',
  battery: '#34d399',
  geothermal: '#fb7185',
  hydro: '#22d3ee',
  company: '#c084fc',
  park: '#22c55e',
};

export const TECH_LABEL: Record<Tech, string> = {
  solar: '☀️ Solar',
  wind: '💨 Wind',
  battery: '🔋 Battery',
  geothermal: '♨️ Geothermal',
  hydro: '💧 Pumped hydro',
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
