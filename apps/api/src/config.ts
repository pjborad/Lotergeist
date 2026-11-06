import path from "node:path";

export interface Config {
  root: string;
  dataDir: string;
  fixturesDir: string;
  port: number;
  rxtermUrl: string;
  rpaMode: "live" | "replay";
  /** pause between RPA steps so the UI can show them streaming */
  stepDelayMs: number;
  weatherMode: "fixture" | "nws";
  osrmUrl: string;
  nwsUserAgent: string;
  steeringPromptPath: string;
  nightWatch: boolean;
  nightWatchAutorun: boolean;
  openfdaKey?: string;
  cryptPath: string;
  sqlitePath: string;
  webDist: string;
  /** YYYY-MM-DD used for the SOUL-9 expiry check; defaults to the real date */
  today?: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, o: Partial<Config> = {}): Config {
  const root = path.resolve(import.meta.dirname, "../../..");
  const dataDir = path.resolve(root, env.DATA_DIR ?? "data");
  return {
    root,
    dataDir,
    fixturesDir: path.join(root, "fixtures"),
    port: Number(env.API_PORT ?? 4000),
    rxtermUrl: env.RXTERM_URL ?? `http://localhost:${env.RXTERM_PORT ?? 4100}`,
    rpaMode: env.RPA_MODE === "replay" ? "replay" : "live",
    stepDelayMs: Number(env.RPA_STEP_DELAY_MS ?? 140),
    weatherMode: env.WEATHER_MODE === "nws" ? "nws" : "fixture",
    osrmUrl: env.OSRM_URL ?? "",
    nwsUserAgent: env.NWS_USER_AGENT ?? "BodySnatcherRx/0.1 (hackathon demo)",
    steeringPromptPath: path.join(root, ".kiro/steering/coroner-prompt.md"),
    nightWatch: env.NIGHT_WATCH !== "0",
    nightWatchAutorun: env.NIGHT_WATCH_AUTORUN === "1",
    openfdaKey: env.OPENFDA_API_KEY || undefined,
    cryptPath: path.join(dataDir, "crypt.duckdb"),
    sqlitePath: path.join(dataDir, "app.sqlite"),
    webDist: path.join(root, "apps/web/dist"),
    today: env.TODAY || undefined,
    ...o
  };
}
