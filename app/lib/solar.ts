// Solar-position math for the day/night layer (§4 D1). A standard low-precision
// NOAA-style approximation — good to ~0.1°, far finer than the globe reads at
// these zooms — with zero dependencies. Verified against the solstices/equinox
// and known local noon longitudes.

const RAD = Math.PI / 180;

export type LngLat = { lng: number; lat: number };

// The point on Earth where the sun is directly overhead at `date`.
export function subsolarPoint(date: Date): LngLat {
  const jd = date.getTime() / 86400000 + 2440587.5; // Julian date
  const n = jd - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean solar longitude (deg)
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD; // obliquity of the ecliptic
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)); // declination (rad)
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)); // right ascension (rad)
  const gmst = (280.46061837 + 360.98564736629 * n) % 360; // Greenwich mean sidereal time (deg)
  let lng = ra / RAD - gmst;
  lng = ((lng + 540) % 360) - 180; // normalise to −180..180
  return { lng, lat: decl / RAD };
}

// Is a point currently in daylight? (sun above the horizon → positive elevation)
export function isSunlit(lng: number, lat: number, sub: LngLat): boolean {
  const h = (lng - sub.lng) * RAD;
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(sub.lat * RAD) +
    Math.cos(lat * RAD) * Math.cos(sub.lat * RAD) * Math.cos(h);
  return cosZenith > 0;
}

type Polygon = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

// A GeoJSON polygon covering the night hemisphere, for a shaded overlay. The
// terminator is the locus where solar elevation = 0: for each longitude the
// boundary latitude is atan(−cos H / tan δ). We trace that curve west→east then
// close along whichever pole is currently dark.
export function nightPolygon(sub: LngLat, step = 1): Polygon {
  // Clamp the declination a hair off zero so tan() stays finite at the equinox
  // (when the terminator runs pole-to-pole through the poles).
  const decl = Math.abs(sub.lat) < 0.1 ? (sub.lat >= 0 ? 0.1 : -0.1) : sub.lat;
  const tanDecl = Math.tan(decl * RAD);
  const ring: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += step) {
    const h = (lng - sub.lng) * RAD;
    const lat = Math.atan(-Math.cos(h) / tanDecl) / RAD;
    ring.push([lng, lat]);
  }
  // The dark pole is the one opposite the subsolar hemisphere.
  const darkPole = sub.lat >= 0 ? -90 : 90;
  ring.push([180, darkPole], [-180, darkPole]);
  ring.push(ring[0]); // close the ring
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
