import { fixtureWeather, nwsWeather, OsrmRouter, planHearse, StraightRouter, type HearsePlan, type HearseStop, type WeatherReport } from "@bsrx/hearse";
import type { Ctx } from "./ctx";
import type { HearseView } from "./types";

export function pharmacyLetters(ctx: Ctx): Map<string, string> {
  const ph = [...ctx.parties.values()].filter((p) => p.kind === "pharmacy").sort((a, b) => a.gln.localeCompare(b.gln));
  return new Map(ph.map((p, i) => [p.gln, String.fromCharCode(65 + i)]));
}

function noun(name: string): string {
  if (/\bpens?\b/i.test(name)) return "pens";
  if (/vial|injectable/i.test(name)) return "vials";
  if (/bottle/i.test(name)) return "bottles";
  return "packages";
}

export interface QuarantineRow { pharmacy_gln: string; gtin: string; shelf: string; recall_id: string }

export async function loadWeather(ctx: Ctx, stops: HearseStop[]): Promise<WeatherReport> {
  if (ctx.cfg.weatherMode === "nws") {
    try {
      return await nwsWeather(stops, { userAgent: ctx.cfg.nwsUserAgent, etaHour: 14 });
    } catch {
      return { ...fixtureWeather(ctx.weatherFixture), source: "fixture (NWS unavailable)" };
    }
  }
  return fixtureWeather(ctx.weatherFixture);
}

export async function planHearseForRecalls(ctx: Ctx, recallIds: string[], avoidHeat: boolean): Promise<HearseView> {
  const marks = recallIds.map(() => "?").join(",");
  const rows = recallIds.length ? ctx.db.all<QuarantineRow>(`SELECT pharmacy_gln, gtin, shelf, recall_id FROM quarantine WHERE recall_id IN (${marks})`, ...recallIds) : [];
  const letters = pharmacyLetters(ctx);
  const byPh = new Map<string, QuarantineRow[]>();
  for (const r of rows) (byPh.get(r.pharmacy_gln) ?? byPh.set(r.pharmacy_gln, []).get(r.pharmacy_gln)!).push(r);
  const products = new Map(ctx.world.products.map((p) => [p.gtin, p]));

  const stops: HearseStop[] = [];
  for (const [gln, items] of byPh) {
    const party = ctx.parties.get(gln)!;
    const counts = new Map<string, number>();
    let cold = false;
    for (const it of items) {
      const p = products.get(it.gtin);
      const n = noun(p?.name ?? "");
      counts.set(n, (counts.get(n) ?? 0) + 1);
      if (p?.refrigerated) cold = true;
    }
    const shelves = [...new Set(items.map((i) => i.shelf).filter(Boolean))];
    const load = [...counts].map(([n, c]) => `${c} ${n}`).join(" · ") + (shelves.length === 1 ? ` · shelf ${shelves[0]}` : "");
    stops.push({ id: letters.get(gln) ?? "?", name: party.name, load, cold, lat: party.lat!, lon: party.lon! });
  }
  stops.sort((a, b) => a.id.localeCompare(b.id));

  const depot = { id: "depot", name: ctx.world.depot.name, lat: ctx.world.depot.lat!, lon: ctx.world.depot.lon! };
  const weather = await loadWeather(ctx, stops);
  const router = ctx.cfg.osrmUrl ? new OsrmRouter(ctx.cfg.osrmUrl) : new StraightRouter();

  let plan: HearsePlan;
  let detourMin: number | null = null;
  if (!stops.length) {
    plan = { depot, stops: [], geometry: [], distanceKm: 0, durationMin: 0, hazardExposureMin: 0, avoided: false, unavoidable: false, hazards: weather.hazards, warnings: [], weatherSource: weather.source, router: router.name, departs: "13:00" };
  } else {
    plan = await planHearse({ depot, stops, weather, router, avoidHazards: avoidHeat });
    if (avoidHeat && plan.avoided) {
      const direct = await planHearse({ depot, stops, weather, router, avoidHazards: false });
      detourMin = Math.max(0, plan.durationMin - direct.durationMin);
    }
  }

  const h = Math.floor(plan.durationMin / 60), m = plan.durationMin % 60;
  const exposure = plan.hazardExposureMin === 0 ? "0 heat exposure" : `${plan.hazardExposureMin} min in heat zone`;
  const view: HearseView = {
    recallIds, avoidHeat, depot: { name: depot.name, lat: depot.lat, lon: depot.lon },
    stops: plan.stops.map((s) => ({ id: s.id, name: s.name, load: s.load, eta: s.eta, cold: s.cold, held: s.held, tempC: s.tempC, tempFlag: s.tempFlag, lat: s.lat, lon: s.lon })),
    geometry: plan.geometry, distanceKm: plan.distanceKm, durationMin: plan.durationMin, hazardExposureMin: plan.hazardExposureMin,
    avoided: plan.avoided, unavoidable: plan.unavoidable,
    hazards: plan.hazards.map((x) => ({ id: x.id, label: x.label, kind: x.kind, lat: x.center.lat, lon: x.center.lon, radiusKm: x.radiusKm, tempF: x.tempF, fromHour: x.fromHour, toHour: x.toHour })),
    warnings: plan.warnings, weatherSource: plan.weatherSource, router: plan.router, departs: plan.departs,
    summary: `${plan.distanceKm} km · ${h} h ${m} m · ${exposure}`, detourMin
  };
  ctx.db.run("INSERT INTO routes (recall_ids, avoid_heat, stops_json, geojson, cold_chain_warnings, created_at) VALUES (?,?,?,?,?,?)",
    recallIds.join(","), avoidHeat ? 1 : 0, JSON.stringify(view.stops), JSON.stringify({ type: "LineString", coordinates: plan.geometry }), JSON.stringify(plan.warnings), Date.now());
  return view;
}
