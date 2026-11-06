import { haversineKm, type LatLon } from "./geo";

export interface Waypoint extends LatLon { id: string }

export type Dist = (a: LatLon, b: LatLon) => number;

export function tourLength(depot: LatLon, order: Waypoint[], dist: Dist = haversineKm): number {
  let s = 0, prev: LatLon = depot;
  for (const w of order) { s += dist(prev, w); prev = w; }
  return s + dist(prev, depot);
}

/** Nearest neighbour from the depot. */
export function nearestNeighbour(depot: LatLon, stops: Waypoint[], dist: Dist = haversineKm): Waypoint[] {
  const left = [...stops];
  const out: Waypoint[] = [];
  let cur: LatLon = depot;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (dist(cur, left[i]!) < dist(cur, left[bi]!)) bi = i;
    const [next] = left.splice(bi, 1);
    out.push(next!);
    cur = next!;
  }
  return out;
}

/** 2-opt improvement on a closed tour that starts and ends at the depot. */
export function twoOpt(depot: LatLon, order: Waypoint[], dist: Dist = haversineKm): Waypoint[] {
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (tourLength(depot, cand, dist) + 1e-9 < tourLength(depot, best, dist)) { best = cand; improved = true; }
      }
    }
  }
  return best;
}

/** HRS-1/HRS-2: depot -> every stop exactly once -> depot. */
export function planOrder(depot: LatLon, stops: Waypoint[], dist: Dist = haversineKm): Waypoint[] {
  if (stops.length <= 2) return nearestNeighbour(depot, stops, dist);
  return twoOpt(depot, nearestNeighbour(depot, stops, dist), dist);
}
