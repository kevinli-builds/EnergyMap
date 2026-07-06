'use client';

import { useMemo, useState } from 'react';

export interface ParkProps {
  name: string;
  type: string; // "National park" | "Nature reserve" | "Protected area"
  visitable: boolean;
  coordinates: [number, number]; // [lng, lat]
  iucn?: string;
  website?: string;
  wikipedia?: string;
}

const MAX_ROWS = 120;

export default function ParksPanel(props: {
  parks: ParkProps[];
  loading: boolean;
  visitableOnly: boolean;
  onToggleVisitable: () => void;
  onSelect: (park: ParkProps) => void;
}) {
  const { parks, loading, visitableOnly, onToggleVisitable, onSelect } = props;
  const [q, setQ] = useState('');

  const visitableCount = useMemo(() => parks.filter((p) => p.visitable).length, [parks]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = parks;
    if (visitableOnly) list = list.filter((p) => p.visitable);
    if (needle) list = list.filter((p) => p.name.toLowerCase().includes(needle));
    // National parks first (the headline destinations), then A–Z.
    return [...list]
      .sort(
        (a, b) =>
          Number(b.type === 'National park') - Number(a.type === 'National park') ||
          a.name.localeCompare(b.name)
      )
      .slice(0, MAX_ROWS);
  }, [parks, q, visitableOnly]);

  const totalShown = visitableOnly ? visitableCount : parks.length;

  return (
    <div className="jobs">
      <p className="jobs-intro">
        National parks, reserves and protected land worldwide.
        {!loading && parks.length > 0 && (
          <>
            {' '}
            <b>{parks.length.toLocaleString()}</b> areas · <b>{visitableCount.toLocaleString()}</b> you can visit.
          </>
        )}
      </p>

      <label className="jobs-toggle">
        <input type="checkbox" checked={visitableOnly} onChange={onToggleVisitable} />
        Only show places you can visit
      </label>

      {loading ? (
        <p className="parks-loading">Loading protected areas…</p>
      ) : (
        <>
          <input
            className="parks-search"
            type="search"
            placeholder="Search parks & reserves…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="jobs-list">
            {rows.map((p) => (
              <button
                key={`${p.name}@${p.coordinates[0]},${p.coordinates[1]}`}
                className="job-item"
                onClick={() => onSelect(p)}
                title="Show on map"
              >
                <div className="j-top">
                  <span className="j-name">{p.name}</span>
                  {p.visitable && <span className="j-visit">Can visit</span>}
                </div>
                <div className="j-meta">{p.type}</div>
              </button>
            ))}
            {rows.length === 0 && <div className="parks-empty">No matches.</div>}
            {!q && totalShown > MAX_ROWS && (
              <div className="parks-more">Showing {MAX_ROWS} of {totalShown.toLocaleString()} — search to narrow.</div>
            )}
          </div>
        </>
      )}

      <p className="jobs-foot">Protected areas © OpenStreetMap contributors · refresh with npm run parks.</p>
    </div>
  );
}
