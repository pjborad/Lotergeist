import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { StraightRouter, haversineKm, nearestNeighbour, planHearse, planOrder, tourLength, type HearseStop, type Hazard } from "../src/index";
import fs from "node:fs";

const depot = { id: "depot", name: "Crypt", lat: 45.5, lon: -122.7 };
const stopArb = fc.record({ lat: fc.double({ min: 45.3, max: 45.7, noNaN: true }), lon: fc.double({ min: -122.9, max: -122.4, noNaN: true }) });
const stopsArb = fc.array(stopArb, { minLength: 1, maxLength: 12 }).map((a) => a.map((p, i): HearseStop => ({ id: `S${i}`, name: `Stop ${i}`, load: "x", cold: i % 3 === 0, ...p })));

describe("route order (HRS-1, HRS-2)", () => {
  it("PBT: every stop exactly once, for 1 to 12 stops", () => {
    fc.assert(fc.property(stopsArb, (stops) => {
      const o = planOrder(depot, stops);
      return o.length === stops.length && new Set(o.map((s) => s.id)).size === stops.length && stops.every((s) => o.some((x) => x.id === s.id));
    }));
  });
  it("PBT: 2-opt is never longer than nearest neighbour", () => {
    fc.assert(fc.property(stopsArb, (stops) => tourLength(depot, planOrder(depot, stops)) <= tourLength(depot, nearestNeighbour(depot, stops)) + 1e-9));
  });
  it("PBT: the planned route starts and ends at the depot", async () => {
    await fc.assert(fc.asyncProperty(stopsArb, async (stops) => {
      const plan = await planHearse({ depot, stops, weather: { source: "fixture", hazards: [], stops: {}, ambientC: 18 }, router: new StraightRouter(), avoidHazards: false });
      const first = plan.geometry[0]!, last = plan.geometry.at(-1)!;
      return first[0] === depot.lon && first[1] === depot.lat && last[0] === depot.lon && last[1] === depot.lat && plan.stops.length === stops.length;
    }), { numRuns: 60 });
  });
});

const demoHazard = JSON.parse(fs.readFileSync(new URL("../../../fixtures/weather/heat-advisory.json", import.meta.url), "utf8")).hazards as Hazard[];
const mk = (id: string, x: number, y: number, cold: boolean): HearseStop => ({ id, name: `Stop ${id}`, load: "", cold, lat: 45.5152 - (y - 260) * 0.00023, lon: -122.6784 + ((x - 400) * 0.00023) / Math.cos((45.5152 * Math.PI) / 180) });
const designStops = [mk("A", 230, 330, false), mk("B", 360, 170, false), mk("C", 520, 100, true), mk("D", 650, 330, true), mk("E", 460, 430, false)];
const designDepot = { id: "depot", name: "Crypt", lat: 45.5152 - (440 - 260) * 0.00023, lon: -122.6784 + ((90 - 400) * 0.00023) / Math.cos((45.5152 * Math.PI) / 180) };

describe("heat advisory (HRS-3)", () => {
  const weather = { source: "fixture" as const, hazards: demoHazard, stops: {}, ambientC: 18 };
  it("the direct route crosses the heat zone with cold stock aboard and warns", async () => {
    const p = await planHearse({ depot: designDepot, stops: designStops, weather, router: new StraightRouter(), avoidHazards: false });
    expect(p.hazardExposureMin).toBeGreaterThan(0);
    expect(p.warnings.some((w) => w.kind === "transit" || w.kind === "stop")).toBe(true);
  });
  it("the avoid route has zero exposure and is longer", async () => {
    const direct = await planHearse({ depot: designDepot, stops: designStops, weather, router: new StraightRouter(), avoidHazards: false });
    const around = await planHearse({ depot: designDepot, stops: designStops, weather, router: new StraightRouter(), avoidHazards: true });
    expect(around.hazardExposureMin).toBe(0);
    expect(around.avoided).toBe(true);
    expect(around.distanceKm).toBeGreaterThan(direct.distanceKm);
    expect(around.warnings.filter((w) => w.kind === "transit")).toHaveLength(0);
  });
  it("flags a cold stop that sits inside a freeze", async () => {
    const stops = [mk("X", 300, 300, true)];
    const freeze: Hazard = { id: "f", kind: "freeze", label: "FREEZE WARNING", center: { lat: stops[0]!.lat, lon: stops[0]!.lon }, radiusKm: 3, tempF: 20, fromHour: 0, toHour: 24 };
    const p = await planHearse({ depot: designDepot, stops, weather: { source: "fixture", hazards: [freeze], stops: {}, ambientC: 18 }, router: new StraightRouter(), avoidHazards: false });
    expect(p.stops[0]!.tempFlag).toBe("freezing");
    expect(p.warnings.some((w) => w.kind === "stop" && w.stopId === "X")).toBe(true);
  });
  it("haversine sanity", () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
  });
});
