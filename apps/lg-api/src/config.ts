import path from "node:path";

export interface Config {
  root: string;
  dataDir: string;
  fixturesDir: string;
  sqlitePath: string;
  port: number;
  webDist: string;
  assetsDir: string;
  openfdaKey?: string;
  /** minimum months to expiry accepted at receiving */
  minExpiryMonths: number;
  nightWatch: boolean;
  /** run delivery receipts of the sandbox SMS provider faster in tests */
  sandboxDelayMs: number;
  /** "demo" prefills the sign-in form; the API never trusts it */
  demo: boolean;
  cookieSecure: boolean;
  /** YYYY-MM-DD override for "today" (tests) */
  today?: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, o: Partial<Config> = {}): Config {
  const root = path.resolve(import.meta.dirname, "../../..");
  const dataDir = path.resolve(root, env.DATA_DIR ?? "data");
  return {
    root,
    dataDir,
    fixturesDir: path.join(root, "apps/lg-api/fixtures"),
    sqlitePath: path.join(dataDir, "lotergeist.sqlite"),
    port: Number(env.LG_API_PORT ?? env.API_PORT ?? 4000),
    webDist: path.join(root, "apps/lg-web/dist"),
    assetsDir: path.join(root, "apps/lg-web/public"),
    openfdaKey: env.OPENFDA_API_KEY || undefined,
    minExpiryMonths: Number(env.MIN_EXPIRY_MONTHS ?? 6),
    nightWatch: env.NIGHT_WATCH !== "0",
    sandboxDelayMs: Number(env.SANDBOX_DELAY_MS ?? 1500),
    demo: env.LG_DEMO !== "0",
    cookieSecure: env.COOKIE_SECURE === "1",
    today: env.TODAY || undefined,
    ...o
  };
}
