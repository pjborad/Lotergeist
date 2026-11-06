/** The design's 800x520 map canvas <-> lat/lon. Mirrors xyToLatLon in packages/crypt-seed. */
export const LAT0 = 45.5152;
export const LON0 = -122.6784;
export const DEG_PER_PX = 0.00023;
const COS = Math.cos((LAT0 * Math.PI) / 180);

export const project = (lat: number, lon: number): [number, number] => [400 + ((lon - LON0) * COS) / DEG_PER_PX, 260 + (LAT0 - lat) / DEG_PER_PX];
export const kmToPx = (km: number) => km / (DEG_PER_PX * 110.574);
export const pathFrom = (geometry: [number, number][]) =>
  geometry.map(([lon, lat], i) => { const [x, y] = project(lat, lon); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
