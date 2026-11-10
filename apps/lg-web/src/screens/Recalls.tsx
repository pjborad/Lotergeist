import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post, type User } from "../lib/api";
import { readText } from "../lib/ocr";
import { deviceVoiceName, speak } from "../lib/speech";
import { btn, C, ErrorBox, Footer, Icon, input, label, MONO, pill, shortDate, StepBars, TONES, when } from "../components/kit";

const STEPS = ["Look up", "Review impact", "Call patients", "Done"];
const stepFor = (status?: string) => (status === "notified" || status === "closed" ? 3 : status === "reviewing" ? 1 : 0);
const CH: Record<string, string> = { Text: "violet", Email: "cold", "Call only": "amber" };
const sec = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 } as const;
const isoLabel = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

export function Recalls({ user }: { user: User }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["recalls"], queryFn: () => get<any[]>("/api/recalls") });
  const fax = useQuery({ queryKey: ["fax"], queryFn: () => get<any[]>("/api/fax") });
  const [rid, setRid] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const current = rid ?? list.data?.find((r) => r.status !== "closed")?.id ?? fax.data?.[0]?.recall_id ?? null;
  const detail = useQuery({ queryKey: ["recall", current], queryFn: () => get(`/api/recalls/${current}`), enabled: !!current });
  useEffect(() => { if (step === null && detail.data) setStep(stepFor(detail.data.recall.status)); }, [detail.data, step]);
  const refresh = () => ["recall", "recalls", "today", "lots", "fax", "recall-results"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const s = step ?? 0;
  const faxRow = fax.data?.find((f) => f.recall_id === current) ?? fax.data?.[0];

  return (
    <>
      <header style={{ position: "relative", overflow: "hidden", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20, padding: "22px 32px", borderBottom: "1px solid var(--danger-soft)", background: "radial-gradient(ellipse 50% 140% at 0% 0%, var(--danger-soft), transparent 70%), radial-gradient(ellipse 40% 140% at 100% 0%, var(--accent-soft), transparent 70%)" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.redText, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, boxShadow: `0 0 10px ${C.red}` }} />
            Recall workflow{faxRow ? ` · fax received ${new Date(faxRow.received_at).toISOString().slice(11, 16)}` : ""}
          </p>
          <h1 style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>Find every affected package and patient</h1>
        </div>
        <div style={{ flex: "1 1 520px" }}><StepBars names={STEPS} current={s} sep=" ·" /></div>
      </header>

      <main style={{ padding: "28px 32px 64px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1240, boxSizing: "border-box", width: "100%" }}>
        {user.role !== "pharmacist" ? (
          <section style={{ ...sec, padding: 28 }}><h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Only a pharmacist works a recall</h2><p style={{ margin: "8px 0 0", color: C.dim }}>Recalled lots are already held. You can see them under Inventory → Recalled.</p></section>
        ) : (
          <>
            {s === 0 && <LookUp faxRow={faxRow} preview={detail.data?.recall} onOpen={(id) => { setRid(id); setStep(1); refresh(); }} />}
            {s === 1 && detail.data && <Review r={detail.data.recall} imp={detail.data.impact} onChange={refresh} back={() => setStep(0)} next={() => setStep(2)} />}
            {s === 2 && detail.data && <Notify r={detail.data.recall} imp={detail.data.impact} back={() => setStep(1)} onSent={() => { refresh(); setStep(3); }} />}
            {s === 3 && detail.data && <Done r={detail.data.recall} onChange={refresh} />}
          </>
        )}
        <Footer />
      </main>
    </>
  );
}

function LookUp({ faxRow, preview, onOpen }: { faxRow?: any; preview?: any; onOpen: (id: string) => void }) {
  const [num, setNum] = useState(faxRow?.recall_id ?? "");
  useEffect(() => { if (!num && faxRow?.recall_id) setNum(faxRow.recall_id); }, [faxRow, num]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const lookup = async (body: { number?: string; text?: string }) => {
    setErr("");
    try { const r = await post("/api/recalls/lookup", body); onOpen(r.recall.id); } catch (e) { setErr(msg(e)); } finally { setBusy(""); }
  };
  const ocr = async (src: Blob) => {
    setBusy("Reading the fax with OCR in this browser… the first run loads the model.");
    try { const { text } = await readText(src); setBusy("Matching the lots on the fax…"); await lookup({ text }); } catch (e) { setErr(msg(e)); setBusy(""); }
  };
  const lots: string[] = preview?.lots?.map((l: any) => l.lot) ?? [];
  const at = faxRow ? new Date(faxRow.received_at) : null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "stretch" }}>
      <section aria-labelledby="look" style={{ ...sec, flex: "1 1 460px", minWidth: 0, padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <h2 id="look" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Enter the recall number from the notice</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.dim }}>We look it up in the FDA enforcement database, read the lot numbers out of the notice, and match them against everything you received and sold.</p>
        <form onSubmit={(e) => { e.preventDefault(); setBusy("Looking it up…"); void lookup({ number: num }); }} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="rn" style={{ fontSize: 13, fontWeight: 500, color: C.ink2 }}>FDA recall number</label>
            <input id="rn" value={num} onChange={(e) => setNum(e.target.value)} placeholder="D-0417-2026" style={input({ height: 52, padding: "0 16px", fontFamily: MONO, fontSize: 18, letterSpacing: "0.04em" })} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button disabled={!!busy || !num.trim()} style={btn("primary", { minHeight: 50, padding: "0 24px" })}>Look up recall</button>
            <label style={{ ...btn("ghost", { minHeight: 50 }), cursor: "pointer" }}>Upload the fax instead<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void ocr(f); e.target.value = ""; }} /></label>
          </div>
        </form>
        {busy && <p role="status" style={{ margin: 0, fontSize: 14, color: C.violet2 }}>{busy}</p>}
        <ErrorBox e={err} />
        <p style={{ margin: "auto 0 0", fontSize: 12, color: C.dimmer }}>Sources: openFDA /drug/enforcement · your receiving and dispensing records</p>
      </section>
      {faxRow && (
        <figure style={{ flex: "1 1 340px", minWidth: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <figcaption style={{ fontSize: 13, color: C.dimmer, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <span>Fax inbox · {faxRow.status === "new" ? "1 new" : "read"} · {faxRow.pages} pages</span>
            <button disabled={!!busy} onClick={async () => { try { await ocr(await (await fetch(faxRow.image)).blob()); } catch (e) { setErr(msg(e)); } }} style={{ border: 0, background: "transparent", color: C.violet2, fontSize: 13, padding: 0 }}>Read this fax with OCR</button>
          </figcaption>
          <div style={{ flex: 1, background: "#E9E7E1", color: "#222", borderRadius: 6, padding: 24, fontFamily: MONO, fontSize: 12, lineHeight: 1.7, boxShadow: "0 20px 50px rgba(0,0,0,0.5)", transform: "rotate(-0.8deg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", borderBottom: "1px solid #999", paddingBottom: 6, marginBottom: 12 }}>
              <span>FROM: {String(faxRow.from_name).toUpperCase()}</span>
              <span>{at ? `${at.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).toUpperCase().replace(",", "")} ${at.toISOString().slice(11, 16)}` : ""} P.1</span>
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.02em", marginBottom: 10 }}>URGENT: DRUG RECALL</div>
            <div>Recall No. <mark style={{ background: C.violet3, padding: "0 3px" }}>{faxRow.recall_id}</mark></div>
            <div>Methylprednisolone Acetate Inj. Susp.</div>
            <div>40 mg/mL, 5 mL vial · NDC 70004-417-05</div>
            <div style={{ marginTop: 10 }}>Lot {lots.length ? lots.join(", ") : "PRORX050925-1, PRORX050925-3"}</div>
            <div style={{ marginTop: 10, color: "#555" }}>Reason: lack of assurance of sterility. Recall to the consumer level. Stop dispensing and quarantine…</div>
          </div>
        </figure>
      )}
    </div>
  );
}

function Review({ r, imp, onChange, back, next }: { r: any; imp: any; onChange: () => void; back: () => void; next: () => void }) {
  const [all, setAll] = useState(false);
  const [err, setErr] = useState("");
  const confirm = useMutation({ mutationFn: (lot: string) => post(`/api/recalls/${r.id}/confirm-lot`, { lot }), onSuccess: onChange, onError: (e) => setErr(msg(e)) });
  const seen = new Set<string>();
  const pts = imp.patients.filter((p: any) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const shown = all ? pts : pts.slice(0, 6);
  const allConfirmed = r.lots.every((l: any) => l.confirmed);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ ...sec, padding: 24, display: "flex", flexWrap: "wrap", gap: 24 }}>
        <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={pill("#FCD9A8", "var(--warn-soft)", { fontWeight: 600 })}>{r.classification}</span>
            {r.level && <span style={pill(C.ink2, C.chip, { fontWeight: 400 })}>{r.level}</span>}
            {r.initiated && <span style={pill(C.ink2, C.chip, { fontWeight: 400 })}>Initiated {isoLabel(r.initiated)}</span>}
            {r.cached && <span style={pill(C.ink2, C.chip, { fontWeight: 400 })}>openFDA offline · demo copy</span>}
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{imp.patients[0]?.drug ?? r.product}</h2>
          <p style={{ margin: 0, fontSize: 14, color: C.dim }}>{r.firm} · {r.reason}</p>
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.dimmer }}>Lots read from the notice</span>
          {r.lots.map((l: any) => (
            <div key={l.lot} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, background: C.well, border: `1px solid ${l.confirmed ? C.line : "var(--warn)"}`, flexWrap: "wrap" }}>
              <span style={{ fontFamily: MONO }}>{l.lot}</span>
              {l.confirmed
                ? <span style={{ fontSize: 12, color: l.received ? C.red3 : C.dim }}>{l.received ? `You received ${l.received} · ${l.firstReceived ? shortDate(l.firstReceived) : ""}` : "Not received here"}</span>
                : <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: C.amber2 }} title={l.why}>Needs your check · {l.confidence.toFixed(2)}</span>
                    <button onClick={() => confirm.mutate(l.lot)} style={{ minHeight: 32, padding: "0 12px", borderRadius: 8, border: 0, background: C.violet, color: C.onAccent, fontSize: 13, fontWeight: 600 }}>Confirm lot</button>
                  </span>}
            </div>
          ))}
          <ErrorBox e={err} />
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div style={{ ...sec, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: C.dim }}>Still on your shelves</span>
          <span style={{ fontSize: 32, fontWeight: 600 }}>{imp.unitsHeld} units</span>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: allConfirmed && imp.unitsHeld ? C.green2 : C.dim }}><input type="checkbox" readOnly checked={allConfirmed && imp.unitsHeld > 0} style={{ width: 18, height: 18, accentColor: C.green }} />Moved to quarantine Q-1</label>
        </div>
        <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: C.redText }}>Already with patients</span>
          <span style={{ fontSize: 32, fontWeight: 600 }}>{imp.patientCount} patients</span>
          <span style={{ fontSize: 14, color: C.redText }}>{imp.soldRange ? `Sold ${imp.soldRange}` : "None sold"}</span>
        </div>
        <div style={{ ...sec, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: C.dim }}>How we can reach them</span>
          <span style={{ fontSize: 15, lineHeight: 1.8 }}>{imp.textCount} by text · {imp.emailCount} by email<br />{imp.callCount} by phone call only</span>
        </div>
      </div>

      <section aria-labelledby="pts" style={{ ...sec, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", flexWrap: "wrap", gap: 10 }}><h2 id="pts" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Affected patients</h2><span style={{ fontSize: 13, color: C.dimmer }}>Matched by lot recorded at fill</span></div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ textAlign: "left", fontSize: 12, color: C.dimmer, background: C.well }}>{["Patient", "Rx #", "Lot", "Sold", "Contact"].map((h) => <th key={h} scope="col" style={{ padding: "12px 20px", fontWeight: 500 }}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((p: any) => (
                <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: "12px 20px" }}><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontWeight: 500 }}>{p.name}</span><span style={{ fontSize: 12, color: C.dimmer }}>{p.id}</span></span></td>
                  <td style={{ padding: "12px 20px", fontFamily: MONO, fontSize: 13 }}>{p.rx}</td>
                  <td style={{ padding: "12px 20px", fontFamily: MONO, fontSize: 13, color: C.red2 }}>{p.lot}</td>
                  <td style={{ padding: "12px 20px", color: C.dim }}>{p.sold}</td>
                  <td style={{ padding: "12px 20px" }}><span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{p.channels.map((c: string) => <span key={c} style={pill(...TONES[CH[c] ?? "gray"]!)}>{c}</span>)}</span></td>
                </tr>
              ))}
              {!pts.length && <tr><td colSpan={5} style={{ padding: "12px 20px", color: C.dim }}>{allConfirmed ? "No patients received these lots." : "Confirm the lots to see who received them."}</td></tr>}
            </tbody>
          </table>
        </div>
        {pts.length > 6 && <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.line}` }}><button onClick={() => setAll(!all)} style={{ minHeight: 40, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.line2}`, background: "transparent", color: C.violet2, fontSize: 14 }}>{all ? "Show fewer" : `Show all ${pts.length} patients`}</button></div>}
      </section>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button onClick={back} style={btn("ghost")}>Back</button>
        <button onClick={next} disabled={!allConfirmed || !imp.patientCount} style={btn("primary", allConfirmed && imp.patientCount ? {} : { background: C.line2, color: C.dimmer })}>{allConfirmed ? "Continue to patient messages" : "Confirm every lot first"}</button>
      </div>
    </div>
  );
}

function Notify({ r, imp, back, onSent }: { r: any; imp: any; back: () => void; onSent: () => void }) {
  const [t, setT] = useState<{ sms: string; emailSubject: string; emailBody: string } | null>(null);
  const [pv, setPv] = useState<any>(null);
  const [attest, setAttest] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { void get(`/api/recalls/${r.id}/messages`).then((d) => { setT({ sms: d.sms, emailSubject: d.emailSubject, emailBody: d.emailBody }); setPv(d); }); }, [r.id]);
  useEffect(() => {
    if (!t) return;
    const h = window.setTimeout(() => { void post(`/api/recalls/${r.id}/preview`, t).then((p) => setPv((o: any) => ({ ...o, ...p }))).catch(() => undefined); }, 250);
    return () => window.clearTimeout(h);
  }, [t, r.id]);
  const vm = useQuery({ queryKey: ["voicemail", r.id], queryFn: () => get(`/api/recalls/${r.id}/voicemail`) });
  const [script, setScript] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [heard, setHeard] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { if (vm.data && script === null) setScript(vm.data.script); }, [vm.data, script]);
  const preview = useMutation({
    mutationFn: () => post(`/api/recalls/${r.id}/voicemail/preview`, { script }),
    onSuccess: (p: any) => {
      setHeard(p); setErr("");
      if (p.audioId) { const a = new Audio(`/api/audio/${p.audioId}`); setPlaying(true); a.onended = () => setPlaying(false); void a.play().catch(() => setPlaying(false)); }
      else { setPlaying(true); speak(p.text, () => setPlaying(false)); }
    },
    onError: (e) => setErr(msg(e))
  });
  const send = useMutation({
    mutationFn: async () => {
      // Follow-ups first: the text/email step refuses to run twice, the voicemail step is idempotent per recall.
      const out: any = {};
      if (follow && imp.messageCount > 0) out.messages = await post(`/api/recalls/${r.id}/notifications`, { ...t, attest });
      out.calls = await post(`/api/recalls/${r.id}/voicemail`, { script, attest });
      return out;
    },
    onSuccess: onSent, onError: (e) => setErr(msg(e))
  });
  if (!t || !vm.data || script === null) return <p style={{ color: C.dim }}>Loading the draft…</p>;
  const v = vm.data;
  const voiceLabel = v.voice.provider === "browser" ? `This device's voice (${deviceVoiceName()})` : `${v.voice.voice} · ${v.voice.provider}`;
  const area = { resize: "vertical", padding: 14, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.well, color: C.ink, font: "inherit", fontSize: 15, lineHeight: 1.5 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section aria-labelledby="vm" className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div><h2 id="vm" className="h2">Pharmacist voicemail · {v.callCount} patient{v.callCount === 1 ? "" : "s"}</h2><p className="sub">One call per patient from the pharmacy number, {v.window}. The message never names the medicine or the reason. Press 1 transfers to the pharmacist.</p></div>
          <span className="chip accent">Voice: {voiceLabel}</span>
        </div>
        <label htmlFor="vms" className="label">Script. {"{first_name}"}, {"{sold_date}"}, {"{pharmacist}"} and {"{pharmacy_phone}"} are filled in for each patient.</label>
        <textarea id="vms" className="field" rows={5} value={script} onChange={(e) => { setScript(e.target.value); setHeard(null); }} />
        {heard?.problems?.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: "var(--danger-text)", fontSize: 14 }}>{heard.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" disabled={preview.isPending || playing} onClick={() => preview.mutate()}>{preview.isPending ? "Making the recording…" : playing ? "Playing…" : "▶ Hear it as a patient would"}</button>
          {playing && <button className="btn ghost" onClick={() => { speechSynthesis?.cancel(); setPlaying(false); }}>Stop</button>}
          {heard && <span className="label">Preview for {heard.sample} · {heard.audioId ? `recorded with ${heard.voice}` : "read by this device"}</span>}
        </div>
        {heard && <p className="sub" style={{ padding: 14, borderRadius: 12, background: "var(--sunken)", color: "var(--text)" }}>{heard.text}</p>}
        {(v.noPhone > 0 || v.dnc > 0) && <p className="label">{v.noPhone ? `${v.noPhone} without a phone number` : ""}{v.noPhone && v.dnc ? " · " : ""}{v.dnc ? `${v.dnc} on do-not-call` : ""} → pharmacist call list.</p>}
      </section>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
        Also send a text or email follow-up to the {imp.messageCount} opt-in contact{imp.messageCount === 1 ? "" : "s"} (recorded consent only)
      </label>
      {follow && <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "stretch" }}>
        <section aria-labelledby="sms" style={{ ...sec, flex: "1 1 380px", minWidth: 0, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="sms" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Text message · {imp.textCount} patients</h2><span style={{ fontSize: 12, color: C.dimmer }}>{pv?.smsInfo?.segments} SMS segment{pv?.smsInfo?.segments === 1 ? "" : "s"}</span></div>
          <label htmlFor="smsb" style={label}>Message. Fields in braces are filled in for each patient. "Reply STOP to opt out." is added when sent.</label>
          <textarea id="smsb" rows={5} value={t.sms} onChange={(e) => setT({ ...t, sms: e.target.value })} style={area} />
          <div style={{ alignSelf: "flex-end", maxWidth: 300, padding: "12px 14px", borderRadius: "16px 16px 4px 16px", background: "var(--accent-soft)", color: "var(--accent-text)", fontSize: 14, lineHeight: 1.5 }}>{pv?.smsPreview}</div>
          <span style={{ alignSelf: "flex-end", fontSize: 12, color: C.dimmer }}>Preview for {pv?.previewName}</span>
        </section>
        <section aria-labelledby="em" style={{ ...sec, flex: "1 1 420px", minWidth: 0, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="em" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Email · {imp.emailCount} patients</h2>
          <label htmlFor="subj" style={label}>Subject</label>
          <input id="subj" value={t.emailSubject} onChange={(e) => setT({ ...t, emailSubject: e.target.value })} style={input()} />
          <label htmlFor="emb" style={label}>Body</label>
          <textarea id="emb" rows={9} value={t.emailBody} onChange={(e) => setT({ ...t, emailBody: e.target.value })} style={{ ...area, lineHeight: 1.55 }} />
        </section>
      </div>}
      <ErrorBox e={err} />
      <section style={{ ...sec, padding: 20, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ flex: "1 1 420px", display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14, lineHeight: 1.5, color: C.ink2, cursor: "pointer" }}>
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: C.violet, flexShrink: 0 }} />
          I am the pharmacist on duty. I reviewed the patient list, the voicemail{follow ? " and the follow-up messages" : ""}. Anyone the calls cannot reach goes to my call list.
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={back} style={btn("ghost", { minHeight: 50 })}>Back</button>
          <button onClick={() => attest && send.mutate()} aria-disabled={!attest} disabled={send.isPending} style={{ minHeight: 50, padding: "0 24px", borderRadius: 10, border: 0, fontWeight: 600, fontSize: 15, ...(attest ? { background: C.red, color: "#fff" } : { background: C.line2, color: C.dimmer, cursor: "not-allowed" }) }}>{send.isPending ? "Starting calls…" : `Start ${v.callCount} calls${follow && imp.messageCount ? ` + ${imp.messageCount} messages` : ""}`}</button>
        </div>
      </section>
      <p style={{ margin: 0, fontSize: 12, color: C.dimmer }}>Sandbox: nothing is dialled or sent. Each call is rendered to speech and its outcome simulated; texts and emails go to the demo outbox.</p>
    </div>
  );
}

function Done({ r, onChange }: { r: any; onChange: () => void }) {
  const res = useQuery({ queryKey: ["recall-results", r.id], queryFn: () => get(`/api/recalls/${r.id}/results`), refetchInterval: 2000 });
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const act = (path: string, ok: string) => async () => { try { await post(`/api/recalls/${r.id}/${path}`); setNote(ok); setErr(""); onChange(); void res.refetch(); } catch (e) { setErr(msg(e)); } };
  const reset = useMutation({ mutationFn: () => post("/api/demo/reset"), onSuccess: () => window.location.reload() });
  const x = res.data;
  if (!x) return <p style={{ color: C.dim }}>Loading…</p>;
  const has = (k: string) => x.actions.some((a: any) => a.kind === k);
  const nextBtn = { textAlign: "left", padding: 16, borderRadius: 12, border: `1px solid ${C.line2}`, background: C.well, color: C.ink, display: "flex", flexDirection: "column", gap: 4, minHeight: 80, textDecoration: "none" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ background: "var(--ok-soft)", border: "1px solid var(--ok)", borderRadius: 16, padding: 28, display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
        {Icon.okBig(52)}
        <div style={{ flex: "1 1 400px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Patients contacted for recall {r.id}</h2>
          <p style={{ margin: 0, fontSize: 15, color: "var(--ok-text)" }}>Sent by {x.sentBy || "the pharmacist"}{x.sentAt ? ` · ${when(x.sentAt)}` : ""} · saved to the recall audit log{x.status === "closed" ? " · recall closed" : ""}</p>
        </div>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {[
          ["Calls", `${x.voice.answered + x.voice.voicemail} / ${x.voice.total}`, `${x.voice.answered} answered · ${x.voice.voicemail} voicemail${x.voice.retrying ? ` · ${x.voice.retrying} retry tomorrow` : ""}`, C.green2],
          ["Text messages", `${x.sms.delivered} / ${x.sms.total}`, `delivered${x.sms.sent ? ` · ${x.sms.sent} pending` : ""}${x.sms.failed ? ` · ${x.sms.failed} failed` : ""}`, C.green2],
          ["Emails", `${x.email.sent} / ${x.email.total}`, "sent", C.green2],
          ["Pharmacist call list", String(x.voice.started ? x.voice.callList.length : x.callList.length), (x.voice.started ? x.voice.callList : x.callList).map((c: any) => c.name).join(" · ") || "nobody", C.amber2],
          ["Quarantined stock", String(x.quarantined), `units in ${x.location.replace("Quarantine ", "")}`, C.dim]
        ].map(([k, v, sub, col]) => (
          <div key={k} style={{ ...sec, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: C.dim }}>{k}</span><span style={{ fontSize: 28, fontWeight: 600 }}>{v}</span><span style={{ fontSize: 13, color: col }}>{sub}</span>
          </div>
        ))}
      </div>
      {x.voice.started && <CallLog calls={x.voice.calls} />}
      <section aria-labelledby="next" style={{ ...sec, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="next" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>What's next</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <button disabled={has("return_pickup")} onClick={act("return-pickup", "Return pickup booked with the reverse distributor (sandbox). Units moved to RTV-1.")} style={nextBtn}>
            <span style={{ fontWeight: 600 }}>{has("return_pickup") ? "✓ Return pickup scheduled" : "Schedule return pickup"}</span><span style={{ fontSize: 13, color: C.dim }}>{x.quarantined} units to the reverse distributor</span>
          </button>
          <button disabled={has("manufacturer_response")} onClick={act("manufacturer-response", "Response written to the sandbox outbox.")} style={nextBtn}>
            <span style={{ fontWeight: 600 }}>{has("manufacturer_response") ? "✓ Response sent to the manufacturer" : "Send response to the manufacturer"}</span><span style={{ fontSize: 13, color: C.dim }}>Quantities found and patients notified</span>
          </button>
          <a href={`/api/recalls/${r.id}/report.pdf`} style={nextBtn}>
            <span style={{ fontWeight: 600 }}>Download audit report</span><span style={{ fontSize: 13, color: C.dim }}>PDF of every lot, patient and message</span>
          </a>
        </div>
        {note && <p role="status" style={{ margin: 0, fontSize: 14, color: C.green2 }}>{note}</p>}
        <ErrorBox e={err} />
      </section>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => reset.mutate()} style={btn("ghost", { minHeight: 44 })}>Replay demo</button>
        <button disabled={x.status === "closed"} onClick={act("close", "Recall closed. The lots stay blocked at receiving and fill.")} style={btn("ghost", { minHeight: 44, opacity: x.status === "closed" ? 0.5 : 1 })}>{x.status === "closed" ? "Recall closed" : "Close this recall"}</button>
      </div>
    </div>
  );
}

const OUTCOME: Record<string, [string, string]> = { answered: ["Answered · transferred", "chip ok"], voicemail: ["Voicemail left", "chip ok"], no_answer: ["No answer", "chip warn"], retry_due: ["Retry tomorrow", "chip warn"], queued: ["Waiting for window", "chip"], call_list: ["Pharmacist call list", "chip bad"] };

function CallLog({ calls }: { calls: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const play = (c: any) => {
    if (c.audioId) { const a = new Audio(`/api/audio/${c.audioId}`); void a.play(); } else speak(c.script);
    setOpen(c.id);
  };
  return (
    <section className="card" aria-labelledby="calls" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", flexWrap: "wrap", gap: 8 }}><h2 id="calls" className="h2">Call log</h2><span className="label">Sandbox outcomes · every attempt kept for the manufacturer's effectiveness check</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="t" style={{ minWidth: 760 }}>
          <thead><tr><th scope="col">Patient</th><th scope="col">Attempt</th><th scope="col">Outcome</th><th scope="col">Note</th><th scope="col">Recording</th></tr></thead>
          <tbody>
            {calls.map((c) => {
              const [label, cls] = OUTCOME[c.outcome] ?? [c.outcome, "chip"];
              return (
                <tr key={c.id}>
                  <td><span style={{ fontWeight: 500 }}>{c.name}</span><div className="label mono">{c.patientId} · {c.phone || "no phone"}</div></td>
                  <td>{c.attempt}</td>
                  <td><span className={cls}>{label}</span></td>
                  <td className="sub">{c.note}</td>
                  <td>{c.script && c.outcome !== "call_list" ? <button className="btn" onClick={() => play(c)} aria-label={`Play the message for ${c.name}`}>{open === c.id ? "▶ Again" : "▶ Play"}</button> : "—"}{c.voice && <div className="label">{String(c.voice).split(":").slice(1).join(":")}</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
