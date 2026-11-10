import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { get, msg, post, type User } from "../lib/api";
import { btn, C, ErrorBox, Footer, Icon, input, label, MONO, pill, TONES } from "../components/kit";
import { PageHeader } from "../components/Shell";

const FILTERS = [["all", "All lots"], ["recall", "Recalled"], ["exp", "Expiring ≤ 60 days"], ["cold", "Refrigerated"], ["ctrl", "Controlled"]] as const;
const STATUS_TONE: Record<string, string> = { recall: "red", exp: "amber", ok: "green", low: "violet" };
const DOT: Record<string, string> = { recv: "#38BDF8", shelf: "var(--accent)", out: "var(--ok)", quarantined: "#F87171", returned: "#FB923C", adjusted: "#FBBF24", moved: "var(--accent)", released: "var(--ok)" };
/** "Aisle 2 · Bay A · Shelf 3 · Bin 14" -> "Aisle 2 · A · S3 · 14", "C-II Safe · Drawer 1" -> "C-II Safe · D1" (mockup style). */
export const shortLoc = (l: string) => l.replace(/Bay /g, "").replace(/Shelf (\d)/g, "S$1").replace(/Bin (\w+)/g, (_, b) => (/^\d+$/.test(b) ? b : b)).replace(/Drawer (\d)/g, "D$1");
const ghostSm = { minHeight: 44, padding: "0 16px", fontSize: 14 } as const;

export function Inventory({ user }: { user: User }) {
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("filter") ?? "all";
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(sp.get("lot") ? Number(sp.get("lot")) : null);
  useEffect(() => { if (sp.get("lot")) setSel(Number(sp.get("lot"))); }, [sp]);
  const lots = useQuery({ queryKey: ["lots", filter, q], queryFn: () => get(`/api/lots?filter=${filter}&q=${encodeURIComponent(q)}`) });
  const rows: any[] = lots.data?.rows ?? [];
  const counts = lots.data?.counts ?? {};
  const selected = sel ?? rows[0]?.id ?? null;
  const setFilter = (f: string) => { const n = new URLSearchParams(); if (f !== "all") n.set("filter", f); setSp(n); setSel(null); };

  return (
    <>
      <PageHeader title="Inventory by lot" sub={`${(counts.all ?? 0).toLocaleString()} lots · ${counts.products ?? 0} products · perpetual, updated on every scan`}>
        <div style={{ flex: "0 1 360px", position: "relative" }}>
          <label htmlFor="iq" className="sr">Search inventory</label>
          <span style={{ position: "absolute", left: 14, top: 13 }}>{Icon.search("var(--subtle)")}</span>
          <input id="iq" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Drug, NDC, lot or location" style={{ width: "100%", boxSizing: "border-box", height: 44, padding: "0 14px 0 42px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, color: C.ink, font: "inherit", fontSize: 14 }} />
        </div>
      </PageHeader>

      <main style={{ padding: "24px 32px 64px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1240, boxSizing: "border-box", width: "100%" }}>
        <div role="group" aria-label="Filter lots" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {FILTERS.map(([k, l]) => {
            const on = k === filter;
            return (
              <button key={k} aria-pressed={on} onClick={() => setFilter(k)} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 14px", borderRadius: 999, fontSize: 14, border: `1px solid ${on ? C.violet : C.line2}`, background: on ? "var(--accent-soft)" : C.card, color: on ? C.ink : C.dim }}>
                {l}<span style={{ fontSize: 12, padding: "1px 7px", borderRadius: 999, background: on ? C.violet : C.track, color: on ? C.bg : C.ink2 }}>{(counts[k] ?? 0).toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 620px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", fontSize: 12, color: C.dimmer, background: C.well }}>
                {["Product", "Lot", "Expires", "On hand", "Location", "Status"].map((h) => <th key={h} scope="col" style={{ padding: "12px 12px", fontWeight: 500, whiteSpace: "nowrap", textAlign: h === "On hand" ? "right" : "left" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const on = r.id === selected;
                  return (
                    <tr key={r.id} className="row" onClick={() => setSel(r.id)} style={{ cursor: "pointer", borderTop: `1px solid ${C.line}`, ...(on ? { background: "var(--sunken)", boxShadow: `inset 3px 0 0 ${C.violet}` } : {}) }}>
                      <td style={{ padding: "12px 12px" }}>
                        <button onClick={(e) => { e.stopPropagation(); setSel(r.id); }} aria-pressed={on} style={{ background: "none", border: 0, padding: 0, color: C.ink, textAlign: "left", display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 500 }}>{r.name}</span><span style={{ fontSize: 12, color: C.dimmer, fontFamily: MONO }}>{r.ndc10}</span>
                        </button>
                      </td>
                      <td style={{ padding: "12px 12px", fontFamily: MONO, fontSize: 13 }}>{r.lot}</td>
                      <td style={{ padding: "12px 12px", whiteSpace: "nowrap", color: r.status === "exp" ? "#FCD34D" : C.ink2 }}>{r.expiry.slice(0, 7)}</td>
                      <td style={{ padding: "12px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.onHand}</td>
                      <td style={{ padding: "12px 12px", color: C.ink2, whiteSpace: "nowrap" }} title={r.location}>{shortLoc(r.location)}</td>
                      <td style={{ padding: "12px 12px" }}><span style={pill(...TONES[STATUS_TONE[r.status] ?? "gray"]!)}>{r.statusLabel}</span></td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={6} style={{ padding: 16, color: C.dim }}>{lots.isLoading ? "Loading…" : "No lots match."}</td></tr>}
              </tbody>
            </table>
          </div>
          {selected != null && <LotDetail key={selected} id={selected} user={user} />}
        </div>
        <Footer />
      </main>
    </>
  );
}

function LotDetail({ id, user }: { id: number; user: User }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["lot", id], queryFn: () => get(`/api/lots/${id}`) });
  const [mode, setMode] = useState<"" | "move" | "adjust">("");
  const [loc, setLoc] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [w, setW] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const after = (m: string) => { setDone(m); setMode(""); setErr(""); ["lot", "lots", "today"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })); };
  const move = useMutation({ mutationFn: () => post(`/api/lots/${id}/move`, { location: loc }), onSuccess: (r) => after(`Moved ${r.moved} unit${r.moved === 1 ? "" : "s"} to ${loc}.`), onError: (e) => setErr(msg(e)) });
  const adjust = useMutation({
    mutationFn: () => post(`/api/lots/${id}/adjust`, { count: Number(count), reason, witness: d.data?.storage === "c2" ? w : undefined }),
    onSuccess: (r) => after(r.delta ? `Count changed by ${r.delta > 0 ? "+" : ""}${r.delta}. Logged with your name.` : "Count unchanged."), onError: (e) => setErr(msg(e))
  });
  const l = d.data;
  const canEdit = user.role !== "cashier" && l?.status !== "recalled";
  return (
    <aside aria-labelledby="lotd" style={{ flex: "1 1 320px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: C.dimmer }}>Lot detail</span>
        <h2 id="lotd" style={{ margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{l?.name ?? "…"}</h2>
        {l && <span style={{ fontFamily: MONO, fontSize: 13, color: C.violet2 }}>Lot {l.lot} · exp {l.expiry.slice(0, 7)}</span>}
      </div>
      {l && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, background: C.line, borderRadius: 10, overflow: "hidden" }}>
            {[[l.received, "Received"], [l.dispensed, "Dispensed"], [l.onHand, "On hand"]].map(([v, k]) => (
              <div key={k as string} style={{ background: C.well, padding: 12 }}><div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div><div style={{ fontSize: 12, color: C.dimmer }}>{k}</div></div>
            ))}
          </div>
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 500, color: C.ink2 }}>Lot history</h3>
            <ol style={{ listStyle: "none", margin: 0, padding: "0 0 0 4px", display: "flex", flexDirection: "column" }}>
              {l.history.map((h: any, i: number) => (
                <li key={i} style={{ display: "flex", gap: 14 }}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 4, flexShrink: 0, background: DOT[h.kind] ?? C.violet }} />
                    {i < l.history.length - 1 && <span style={{ flex: 1, width: 1, background: C.line2, minHeight: 18 }} />}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 14 }}><span style={{ fontSize: 14, fontWeight: 500 }}>{h.title}</span><span style={{ fontSize: 12, color: C.dimmer }}>{h.detail}</span></span>
                </li>
              ))}
            </ol>
          </div>
          {done && <p role="status" style={{ margin: 0, fontSize: 13, color: C.green2 }}>{done}</p>}
          <ErrorBox e={err} />
          {mode === "move" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="loc" style={label}>New location for the on-shelf units</label>
              <input id="loc" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Aisle 3 · Bay B · Shelf 2" style={input()} />
              <div style={{ display: "flex", gap: 10 }}><button onClick={() => move.mutate()} disabled={!loc.trim()} style={btn("primary", ghostSm)}>Move</button><button onClick={() => setMode("")} style={btn("ghost", ghostSm)}>Cancel</button></div>
            </div>
          )}
          {mode === "adjust" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="cnt" style={label}>Counted on hand</label>
              <input id="cnt" type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} style={input()} />
              <label htmlFor="rs" style={label}>Reason (required)</label>
              <input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cycle count, breakage…" style={input()} />
              {l.storage === "c2" && (
                <>
                  <span style={label}>Schedule II: pharmacist sign-off and a second staff member as witness</span>
                  <input aria-label="Witness email" placeholder="Witness work email" value={w.email} onChange={(e) => setW({ ...w, email: e.target.value })} style={input()} />
                  <input aria-label="Witness password" type="password" placeholder="Witness password" value={w.password} onChange={(e) => setW({ ...w, password: e.target.value })} style={input()} />
                </>
              )}
              <div style={{ display: "flex", gap: 10 }}><button onClick={() => adjust.mutate()} style={btn("primary", ghostSm)}>Save count</button><button onClick={() => setMode("")} style={btn("ghost", ghostSm)}>Cancel</button></div>
            </div>
          )}
          {!mode && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
              <button disabled={!canEdit} onClick={() => { setMode("move"); setDone(""); }} style={btn("ghost", { ...ghostSm, opacity: canEdit ? 1 : 0.5 })}>Move location</button>
              <button disabled={!canEdit} onClick={() => { setMode("adjust"); setCount(String(l.onHand)); setDone(""); }} style={btn("ghost", { ...ghostSm, opacity: canEdit ? 1 : 0.5 })}>Adjust count</button>
            </div>
          )}
          {l.status === "recalled" && <p style={{ margin: 0, fontSize: 12, color: C.dimmer }}>Recalled lots stay in quarantine until they go back to the vendor.</p>}
        </>
      )}
    </aside>
  );
}
