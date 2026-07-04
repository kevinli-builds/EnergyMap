'use client';

export interface CompanyProps {
  name: string;
  focus: string;
  hq: string;
  careersUrl: string;
  openRoles: number | null;
}

export default function JobsPanel(props: {
  companies: CompanyProps[];
  companiesOn: boolean;
  onToggle: () => void;
  onSelect: (name: string) => void;
}) {
  const { companies, companiesOn, onToggle, onSelect } = props;
  // Companies with live role counts first (most roles first), then the rest A–Z.
  const sorted = [...companies].sort(
    (a, b) => (b.openRoles ?? -1) - (a.openRoles ?? -1) || a.name.localeCompare(b.name)
  );
  const totalRoles = companies.reduce((s, c) => s + (c.openRoles ?? 0), 0);

  return (
    <div className="jobs">
      <p className="jobs-intro">
        The companies building these projects — and hiring.
        {totalRoles > 0 && (
          <>
            {' '}
            <b>{totalRoles}</b> open roles tracked live.
          </>
        )}
      </p>

      <label className="jobs-toggle">
        <input type="checkbox" checked={companiesOn} onChange={onToggle} />
        Show companies on the map
      </label>

      <div className="jobs-list">
        {sorted.map((c) => (
          <button key={c.name} className="job-item" onClick={() => onSelect(c.name)} title="Show on map">
            <div className="j-top">
              <span className="j-name">{c.name}</span>
              {c.openRoles != null && <span className="j-roles">{c.openRoles} roles</span>}
            </div>
            <div className="j-meta">
              {c.focus} · {c.hq}
            </div>
          </button>
        ))}
      </div>

      <p className="jobs-foot">Live role counts (Greenhouse/Lever) refresh nightly.</p>
    </div>
  );
}
