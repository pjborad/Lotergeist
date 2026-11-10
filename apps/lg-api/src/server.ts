import cron from "node-cron";
import { createLlmFromEnv } from "@bsrx/coroner";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import type { Ctx } from "./core";
import { Db } from "./db";
import { SandboxNotifier } from "./notify";
import { reviewPending } from "./rxwatcher";
import { seedDatabase } from "./seed";
import { ingestFaxInbox, pollOpenFda } from "./today";
import { createVoice } from "./voice";
import { startWebhookDispatcher } from "./webhooks";
import { runOutreachAgent } from "./outreach";

const cfg = loadConfig();
const db = new Db(cfg.sqlitePath);
const ctx: Ctx = { cfg, db, notify: new SandboxNotifier(db, cfg), now: () => Date.now(), llm: createLlmFromEnv(), voice: await createVoice() };
if (seedDatabase(db, cfg)) console.log("Seeded Elm Street Pharmacy · Store 7 (synthetic data)");
await ingestFaxInbox(ctx);
startWebhookDispatcher(ctx);

const app = await buildApp(ctx);
await app.listen({ port: cfg.port, host: "0.0.0.0" });
console.log(`Lotergeist API on http://localhost:${cfg.port}  (notifier=${ctx.notify.name}, llm=${ctx.llm?.name ?? "none"}, voice=${ctx.voice!.name}:${ctx.voice!.voice}, demo=${cfg.demo})`);

// Rx Watcher: review every new order at start-up, then every minute.
void reviewPending(ctx).then((n) => n && console.log(`Rx Watcher reviewed ${n} new order(s)`));
cron.schedule("* * * * *", () => { void reviewPending(ctx).catch(() => undefined); });
// Outreach agent: retries due voicemail attempts inside the calling window, every 5 minutes.
cron.schedule("*/5 * * * *", () => { void runOutreachAgent(ctx).catch(() => undefined); });

// Night Watch: openFDA poll at start-up and every 2 hours (plan 6.3).
if (cfg.nightWatch) {
  setTimeout(() => { void pollOpenFda(ctx).then((r) => console.log("Night Watch:", r)).catch(() => undefined); }, 3000).unref();
  cron.schedule("0 */2 * * *", () => { void pollOpenFda(ctx).catch(() => undefined); }, { timezone: "UTC" });
}
