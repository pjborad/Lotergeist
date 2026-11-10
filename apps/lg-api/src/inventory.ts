import { audit, HttpError, lotEvent, todayIso, type Actor, type Ctx } from "./core";
import { daysBetween, verifyPassword } from "./domain";

export type LotStatusKey = "recall" | "exp" | "ok" | "low";
export interface LotRow {
  id: number; name: string; ndc10: string; lot: string; expiry: string; onHand: number; received: number; dispensed: number;
  location: string; status: LotStatusKey; statusLabel: string; tags: string[]; storage: string;
}

const ON_HAND = "('on_shelf','quarantined')";

export function listLots(ctx: Ctx, opts: { filter?: string; q?: string } = {}): { rows: LotRow[]; counts: Record<string, number> } {
  const t = todayIso(ctx);
  const base = ctx.db.all<any>(
    `SELECT l.id, l.lot, l.expiry, l.status AS lot_status, p.name, p.ndc10, p.ndc11, p.storage, p.reorder_point,
       (SELECT count(*) FROM packages k WHERE k.lot_id = l.id AND k.status IN ${ON_HAND}) AS on_hand,
       (SELECT count(*) FROM packages k WHERE k.lot_id = l.id AND k.status <> 'pending_putaway') AS received,
       (SELECT count(*) FROM packages k WHERE k.lot_id = l.id AND k.status = 'dispensed') AS dispensed,
       (SELECT group_concat(DISTINCT k.location) FROM packages k WHERE k.lot_id = l.id AND k.status IN ${ON_HAND}) AS locs
     FROM lots l JOIN products p ON p.ndc11 = l.ndc11`);
  const productTotals = new Map<string, number>();
  for (const r of base) productTotals.set(r.ndc11, (productTotals.get(r.ndc11) ?? 0) + r.on_hand);

  const rows: LotRow[] = base.filter((r) => r.on_hand > 0 || r.lot_status === "recalled").map((r) => {
    const locs: string[] = r.locs ? String(r.locs).split(",") : [];
    const days = r.expiry ? daysBetween(t, r.expiry) : 9999;
    let status: LotStatusKey = "ok";
    if (r.lot_status === "recalled") status = "recall";
    else if (days <= 60) status = "exp";
    else if ((productTotals.get(r.ndc11) ?? 0) < r.reorder_point) status = "low";
    const tags: string[] = [];
    if (status === "recall") tags.push("recall");
    if (days <= 60) tags.push("exp");
    if (r.storage === "cold") tags.push("cold");
    if (r.storage === "c2") tags.push("ctrl");
    return {
      id: r.id, name: r.name, ndc10: r.ndc10, lot: r.lot, expiry: r.expiry, onHand: r.on_hand, received: r.received, dispensed: r.dispensed,
      location: locs.length === 0 ? "—" : locs.length === 1 ? locs[0]! : `${locs.length} locations`,
      status, statusLabel: { recall: "Recalled · held", exp: days < 0 ? "Expired" : "Expiring soon", ok: "Available", low: "Reorder" }[status], tags, storage: r.storage
    };
  });

  const counts: Record<string, number> = { all: rows.length, recall: 0, exp: 0, cold: 0, ctrl: 0 };
  for (const r of rows) for (const tg of r.tags) counts[tg] = (counts[tg] ?? 0) + 1;
  counts.products = new Set(rows.map((r) => r.ndc10)).size;

  const q = opts.q?.trim().toLowerCase();
  let out = rows;
  if (opts.filter && opts.filter !== "all") out = out.filter((r) => r.tags.includes(opts.filter!));
  if (q) out = out.filter((r) => [r.name, r.ndc10, r.ndc10.replace(/-/g, ""), r.lot, r.location].some((v) => v.toLowerCase().includes(q)));
  out.sort((a, b) => (a.status === "recall" ? -1 : 0) - (b.status === "recall" ? -1 : 0) || a.name.localeCompare(b.name) || a.expiry.localeCompare(b.expiry));
  return { rows: out, counts };
}

export interface HistoryItem { kind: string; title: string; detail: string; at: number }

export function lotDetail(ctx: Ctx, id: number) {
  const l = ctx.db.get<any>("SELECT l.*, p.name, p.ndc10, p.storage FROM lots l JOIN products p ON p.ndc11 = l.ndc11 WHERE l.id = ?", id);
  if (!l) throw new HttpError(404, "Unknown lot.");
  const c = (status: string) => ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE lot_id = ? AND status = ?", id, status)!.n;
  const onHand = ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM packages WHERE lot_id = ? AND status IN ${ON_HAND}`, id)!.n;
  const received = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE lot_id = ? AND status <> 'pending_putaway'", id)!.n;
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const hist: HistoryItem[] = [];

  const rec = ctx.db.get<any>("SELECT count(*) AS n, min(received_at) AS first, group_concat(DISTINCT delivery_id) AS d FROM packages WHERE lot_id = ? AND status <> 'pending_putaway'", id)!;
  if (rec.n) hist.push({ kind: "recv", title: `Received ${rec.n} unit${rec.n === 1 ? "" : "s"}`, detail: `${fmt(rec.first)} · ${rec.d ?? ""} · TI/TS verified`, at: rec.first });
  const locs = ctx.db.all<any>("SELECT location, count(*) AS n, min(received_at) AS at FROM packages WHERE lot_id = ? AND location IS NOT NULL GROUP BY location ORDER BY at", id);
  if (locs[0]) hist.push({ kind: "shelf", title: `Shelved ${locs[0].location}`, detail: `${fmt(locs[0].at)}`, at: locs[0].at + 1 });
  const out = ctx.db.get<any>(
    `SELECT count(*) AS n, min(COALESCE(d.sold_at, d.filled_at)) AS a, max(COALESCE(d.sold_at, d.filled_at)) AS b FROM dispenses d JOIN packages k ON k.id = d.package_id WHERE k.lot_id = ? AND d.state <> 'sent_back'`, id)!;
  if (out.n) hist.push({ kind: "out", title: `${out.n} unit${out.n === 1 ? "" : "s"} dispensed`, detail: `${fmt(out.a)}${out.b !== out.a ? ` – ${fmt(out.b)}` : ""} · linked to patients`, at: out.b });
  for (const e of ctx.db.all<any>("SELECT * FROM lot_events WHERE lot_id = ? AND kind IN ('Quarantined','Returned','Adjusted','Moved','Released') ORDER BY at", id)) {
    hist.push({ kind: e.kind.toLowerCase(), title: e.kind === "Quarantined" ? `Quarantined${e.note ? ` · ${e.note}` : ""}` : `${e.kind}${e.note ? ` · ${e.note}` : ""}`, detail: `${fmt(e.at)} · ${new Date(e.at).toISOString().slice(11, 16)} · ${e.user_name}`, at: e.at });
  }
  hist.sort((a, b) => a.at - b.at);
  return {
    id: l.id, name: l.name, ndc10: l.ndc10, lot: l.lot, expiry: l.expiry, status: l.status, storage: l.storage,
    received, dispensed: c("dispensed"), onHand, returned: c("returned"), adjusted: c("adjusted") + c("destroyed"), history: hist
  };
}

function zoneOf(location: string) {
  return /^Fridge/i.test(location) ? "cold" : /^C-II/i.test(location) ? "controlled" : /^Quarantine/i.test(location) ? "quarantine" : /^RTV/i.test(location) ? "rtv" : "shelf";
}

export function moveLot(ctx: Ctx, actor: Actor, lotId: number, location: string): { moved: number } {
  const l = lotDetail(ctx, lotId);
  location = location.trim();
  if (!location || location.length > 60) throw new HttpError(422, "Give a location like “Aisle 3 · Bay B · Shelf 2”.");
  if (l.storage === "c2" && actor.role !== "pharmacist") throw new HttpError(403, "Only a pharmacist moves Schedule II stock.", "forbidden");
  const zone = zoneOf(location);
  if (l.storage === "cold" && zone === "shelf") throw new HttpError(422, "Refrigerated stock cannot move to a room-temperature shelf.");
  const res = ctx.db.run("UPDATE packages SET location = ?, zone = ? WHERE lot_id = ? AND status = 'on_shelf'", location, zone, lotId);
  lotEvent(ctx, "Moved", lotId, actor.name, `${res.changes} unit${res.changes === 1 ? "" : "s"} to ${location}`);
  audit(ctx, actor, "inventory.move", "lot", lotId, undefined, { location, units: Number(res.changes) });
  return { moved: Number(res.changes) };
}

export function adjustLot(ctx: Ctx, actor: Actor, lotId: number, newCount: number, reason: string, witness?: { email: string; password: string }) {
  const l = lotDetail(ctx, lotId);
  if (!Number.isInteger(newCount) || newCount < 0) throw new HttpError(422, "Count must be a whole number, zero or more.");
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required to adjust a count.", "reason_required");
  let witnessName = "";
  if (l.storage === "c2") {
    if (actor.role !== "pharmacist") throw new HttpError(403, "A pharmacist must sign off a Schedule II count change.", "forbidden");
    if (!witness?.email || !witness.password) throw new HttpError(422, "A Schedule II count change needs a second staff member as witness.", "witness_required");
    const w = ctx.db.get<any>("SELECT * FROM users WHERE lower(email) = lower(?)", witness.email);
    if (!w || !verifyPassword(witness.password, w.pw_hash)) throw new HttpError(403, "Witness sign-in failed.", "witness_invalid");
    if (w.id === actor.id) throw new HttpError(403, "You cannot witness your own count.", "witness_self");
    witnessName = w.name;
  }
  const delta = newCount - l.onHand;
  if (delta === 0) return { delta: 0, onHand: l.onHand };
  ctx.db.tx(() => {
    if (delta < 0) {
      const ids = ctx.db.all<{ id: number }>("SELECT id FROM packages WHERE lot_id = ? AND status = 'on_shelf' ORDER BY id LIMIT ?", lotId, -delta);
      if (ids.length < -delta) throw new HttpError(409, "Quarantined units cannot be adjusted away; release or return them first.");
      for (const r of ids) ctx.db.run("UPDATE packages SET status = 'adjusted', note = ? WHERE id = ?", `adjusted: ${reason}`, r.id);
    } else {
      const loc = ctx.db.get<{ location: string; zone: string; gtin: string; expiry: string }>("SELECT location, zone, gtin, expiry FROM packages WHERE lot_id = ? AND status = 'on_shelf' GROUP BY location ORDER BY count(*) DESC LIMIT 1", lotId);
      if (!loc) throw new HttpError(409, "No shelf location to add stock to. Receive a package first.");
      for (let i = 0; i < delta; i++) {
        ctx.db.run("INSERT INTO packages (serial, lot_id, gtin, expiry, location, zone, status, delivery_id, received_at, received_by, manual, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          `ADJ-${lotId}-${ctx.now()}-${i}`, lotId, loc.gtin, loc.expiry, loc.location, loc.zone, "on_shelf", null, ctx.now(), actor.name, 1, `adjusted up: ${reason}`);
      }
    }
    lotEvent(ctx, "Adjusted", lotId, actor.name, `${delta > 0 ? "+" : ""}${delta} · ${reason}${witnessName ? ` · witness ${witnessName}` : ""}`);
  });
  audit(ctx, actor, "inventory.adjust", "lot", lotId, { onHand: l.onHand }, { onHand: newCount, reason, witness: witnessName || undefined });
  return { delta, onHand: newCount };
}

/**
 * The ledger's invariants (spec property tests):
 *  - on hand = received - dispensed - returned - adjusted, never negative
 *  - every dispensed package has a receiving record and exactly one live dispense
 */
export function ledgerViolations(ctx: Ctx): string[] {
  const bad: string[] = [];
  for (const l of ctx.db.all<any>("SELECT id, lot FROM lots")) {
    const c = (s: string) => ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE lot_id = ? AND status = ?", l.id, s)!.n;
    const received = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE lot_id = ? AND status <> 'pending_putaway'", l.id)!.n;
    const onHand = c("on_shelf") + c("quarantined");
    if (onHand !== received - c("dispensed") - c("returned") - c("adjusted") - c("destroyed")) bad.push(`lot ${l.lot}: on hand does not reconcile`);
    if (onHand < 0) bad.push(`lot ${l.lot}: negative on hand`);
  }
  for (const r of ctx.db.all<any>(
    `SELECT k.id, k.serial, count(d.id) AS n FROM packages k LEFT JOIN dispenses d ON d.package_id = k.id AND d.state <> 'sent_back' WHERE k.status = 'dispensed' GROUP BY k.id HAVING n <> 1`)) bad.push(`package ${r.serial}: ${r.n} live dispenses`);
  for (const r of ctx.db.all<any>("SELECT k.serial FROM packages k WHERE k.status = 'dispensed' AND k.received_at IS NULL")) bad.push(`package ${r.serial}: dispensed without a receiving record`);
  for (const r of ctx.db.all<any>("SELECT package_id, count(*) AS n FROM dispenses WHERE package_id IS NOT NULL AND state <> 'sent_back' GROUP BY package_id HAVING n > 1")) bad.push(`package ${r.package_id}: dispensed twice`);
  return bad;
}
