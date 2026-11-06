import type { LatLon } from "./geo";

export interface Hazard {
  id: string;
  kind: "heat" | "freeze";
  label: string;
  center: LatLon;
  radiusKm: number;
  tempF: number;
  /** local hour window, e.g. 14 to 19 */
  fromHour: number;
  toHour: number;
}

export interface StopWeather { tempC: number; alert?: string }

export interface WeatherReport {
  source: "fixture" | "nws" | "fixture (NWS unavailable)";
  hazards: Hazard[];
  /** ambient forecast per stop id, when known */
  stops: Record<string, StopWeather>;
  ambientC: number;
}

export const fToC = (f: number) => Math.round(((f - 32) * 5) / 9 * 10) / 10;

export interface FixtureFile { ambientC?: number; hazards: Hazard[] }

export function fixtureWeather(fx: FixtureFile): WeatherReport {
  return { source: "fixture", hazards: fx.hazards, stops: {}, ambientC: fx.ambientC ?? 18 };
}

const ALERT_KINDS: { re: RegExp; kind: Hazard["kind"]; tempF: number }[] = [
  { re: /heat/i, kind: "heat", tempF: 98 },
  { re: /freez|frost|winter|cold/i, kind: "freeze", tempF: 25 }
];

/**
 * HRS-3 against the real National Weather Service API. api.weather.gov needs a descriptive
 * User-Agent. Hourly forecast gives the temperature at each stop; active alerts become hazard circles.
 */
export async function nwsWeather(stops: ({ id: string } & LatLon)[], opts: { userAgent: string; fetchImpl?: typeof fetch; etaHour?: number }): Promise<WeatherReport> {
  const f = opts.fetchImpl ?? fetch;
  const headers = { "User-Agent": opts.userAgent, Accept: "application/geo+json" };
  const get = async (url: string) => {
    const r = await f(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`NWS HTTP ${r.status}`);
    return (await r.json()) as Record<string, any>;
  };
  const report: WeatherReport = { source: "nws", hazards: [], stops: {}, ambientC: 18 };
  const hour = opts.etaHour ?? new Date().getHours();
  for (const s of stops) {
    const pt = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
    const points = await get(`https://api.weather.gov/points/${pt}`);
    const hourly = await get(points.properties.forecastHourly as string);
    const periods = (hourly.properties.periods ?? []) as { temperature: number; temperatureUnit: string; startTime: string }[];
    const pick = periods.find((p) => new Date(p.startTime).getHours() === hour) ?? periods[0];
    if (pick) report.stops[s.id] = { tempC: pick.temperatureUnit === "F" ? fToC(pick.temperature) : pick.temperature };
    const alerts = await get(`https://api.weather.gov/alerts/active?point=${pt}`);
    for (const a of (alerts.features ?? []) as { properties: { event: string; id: string } }[]) {
      const k = ALERT_KINDS.find((x) => x.re.test(a.properties.event));
      if (!k || report.hazards.some((h) => h.id === a.properties.id)) continue;
      report.hazards.push({ id: a.properties.id, kind: k.kind, label: a.properties.event.toUpperCase(), center: { lat: s.lat, lon: s.lon }, radiusKm: 5, tempF: k.tempF, fromHour: 0, toHour: 24 });
      report.stops[s.id] = { ...(report.stops[s.id] ?? { tempC: fToC(k.tempF) }), alert: a.properties.event };
    }
  }
  return report;
}
