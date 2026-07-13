'use client';

import { COLORS, StatusFilter, Tech, TECH_LABEL, TECHS } from './shared';

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
  gridOn: boolean;
  onGrid: () => void;
  coalOn: boolean;
  onCoal: () => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  minCap: number;
  onMinCap: (n: number) => void;
  year: number;
  yearMin: number;
  yearMax: number;
  onYear: (y: number) => void;
  playing: boolean;
  onPlay: () => void;
  onFeatured: () => void;
}) {
  const {
    techOn,
    onTech,
    gridOn,
    onGrid,
    coalOn,
    onCoal,
    status,
    onStatus,
    minCap,
    onMinCap,
    year,
    yearMin,
    yearMax,
    onYear,
    playing,
    onPlay,
    onFeatured,
  } = props;

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
            className={`chip ${gridOn ? 'on' : ''}`}
            style={{ '--c': '#fb923c' } as React.CSSProperties}
            onClick={onGrid}
          >
            🔌 Grid
          </button>
          <button
            className={`chip ${coalOn ? 'on' : ''}`}
            style={{ '--c': COLORS.coal } as React.CSSProperties}
            onClick={onCoal}
            title="Contrast layer: the coal fleet all this is displacing (Global Energy Monitor)"
          >
            🏭 Coal
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

      <div className="section">
        <div className="section-label">Built by year {year >= yearMax ? '· all' : `· up to ${year}`}</div>
        <div className="timeline">
          <button className="tl-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play build-out'}>
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            className="tl-range"
            min={yearMin}
            max={yearMax}
            value={year}
            onChange={(e) => onYear(Number(e.target.value))}
          />
          <span className="tl-year">{year >= yearMax ? 'All' : year}</span>
        </div>
      </div>

      <button className="featured-btn" onClick={onFeatured}>
        ★ Featured projects
      </button>

      <div className="section">
        <div className="section-label">Legend</div>
        <div className="legend">
          <div className="legend-row">
            <span className="ldot filled" /> Operating
            <span className="ldot ring" /> Under construction
          </div>
          <div className="legend-row">
            <span className="ldot sz-s" />
            <span className="ldot sz-l" /> Bigger dot = more capacity
          </div>
          <div className="legend-row">
            {TECHS.map((t) => (
              <span key={t} className="ldot" style={{ background: COLORS[t] }} title={TECH_LABEL[t]} />
            ))}
            Colour = technology
          </div>
          <div className="legend-row">
            <span className="lline" /> Transmission &amp; interconnectors
          </div>
          {coalOn && (
            <div className="legend-row">
              <span className="ldot" style={{ background: COLORS.coal }} /> Coal plants (what&rsquo;s being displaced)
            </div>
          )}
        </div>
      </div>
    </>
  );
}
