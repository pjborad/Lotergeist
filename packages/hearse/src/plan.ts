import { distPointSegment, fromXY, haversineKm, toXY, type LatLon } from "./geo";
import { planOrder, type Waypoint } from "./order";
import type { Router } from "./router";
import type { Hazard, WeatherReport } from "./weather";

export interface HearseStop extends Waypoint {
  name: string;
  /** e.g. "42 vials · shelf C-12" */
  load: string;
  /** true when the stop holds refrigerated product (HRS-3) */
  cold: boolean;
}

export interface PlannedStop extends HearseStop {
  eta: string;
  etaMin: number;
  tempC: number;
  tempFlag: "ok" | "hot" | "freezing";
  held: string;
}

export interface ColdWarning {
  kind: "stop" | "transit";
  stopId?: string;
  message: string;
}

export interface HearsePlan {
  depot: LatLon & { id: string; name: string };
  stops: PlannedStop[];
  /** [lon, lat] polyline for the map */
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  /** minutes spent inside a hazard circle during its time window */
  hazardExposureMin: number;
  avoided: boolean;
  /** true if a hazard sits on the route and we could not go around it */
  unavoidable: boolean;
  hazards: Hazard[];
  warnings: ColdWarning[];
  weatherSource: string;
  router: string;
  departs: string;
}

export interface PlanInput {
  depot: LatLon & { id: string; name: string };
  stops: HearseStop[];
  weather: WeatherReport;
  router: Router;
  avoidHazards: boolean;
  departMin?: number; // minutes after midnight
  speedKmh?: number;
  dwellMin?: number;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

function legHitsHazard(a: LatLon, b: LatLon, h: Hazard): boolean {
  const ref = h.center;
  return distPointSegment([0, 0], toXY(a, ref), toXY(b, ref)) < h.radiusKm;
}

/** Km of segment a-b inside the hazard circle, by sampling every ~50 m. */
function kmInside(a: LatLon, b: LatLon, h: Hazard): number {
  const len = haversineKm(a, b);
  if (len === 0) return 0;
  const n = Math.max(2, Math.ceil(len / 0.05));
  const A = toXY(a, h.center), B = toXY(b, h.center);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (Math.hypot(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t) < h.radiusKm) inside++;
  }
  return (inside / n) * len;
}

/** Waypoint that bends a leg around a hazard circle, picking the shorter side. */
function detour(a: LatLon, b: LatLon, h: Hazard, others: Hazard[]): LatLon | null {
  const ref = h.center;
  const A = toXY(a, ref), B = toXY(b, ref);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (const factor of [1.35, 1.8, 2.4]) {
    const cands = ([1, -1] as const).map((side) => fromXY([nx * side * h.radiusKm * factor, ny * side * h.radiusKm * factor], ref));
    cands.sort((p, q) => haversineKm(a, p) + haversineKm(p, b) - (haversineKm(a, q) + haversineKm(q, b)));
    for (const w of cands) {
      if (![h, ...others].some((x) => legHitsHazard(a, w, x) || legHitsHazard(w, b, x))) return w;
    }
  }
  return null;
}

const inWindow = (h: Hazard, min: number) => min / 60 >= h.fromHour && min / 60 < h.toHour;

export async function planHearse(inp: PlanInput): Promise<HearsePlan> {
  const speed = inp.speedKmh ?? 30;
  const dwell = inp.dwellMin ?? 10;
  const depart = inp.departMin ?? 13 * 60;
  const { depot, weather } = inp;

  // 1. visiting order (HRS-1/HRS-2)
  const order = planOrder(depot, inp.stops) as HearseStop[];

  // 2. waypoint chain, bending around hazards when asked to
  const chain: LatLon[] = [depot, ...order, depot];
  const legs: LatLon[][] = [];
  let unavoidable = false;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]!, b = chain[i + 1]!;
    const hit = weather.hazards.find((h) => legHitsHazard(a, b, h));
    if (hit && inp.avoidHazards) {
      const w = detour(a, b, hit, weather.hazards.filter((x) => x !== hit));
      if (w) legs.push([a, w, b]);
      else { legs.push([a, b]); unavoidable = true; }
    } else legs.push([a, b]);
  }

  // 3. route each leg, build ETAs and exposure
  const geometry: [number, number][] = [];
  let km = 0, driveMin = 0, exposure = 0, clock = depart;
  const planned: PlannedStop[] = [];
  const warnings: ColdWarning[] = [];
  let carryingCold = false;
  for (let i = 0; i < legs.length; i++) {
    const leg = await inp.router.route(legs[i]!);
    const minutes = leg.source === "osrm" ? leg.minutes : (leg.km / speed) * 60;
    km += leg.km;
    driveMin += minutes;
    geometry.push(...(geometry.length ? leg.geometry.slice(1) : leg.geometry));

    for (const h of weather.hazards) {
      let inside = 0;
      for (let j = 0; j < legs[i]!.length - 1; j++) inside += kmInside(legs[i]![j]!, legs[i]![j + 1]!, h);
      if (inside > 0 && inWindow(h, clock + minutes / 2)) {
        const m = (inside / Math.max(leg.km, 0.001)) * minutes;
        exposure += m;
        if (carryingCold) warnings.push({ kind: "transit", message: `Refrigerated stock crosses ${h.label} for about ${Math.round(m)} min (${h.tempF}°F). Excursion risk.` });
      }
    }
    clock += minutes;

    if (i < order.length) {
      const s = order[i]!;
      let tempC = weather.stops[s.id]?.tempC ?? weather.ambientC;
      for (const h of weather.hazards) {
        if (haversineKm(s, h.center) < h.radiusKm && inWindow(h, clock)) tempC = (h.tempF - 32) * 5 / 9;
      }
      tempC = Math.round(tempC * 10) / 10;
      const tempFlag: PlannedStop["tempFlag"] = tempC > 25 ? "hot" : tempC < 0 ? "freezing" : "ok";
      if (s.cold && tempFlag !== "ok") warnings.push({ kind: "stop", stopId: s.id, message: `${s.name}: ${tempC}°C at pickup (${tempFlag === "hot" ? "above 25°C" : "below 0°C"}). Cold-chain stop is at risk.` });
      if (s.cold) carryingCold = true;
      planned.push({ ...s, eta: hhmm(clock), etaMin: clock, tempC, tempFlag, held: s.cold ? "2–8 °C held" : "room temp" });
      clock += dwell;
    }
  }

  return {
    depot,
    stops: planned,
    geometry,
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round(driveMin + dwell * order.length),
    hazardExposureMin: Math.round(exposure),
    avoided: inp.avoidHazards && weather.hazards.length > 0 && !unavoidable,
    unavoidable,
    hazards: weather.hazards,
    warnings,
    weatherSource: weather.source,
    router: inp.router.name,
    departs: hhmm(depart)
  };
}
