'use client';

import { COLORS, TECH_LABEL, TECHS } from './shared';

// First-visit welcome overlay. Shown once (localStorage 'em.introSeen'),
// reopenable via the ? button in the HUD header.
export default function Intro(props: { onClose: () => void; onTour: () => void }) {
  const { onClose, onTour } = props;
  return (
    <div className="intro-backdrop" onClick={onClose}>
      <div className="intro" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Welcome">
        <h2>⚡ Welcome to Energy Map</h2>
        <p className="intro-lede">
          Every dot is one of the world&rsquo;s biggest clean-energy projects — 2,500+ across solar, wind, batteries,
          geothermal and pumped hydro.
        </p>

        <div className="intro-rows">
          <div className="intro-row">
            <span className="intro-icon">
              {TECHS.slice(0, 3).map((t) => (
                <span key={t} className="ldot" style={{ background: COLORS[t] }} title={TECH_LABEL[t]} />
              ))}
            </span>
            <span>Colours are technologies; bigger dots are bigger projects.</span>
          </div>
          <div className="intro-row">
            <span className="intro-icon">
              <span className="ldot" style={{ background: COLORS.solar }} />
              <span className="ldot ring" style={{ borderColor: COLORS.solar }} />
            </span>
            <span>
              Filled&nbsp;=&nbsp;operating · hollow&nbsp;=&nbsp;under construction. Click any dot for the full story.
            </span>
          </div>
          <div className="intro-row">
            <span className="intro-icon">
              <span className="ldot" style={{ background: COLORS.company }} />
            </span>
            <span>Purple dots are the companies building all this — including who&rsquo;s hiring right now.</span>
          </div>
        </div>

        <div className="intro-actions">
          <button className="intro-primary" onClick={onTour}>
            ★ Take the 60-second tour
          </button>
          <button className="intro-secondary" onClick={onClose}>
            Explore on my own
          </button>
        </div>
        <p className="intro-foot">Reopen this anytime with the ? button up top.</p>
      </div>
    </div>
  );
}
