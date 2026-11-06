import path from "node:path";
import { loadFixtureRecords, recordFromText } from "@bsrx/summoner";
import type { Ctx } from "./ctx";
import { confirmRecall, runHunt, summonRecord } from "./pipeline";

export const DEMO_ID = "D-0417-2026";
/** Real FDA recall (Hikma alendronate, April 2026) used for the live webcam demo. */
export const REAL_DEMO_RECALL = "D-0526-2026";
const PRERUN = ["D-0417-2026", "D-0603-2026", "D-0526-2026"];

/** UX-1 / POST /api/demo/reset: back to the judge's starting state. */
export async function resetDemo(ctx: Ctx, opts: { prerun?: boolean; instant?: boolean } = {}) {
  await ctx.store.deleteEventsByOrigin("rpa");
  ctx.db.clearAll();
  ctx.db.run("DELETE FROM meta");
  ctx.bus.reset();
  ctx.running.clear();
  // the mock terminal keeps F6 notes in memory: clear them so a new take starts clean (best effort, it may be down)
  await fetch(`${ctx.cfg.rxtermUrl}/reset-notes`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => undefined);
  const demo = loadFixtureRecords(path.join(ctx.cfg.fixturesDir, "recalls")).filter((r) => /\(synthetic\)/i.test(r.recalling_firm) || r.recall_number === REAL_DEMO_RECALL);
  for (const rec of demo) await summonRecord(ctx, rec, { demo: true });
  ctx.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_openfda_sync', ?)", String(Date.now()));
  if (opts.prerun) {
    for (const id of PRERUN) {
      confirmRecall(ctx, id, {});
      await runHunt(ctx, id, { stepDelayMs: opts.instant === false ? undefined : 0 });
    }
  }
  return { recalls: demo.length, prerun: !!opts.prerun };
}

/** Night Watch: poll openFDA, summon what is new. Never confirms on its own unless asked to autorun. */
export async function nightWatch(ctx: Ctx, opts: { days?: number } = {}) {
  const res = await ctx.openfda.fetchRecent(opts.days ?? 7);
  let added = 0;
  const ids: string[] = [];
  for (const rec of res.records) {
    if (!rec.recall_number || ctx.db.get("SELECT 1 FROM recalls WHERE id = ?", rec.recall_number)) continue;
    await summonRecord(ctx, rec);
    ids.push(rec.recall_number);
    added++;
  }
  if (!res.cached) ctx.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_openfda_sync', ?)", String(Date.now()));
  if (ctx.cfg.nightWatchAutorun) {
    for (const id of ids) {
      try { confirmRecall(ctx, id, { auto: true }); void runHunt(ctx, id); } catch { /* needs a living witness: leave it for the pharmacist */ }
    }
  }
  return { added, ids, cached: res.cached, reason: res.reason ?? null };
}

export { recordFromText };
