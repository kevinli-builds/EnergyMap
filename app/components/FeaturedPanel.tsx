'use client';

import featured from '../../data/featured.json';
import { fmtCapacity, Tech, TECH_LABEL } from './shared';

export interface FeaturedLookup {
  country: string;
  capacityMW: number | null;
  energyMWh: number | null;
  tech: Tech;
  status: string;
}

export default function FeaturedPanel(props: {
  lookup: (name: string) => FeaturedLookup | null;
  onSelect: (name: string) => void;
  onClose: () => void;
  onTour: () => void;
}) {
  return (
    <div className="featured-panel">
      <div className="featured-head">
        <h2>★ Featured projects</h2>
        <div className="fh-actions">
          <button className="tour-btn" onClick={props.onTour}>
            ▶ Tour
          </button>
          <button onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="featured-list">
        {featured.map((f) => {
          const p = props.lookup(f.name);
          return (
            <button key={f.name} className="featured-item" onClick={() => props.onSelect(f.name)}>
              <div className="fi-name">{f.name}</div>
              {p && (
                <div className="fi-meta">
                  {TECH_LABEL[p.tech]} · {p.country} · {fmtCapacity(p.capacityMW, p.energyMWh)}
                  {p.status === 'construction' ? ' · under construction' : ''}
                </div>
              )}
              <div className="fi-blurb">{f.blurb}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
