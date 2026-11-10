import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { dateLabel, get, msg, post, type User } from "../lib/api";
import { PageHeader } from "../components/Shell";
import { ErrorBox, when } from "../components/kit";

interface Match { id: string; name: string; dob: string }
interface Profile {
  patient: { id: string; name: string; dob: string; phone: string | null; email: string | null; preferred: string; allergies: string[]; conditions: string[]; consents: { sms: boolean; email: boolean; voice: boolean } };
  safety: { title: string; body: string; kind: "Act" | "Monitor" | "Pass"; level: "warn" | "info" | "ok" }[];
  history: { date: string; drug: string; sig: string; prescriber: string; lot: string; status: string }[];
  refills: { due: string; dueLabel: string; drug: string; overdue: boolean; note: string; left: string }[];
  openOrders: { rx: string; drug: string; status: string; review: string }[];
  accessLog: { at: number; by: string; reason: string }[];
}
const REASONS = ["Dispensing", "Patient question", "Refill review", "Recall follow-up", "Prescriber call"];
const usDob = (iso: string) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
const STATUS_CHIP: Record<string, string> = { Active: "chip ok", "Refill late": "chip warn", Completed: "chip", Replaced: "chip" };

export function Patients({ user }: { user: User }) {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [term, setTerm] = useState(sp.get("q") ?? "");
  const [picked, setPicked] = useState<string | null>(sp.get("id"));
  const [reason, setReason] = useState("");
  const [opened, setOpened] = useState<{ id: string; reason: string } | null>(null);
  const [tab, setTab] = useState<"safety" | "history" | "refills">("safety");
  const [sync, setSync] = useState<{ syncDate: string | null; note: string } | null>(null);
  const [err, setErr] = useState("");

  const search = useQuery({ queryKey: ["psearch", term], queryFn: () => get<{ matches: Match[] }>(`/api/patients?q=${encodeURIComponent(term)}`), enabled: term.trim().length >= 2 });
  const profile = useQuery({
    queryKey: ["patient", opened?.id, opened?.reason],
    queryFn: () => get<Profile>(`/api/patients/${opened!.id}?reason=${encodeURIComponent(opened!.reason)}`),
    enabled: !!opened, staleTime: Infinity
  });
  const syncM = useMutation({ mutationFn: (id: string) => post<{ syncDate: string | null; note: string }>(`/api/patients/${id}/refill-sync`), onSuccess: setSync, onError: (e) => setErr(msg(e)) });
  const p = profile.data;
  const act = p?.safety.filter((f) => f.kind === "Act").length ?? 0, mon = p?.safety.filter((f) => f.kind === "Monitor").length ?? 0;
  const active = p?.history.filter((h) => h.status === "Active" || h.status === "Refill late").length ?? 0;

  const open = (id: string, r: string) => { setOpened({ id, reason: r }); setSync(null); setSp({ id, ...(term ? { q: term } : {}) }); };

  return (
    <>
      <PageHeader crumb="Care · Patients" title={p ? p.patient.name : "Patients"} sub="Search by name, date of birth, phone or Rx number. Every profile view is logged." />
      <main className="page">
        <form className="card pad" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q); setPicked(null); setOpened(null); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label htmlFor="psearch" className="label">Find a patient</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input id="psearch" className="field" style={{ flex: "1 1 320px" }} placeholder="Daniel Brooks · 03/14/1968 · 0072210" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary big" type="submit">Search</button>
          </div>
          {search.data && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Matches">
              {search.data.matches.length === 0 && <span className="sub">No patient matches “{term}”.</span>}
              {search.data.matches.map((m) => (
                <button key={m.id} type="button" className={`pill${(picked ?? opened?.id) === m.id ? " on" : ""}`} onClick={() => { setPicked(m.id); setOpened(null); }}>{m.name} · {usDob(m.dob)}</button>
              ))}
            </div>
          )}
        </form>

        {picked && !opened && (
          <form className="card pad enter" onSubmit={(e) => { e.preventDefault(); open(picked, reason); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="h2">Why are you opening this profile?</h2>
            <p className="sub">The reason is saved in the audit log with your name, the time and this workstation.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {REASONS.map((r) => <button type="button" key={r} className={`pill${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}
            </div>
            <input aria-label="Reason" className="field" placeholder="Or type a reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div><button className="btn primary" disabled={reason.trim().length < 3} type="submit">Open profile</button></div>
          </form>
        )}

        {profile.isError && <ErrorBox e={msg(profile.error)} />}
        <ErrorBox e={err} />

        {p && (
          <>
            <section className="card pad enter" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
              <div style={{ flex: "1 1 360px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span className="av" style={{ width: 52, height: 52, fontSize: 16 }}>{p.patient.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <h2 className="h2" style={{ fontSize: 20 }}>{p.patient.name}</h2>
                  <span className="sub">DOB {usDob(p.patient.dob)} · Patient {p.patient.id} · prefers {p.patient.preferred === "sms" ? "text" : p.patient.preferred}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {p.patient.allergies.map((a) => <span key={a} className="chip bad">{a[0]!.toUpperCase() + a.slice(1)} allergy</span>)}
                    {p.patient.conditions.map((c) => <span key={c} className="chip info">{c}</span>)}
                    {p.patient.phone && <span className="chip">{p.patient.phone}{p.patient.consents.sms ? " · text OK" : ""}{p.patient.consents.voice ? " · calls OK" : " · no automated calls"}</span>}
                    {p.patient.email && <span className="chip">{p.patient.email}</span>}
                  </div>
                </div>
              </div>
              <div className="kv" style={{ flex: "1 1 360px" }}>
                <div><div style={{ fontSize: 24, fontWeight: 600 }}>{active}</div><div className="label">Active medicines</div></div>
                <div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--warn-text)" }}>{p.refills.filter((r) => r.overdue).length}</div><div className="label">Refill overdue</div></div>
                <div><div style={{ fontSize: 24, fontWeight: 600, color: p.safety.some((f) => f.title === "Recall exposure" && f.kind === "Act") ? "var(--danger-text)" : "var(--ok-text)" }}>{p.safety.some((f) => f.title === "Recall exposure" && f.kind === "Act") ? "Yes" : "0"}</div><div className="label">Recalled lots received</div></div>
              </div>
            </section>

            {p.openOrders.length > 0 && (
              <div className="finding" style={{ flexWrap: "wrap" }}>
                <span className="ico sm accent" aria-hidden="true">Rx</span>
                <span style={{ flex: 1 }} className="sub">Open order{p.openOrders.length > 1 ? "s" : ""}: {p.openOrders.map((o) => <a key={o.rx} href={`#/fill?rx=${o.rx}`} style={{ marginRight: 10 }}>Rx {o.rx} · {o.drug.split(" · ")[0]} ({o.review === "pending" ? "needs review" : o.review.replace("_", " ")})</a>)}</span>
              </div>
            )}

            <div className="tabs" role="tablist" aria-label="Patient views">
              {([["safety", "Safety review"], ["history", "Medication history"], ["refills", "Upcoming refills"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            {tab === "safety" && (
              <section className="card pad enter" style={{ display: "flex", flexDirection: "column", gap: 14 }} role="tabpanel">
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div><h3 className="h2">Rx Watcher · past vs current medicines</h3><p className="sub">Checked against 2 years of fills here and open orders. Rules-based; the pharmacist confirms.</p></div>
                  <span className={`chip ${act ? "warn" : "ok"}`}>{act} to act on · {mon} to monitor</span>
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.safety.map((f, i) => (
                    <li key={i} className={`finding${f.level === "warn" ? " warn" : ""}`}>
                      <span className={`ico sm ${f.level}`} aria-hidden="true">{f.level === "warn" ? "!" : f.level === "info" ? "i" : "✓"}</span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</span><span className="sub">{f.body}</span></span>
                      <span className="label" style={{ whiteSpace: "nowrap" }}>{f.kind}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {tab === "history" && (
              <section className="card enter" style={{ overflow: "hidden" }} role="tabpanel">
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "18px 20px" }}><h3 className="h2">Medication history</h3><span className="label">Newest first · lot saved on every fill</span></div>
                <div style={{ overflowX: "auto" }}>
                  <table className="t" style={{ minWidth: 860 }}>
                    <thead><tr><th scope="col">Filled</th><th scope="col">Medicine</th><th scope="col">Directions</th><th scope="col">Prescriber</th><th scope="col">Lot</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {p.history.map((h, i) => (
                        <tr key={i}><td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{dateLabel(h.date)}</td><td style={{ fontWeight: 500 }}>{h.drug}</td><td style={{ color: "var(--muted)" }}>{h.sig}</td><td style={{ color: "var(--muted)" }}>{h.prescriber}</td><td className="mono">{h.lot || "—"}</td><td><span className={STATUS_CHIP[h.status] ?? "chip"}>{h.status}</span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {tab === "refills" && (
              <section className="card pad enter" style={{ display: "flex", flexDirection: "column", gap: 14 }} role="tabpanel">
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}><h3 className="h2">Upcoming refills</h3><span className="label">From days supply and fill dates</span></div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.refills.map((r, i) => (
                    <li key={i} className="finding" style={{ flexWrap: "wrap", alignItems: "center" }}>
                      <span className={`chip ${r.overdue ? "warn" : "accent"}`} style={{ minWidth: 76, justifyContent: "center" }}>{r.dueLabel}</span>
                      <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontWeight: 600 }}>{r.drug}</span><span className="sub">{r.note}</span></span>
                      <span className="label">{r.left}</span>
                    </li>
                  ))}
                  {p.refills.length === 0 && <li className="sub">No active medicines with a days supply.</li>}
                </ul>
                {user.role === "pharmacist" && p.refills.length > 1 && (
                  <div style={{ padding: 16, borderRadius: 14, background: "var(--accent-soft)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, lineHeight: 1.5, flex: "1 1 320px" }}><strong style={{ color: "var(--accent-text)" }}>Refill sync</strong> · {sync ? sync.note : "Line up refills so the patient makes one trip a month."}</span>
                    <button className="btn primary" disabled={syncM.isPending} onClick={() => syncM.mutate(p.patient.id)}>{sync ? "Recalculate" : "Suggest a sync date"}</button>
                  </div>
                )}
              </section>
            )}

            <p className="label" style={{ margin: 0 }}>
              Access logged: {p.accessLog.map((a) => `${a.by} · ${when(a.at)} · reason: ${a.reason}`).join("  |  ")}. Synthetic data.
            </p>
          </>
        )}
      </main>
    </>
  );
}
