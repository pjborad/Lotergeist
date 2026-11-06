export interface LatLon { lat: number; lon: number }

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local flat projection in km around a reference point; fine at city scale. */
export function toXY(p: LatLon, ref: LatLon): [number, number] {
  return [(p.lon - ref.lon) * 111.32 * Math.cos(rad(ref.lat)), (p.lat - ref.lat) * 110.574];
}
export function fromXY(xy: [number, number], ref: LatLon): LatLon {
  return { lat: ref.lat + xy[1] / 110.574, lon: ref.lon + xy[0] / (111.32 * Math.cos(rad(ref.lat))) };
}

/** Distance from point to segment, all in km-plane coordinates. */
export function distPointSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pathLengthKm(pts: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversineKm(pts[i - 1]!, pts[i]!);
  return s;
}
