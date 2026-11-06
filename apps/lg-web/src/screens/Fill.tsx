import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { get, msg, post, type User, type ScanInput } from "../lib/api";
import { ScanPanel } from "../components/ScanPanel";
import { Checks, Err, Tag, when } from "../components/ui";
import { play } from "../lib/sound";

const STEPS = ["Scan", "Label", "Verify", "Pickup"];
const VERIFY = ["Right patient and right drug", "Strength, directions and quantity match the prescription", "Lot and serial on the label match the package", "Not recalled and in date"];
const tone = (s: string) => ({ to_fill: "orange", filled: "violet", to_verify: "amber", ready: "green", sold: "gray" } as Record<string, string>)[s] ?? "gray";

export function Fill({ user }: { user: User }) {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const queue = useQuery({ queryKey: ["rxq"], queryFn: () => get<any[]>("/api/rx"), refetchInterval: 10000 });
  const rx = sp.get("rx") ?? queue.data?.[0]?.rx;
  const d = useQuery({ queryKey: ["rx", rx], queryFn: () => get(`/api/rx/${rx}`), enabled: !!rx });
  const [outcome, setOutcome] = useState<any>(null);
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState<boolean[]>([false, false, false, false]);
  const [pick, setPick] = useState({ idChecked: false, counseled: false, signature: false });
  const [sold, setSold] = useState<any>(null);
  const [back, setBack] = useState("");
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["rxq"] }); void qc.invalidateQueries({ queryKey: ["rx"] }); void qc.invalidateQueries({ queryKey: ["today"] }); void qc.invalidateQueries({ queryKey: ["lots"] }); };
  const ok = (after?: (r: any) => void) => ({ onSuccess: (r: any) => { setErr(""); after?.(r); refresh(); }, onError: (e: unknown) => { setErr(msg(e)); play("crack"); } });

  const scan = useMutation({ mutationFn: (i: ScanInput) => post(`/api/rx/${rx}/scan`, i), ...ok((r) => { setOutcome(r); play("chime"); }) });
  const label = useMutation({ mutationFn: () => post(`/api/dispenses/${d.data.dispense.id}/label`), ...ok() });
  const verify = useMutation({ mutationFn: () => post(`/api/dispenses/${d.data.dispense.id}/verify`, { checklist: checked }), ...ok(() => { setChecked([false, false, false, false]); play("seal"); }) });
  const sendBack = useMutation({ mutationFn: () => post(`/api/dispenses/${d.data.dispense.id}/sendback`, { reason: back }), ...ok(() => { setBack(""); setOutcome(null); }) });
  const sell = useMutation({ mutationFn: () => post(`/api/dispenses/${d.data.dispense.id}/sell`, pick), ...ok((r) => { setSold(r); setPick({ idChecked: false, counseled: false, signature: false }); play("seal"); }) });

  const choose = (r: string) => { setSp({ rx: r }); setOutcome(null); setErr(""); setSold(null); };
  const x = d.data;
  return (
    <>
      <h1>Fill & pickup</h1>
      <p className="sub">The lot and serial you scan are saved on the prescription. That is what makes a recall precise later.</p>
      <div className="grid2" style={{ gridTemplateColumns: "340px 1fr", marginTop: 16 }}>
        <div className="card" style={{ padding: 8, alignSelf: "start" }}>
          {queue.data?.map((r) => (
            <button key={r.rx} onClick={() => choose(r.rx)} className="results" style={{ position: "static", width: "100%", display: "block", background: r.rx === rx ? "#1b1830" : "transparent", border: 0, padding: "10px 12px", cursor: "pointer", borderRadius: 8, marginBottom: 2, textAlign: "left" }}>
              <div className="spread"><span className="mono">Rx {r.rx}</span><Tag tone={tone(r.status)}>{r.statusLabel}</Tag></div>
              <div style={{ fontWeight: 600 }}>{r.patient}</div>
              <div className="dim" style={{ fontSize: 12 }}>{r.drug}</div>
            </button>
          ))}
        </div>
        {x ? (
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div className="card">
              <div className="spread">
                <div><h3>{x.patient.name} <span className="dimmer mono" style={{ fontWeight: 400 }}>{x.patient.id}</span></h3><div style={{ marginTop: 4 }}>{x.prescription.drug}</div><div className="dim">{x.prescription.directions} · {x.prescription.prescriber}</div></div>
                <Tag tone={tone(x.status)}>{x.statusLabel}</Tag>
              </div>
              {x.patient.allergies !== undefined && x.patient.dob && <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>DOB {x.patient.dob} · Allergies: {x.patient.allergies || "none on file"}</div>}
              <div className="steps" style={{ marginBottom: 0 }} aria-label="Progress">
                {STEPS.map((s, i) => <div key={s} className={`s ${i === x.step ? "on" : i < x.step ? "done" : ""}`}>{i < x.step ? "✓ " : `${i + 1}. `}{s}</div>)}
              </div>
            </div>
            <Err e={err} />

            {x.status === "to_fill" && (user.role === "cashier" ? <div className="warnbox">A technician or pharmacist scans the package.</div> : <ScanPanel title="Scan the package for this prescription" onScan={(i) => scan.mutate(i)} busy={scan.isPending} />)}
            {outcome && x.status !== "to_fill" && (
              <div className="card"><h3>Package scanned</h3><Checks checks={outcome.checks} />
                <div className="mono" style={{ marginTop: 8 }}>Lot {outcome.lot} · Serial {outcome.serial} · Exp {outcome.expiry}</div>
                {outcome.inferredSerial && <div className="warnbox" style={{ marginTop: 8 }}>No serial was scanned, so the oldest unit of this lot was assumed. Not read from the package.</div>}
              </div>
            )}
            {x.status === "filled" && (
              <div className="card"><h3>Step 2 · Label</h3><p className="dim" style={{ margin: "6px 0 12px" }}>Print the label and put it on the package.</p>
                <button className="btn" disabled={user.role === "cashier"} onClick={() => label.mutate()}>Print label</button></div>
            )}
            {x.status === "to_verify" && (
              <div className="card"><h3>Step 3 · Pharmacist verify</h3>
                {user.role !== "pharmacist" ? <p className="dim" style={{ marginTop: 8 }}>Waiting for a pharmacist.</p> : (
                  <>
                    {VERIFY.map((v, i) => <label key={v} className="row" style={{ padding: "6px 0" }}><input type="checkbox" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} /> {v}</label>)}
                    <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                      <button className="btn green" disabled={!checked.every(Boolean)} onClick={() => verify.mutate()}>Verify</button>
                      <input aria-label="Reason to send back" placeholder="Reason to send back" value={back} onChange={(e) => setBack(e.target.value)} style={{ background: "var(--panel2)", border: "1px solid var(--line2)", borderRadius: 8, padding: 8 }} />
                      <button className="btn ghost" disabled={back.trim().length < 3} onClick={() => sendBack.mutate()}>Send back</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {x.status === "ready" && !sold && (
              <div className="card"><h3>Step 4 · Pickup</h3>
                {user.role === "technician" ? <p className="dim" style={{ marginTop: 8 }}>A cashier or pharmacist hands this over.</p> : (
                  <>
                    {([["idChecked", "Photo ID checked"], ["counseled", "Counseling offered"], ["signature", "Signature captured"]] as const).map(([k, l]) => <label key={k} className="row" style={{ padding: "6px 0" }}><input type="checkbox" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} /> {l}</label>)}
                    <button className="btn green" style={{ marginTop: 10 }} disabled={!Object.values(pick).every(Boolean)} onClick={() => sell.mutate()}>Complete sale</button>
                  </>
                )}
              </div>
            )}
            {(sold || x.status === "sold") && x.dispense && (
              <div className="card"><div className="ok" role="status" style={{ marginBottom: 10 }}>✓ Sold. The lot and serial are now linked to {x.patient.name}.</div>
                <table><tbody>
                  <tr><td className="dim">Lot</td><td className="mono">{x.dispense.lot || "—"}</td></tr>
                  <tr><td className="dim">Serial</td><td className="mono">{x.dispense.serial || "—"}</td></tr>
                  <tr><td className="dim">Expiry</td><td className="mono">{x.dispense.expiry || "—"}</td></tr>
                  <tr><td className="dim">Sold</td><td>{x.dispense.soldAt ? when(x.dispense.soldAt) : "—"} · {x.dispense.register}</td></tr>
                  <tr><td className="dim">Contact for recalls</td><td>{[x.dispense.contact?.sms && "text", x.dispense.contact?.email && "email", x.dispense.contact?.phone && "phone"].filter(Boolean).join(", ") || "—"}</td></tr>
                </tbody></table>
              </div>
            )}
          </div>
        ) : <p className="dim">Pick a prescription.</p>}
      </div>
    </>
  );
}
