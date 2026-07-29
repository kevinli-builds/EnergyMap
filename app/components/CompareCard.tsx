'use client';

import { Fragment, useEffect } from 'react';
import { COLORS, fmtCapacity, fmtHomes, homesPowered, Tech, TECH_LABEL } from './shared';

type P = Record<string, any>;

// §4 D4 head-to-head "top trumps": two projects side by side, with a 👑 on the
// winning cell for the numeric rows (capacity, homes powered). Text rows just
// display. Pure UI over data already loaded — instantly screenshot-shareable.
export default function CompareCard({ a, b, onClose }: { a: P; b: P; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const homesA = homesPowered(a.capacityMW, a.tech);
  const homesB = homesPowered(b.capacityMW, b.tech);

  // A cell "wins" a numeric row when it's strictly greater; ties crown neither.
  const rows: { label: string; a: string; b: string; winA: boolean; winB: boolean }[] = [
    {
      label: 'Capacity',
      a: fmtCapacity(a.capacityMW),
      b: fmtCapacity(b.capacityMW),
      winA: (a.capacityMW ?? 0) > (b.capacityMW ?? 0),
      winB: (b.capacityMW ?? 0) > (a.capacityMW ?? 0),
    },
    {
      label: 'Powers ~homes',
      a: fmtHomes(a.capacityMW, a.tech) ?? '—',
      b: fmtHomes(b.capacityMW, b.tech) ?? '—',
      winA: (homesA ?? -1) > (homesB ?? -1) && homesA != null,
      winB: (homesB ?? -1) > (homesA ?? -1) && homesB != null,
    },
    { label: 'Status', a: statusLabel(a), b: statusLabel(b), winA: false, winB: false },
    { label: 'Country', a: a.country || '—', b: b.country || '—', winA: false, winB: false },
    { label: 'Year', a: a.year ? String(a.year) : '—', b: b.year ? String(b.year) : '—', winA: false, winB: false },
  ];

  return (
    <div className="compare-card" role="dialog" aria-label="Compare projects">
      <div className="compare-head">
        <h2>⚔ Head-to-head</h2>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="compare-grid">
        <div className="cc-corner" />
        <ProjectHead p={a} />
        <ProjectHead p={b} />
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span className="cc-label">{r.label}</span>
            <span className={`cc-val ${r.winA ? 'win' : ''}`}>
              {r.winA && <span className="cc-crown">👑</span>}
              {r.a}
            </span>
            <span className={`cc-val ${r.winB ? 'win' : ''}`}>
              {r.winB && <span className="cc-crown">👑</span>}
              {r.b}
            </span>
          </Fragment>
        ))}
      </div>
      <p className="compare-foot">Homes powered is a rough estimate (capacity factor by technology).</p>
    </div>
  );
}

function statusLabel(p: P) {
  return p.status === 'operating' ? 'Operating' : 'Building';
}

function ProjectHead({ p }: { p: P }) {
  const tech = p.tech as Tech;
  return (
    <div className="cc-proj">
      <span className="cc-tech" style={{ color: COLORS[tech] }}>
        {TECH_LABEL[tech] ?? p.tech}
      </span>
      <span className="cc-name">{p.name}</span>
    </div>
  );
}
