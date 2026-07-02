'use client';

import { COLORS, StatusFilter, Tech, TECH_LABEL } from './shared';

const CAP_OPTIONS = [
  { v: 0, label: 'Any size' },
  { v: 100, label: '≥ 100 MW' },
  { v: 500, label: '≥ 500 MW' },
  { v: 1000, label: '≥ 1 GW' },
];

const STATUS_OPTIONS: [StatusFilter, string][] = [
  ['all', 'All'],
  ['operating', 'Operating'],
  ['construction', 'Building'],
];

export default function Controls(props: {
  techOn: Record<Tech, boolean>;
  onTech: (t: Tech) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  minCap: number;
  onMinCap: (n: number) => void;
  companiesOn: boolean;
  onCompanies: () => void;
  onFeatured: () => void;
}) {
  const { techOn, onTech, status, onStatus, minCap, onMinCap, companiesOn, onCompanies, onFeatured } = props;

  return (
    <>
      <div className="section">
        <div className="section-label">Layers</div>
        <div className="chips">
          {(Object.keys(techOn) as Tech[]).map((t) => (
            <button
              key={t}
              className={`chip ${techOn[t] ? 'on' : ''}`}
              style={{ '--c': COLORS[t] } as React.CSSProperties}
              onClick={() => onTech(t)}
            >
              {TECH_LABEL[t]}
            </button>
          ))}
          <button
            className={`chip ${companiesOn ? 'on' : ''}`}
            style={{ '--c': COLORS.company } as React.CSSProperties}
            onClick={onCompanies}
          >
            🏢 Hiring
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-label">Status</div>
        <div className="seg">
          {STATUS_OPTIONS.map(([v, label]) => (
            <button key={v} className={status === v ? 'on' : ''} onClick={() => onStatus(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label">Min capacity</div>
        <select className="mincap" value={minCap} onChange={(e) => onMinCap(Number(e.target.value))}>
          {CAP_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <button className="featured-btn" onClick={onFeatured}>
        ★ Featured projects
      </button>

      <div className="legend">
        <span>
          <span className="dot" style={{ background: '#9aa3b2' }} /> operating
        </span>
        <span>
          <span
            className="dot"
            style={{ background: 'transparent', border: '2px solid #9aa3b2', width: 7, height: 7 }}
          />{' '}
          under construction
        </span>
      </div>
    </>
  );
}
