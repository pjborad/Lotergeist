import { haversineKm, type LatLon } from "./geo";

export interface RoutedLeg {
  /** [lon, lat] pairs */
  geometry: [number, number][];
  km: number;
  minutes: number;
  source: "osrm" | "straight";
}

export interface Router {
  readonly name: string;
  /** route through the given points in order */
  route(points: LatLon[]): Promise<RoutedLeg>;
}

export class StraightRouter implements Router {
  readonly name = "straight-line";
  constructor(private speedKmh = 30) {}
  async route(points: LatLon[]): Promise<RoutedLeg> {
    let km = 0;
    for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
    return { geometry: points.map((p) => [p.lon, p.lat]), km, minutes: (km / this.speedKmh) * 60, source: "straight" };
  }
}

/** OSRM /route with a straight-line fallback if the server is unreachable. */
export class OsrmRouter implements Router {
  readonly name = "osrm";
  private fallback: StraightRouter;
  constructor(private baseUrl: string, speedKmh = 30, private fetchImpl: typeof fetch = fetch) {
    this.fallback = new StraightRouter(speedKmh);
  }
  async route(points: LatLon[]): Promise<RoutedLeg> {
    try {
      const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const j = (await res.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
      const r = j.routes?.[0];
      if (!r) throw new Error("OSRM: no route");
      return { geometry: r.geometry.coordinates, km: r.distance / 1000, minutes: r.duration / 60, source: "osrm" };
    } catch {
      return this.fallback.route(points);
    }
  }
}

export function routerFromEnv(env: Record<string, string | undefined> = process.env): Router {
  return env.OSRM_URL ? new OsrmRouter(env.OSRM_URL) : new StraightRouter();
}
