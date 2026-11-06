import cron from "node-cron";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./ctx";
import { nightWatch, resetDemo } from "./demo";
import { retryFailedWritebacks } from "./fills";

const cfg = loadConfig();
const ctx = await createContext(cfg);
if (ctx.db.all("SELECT 1 FROM recalls LIMIT 1").length === 0) await resetDemo(ctx);

const app = await buildApp(ctx);
await app.listen({ port: cfg.port, host: "0.0.0.0" });
console.log(`Body Snatcher Rx API on http://localhost:${cfg.port}  (rpa=${cfg.rpaMode}, weather=${cfg.weatherMode}, llm=${ctx.llm?.name ?? "regex-only"})`);

// RPA-9: scans whose write-back failed last time are retried on the next run
void retryFailedWritebacks(ctx).catch(() => undefined);

// SUM-1: nightly poll at 02:00 UTC
if (cfg.nightWatch) {
  cron.schedule("0 2 * * *", () => { void nightWatch(ctx).then((r) => console.log("Night Watch:", r)); }, { timezone: "UTC" });
}
