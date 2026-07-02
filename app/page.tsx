'use client';

import dynamic from 'next/dynamic';

// MapLibre needs window/WebGL, so the whole map app renders client-side only.
const MapApp = dynamic(() => import('./components/MapApp'), {
  ssr: false,
  loading: () => <div className="loading">Loading map…</div>,
});

export default function Page() {
  return <MapApp />;
}
