'use client';

import { useEffect, useState } from 'react';
import energyMix from '../../data/energy-mix.json';
import buildout from '../../data/country-buildout.json';

type Mix = {
  iso: string;
  year: number;
  renewables: number | null;
  nuclear: number | null;
  lowCarbon: number | null;
  fossil: number | null;
  demand: number | null;
  generation: number | null;
};
type Buildout = {
  name: string;
  opGW: number;
  ucGW: number;
  totalGW: number;
  gwPerM: number | null;
  pipeline: number | null;
  cagr: number | null;
  firstYear: number | null;
  byYear: Record<string, number>;
};
const MIX: Record<string, Mix> = energyMix as any;
const BUILDOUT: Record<string, Buildout> = buildout as any;
const COUNTRIES = Object.keys(MIX).sort();

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export default function CountryPanel(props: {
  country: string;
  onCountry: (c: string) => void;
  onClose: () => void;
}) {
  const { country, onCountry, onClose } = props;
  const m = MIX[country];
  const b = m?.iso ? BUILDOUT[m.iso] : undefined;
  const slug = slugify(country);
  const clean = m?.lowCarbon ?? 0;
  const fossil = m?.fossil ?? Math.max(0, 100 - clean);

  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [country]);

  // Esc closes the panel — a close affordance users reach for reflexively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?c=${encodeURIComponent(country)}`
      : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked (insecure context) — ignore
    }
  };

  return (
    <div className="detail-panel">
      <div className="featured-head">
        <h2>🌍 Country energy mix</h2>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="detail-body">
        <select className="mincap" value={country} onChange={(e) => onCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {m ? (
          <>
            <div className="cp-headline">
              <span className="cp-big" style={{ color: clean >= 50 ? 'var(--battery)' : 'var(--text)' }}>
                {clean.toFixed(0)}%
              </span>
              <span className="cp-sub">
                low-carbon electricity <span className="cp-year">· {m.year}</span>
              </span>
            </div>

            <div className="cp-bar" role="img" aria-label={`${clean.toFixed(0)}% clean, ${fossil.toFixed(0)}% fossil`}>
              <span className="cp-seg clean" style={{ width: `${clean}%` }} />
              <span className="cp-seg fossil" style={{ width: `${fossil}%` }} />
            </div>
            <div className="cp-key">
              <span>
                <span className="cp-dot clean" /> Clean {pct(m.lowCarbon)}
              </span>
              <span>
                <span className="cp-dot fossil" /> Fossil {pct(m.fossil)}
              </span>
            </div>

            {(m.demand ?? m.generation) != null && (
              <div className="cp-total">
                ⚡ <b>{(m.demand ?? m.generation)!.toLocaleString()} TWh</b>{' '}
                {m.demand != null ? 'used' : 'generated'} per year
                {m.lowCarbon != null && (
                  <>
                    {' '}
                    · <span className="cp-total-green">{Math.round((m.lowCarbon / 100) * (m.demand ?? m.generation)!).toLocaleString()} TWh clean</span>
                  </>
                )}
              </div>
            )}

            {b && b.totalGW > 0 && <BuildoutSection b={b} />}

            <dl className="d-rows">
              <div className="d-row">
                <dt>Renewables</dt>
                <dd>{pct(m.renewables)}</dd>
              </div>
              <div className="d-row">
                <dt>Nuclear</dt>
                <dd>{pct(m.nuclear)}</dd>
              </div>
              <div className="d-row">
                <dt>Fossil fuels</dt>
                <dd>{pct(m.fossil)}</dd>
              </div>
            </dl>

            <button className="cp-copy" onClick={copy}>
              {copied ? '✓ Copied link' : '🔗 Copy link to this country'}
            </button>

            <div className="cp-reports">
              <div className="sp-title">Full reports</div>
              <a className="cp-report" href={`https://ourworldindata.org/energy/country/${slug}`} target="_blank" rel="noopener noreferrer">
                Our World in Data ↗
              </a>
              <a className="cp-report" href={`https://www.iea.org/countries/${slug}`} target="_blank" rel="noopener noreferrer">
                IEA country profile ↗
              </a>
              <a className="cp-report" href="https://ember-energy.org/data/electricity-data-explorer/" target="_blank" rel="noopener noreferrer">
                Ember electricity explorer ↗
              </a>
            </div>
          </>
        ) : (
          <p className="d-note">No electricity-mix data available for {country}.</p>
        )}

        <p className="intro-foot">Share of electricity generation · Our World in Data / Ember (CC BY)</p>
      </div>
    </div>
  );
}

// §9 L2 growth engine: the tracked clean-energy build-out for this country —
// operating vs building totals, a CAGR chip, and a GW-added-per-year mini chart.
function BuildoutSection({ b }: { b: Buildout }) {
  const years = Object.keys(b.byYear)
    .map(Number)
    .sort((a, y) => a - y);
  const recent = years.slice(-16);
  const max = Math.max(0.0001, ...recent.map((y) => b.byYear[y]));
  return (
    <div className="cp-build">
      <div className="sp-title">Tracked clean-energy build-out</div>
      <div className="cp-build-head">
        <span className="cp-build-total">{b.totalGW.toLocaleString()} GW</span>
        <span className="cp-build-split">
          {b.opGW.toLocaleString()} operating · {b.ucGW.toLocaleString()} building
        </span>
        {b.cagr != null && b.firstYear != null && (
          <span className="cp-cagr" title="Compound annual growth of cumulative operating capacity">
            ▲ +{b.cagr}%/yr since {b.firstYear}
          </span>
        )}
      </div>
      {recent.length > 1 && (
        <>
          <div className="cp-bars" role="img" aria-label="Gigawatts added per year">
            {recent.map((y) => (
              <span
                key={y}
                className="cp-bar-col"
                style={{ height: `${Math.max(3, (b.byYear[y] / max) * 100)}%` }}
                title={`${y}: ${b.byYear[y].toLocaleString()} GW added`}
              />
            ))}
          </div>
          <div className="cp-bars-axis">
            <span>{recent[0]}</span>
            <span>GW commissioned per year</span>
            <span>{recent[recent.length - 1]}</span>
          </div>
        </>
      )}
    </div>
  );
}
