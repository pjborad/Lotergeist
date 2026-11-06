import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { dateLabel, get, msg, post, type User } from "../lib/api";
import { Err, statusTone, Tag } from "../components/ui";

const CHIPS = [["all", "All lots"], ["recall", "Recalled"], ["exp", "Expiring ≤ 60 days"], ["cold", "Cold chain"], ["ctrl", "Controlled"]] as const;
const inp = { background: "var(--panel2)", border: "1px solid var(--line2)", borderRadius: 8, padding: "8px 10px" } as const;

export function Inventory({ user }: { user: User }) {
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("filter") ?? "all";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(sp.get("lot") ? Number(sp.get("lot")) : null);
  useEffect(() => { if (sp.get("lot")) setOpen(Number(sp.get("lot"))); }, [sp]);
  const lots = useQuery({ queryKey: ["lots", filter, q], queryFn: () => get(`/api/lots?filter=${filter}&q=${encodeURIComponent(q)}`) });
  const rows = lots.data?.rows ?? [];
  const counts = lots.data?.counts ?? {};
  return (
    <>
      <h1>Inventory by lot</h1>
      <p className="sub">Every package is tracked by lot and serial. Click a lot to see where each unit went.</p>
      <div className="row" style={{ margin: "16px 0", flexWrap: "wrap" }}>
        {CHIPS.map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setSp(k === "all" ? {} : { filter: k })}>{l} · {counts[k] ?? 0}</button>
        ))}
        <input aria-label="Filter lots" placeholder="Filter by drug, NDC, lot or location" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, marginLeft: "auto", width: 280 }} />
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table>
          <thead><tr><th>Product</th><th>Lot</th><th>Expiry</th><th>On hand</th><th>Location</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="click" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(r.id)}>
                <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="mono dim" style={{ fontSize: 12 }}>NDC {r.ndc10}</div></td>
                <td className="mono">{r.lot}</td>
                <td>{dateLabel(r.expiry)}</td>
                <td className="mono">{r.onHand}</td>
                <td className="dim">{r.location}</td>
                <td><span className="row" style={{ gap: 6 }}><Tag tone={statusTone(r.status)}>{r.statusLabel}</Tag>{r.tags.includes("cold") && <Tag tone="cold">Cold</Tag>}{r.tags.includes("ctrl") && <Tag tone="ctrl">C-II</Tag>}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="dim">No lots match.</td></tr>}
          </tbody>
        </table>
      </div>
      {open != null && <LotDrawer id={open} user={user} onClose={() => { setOpen(null); if (sp.get("lot")) { sp.delete("lot"); setSp(sp); } }} />}
    </>
  );
}

function LotDrawer({ id, user, onClose }: { id: number; user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["lot", id], queryFn: () => get(`/api/lots/${id}`) });
  const [mode, setMode] = useState<"" | "move" | "adjust">("");
  const [loc, setLoc] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [w, setW] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const after = () => { void qc.invalidateQueries({ queryKey: ["lot", id] }); void qc.invalidateQueries({ queryKey: ["lots"] }); void qc.invalidateQueries({ queryKey: ["today"] }); setMode(""); setErr(""); };
  const move = useMutation({ mutationFn: () => post(`/api/lots/${id}/move`, { location: loc }), onSuccess: (r) => { setDone(`Moved ${r.moved} units.`); after(); }, onError: (e) => setErr(msg(e)) });
  const adjust = useMutation({
    mutationFn: () => post(`/api/lots/${id}/adjust`, { count: Number(count), reason, witness: d.data?.storage === "c2" ? w : undefined }),
    onSuccess: (r) => { setDone(r.delta ? `Count changed by ${r.delta}.` : "No change."); after(); }, onError: (e) => setErr(msg(e))
  });
  const l = d.data;
  const canEdit = user.role !== "cashier";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Lot detail">
        <div className="spread"><h2 style={{ fontSize: 18 }}>{l?.name ?? "…"}</h2><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        {l && (
          <>
            <div className="mono dim" style={{ marginTop: 4 }}>NDC {l.ndc10} · lot {l.lot} · exp {dateLabel(l.expiry)}</div>
            {l.status === "recalled" && <div className="err" style={{ margin: "12px 0" }}>This lot is recalled. Units are held in quarantine.</div>}
            <div className="grid4" style={{ gridTemplateColumns: "repeat(4,1fr)", margin: "14px 0", gap: 8 }}>
              {[["Received", l.received], ["Dispensed", l.dispensed], ["Returned", l.returned], ["On hand", l.onHand]].map(([k, v]) => (
                <div key={k as string} className="card" style={{ padding: 10, background: "var(--panel2)" }}><div className="dimmer" style={{ fontSize: 11 }}>{k}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div></div>
              ))}
            </div>
            <h3 style={{ marginBottom: 8 }}>History</h3>
            <div className="timeline">
              {l.history.map((h: any, i: number) => <div className="it" key={i}><div style={{ fontWeight: 600 }}>{h.title}</div><div className="dim" style={{ fontSize: 12 }}>{h.detail}</div></div>)}
            </div>
            {done && <div className="ok" role="status" style={{ margin: "10px 0" }}>{done}</div>}
            <Err e={err} />
            {canEdit && !mode && <div className="row" style={{ marginTop: 14 }}><button className="btn ghost" onClick={() => { setMode("move"); setDone(""); }}>Move</button><button className="btn ghost" onClick={() => { setMode("adjust"); setCount(String(l.onHand)); setDone(""); }}>Adjust count</button></div>}
            {mode === "move" && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="field"><label htmlFor="loc">New location</label><input id="loc" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Aisle 3 · Bay B · Shelf 2" /></div>
                <div className="row"><button className="btn" onClick={() => move.mutate()} disabled={!loc.trim()}>Move units</button><button className="btn ghost" onClick={() => setMode("")}>Cancel</button></div>
              </div>
            )}
            {mode === "adjust" && (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="field"><label htmlFor="cnt">Counted on hand</label><input id="cnt" type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} /></div>
                <div className="field"><label htmlFor="rs">Reason</label><input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cycle count, breakage…" /></div>
                {l.storage === "c2" && (
                  <div className="field"><label>Schedule II: a pharmacist signs off and a second person witnesses</label>
                    <div className="row"><input aria-label="Witness email" placeholder="witness email" value={w.email} onChange={(e) => setW({ ...w, email: e.target.value })} style={{ flex: 1 }} /><input aria-label="Witness password" type="password" placeholder="password" value={w.password} onChange={(e) => setW({ ...w, password: e.target.value })} style={{ flex: 1 }} /></div>
                  </div>
                )}
                <div className="row"><button className="btn" onClick={() => adjust.mutate()}>Save count</button><button className="btn ghost" onClick={() => setMode("")}>Cancel</button></div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
