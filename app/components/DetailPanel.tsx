'use client';

import { useEffect, useState } from 'react';
import featured from '../../data/featured.json';
import { COLORS, fmtCapacity, Tech, TECH_LABEL } from './shared';

const featuredBlurb = new Map(featured.map((f) => [f.name, f.blurb]));

export default function DetailPanel({ project, onClose }: { project: Record<string, any>; onClose: () => void }) {
  const p = project;
  const tech = p.tech as Tech;
  const blurb = featuredBlurb.get(p.name);
  const [copied, setCopied] = useState(false);

  // Reset the "Copied!" label whenever a different project is shown.
  useEffect(() => setCopied(false), [p.slug]);

  const link =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?p=${p.slug}` : '';
  const learnUrl: string =
    p.url || `https://www.google.com/search?q=${encodeURIComponent(`${p.name} power project`)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked (insecure context) — select-all fallback isn't worth it here
    }
  };

  return (
    <div className="detail-panel">
      <div className="featured-head">
        <h2>Project details</h2>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="detail-body">
        <div className="d-tech" style={{ color: COLORS[tech] }}>
          {TECH_LABEL[tech] ?? p.tech}
        </div>
        <div className="d-name">{p.name}</div>
        <span className={`badge ${p.status === 'operating' ? 'op' : 'uc'}`}>
          {p.status === 'operating' ? 'Operating' : 'Under construction'}
        </span>
        <div className="d-cap">{fmtCapacity(p.capacityMW, p.energyMWh)}</div>

        <dl className="d-rows">
          {p.country && (
            <div className="d-row">
              <dt>Country</dt>
              <dd>{p.country}</dd>
            </div>
          )}
          {p.owner && (
            <div className="d-row">
              <dt>Owner</dt>
              <dd>{p.owner}</dd>
            </div>
          )}
          {p.operator && (
            <div className="d-row">
              <dt>Operator</dt>
              <dd>{p.operator}</dd>
            </div>
          )}
          {p.year && (
            <div className="d-row">
              <dt>{p.status === 'operating' ? 'Online since' : 'Start year'}</dt>
              <dd>{p.year}</dd>
            </div>
          )}
        </dl>

        {blurb && <p className="d-blurb">★ {blurb}</p>}
        {p.note && !blurb && <p className="d-note">{p.note}</p>}

        <div className="d-actions">
          <a className="d-link" href={learnUrl} target="_blank" rel="noopener noreferrer">
            {p.url ? 'View on GEM wiki ↗' : 'Search the web ↗'}
          </a>
          <button className="d-copy" onClick={copy}>
            {copied ? '✓ Copied' : '🔗 Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
