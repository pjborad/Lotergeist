import fs from "node:fs";
import path from "node:path";
import { createLlmFromEnv, type LlmClient } from "@bsrx/coroner";
import { generateWorld, type World } from "@bsrx/crypt-seed";
import { OpenFdaClient, RateLimiter } from "@bsrx/summoner";
import { CryptStore, type Party } from "@bsrx/tracker";
import type { ShortageFixture } from "@bsrx/undertaker";
import type { FixtureFile } from "@bsrx/hearse";
import { Bus } from "./bus";
import type { Config } from "./config";
import { Db } from "./db";

export interface Ctx {
  cfg: Config;
  db: Db;
  store: CryptStore;
  bus: Bus;
  llm: LlmClient | null;
  openfda: OpenFdaClient;
  /** SUM-4: one 240-per-minute budget shared by every openFDA call */
  openfdaLimiter: RateLimiter;
  world: World;
  parties: Map<string, Party>;
  shortageFixture: ShortageFixture;
  weatherFixture: FixtureFile;
  running: Set<string>;
}

const readJson = <T>(file: string, fallback: T): T => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
};

export async function createContext(cfg: Config, opts: { world?: World; store?: CryptStore; llm?: LlmClient | null; db?: Db } = {}): Promise<Ctx> {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const world = opts.world ?? generateWorld();
  const store = opts.store ?? (await CryptStore.open(cfg.cryptPath));
  if ((await store.countEvents()) === 0) {
    await store.replaceParties(world.parties);
    await store.insertEvents(world.events());
  }
  const parties = new Map((await store.parties()).map((p) => [p.gln, p]));
  const openfdaLimiter = new RateLimiter(240, 60_000);
  return {
    cfg,
    db: opts.db ?? new Db(cfg.sqlitePath),
    store,
    bus: new Bus(),
    llm: opts.llm === undefined ? createLlmFromEnv() : opts.llm,
    openfdaLimiter,
    openfda: new OpenFdaClient({ apiKey: cfg.openfdaKey, fixtureDir: path.join(cfg.fixturesDir, "recalls"), limiter: openfdaLimiter }),
    world,
    parties,
    shortageFixture: readJson<ShortageFixture>(path.join(cfg.fixturesDir, "shortages.json"), {}),
    weatherFixture: readJson<FixtureFile>(path.join(cfg.fixturesDir, "weather/heat-advisory.json"), { hazards: [] }),
    running: new Set()
  };
}
