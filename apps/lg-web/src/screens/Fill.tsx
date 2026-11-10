import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { get, msg, post, type ScanInput, type User } from "../lib/api";
import { play } from "../lib/sound";
import { ScanPanel } from "../components/ScanPanel";
import { btn, C, CheckList, ErrorBox, Footer, Icon, input, MONO, pill, when } from "../components/kit";
import { PageHeader } from "../components/Shell";
import { RxReview } from "../components/RxReview";

const STEPS = ["Review", "Scan", "Label", "Verify", "Pickup"];
const FILLABLE = new Set(["clear", "approved"]);
const VERIFY = ["Patient and prescription match", "Dose is within normal range", "No interactions on profile", "Package matches the NDC, lot and serial on the label"];
const PICKUP = [["idChecked", "Photo ID verified"], ["counseled", "Counseling offered"], ["signature", "Signature captured"]] as const;
const queueTone = (s: string, review?: string): [string, string] => (s === "ready" || s === "sold" ? ["var(--ok-text)", "var(--ok-soft)"] : s === "to_verify" || review === "pending" || review === "on_hold" ? ["var(--warn-text)", "var(--warn-soft)"] : review === "rejected" ? ["var(--danger-text)", "var(--danger-soft)"] : ["var(--accent-text)", "var(--accent-soft)"]);
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const panel = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", gap: 18, minHeight: 300 } as const;
const chip = { fontSize: 12, padding: "3px 10px", borderRadius: 999, background: C.chip, color: C.ink2 } as const;

export function Fill({ user }: { user: User }) {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const queue = useQuery({ queryKey: ["rxq"], queryFn: () => get<any[]>("/api/rx"), refetchInterval: 10000 });
  const rx = sp.get("rx") ?? queue.data?.[0]?.rx;
  const d = useQuery({ queryKey: ["rx", rx], queryFn: () => get(`/api/rx/${rx}`), enabled: !!rx });
  const [outcome, setOutcome] = useState<any>(null);
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState([false, false, false, false]);
  const [pick, setPick] = useState({ idChecked: false, counseled: false, signature: false });
  const [backing, setBacking] = useState(false);
  const [reason, setReason] = useState("");
  const refresh = () => ["rxq", "rx", "today", "lots"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const handlers = (after?: (r: any) => void) => ({ onSuccess: (r: any) => { setErr(""); after?.(r); refresh(); }, onError: (e: unknown) => { setErr(msg(e)); play("crack"); } });

  const x = d.data;
  const did = x?.dispense?.id;
  const scan = useMutation({ mutationFn: (i: ScanInput) => post(`/api/rx/${rx}/scan`, i), ...handlers((r) => { setOutcome(r); play("chime"); }) });
  const label = useMutation({ mutationFn: () => post(`/api/dispenses/${did}/label`), ...handlers() });
  const verify = useMutation({ mutationFn: () => post(`/api/dispenses/${did}/verify`, { checklist: checked }), ...handlers(() => { setChecked([false, false, false, false]); play("seal"); }) });
  const sendBack = useMutation({ mutationFn: () => post(`/api/dispenses/${did}/sendback`, { reason }), ...handlers(() => { setReason(""); setBacking(false); setOutcome(null); }) });
  const sell = useMutation({ mutationFn: () => post(`/api/dispenses/${did}/sell`, pick), ...handlers(() => { setPick({ idChecked: false, counseled: false, signature: false }); play("seal"); }) });

  const choose = (r: string) => { setSp({ rx: r }); setOutcome(null); setErr(""); setBacking(false); };
  const next = () => { const n = queue.data?.find((q) => q.rx !== rx && q.status !== "sold"); if (n) choose(n.rx); };
  const disp = x?.dispense;
  const scanned = outcome && outcome.dispenseId === did ? outcome : null;
  const contact = disp?.contact ?? {};

  return (
    <>
      <PageHeader crumb="Operations · Fill & pickup" title={x ? `${x.prescription.drug.split(" · ")[0].replace(/ \d.*$/, "")} for ${x.patient.name}` : "Fill & pickup"}>
        <span className="chip accent"><span className="dot pulse" />Rx Watcher reviewing {queue.data?.filter((q) => q.status === "to_fill").length ?? 0} open orders</span>
      </PageHeader>
      <main style={{ padding: "24px 32px 64px", display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", maxWidth: 1240, boxSizing: "border-box", width: "100%" }}>
        <section aria-labelledby="queue" style={{ flex: "1 1 280px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="queue" style={{ margin: 4, fontSize: 14, fontWeight: 600, color: C.ink2 }}>Queue · {queue.data?.filter((q) => q.status !== "sold").length ?? 0}</h2>
          {queue.data?.map((q) => {
            const on = q.rx === rx;
            const [c, bg] = queueTone(q.status, q.review);
            const flag = q.status === "to_fill" && (q.review === "pending" || q.review === "none");
            return (
              <button key={q.rx} onClick={() => choose(q.rx)} aria-current={on ? "true" : undefined} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 10, border: `1px solid ${on ? C.violet : C.line}`, background: on ? "var(--sunken)" : C.well, color: C.ink, textAlign: "left" }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}><span style={{ fontWeight: 600, fontSize: 14 }}>{q.patient}</span><span style={pill(c, bg, { fontSize: 11, fontWeight: 600, padding: "2px 8px" })}>{q.statusLabel}</span></span>
                <span style={{ fontSize: 13, color: C.dim }}>{q.drug.split(" · ")[0]}</span>
                <span style={{ fontSize: 12, color: C.dimmer, fontFamily: MONO }}>Rx {q.rx} · {q.due}</span>
                {q.status === "to_fill" && <span className={flag && q.flags ? "chip warn" : "label"} style={{ alignSelf: "flex-start" }}>Rx Watcher · {q.watcher}</span>}
              </button>
            );
          })}
        </section>

        <section aria-labelledby="rx" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {x && (
            <>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", flexWrap: "wrap", gap: 24 }}>
                <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span aria-hidden="true" style={{ width: 48, height: 48, flexShrink: 0, borderRadius: "50%", background: "var(--accent-soft)", color: C.violet3, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>{initials(x.patient.name)}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <h2 id="rx" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{x.patient.name}</h2>
                    <span style={{ fontSize: 13, color: C.dim }}>{x.patient.dob ? `DOB ${x.patient.dob} · ` : ""}Patient {x.patient.id}</span>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {x.patient.phone && <span style={chip}>{x.patient.phone}{x.patient.smsConsent ? " · SMS" : ""}</span>}
                      {x.patient.email && <span style={chip}>{x.patient.email}</span>}
                      {x.patient.allergies && <span style={{ ...chip, background: "var(--danger-soft)", color: C.red3 }}>Allergy: {x.patient.allergies}</span>}
                    </span>
                  </div>
                </div>
                <dl style={{ flex: "1 1 320px", minWidth: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 20px", fontSize: 14 }}>
                  <div style={{ gridColumn: "1 / -1" }}><dt style={{ fontSize: 12, color: C.dimmer }}>Prescription · Rx {x.rx}</dt><dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{x.prescription.drug}</dd></div>
                  <div style={{ gridColumn: "1 / -1" }}><dt style={{ fontSize: 12, color: C.dimmer }}>Directions</dt><dd style={{ margin: "2px 0 0" }}>{x.prescription.directions}</dd></div>
                  <div><dt style={{ fontSize: 12, color: C.dimmer }}>Prescriber</dt><dd style={{ margin: "2px 0 0" }}>{x.prescription.prescriber}</dd></div>
                  <div><dt style={{ fontSize: 12, color: C.dimmer }}>Refills</dt><dd style={{ margin: "2px 0 0" }}>{x.prescription.refills} remaining</dd></div>
                  <div><dt style={{ fontSize: 12, color: C.dimmer }}>Quantity</dt><dd style={{ margin: "2px 0 0" }}>{x.prescription.qty} × {x.prescription.packSize || "pack"}</dd></div>
                  <div><dt style={{ fontSize: 12, color: C.dimmer }}>Days supply</dt><dd style={{ margin: "2px 0 0" }}>{x.prescription.daysSupply ?? "—"}{x.prescription.parentRx ? ` · replaces Rx ${x.prescription.parentRx}` : ""}</dd></div>
                </dl>
              </div>

              {x.replacedBy && (
                <div className="finding warn" role="status"><span className="ico sm warn" aria-hidden="true">!</span><div style={{ flex: 1 }}><strong>Replaced by Rx {x.replacedBy}</strong><p className="sub">The prescriber changed this order. The original is kept unchanged for the record.</p></div><button className="btn primary" onClick={() => choose(x.replacedBy)}>Open Rx {x.replacedBy}</button></div>
              )}
              <ol className="card stepper" aria-label="Steps">
                {STEPS.map((t, k) => {
                  const cur = x.status === "replaced" ? 0 : x.status === "to_fill" ? (FILLABLE.has(x.review) ? 1 : 0) : x.step + 1;
                  const done = k < cur || x.status === "sold", now = k === cur && x.status !== "sold";
                  return <li key={t} className={`step${done ? " done" : now ? " now" : ""}`} aria-current={now ? "step" : undefined}><span className="n">{done ? "✓" : k + 1}</span>{t}<span className="ln" /></li>;
                })}
              </ol>
              <ErrorBox e={err} />

              {(x.status === "to_fill" || x.status === "replaced") && user.role !== "cashier" && <RxReview rx={x.rx} user={user} onNewRx={choose} />}
              {x.status === "to_fill" && FILLABLE.has(x.review) && (user.role === "cashier"
                ? <div style={panel}><p style={{ margin: 0, color: C.dim }}>A technician or pharmacist scans the package for this prescription.</p></div>
                : <ScanPanel title="Scan the package you are filling" busy={scan.isPending} onScan={(i) => scan.mutate(i)}
                    hint={`${x.pickFrom ? `Pick from ${x.pickFrom}. ` : ""}The scan checks the NDC against the prescription and records the lot and serial on this fill.`} />)}

              {x.status === "filled" && disp && (
                <div style={panel}>
                  {scanned ? <CheckList cols={false} checks={scanned.checks} /> : <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.green2, fontWeight: 600 }}>{Icon.okSmall()}Right drug, right strength. NDC {x.prescription.ndc10} matches.</div>}
                  <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: C.line, borderRadius: 10, overflow: "hidden" }}>
                    {[["Lot", disp.lot], ["Serial", disp.serial], ["Expires", disp.expiry]].map(([k, v]) => (
                      <div key={k} style={{ background: C.well, padding: 14 }}><dt style={{ fontSize: 12, color: C.dimmer }}>{k}</dt><dd style={{ margin: "4px 0 0", fontFamily: MONO }}>{v || "—"}</dd></div>
                    ))}
                    <div style={{ background: C.well, padding: 14 }}><dt style={{ fontSize: 12, color: C.dimmer }}>Recall check</dt><dd style={{ margin: "4px 0 0", color: C.green2 }}>Clear</dd></div>
                  </dl>
                  {scanned?.inferredSerial && <p style={{ margin: 0, fontSize: 13, color: C.amber2 }}>No serial was scanned, so the oldest unit of this lot on the shelf was assumed. It was not read from the package.</p>}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button disabled={user.role === "cashier" || label.isPending} onClick={() => label.mutate()} style={btn("primary")}>Print label &amp; send to pharmacist</button>
                    {user.role === "pharmacist" && <BackButton backing={backing} setBacking={setBacking} reason={reason} setReason={setReason} go={() => sendBack.mutate()} />}
                  </div>
                </div>
              )}

              {x.status === "to_verify" && (
                <div style={panel}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Pharmacist check</h3>
                  {user.role !== "pharmacist" ? <p style={{ margin: 0, fontSize: 14, color: C.dim }}>Lot {disp?.lot} scanned and labelled. Waiting for a pharmacist to verify.</p> : (
                    <>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, fontSize: 14, color: C.ink2 }}>
                        {VERIFY.map((v, i) => (
                          <li key={v}><label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}><input type="checkbox" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} style={{ width: 18, height: 18, accentColor: C.violet }} />{v}</label></li>
                        ))}
                      </ul>
                      <p style={{ margin: 0, fontFamily: MONO, fontSize: 13, color: C.dim }}>Lot {disp?.lot} · serial {disp?.serial} · exp {disp?.expiry}</p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button disabled={!checked.every(Boolean) || verify.isPending} onClick={() => verify.mutate()} style={btn("primary", checked.every(Boolean) ? {} : { background: C.line2, color: C.dimmer })}>Approve as {user.name}</button>
                        <BackButton backing={backing} setBacking={setBacking} reason={reason} setReason={setReason} go={() => sendBack.mutate()} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {x.status === "ready" && (
                <div style={panel}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Pickup at register 2</h3>
                  {user.role === "technician" ? <p style={{ margin: 0, fontSize: 14, color: C.dim }}>Verified and in the will-call bin. A cashier or pharmacist completes the sale.</p> : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                        {PICKUP.map(([k, l]) => (
                          <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, border: `1px solid ${C.line2}`, borderRadius: 10, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} style={{ width: 18, height: 18, accentColor: C.violet }} />{l}</label>
                        ))}
                      </div>
                      <div><button disabled={!Object.values(pick).every(Boolean) || sell.isPending} onClick={() => sell.mutate()} style={btn("green", Object.values(pick).every(Boolean) ? {} : { background: C.line2, color: C.dimmer })}>Complete sale</button></div>
                    </>
                  )}
                </div>
              )}

              {x.status === "sold" && disp && (
                <div style={panel}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{Icon.okBig(40)}<h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Sold to {x.patient.name}</h3></div>
                  <div style={{ padding: 16, borderRadius: 12, background: C.well, border: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 13, lineHeight: 1.9, color: C.ink2 }}>
                    {disp.soldAt ? when(disp.soldAt) : "—"} · register {String(disp.register ?? "").replace(/^POS\s*/, "")}<br />
                    Rx {x.rx} · {x.prescription.drug.split(" · ")[0].toLowerCase()}<br />
                    Lot {disp.lot || "—"} · serial {disp.serial || "—"} · exp {disp.expiry || "—"}<br />
                    Contact on file: {[contact.sms && `SMS ${contact.sms}`, contact.email && "email", !contact.sms && contact.phone && `phone ${contact.phone}`].filter(Boolean).join(" · ") || "none"}
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.dim }}>If this lot is ever recalled, {x.patient.name.split(" ")[0]} appears on the recall list automatically{contact.sms ? " and gets a text" : contact.email ? " and gets an email" : " and goes on the call list"}.</p>
                  <div><button onClick={next} style={btn("ghost", { minHeight: 44 })}>Next prescription</button></div>
                </div>
              )}
            </>
          )}
          {!x && <div style={panel}><p style={{ margin: 0, color: C.dim }}>{d.isLoading ? "Loading…" : "Pick a prescription from the queue."}</p></div>}
        </section>
        <div style={{ flexBasis: "100%" }}><Footer /></div>
      </main>
    </>
  );
}

function BackButton({ backing, setBacking, reason, setReason, go }: { backing: boolean; setBacking: (b: boolean) => void; reason: string; setReason: (s: string) => void; go: () => void }) {
  if (!backing) return <button onClick={() => setBacking(true)} style={btn("ghost")}>Send back</button>;
  return (
    <span style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: "1 1 320px" }}>
      <input aria-label="Reason to send back" placeholder="Why is it going back?" value={reason} onChange={(e) => setReason(e.target.value)} style={input({ flex: 1, height: 48 })} />
      <button disabled={reason.trim().length < 3} onClick={go} style={btn("ghost")}>Send back</button>
    </span>
  );
}
