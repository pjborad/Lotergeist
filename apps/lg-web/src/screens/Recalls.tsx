import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post, type User } from "../lib/api";
import { readText } from "../lib/ocr";
import { Err, Tag } from "../components/ui";

const STEPS = ["Look up", "Review impact", "Notify", "Done"];
const inp = { background: "var(--panel2)", border: "1px solid var(--line2)", borderRadius: 8, padding: "9px 11px" } as const;

export function Recalls({ user }: { user: User }) {
  const qc = useQueryClient();
  const [rid, setRid] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const list = useQuery({ queryKey: ["recalls"], queryFn: () => get<any[]>("/api/recalls") });
  const detail = useQuery({ queryKey: ["recall", rid], queryFn: () => get(`/api/recalls/${rid}`), enabled: !!rid });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["recall"] }); void qc.invalidateQueries({ queryKey: ["recalls"] }); void qc.invalidateQueries({ queryKey: ["today"] }); void qc.invalidateQueries({ queryKey: ["lots"] }); };
  const open = (id: string, s: number) => { setRid(id); setStep(s); };

  if (user.role !== "pharmacist") return <><h1>Recalls</h1><div className="warnbox" style={{ marginTop: 16 }}>Only a pharmacist works recalls. You can still see which lots are held under Inventory.</div></>;
  const r = detail.data?.recall, imp = detail.data?.impact;
  return (
    <>
      <div className="recallhead">
        <Tag tone="red">⚠ Recall</Tag>
        <h1 style={{ marginTop: 8 }}>Recall in four steps</h1>
        <p className="dim" style={{ marginTop: 4 }}>From an FDA notice to patients told and stock held. A pharmacist confirms every lot before anything happens.</p>
      </div>
      <div className="steps" aria-label="Recall steps">
        {STEPS.map((s, i) => <button key={s} className={`s ${i === step ? "on" : i < step ? "done" : ""}`} disabled={i > 0 && !rid} onClick={() => setStep(i)} style={{ background: "none", textAlign: "left", cursor: "pointer" }}>{i < step ? "✓ " : `${i + 1}. `}{s}</button>)}
      </div>
      {step === 0 && <Lookup list={list.data ?? []} onOpen={(id) => { refresh(); open(id, 1); }} />}
      {step >= 1 && r && imp && step === 1 && <Review r={r} imp={imp} onChange={refresh} onNext={() => setStep(2)} />}
      {step === 2 && r && imp && <Notify r={r} imp={imp} onSent={() => { refresh(); setStep(3); }} />}
      {step === 3 && r && imp && <Done r={r} onChange={refresh} />}
    </>
  );
}

function Lookup({ list, onOpen }: { list: any[]; onOpen: (id: string) => void }) {
  const [num, setNum] = useState("D-0417-2026");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const fax = useQuery({ queryKey: ["fax"], queryFn: () => get<any[]>("/api/fax") });
  const lookup = async (body: { number?: string; text?: string }) => {
    setErr("");
    try { const r = await post("/api/recalls/lookup", body); onOpen(r.recall.id); } catch (e) { setErr(msg(e)); } finally { setBusy(""); }
  };
  async function fromImage(src: Blob) {
    setBusy("Reading the fax with OCR… the first run loads the model.");
    try { const { text } = await readText(src); await lookup({ text }); } catch (e) { setErr(msg(e)); setBusy(""); }
  }
  return (
    <div className="grid2">
      <div className="card">
        <h3>Look up a recall</h3>
        <p className="dim" style={{ margin: "4px 0 12px" }}>Type the FDA recall number. We read the notice from openFDA (or the demo copy if it is offline).</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setBusy("Looking up…"); void lookup({ number: num }); }}>
          <input aria-label="Recall number" className="mono" value={num} onChange={(e) => setNum(e.target.value)} style={{ ...inp, flex: 1 }} />
          <button className="btn" disabled={!!busy}>Look up</button>
        </form>
        <div className="row" style={{ margin: "14px 0 8px", flexWrap: "wrap" }}>
          <label className="btn ghost sm" style={{ cursor: "pointer" }}>Upload the fax instead
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromImage(f); e.target.value = ""; }} />
          </label>
          <span className="dimmer" style={{ fontSize: 12 }}>The fax is read by OCR in your browser.</span>
        </div>
        {busy && <div className="warnbox" role="status">{busy}</div>}
        <Err e={err} />
        <h3 style={{ marginTop: 18 }}>Fax inbox</h3>
        {fax.data?.map((f) => (
          <div key={f.id} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <img src={f.image} alt="Fax page" width={56} style={{ borderRadius: 4, background: "#fff" }} />
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{f.from_name} · {f.pages} pages</div><div className="dim" style={{ fontSize: 12 }}>{f.recall_id}</div></div>
            {f.status === "new" && <Tag tone="red">New</Tag>}
            <button className="btn sm" disabled={!!busy} onClick={async () => { setBusy("Reading the fax with OCR…"); try { const b = await (await fetch(f.image)).blob(); await fromImage(b); } catch (e) { setErr(msg(e)); setBusy(""); } }}>Read with OCR</button>
          </div>
        ))}
      </div>
      <div className="card" style={{ alignSelf: "start" }}>
        <h3>Recalls so far</h3>
        {list.map((x) => (
          <button key={x.id} className="chip" style={{ display: "flex", width: "100%", margin: "8px 0", justifyContent: "space-between", borderRadius: 10, padding: "10px 12px" }} onClick={() => onOpen(x.id)}>
            <span><span className="mono">{x.id}</span> · {x.impact.patientCount} patients</span><Tag tone={x.status === "closed" ? "gray" : x.status === "notified" ? "green" : "amber"}>{x.status}</Tag>
          </button>
        ))}
        {!list.length && <p className="dim" style={{ marginTop: 8 }}>None yet.</p>}
      </div>
    </div>
  );
}

function Review({ r, imp, onChange, onNext }: { r: any; imp: any; onChange: () => void; onNext: () => void }) {
  const [all, setAll] = useState(false);
  const [err, setErr] = useState("");
  const confirm = useMutation({ mutationFn: (lot: string) => post(`/api/recalls/${r.id}/confirm-lot`, { lot }), onSuccess: onChange, onError: (e) => setErr(msg(e)) });
  const seen = new Set<string>();
  const pts = imp.patients.filter((p: any) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  const shown = all ? pts : pts.slice(0, 5);
  return (
    <>
      <div className="card">
        <div className="spread"><div><span className="mono dim">{r.id}</span><h3 style={{ fontSize: 17 }}>{r.product}</h3></div><div className="row"><Tag tone="red">{r.classification}</Tag>{r.level && <Tag tone="gray">{r.level}</Tag>}</div></div>
        <p className="dim" style={{ marginTop: 6 }}>{r.reason} · {r.firm}</p>
        {r.warnings.map((w: string) => <div key={w} className="warnbox" style={{ marginTop: 8 }}>{w}</div>)}
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Lot</th><th>Expiry</th><th>Read by</th><th>Confidence</th><th>In your store</th><th /></tr></thead>
          <tbody>
            {r.lots.map((l: any) => (
              <tr key={l.lot}>
                <td className="mono" style={{ fontWeight: 600 }}>{l.lot}</td><td>{l.expiry || "—"}</td><td className="dim">{l.source}</td>
                <td><span className="mono">{l.confidence.toFixed(2)}</span> {l.confidence < 0.8 && <Tag tone="amber">Needs a person</Tag>}</td>
                <td className="mono">{l.received} received · {l.dispensed} dispensed · {l.onShelf} held</td>
                <td>{l.confirmed ? <Tag tone="green">✓ Confirmed</Tag> : <button className="btn sm" onClick={() => confirm.mutate(l.lot)} title={l.why}>Confirm lot</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.lots.some((l: any) => !l.confirmed) && <div className="warnbox" style={{ marginTop: 10 }}>Check the lot against the notice, then confirm it. Units are held only after you confirm.</div>}
        <Err e={err} />
      </div>
      <div className="grid4" style={{ gridTemplateColumns: "repeat(3,1fr)", margin: "16px 0" }}>
        <div className="card"><div className="dim">Units held</div><div style={{ fontSize: 28, fontWeight: 700 }}>{imp.unitsHeld}</div><div className="dimmer">in {imp.location}</div></div>
        <div className="card"><div className="dim">Patients found</div><div style={{ fontSize: 28, fontWeight: 700 }}>{imp.patientCount}</div><div className="dimmer">sold {imp.soldRange || "—"}</div></div>
        <div className="card"><div className="dim">Messages to send</div><div style={{ fontSize: 28, fontWeight: 700 }}>{imp.messageCount}</div><div className="dimmer">{imp.textCount} text · {imp.emailCount} email · {imp.callCount} call only</div></div>
      </div>
      <div className="card">
        <h3>Patients</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Patient</th><th>Rx</th><th>Lot</th><th>Sold</th><th>How we reach them</th></tr></thead>
          <tbody>{shown.map((p: any) => <tr key={p.id}><td>{p.name} <span className="mono dimmer">{p.id}</span></td><td className="mono">{p.rx}</td><td className="mono">{p.lot}</td><td>{p.sold}</td><td>{p.channels.join(" + ")}</td></tr>)}</tbody>
        </table>
        {pts.length > 5 && <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${pts.length} patients`}</button>}
      </div>
      <div style={{ marginTop: 16 }}><button className="btn" disabled={imp.unconfirmed > 0 || !imp.patientCount} onClick={onNext}>{imp.unconfirmed ? `Confirm ${imp.unconfirmed} lot(s) first` : "Next: write the message"}</button></div>
    </>
  );
}

function Notify({ r, imp, onSent }: { r: any; imp: any; onSent: () => void }) {
  const [t, setT] = useState<{ sms: string; emailSubject: string; emailBody: string } | null>(null);
  const [pv, setPv] = useState<any>(null);
  const [attest, setAttest] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { void get(`/api/recalls/${r.id}/messages`).then((d) => { setT({ sms: d.sms, emailSubject: d.emailSubject, emailBody: d.emailBody }); setPv(d); }); }, [r.id]);
  useEffect(() => {
    if (!t) return;
    const h = window.setTimeout(() => { void post(`/api/recalls/${r.id}/preview`, t).then(setPv).catch(() => undefined); }, 250);
    return () => window.clearTimeout(h);
  }, [t, r.id]);
  const send = useMutation({ mutationFn: () => post(`/api/recalls/${r.id}/notifications`, { ...t, attest }), onSuccess: onSent, onError: (e) => setErr(msg(e)) });
  if (!t) return <p className="dim">Loading the draft…</p>;
  return (
    <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="card">
        <h3>Text message</h3>
        <div className="field" style={{ marginTop: 8 }}><label htmlFor="sms">Fields like {"{first_name}"} are filled in for each patient. “Reply STOP to opt out.” is added.</label><textarea id="sms" rows={5} value={t.sms} onChange={(e) => setT({ ...t, sms: e.target.value })} /></div>
        <div className="dimmer" style={{ fontSize: 12 }}>{pv?.smsInfo?.chars} characters · {pv?.smsInfo?.segments} SMS segment{pv?.smsInfo?.segments === 1 ? "" : "s"}</div>
        <h3 style={{ marginTop: 16 }}>Email</h3>
        <div className="field" style={{ marginTop: 8 }}><label htmlFor="sub">Subject</label><input id="sub" value={t.emailSubject} onChange={(e) => setT({ ...t, emailSubject: e.target.value })} /></div>
        <div className="field"><label htmlFor="eb">Body</label><textarea id="eb" rows={8} value={t.emailBody} onChange={(e) => setT({ ...t, emailBody: e.target.value })} /></div>
      </div>
      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <div className="card">
          <h3>Preview for {pv?.previewName}</h3>
          <div className="bubble" style={{ marginTop: 10 }}>{pv?.smsPreview}</div>
          <div className="dimmer" style={{ fontSize: 12, marginTop: 8 }}>Email subject: {pv?.emailSubject}</div>
        </div>
        <div className="card">
          <p><strong>{imp.textCount}</strong> texts · <strong>{imp.emailCount}</strong> emails · <strong>{imp.callCount}</strong> on the call list</p>
          <div className="warnbox" style={{ marginTop: 10 }}>Sandbox: messages go to the demo outbox. Nothing leaves this computer.</div>
          <label className="row" style={{ margin: "12px 0" }}><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> I am the pharmacist. I reviewed this message and the patient list.</label>
          <Err e={err} />
          <button className="btn red" disabled={!attest || send.isPending} onClick={() => send.mutate()}>Send {imp.messageCount} messages</button>
        </div>
      </div>
    </div>
  );
}

function Done({ r, onChange }: { r: any; onChange: () => void }) {
  const res = useQuery({ queryKey: ["recall-results", r.id], queryFn: () => get(`/api/recalls/${r.id}/results`), refetchInterval: 2000 });
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const act = (path: string, label: string) => async () => { try { await post(`/api/recalls/${r.id}/${path}`); setNote(label); onChange(); void res.refetch(); } catch (e) { setErr(msg(e)); } };
  const x = res.data;
  if (!x) return <p className="dim">Loading…</p>;
  const acts = (k: string) => x.actions.some((a: any) => a.kind === k);
  return (
    <>
      <div className="ok" role="status" style={{ marginBottom: 16 }}>✓ Messages sent to the sandbox. Delivery updates below as the provider reports back.</div>
      <div className="grid4" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="card"><div className="dim">Texts</div><div style={{ fontSize: 26, fontWeight: 700 }}>{x.sms.delivered} / {x.sms.total}</div><div className="dimmer">delivered · {x.sms.sent} waiting · {x.sms.failed} failed</div></div>
        <div className="card"><div className="dim">Emails</div><div style={{ fontSize: 26, fontWeight: 700 }}>{x.email.sent} / {x.email.total}</div><div className="dimmer">sent</div></div>
        <div className="card"><div className="dim">Units held</div><div style={{ fontSize: 26, fontWeight: 700 }}>{x.quarantined}</div><div className="dimmer">{x.location}</div></div>
      </div>
      <div className="grid2" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="card"><h3>Call list</h3>
          {x.callList.map((c: any) => <div key={c.id} className="row spread" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}><span>{c.name} <span className="mono dimmer">{c.id}</span></span><span className="mono">{c.phone || "no phone"}</span></div>)}
          {!x.callList.length && <p className="dim">Nobody needs a call.</p>}
        </div>
        <div className="card"><h3>What's next</h3>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" disabled={acts("return_pickup")} onClick={act("return-pickup", "Return pickup scheduled (sandbox).")}>{acts("return_pickup") ? "✓ Return pickup scheduled" : "Schedule return pickup"}</button>
            <button className="btn ghost" disabled={acts("manufacturer_response")} onClick={act("manufacturer-response", "Response written to the sandbox outbox.")}>{acts("manufacturer_response") ? "✓ Manufacturer responded" : "Respond to the manufacturer"}</button>
            <a className="btn ghost" href={`/api/recalls/${r.id}/report.pdf`} style={{ textAlign: "center" }}>Download audit report (PDF)</a>
            <button className="btn" disabled={x.status === "closed"} onClick={act("close", "Recall closed. Lots stay blocked.")}>{x.status === "closed" ? "Recall closed" : "Close this recall"}</button>
          </div>
          {note && <div className="ok" role="status" style={{ marginTop: 10 }}>{note}</div>}
          <Err e={err} />
        </div>
      </div>
    </>
  );
}
