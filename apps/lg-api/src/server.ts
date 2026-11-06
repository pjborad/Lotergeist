import cron from "node-cron";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import type { Ctx } from "./core";
import { Db } from "./db";
import { SandboxNotifier } from "./notify";
import { seedDatabase } from "./seed";
import { ingestFaxInbox, pollOpenFda } from "./today";

const cfg = loadConfig();
const db = new Db(cfg.sqlitePath);
const ctx: Ctx = { cfg, db, notify: new SandboxNotifier(db, cfg), now: () => Date.now() };
if (seedDatabase(db, cfg)) console.log("Seeded Elm Street Pharmacy · Store 7 (synthetic data)");
await ingestFaxInbox(ctx);

const app = await buildApp(ctx);
await app.listen({ port: cfg.port, host: "0.0.0.0" });
console.log(`Lotergeist API on http://localhost:${cfg.port}  (notifier=${ctx.notify.name}, demo=${cfg.demo})`);

// Night Watch: poll openFDA at start-up and nightly at 02:00 UTC
if (cfg.nightWatch) {
  setTimeout(() => { void pollOpenFda(ctx).then((r) => console.log("Night Watch:", r)).catch(() => undefined); }, 3000).unref();
  cron.schedule("0 2 * * *", () => { void pollOpenFda(ctx).catch(() => undefined); }, { timezone: "UTC" });
}
