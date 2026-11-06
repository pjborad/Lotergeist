import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post, type User, type ScanInput } from "../lib/api";
import { ScanPanel } from "../components/ScanPanel";
import { Checks, Err, Tag } from "../components/ui";
import { play } from "../lib/sound";

const PROBLEMS = [["short", "Short shipment"], ["damaged", "Damaged"], ["wrong_item", "Wrong item"], ["suspect", "Suspect product"]] as const;

export function Receiving({ user }: { user: User }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["deliveries"], queryFn: () => get<any[]>("/api/deliveries") });
  const [pick, setPick] = useState<string>("");
  const open = list.data?.filter((d) => d.status !== "closed") ?? [];
  const id = pick || open[0]?.id || list.data?.[0]?.id;
  const view = useQuery({ queryKey: ["delivery", id], queryFn: () => get(`/api/deliveries/${id}`), enabled: !!id });
  const [out, setOut] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [err, setErr] = useState("");
  const [witness, setWitness] = useState({ email: "", password: "" });
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["deliveries"] }); void qc.invalidateQueries({ queryKey: ["delivery"] }); void qc.invalidateQueries({ queryKey: ["today"] }); void qc.invalidateQueries({ queryKey: ["lots"] }); };

  const scan = useMutation({
    mutationFn: (i: ScanInput) => post(`/api/deliveries/${id}/scan`, i),
    onSuccess: (r) => { setOut(r); setDelivery(r.delivery); setErr(""); play(r.canConfirm ? "chime" : "crack"); refresh(); },
    onError: (e) => { setErr(msg(e)); setOut(null); play("crack"); }
  });
  const confirm = useMutation({
    mutationFn: () => post(`/api/packages/${out.packageId}/putaway`, out.needsWitness ? { witness } : {}),
    onSuccess: (d) => { setDelivery(d); setOut(null); setErr(""); setWitness({ email: "", password: "" }); play("seal"); refresh(); },
    onError: (e) => setErr(msg(e))
  });
  const report = useMutation({
    mutationFn: () => post(`/api/packages/${out.packageId}/problem`, { kind: problem, note }),
    onSuccess: (d) => { setDelivery(d); setOut(null); setProblem(""); setNote(""); setErr(""); refresh(); },
    onError: (e) => setErr(msg(e))
  });

  const d = delivery?.id === id ? delivery : view.data;
  if (!id) return <p className="dim">No deliveries.</p>;
  const canScan = user.role !== "cashier";
  const done = d && d.checkedIn >= d.expected;
  return (
    <>
      <div className="spread">
        <div><h1>Receive & put away</h1><p className="sub">Scan each package. Lotergeist checks it and tells you where it goes.</p></div>
        <select aria-label="Delivery" value={id} onChange={(e) => { setPick(e.target.value); setOut(null); setDelivery(null); }} style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }}>
          {list.data?.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.wholesaler} · {x.checkedIn}/{x.expected}</option>)}
        </select>
      </div>

      {d && (
        <div className="card" style={{ margin: "16px 0" }}>
          <div className="spread"><strong>{d.wholesaler} · {d.id}</strong><span className="dim">{d.checkedIn} of {d.expected} packages checked in</span></div>
          <div className="bar" style={{ marginTop: 10 }} role="progressbar" aria-valuenow={d.checkedIn} aria-valuemax={d.expected}><i style={{ width: `${(100 * d.checkedIn) / d.expected}%` }} /></div>
        </div>
      )}

      {done && (
        <div className="ok" style={{ marginBottom: 16, fontSize: 16 }} role="status">✓ Delivery checked in. All {d.expected} packages are on the shelves and in the ledger.</div>
      )}

      <div className="grid2">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {canScan ? <ScanPanel onScan={(i) => scan.mutate(i)} busy={scan.isPending} /> : <div className="warnbox">A cashier cannot receive stock.</div>}
          <Err e={err} />
          {out && (
            <div className="card">
              <div className="spread">
                <div><h3>{out.product.name}</h3><div className="dim">{out.product.maker} · <span className="mono">NDC {out.product.ndc10}</span></div></div>
                {out.product.storage === "cold" && <Tag tone="cold">Cold chain</Tag>}
                {out.product.storage === "c2" && <Tag tone="ctrl">Schedule II</Tag>}
              </div>
              <div className="row" style={{ margin: "12px 0", flexWrap: "wrap" }}>
                {out.fields.map((f: any) => <div key={f.k} className="card" style={{ padding: "8px 12px", background: "var(--panel2)" }}><div className="dimmer" style={{ fontSize: 11 }}>{f.k} · AI {f.ai}</div><div className="mono">{f.v}</div></div>)}
              </div>
              {out.noSerial && <div className="warnbox" style={{ marginBottom: 8 }}>No serial on the label. The package got an internal id; check the supplier paperwork by hand.</div>}
              <Checks checks={out.checks} />
              <div className="card" style={{ margin: "12px 0", background: out.suggestion.zone === "cold" ? "#0d2634" : out.suggestion.zone === "controlled" ? "#2a170c" : "#1b1830" }}>
                <Tag tone={out.suggestion.zone === "cold" ? "cold" : out.suggestion.zone === "controlled" ? "ctrl" : "violet"}>{out.suggestion.zoneLabel}</Tag>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{out.suggestion.location}</div>
                <div className="dim" style={{ fontSize: 12 }}>{out.suggestion.why}</div>
              </div>
              {out.needsWitness && out.canConfirm && (
                <div className="card" style={{ background: "var(--panel2)", marginBottom: 12 }}>
                  <strong>Witness (another staff member signs in)</strong>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input aria-label="Witness email" placeholder="witness email" value={witness.email} onChange={(e) => setWitness({ ...witness, email: e.target.value })} style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }} />
                    <input aria-label="Witness password" type="password" placeholder="password" value={witness.password} onChange={(e) => setWitness({ ...witness, password: e.target.value })} style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }} />
                  </div>
                </div>
              )}
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn green" disabled={!out.canConfirm || confirm.isPending} onClick={() => confirm.mutate()}>Confirm put-away</button>
                <select aria-label="Problem kind" value={problem} onChange={(e) => setProblem(e.target.value)} style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }}>
                  <option value="">Report a problem…</option>
                  {PROBLEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {problem && <><input aria-label="Problem note" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }} /><button className="btn red sm" onClick={() => report.mutate()}>Quarantine & report</button></>}
              </div>
            </div>
          )}
        </div>
        <div className="card" style={{ alignSelf: "start" }}>
          <h3>Invoice {d?.tiDoc ? <span className="dimmer mono" style={{ fontWeight: 400 }}>· {d.tiDoc}</span> : null}</h3>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Line</th><th>Item</th><th>Qty</th></tr></thead>
            <tbody>
              {d?.lines.map((l: any) => (
                <tr key={l.lineNo}>
                  <td className="dim">{l.lineNo}</td>
                  <td><div style={{ fontWeight: 500 }}>{l.name}</div><div className="dim" style={{ fontSize: 12 }}>{l.sub}</div></td>
                  <td className="mono" style={{ color: l.state === "done" ? "var(--green)" : l.state === "now" ? "var(--violet2)" : "var(--dim)" }}>{l.qty}{l.state === "done" ? " ✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
