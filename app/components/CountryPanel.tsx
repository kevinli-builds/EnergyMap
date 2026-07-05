'use client';

import { useEffect, useState } from 'react';
import energyMix from '../../data/energy-mix.json';

type Mix = {
  iso: string;
  year: number;
  renewables: number | null;
  nuclear: number | null;
  lowCarbon: number | null;
  fossil: number | null;
};
const MIX: Record<string, Mix> = energyMix as any;
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
  const slug = slugify(country);
  const clean = m?.lowCarbon ?? 0;
  const fossil = m?.fossil ?? Math.max(0, 100 - clean);

  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [country]);
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
