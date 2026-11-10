import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get, msg, post, type ScanInput, type User } from "../lib/api";
import { gs1Text } from "../lib/gs1";
import { play } from "../lib/sound";
import { ScanPanel } from "../components/ScanPanel";
import { DataMatrix } from "../components/DataMatrix";
import { btn, C, CheckList, ErrorBox, Footer, Icon, input, label, MONO, pill } from "../components/kit";

const ZONE: Record<string, { tint: string; pill: [string, string] }> = {
  shelf: { tint: "var(--accent)", pill: ["#DDD6FE", "var(--accent-soft)"] },
  cold: { tint: "#38BDF8", pill: ["#BAE6FD", "var(--info-soft)"] },
  controlled: { tint: "#FB923C", pill: ["#FCD9A8", "var(--warn-soft)"] }
};
const PROBLEMS = [["short", "Short shipment"], ["damaged", "Damaged"], ["wrong_item", "Wrong item"], ["suspect", "Suspect product"]] as const;
const SOURCE: Record<string, string> = { datamatrix: "Scanned · 2D DataMatrix decoded", typed: "Scanned · code typed or from a USB scanner", ocr: "Read by OCR · check every field" };

export function Receiving({ user }: { user: User }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["deliveries"], queryFn: () => get<any[]>("/api/deliveries") });
  const [pick, setPick] = useState("");
  const open = list.data?.filter((d) => d.status !== "closed") ?? [];
  const id = pick || open[0]?.id || list.data?.[0]?.id;
  const view = useQuery({ queryKey: ["delivery", id], queryFn: () => get(`/api/deliveries/${id}`), enabled: !!id });
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  const [witness, setWitness] = useState({ email: "", password: "" });
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState("");
  const refresh = () => ["deliveries", "delivery", "today", "lots"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const clear = () => { setOut(null); setReporting(false); setProblem(""); setNote(""); setWitness({ email: "", password: "" }); };

  const scan = useMutation({
    mutationFn: (i: ScanInput) => post(`/api/deliveries/${id}/scan`, i),
    onSuccess: (r) => { setOut(r); setErr(""); setToast(""); play(r.canConfirm ? "chime" : "crack"); refresh(); },
    onError: (e) => { setErr(msg(e)); play("crack"); }
  });
  const confirm = useMutation({
    mutationFn: () => post(`/api/packages/${out.packageId}/putaway`, out.needsWitness ? { witness } : {}),
    onSuccess: () => { setToast(`Put away at ${out.suggestion.location}. Scan the next package.`); clear(); setErr(""); play("seal"); refresh(); },
    onError: (e) => setErr(msg(e))
  });
  const report = useMutation({
    mutationFn: () => post(`/api/packages/${out.packageId}/problem`, { kind: problem, note }),
    onSuccess: () => { setToast("Problem logged. The package is in quarantine Q-1."); clear(); setErr(""); refresh(); },
    onError: (e) => setErr(msg(e))
  });
  const reset = useMutation({ mutationFn: () => post("/api/demo/reset"), onSuccess: () => { window.location.reload(); } });

  const d = out && out.delivery?.id === id ? out.delivery : view.data; // while a package is on screen, its invoice line shows "Scanning now"
  const done = d && d.checkedIn >= d.expected;
  const canScan = user.role !== "cashier";
  const zone = out ? (out.checks.some((c: any) => c.state === "fail") ? { tint: C.red, pill: ["var(--danger-text)", "var(--danger-soft)"] as [string, string] } : ZONE[out.suggestion.zone] ?? ZONE.shelf!) : ZONE.shelf!;
  const f = (k: string) => out?.fields.find((x: any) => x.k === k)?.v ?? "";

  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "18px 32px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.dimmer, display: "flex", alignItems: "center", gap: 6 }}>
            <Link to="/" style={{ color: C.dimmer, textDecoration: "none" }}>Receiving</Link> /
            <label htmlFor="dlv" className="sr">Delivery</label>
            <select id="dlv" value={id ?? ""} onChange={(e) => { setPick(e.target.value); clear(); setToast(""); setErr(""); }} style={{ background: "transparent", border: 0, color: C.dimmer, font: "inherit", fontSize: 13, padding: 0, cursor: "pointer" }}>
              {list.data?.map((x) => <option key={x.id} value={x.id} style={{ background: C.card }}>{x.id}{x.status === "closed" ? " (checked in)" : ""}</option>)}
            </select>
          </p>
          <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Check in delivery from {d?.wholesaler ?? "…"}</h1>
        </div>
        {d && (
          <div style={{ flex: "0 1 320px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: C.dim }}>Checked in</span><span style={{ fontWeight: 600 }}>{d.checkedIn} of {d.expected}</span></div>
            <div role="progressbar" aria-label="Packages checked in" aria-valuenow={d.checkedIn} aria-valuemin={0} aria-valuemax={d.expected} style={{ height: 8, borderRadius: 999, background: C.line, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, background: C.violet, width: `${Math.round((d.checkedIn / d.expected) * 100)}%` }} />
            </div>
          </div>
        )}
      </header>

      <main style={{ padding: "28px 32px 64px", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", maxWidth: 1240, boxSizing: "border-box", width: "100%" }}>
        <section aria-labelledby="scan" style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {done && !out && (
            <div style={{ background: "var(--ok-soft)", border: "1px solid var(--ok)", borderRadius: 16, padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
              {Icon.okBig()}
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Delivery checked in</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--ok-text)" }}>{d.expected} packages · {d.expected - d.problems} lots and serials recorded · transaction information stored for 6 years · {d.problems} discrepanc{d.problems === 1 ? "y" : "ies"}.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link to="/inventory" style={btn("primary", { minHeight: 46, padding: "0 20px", fontSize: 14 })}>View in inventory</Link>
                {open.length > 0 && <button onClick={() => setPick(open[0].id)} style={btn("ghost", { minHeight: 46, fontSize: 14 })}>Next delivery: {open[0].id}</button>}
                {user.role === "pharmacist" && <button onClick={() => reset.mutate()} style={btn("ghost", { minHeight: 46, fontSize: 14 })}>Replay demo</button>}
              </div>
            </div>
          )}

          {toast && <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12, background: "var(--ok-soft)", border: "1px solid var(--ok)", color: C.green2, fontSize: 14 }}>{Icon.okSmall()}{toast}</div>}
          <ErrorBox e={err} />

          {canScan && !done && (
            <div style={{ display: out ? "none" : "block" }}>
              <ScanPanel title="Scan the next package from the tote" hint="Hold the 2D barcode inside the frame. A USB scanner works too." busy={scan.isPending} onScan={(i) => { if (!out) scan.mutate(i); }} />
            </div>
          )}
          {!canScan && <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.dim }}>A cashier cannot receive stock. Sign in as a technician or pharmacist.</div>}

          {out && (
            <>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 20, alignItems: "center", borderBottom: `1px solid ${C.line}` }}>
                  <div aria-hidden="true" style={{ position: "relative", width: 132, height: 132, flexShrink: 0, borderRadius: 12, background: C.bg, border: `1px solid ${C.line2}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <DataMatrix dark size={96} text={gs1Text({ gtin: f("GTIN"), lot: f("Lot"), expiry: /^\d{4}-\d{2}-\d{2}$/.test(f("Expiry")) ? f("Expiry") : "", serial: out.noSerial ? "0" : f("Serial") })} />
                    <span className="laser" style={{ position: "absolute", left: 8, right: 8, height: 2, background: C.violet, boxShadow: "0 0 12px 2px var(--accent-soft)" }} />
                  </div>
                  <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <h2 id="scan" style={{ margin: 0, fontSize: 13, fontWeight: 500, color: out.source === "ocr" ? C.amber2 : C.green2, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: out.source === "ocr" ? C.amber : C.green }} />{SOURCE[out.source] ?? SOURCE.datamatrix}</h2>
                    <p style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{out.product.name}</p>
                    <p style={{ margin: 0, fontSize: 14, color: C.dim }}>{out.product.maker} · NDC <span style={{ fontFamily: MONO, color: C.ink2 }}>{out.product.ndc10}</span></p>
                  </div>
                </div>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 0 }}>
                  {out.fields.map((x: any) => (
                    <div key={x.k} style={{ padding: "16px 20px", borderRight: `1px solid ${C.line}` }}>
                      <dt style={{ fontSize: 12, color: C.dimmer }}>{x.k} <span style={{ fontFamily: MONO }}>({x.ai})</span></dt>
                      <dd style={{ margin: "4px 0 0", fontFamily: MONO, fontSize: 15, color: C.ink }}>{x.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div style={{ background: C.card, border: `1px solid ${zone.tint}55`, borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 18, boxShadow: `0 0 0 4px ${zone.tint}14` }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: C.ink2 }}>{out.canConfirm ? "Put away at" : "Do not shelve. Suggested spot if cleared"}</span>
                    <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>{out.suggestion.location}</span>
                    <span style={{ fontSize: 14, color: C.dim }}>{out.suggestion.why}</span>
                  </div>
                  <span style={pill(zone.pill[0], zone.pill[1], { fontSize: 13, fontWeight: 600, padding: "6px 12px" })}>{out.suggestion.zoneLabel}</span>
                </div>
                <CheckList checks={out.checks} />
                {out.noSerial && <p style={{ margin: 0, fontSize: 13, color: C.amber2 }}>No serial on this label. It got an internal id; check the supplier paperwork by hand.</p>}

                {out.needsWitness && out.canConfirm && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={label}>Schedule II: a second staff member signs in as witness</span>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input aria-label="Witness email" placeholder="Witness work email" value={witness.email} onChange={(e) => setWitness({ ...witness, email: e.target.value })} style={input({ flex: "1 1 200px" })} />
                      <input aria-label="Witness password" type="password" placeholder="Witness password" value={witness.password} onChange={(e) => setWitness({ ...witness, password: e.target.value })} style={input({ flex: "1 1 160px" })} />
                    </div>
                  </div>
                )}

                {reporting && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={label}>What is wrong with this package? It goes to quarantine Q-1.</span>
                    <div role="radiogroup" aria-label="Problem" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {PROBLEMS.map(([k, l]) => (
                        <button key={k} role="radio" aria-checked={problem === k} onClick={() => setProblem(k)} style={{ minHeight: 40, padding: "0 14px", borderRadius: 999, fontSize: 14, border: `1px solid ${problem === k ? C.violet : C.line2}`, background: problem === k ? "var(--accent-soft)" : C.card, color: problem === k ? C.ink : C.dim }}>{l}</button>
                      ))}
                    </div>
                    <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={input()} />
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {!reporting ? (
                    <>
                      <button onClick={() => confirm.mutate()} disabled={!out.canConfirm || confirm.isPending} style={btn("primary", out.canConfirm ? {} : { background: C.line2, color: C.dimmer })}>Confirm put-away &amp; scan next</button>
                      <button onClick={() => setReporting(true)} style={btn("ghost")}>Report a problem</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => report.mutate()} disabled={!problem || report.isPending} style={btn("red", problem ? {} : { background: C.line2, color: C.dimmer })}>Quarantine &amp; log problem</button>
                      <button onClick={() => setReporting(false)} style={btn("ghost")}>Cancel</button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        <aside aria-labelledby="inv" style={{ flex: "1 1 360px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="inv" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Invoice {d?.id}</h2><span style={{ fontSize: 12, color: C.dimmer }}>EDI 856 · TI/TS attached</span></div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {d?.lines.map((l: any) => {
              const st = l.state === "done" ? ["var(--ok)", "var(--ok-soft)", "✓"] : l.state === "now" ? ["var(--accent-text)", "var(--accent-soft)", "•"] : ["var(--subtle)", "transparent", ""];
              return (
                <li key={l.lineNo} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 8px", borderTop: `1px solid ${C.line}`, borderRadius: 8, background: l.state === "now" ? "var(--sunken)" : undefined }}>
                  <span aria-hidden="true" style={{ width: 24, height: 24, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: st[0], background: st[1], border: `1.5px solid ${st[0]}` }}>{st[2]}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 500 }}>{l.name}</span><span style={{ fontSize: 12, color: C.dimmer }}>{l.sub}</span></span>
                  <span style={{ fontSize: 13, color: C.ink2, whiteSpace: "nowrap" }}><span className="sr">{l.state === "done" ? "Done, " : ""}</span>{l.qty}</span>
                </li>
              );
            })}
          </ul>
        </aside>
        <div style={{ flexBasis: "100%" }}><Footer /></div>
      </main>
    </>
  );
}
