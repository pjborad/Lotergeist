import path from "node:path";
import { OpenFdaClient } from "@bsrx/summoner";
import { autopsy } from "@bsrx/coroner";
import type { Actor, Ctx } from "./core";
import { monthEnd, ndcFromAny } from "./domain";
import { listDeliveries } from "./receiving";
import { listLots } from "./inventory";
import { lookupRecall, recallImpact } from "./recall";

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** A believable cold-chain reading. There is no real sensor in the demo: the UI says so. */
export function fridgeTemp(now: number): number {
  const t = now / 60_000;
  return Math.round((4.2 + 0.5 * Math.sin(t / 11) + 0.2 * Math.sin(t / 3.7)) * 10) / 10;
}

export function todayView(ctx: Ctx, actor: Actor) {
  const now = ctx.now();
  const nowD = new Date(now);
  const hour = nowD.getUTCHours();
  const first = actor.name.replace(/^[A-Z]\.\s*/, "").split(/[ ,]/)[0] ?? actor.name;
  const shift = hour >= 6 && hour < 14 ? "day shift" : hour >= 14 && hour < 22 ? "evening shift" : "night shift";
  const sync = Number(ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_sync'")?.value ?? now);

  // ---- recall banner: any open recall that matches lots this store received
  const banner = ctx.db.all<{ id: string; status: string; product: string }>("SELECT id, status, product_description AS product FROM recalls WHERE status <> 'closed' ORDER BY created_at")
    .map((r) => {
      const imp = recallImpact(ctx, r.id, { includeUnconfirmed: true });
      const lots = ctx.db.all<{ lot: string; ndc11: string }>("SELECT lot, ndc11 FROM recall_lots WHERE recall_id = ?", r.id)
        .filter((l) => ctx.db.get("SELECT 1 FROM lots WHERE upper(lot) = upper(?) AND (? = '' OR ndc11 = ?)", l.lot, l.ndc11 ?? "", l.ndc11 ?? ""));
      const units = ctx.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.status IN ('on_shelf','quarantined') AND EXISTS (SELECT 1 FROM recall_lots rl WHERE rl.recall_id = ? AND upper(rl.lot) = upper(l.lot))`, r.id)!.n;
      const fax = ctx.db.get<{ received_at: number }>("SELECT received_at FROM fax_inbox WHERE recall_id = ? ORDER BY id DESC LIMIT 1", r.id);
      return { id: r.id, status: r.status, product: r.product, lotsReceived: lots.length, units, patients: imp.patientCount, faxAt: fax?.received_at ?? null };
    }).filter((b) => b.lotsReceived > 0)[0] ?? null;

  const deliveries = listDeliveries(ctx).filter((d) => d.status !== "closed");
  const remaining = deliveries.reduce((a, d) => a + (d.expected - d.checkedIn), 0);
  const month = nowD.toISOString().slice(0, 7);
  const filled = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM dispenses WHERE state <> 'sent_back' AND strftime('%Y-%m', filled_at / 1000, 'unixepoch') = ?", month)!.n;
  const waiting = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM prescriptions WHERE status = 'ready'")!.n;
  const totals = ctx.db.get<{ a: number; b: number }>("SELECT count(*) AS a, sum(CASE WHEN package_id IS NOT NULL THEN 1 ELSE 0 END) AS b FROM dispenses WHERE state <> 'sent_back'")!;
  const rate = totals.a ? Math.round((1000 * (totals.b ?? 0)) / totals.a) / 10 : 100;
  const temp = fridgeTemp(now);

  const kpis = [
    { label: "Deliveries to check in", value: String(deliveries.length), sub: `${remaining} packages · ${deliveries[0]?.wholesaler ?? "none due"}`, tag: deliveries.length ? "Due" : "Clear", tone: deliveries.length ? "orange" : "green" },
    { label: "Prescriptions filled", value: String(filled), sub: `${waiting} waiting for pickup · this month`, tag: "Live", tone: "green" },
    { label: "Lot capture rate", value: `${rate}%`, sub: "Fills with lot + serial recorded", tag: "DSCSA", tone: "violet" },
    { label: "Fridge F1", value: `${temp.toFixed(1)} °C`, sub: "In range 2–8 °C · simulated sensor", tag: temp >= 2 && temp <= 8 ? "OK" : "Alert", tone: temp >= 2 && temp <= 8 ? "green" : "red" }
  ];

  // ---- expiring lots by month: this month and the next four
  const lots = listLots(ctx).rows;
  const expiring = [0, 1, 2, 3, 4].map((k) => {
    const m = monthEnd(nowD.getUTCFullYear(), nowD.getUTCMonth() + k).slice(0, 7);
    return { month: new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + k, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), n: lots.filter((l) => l.expiry.startsWith(m)).length, current: k === 0 };
  });

  // ---- work queue
  const tasks: { title: string; sub: string; when: string; href: string; dot: string }[] = [];
  if (banner && actor.role === "pharmacist") tasks.push({ title: `Work recall ${banner.id}`, sub: banner.status === "notified" ? "Messages sent · call list and returns remain" : `Quarantine ${banner.units} units · notify ${banner.patients} patients`, when: "Now", href: "/recalls", dot: "#F87171" });
  for (const d of deliveries) tasks.push({ title: `Check in delivery ${d.id}`, sub: `${d.expected - d.checkedIn} of ${d.expected} packages left · ${d.note}`, when: d.arrived.replace("Today ", ""), href: "/receiving", dot: "#FB923C" });
  const toVerify = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM prescriptions WHERE status = 'to_verify'")!.n;
  if (toVerify) tasks.push({ title: `Verify ${toVerify} filled prescription${toVerify === 1 ? "" : "s"}`, sub: "Lots scanned, awaiting pharmacist check", when: "19:00", href: "/fill", dot: "#A78BFA" });
  const thisMonth = expiring[0]!.n;
  if (thisMonth) tasks.push({ title: `Pull ${thisMonth} lot${thisMonth === 1 ? "" : "s"} expiring this month`, sub: "Move to return-to-vendor bin RTV-1", when: "Tonight", href: "/inventory?filter=exp", dot: "#FBBF24" });
  for (const t of ctx.db.all<any>("SELECT * FROM tasks WHERE done = 0")) tasks.push({ title: t.title, sub: t.sub, when: t.due, href: t.href, dot: t.dot });

  const feed = ctx.db.all<any>(
    `SELECT e.at, e.kind, e.user_name, l.lot, p.name FROM lot_events e JOIN lots l ON l.id = e.lot_id JOIN products p ON p.ndc11 = l.ndc11 ORDER BY e.at DESC, e.id DESC LIMIT 8`
  ).map((e) => ({ time: hhmm(e.at), kind: e.kind, product: e.name.split(" · ")[0], lot: e.lot, by: e.user_name }));

  return {
    greeting: { title: `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`, line: `${nowD.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })} · ${shift} · last sync ${Math.max(0, Math.round((now - sync) / 60_000))} min ago` },
    banner, kpis, tasks: tasks.slice(0, 5), openTasks: tasks.length, expiring, feed,
    badges: { receiving: deliveries.length, recalls: ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM recalls WHERE status <> 'closed'")!.n }
  };
}

// ------------------------------------------------------------------ Night Watch

/** Poll openFDA for new enforcement records and keep only those whose lots we actually hold. */
export async function pollOpenFda(ctx: Ctx): Promise<{ checked: number; matched: string[]; cached: boolean }> {
  const client = new OpenFdaClient({ apiKey: ctx.cfg.openfdaKey, fixtureDir: path.join(ctx.cfg.fixturesDir, "recalls") });
  const res = await client.fetchRecent(7);
  const matched: string[] = [];
  if (!res.cached) {
    for (const rec of res.records) {
      if (ctx.db.get("SELECT 1 FROM recalls WHERE id = ?", rec.recall_number)) continue;
      const a = await autopsy(`${rec.product_description}\n${rec.code_info}`, { llm: null });
      const ndc = a.ndcs[0] ? ndcFromAny(a.ndcs[0].value)?.ndc11 ?? "" : "";
      const hit = a.lots.some((l) => ctx.db.get("SELECT 1 FROM lots WHERE upper(lot) = upper(?) AND (? = '' OR ndc11 = ?)", l.value, ndc, ndc));
      if (hit) { await lookupRecall(ctx, null, { number: rec.recall_number }, { autoConfirm: false }); matched.push(rec.recall_number); }
    }
    ctx.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)", String(ctx.now()));
  }
  return { checked: res.records.length, matched, cached: res.cached };
}

/** Turn faxes that arrived in the inbox into recall records (not yet confirmed: only a pharmacist confirms lots). */
export async function ingestFaxInbox(ctx: Ctx) {
  for (const f of ctx.db.all<any>("SELECT * FROM fax_inbox WHERE status = 'new' AND recall_id IS NOT NULL")) {
    try {
      await lookupRecall(ctx, null, { number: f.recall_id, text: f.text || undefined }, { autoConfirm: false });
    } catch { /* leave it in the inbox for a person */ }
  }
}
