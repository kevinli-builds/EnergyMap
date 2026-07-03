import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Energy Map — the world’s biggest clean energy projects',
  description:
    'Interactive world map of major solar, wind, battery, geothermal and pumped-hydro projects — operating and under construction — plus the companies building them that are hiring.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
