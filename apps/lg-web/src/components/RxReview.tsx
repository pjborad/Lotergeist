import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post, type User } from "../lib/api";
import { ErrorBox } from "./kit";

export interface Finding { id: number; rule: string; severity: "pass" | "monitor" | "needs_review" | "block"; title: string; body: string; source: "rule" | "llm" }
export interface Review { rx: string; checked: boolean; review: string; badge: string; flags: number; findings: Finding[]; summary: string; llm: { used: boolean; model: string | null; error: string | null } }
interface Message { id: number; rx: string; type: string; scriptId: string; prescriber: string; body: string; status: string; createdAt: number; respondedAt: number | null; proposal?: { directions: string; daysSupply: number | null }; response?: { by: string; newRx: string | null; note: string | null } }

const KIND: Record<Finding["severity"], [string, string, string, string]> = {
  block: ["Block", "bad", "!", "finding bad"], needs_review: ["Needs review", "warn", "!", "finding warn"], monitor: ["Monitor", "info", "i", "finding"], pass: ["Pass", "ok", "✓", "finding"]
};

export function FindingRow({ f }: { f: { title: string; body: string; severity: Finding["severity"]; source?: string } }) {
  const [label, tone, mark, row] = KIND[f.severity];
  return (
    <li className={row}>
      <span className={`ico sm ${tone}`} aria-hidden="true">{mark}</span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{f.title}</span>
          <span className={`chip ${tone}`}><span className="sr">Severity: </span>{label}{f.source === "llm" ? " · AI" : ""}</span>
        </span>
        <span className="sub">{f.body}</span>
      </div>
    </li>
  );
}

/** Step 1 of Fill & pickup: Rx Watcher findings, the pharmacist's decision, and the prescriber change loop. */
export function RxReview({ rx, user, onNewRx }: { rx: string; user: User; onNewRx: (rx: string) => void }) {
  const qc = useQueryClient();
  const review = useQuery({ queryKey: ["review", rx], queryFn: () => get<Review>(`/api/rx/${rx}/review`) });
  const msgs = useQuery({ queryKey: ["pmsg", rx], queryFn: () => get<Message[]>(`/api/prescriber-messages?rx=${encodeURIComponent(rx)}`), refetchInterval: 8000 });
  const [mode, setMode] = useState<"view" | "compose" | "approve" | "reject">("view");
  const [err, setErr] = useState("");
  const [message, setMessage] = useState("");
  const [directions, setDirections] = useState("");
  const [days, setDays] = useState<string>("");
  const [reason, setReason] = useState("");
  useEffect(() => { setMode("view"); setErr(""); setReason(""); }, [rx]);
  const refresh = () => ["review", "pmsg", "rx", "rxq"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const on = { onSuccess: () => { setErr(""); setMode("view"); refresh(); }, onError: (e: unknown) => setErr(msg(e)) };

  const run = useMutation({ mutationFn: () => post<Review>(`/api/rx/${rx}/review`), ...on });
  const compose = useMutation({
    mutationFn: () => get<{ message: string; proposal: { directions: string; daysSupply: number | null } }>(`/api/rx/${rx}/change-draft`),
    onSuccess: (d) => { setMessage(d.message); setDirections(d.proposal.directions); setDays(d.proposal.daysSupply ? String(d.proposal.daysSupply) : ""); setMode("compose"); setErr(""); },
    onError: (e) => setErr(msg(e))
  });
  const decide = useMutation({ mutationFn: (b: unknown) => post(`/api/rx/${rx}/decision`, b), ...on });
  const reply = useMutation({
    mutationFn: (b: { id: number; response: "approved" | "denied" }) => post<{ newRx: string | null }>(`/api/prescriber-messages/${b.id}/respond`, { response: b.response }),
    onSuccess: (r) => { refresh(); if (r.newRx) onNewRx(r.newRx); },
    onError: (e) => setErr(msg(e))
  });

  const r = review.data;
  if (!r) return <div className="card pad"><p className="sub">{review.isLoading ? "Loading Rx Watcher…" : "Could not load the review."}</p></div>;
  const pharmacist = user.role === "pharmacist";
  const open = (msgs.data ?? []).find((m) => m.status === "sent");
  const badgeTone = !r.checked ? "warn" : r.flags ? "warn" : "ok";
  const decided = ["approved", "rejected", "on_hold"].includes(r.review);

  return (
    <section className="card pad enter" aria-labelledby="rxw" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="ico accent" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z" /><circle cx="10" cy="10" r="2.5" /></svg></span>
          <div><h2 id="rxw" className="h2">Rx Watcher</h2><p className="sub">Rules first{r.llm.used ? `, explained by ${r.llm.model}` : ""}. Advisory only: a pharmacist decides.</p></div>
        </div>
        <span className={`chip ${badgeTone}`}>{r.review === "approved" ? "Approved by pharmacist" : r.review === "on_hold" ? "On hold · prescriber" : r.review === "rejected" ? "Rejected" : r.badge}</span>
      </div>

      {!r.checked && (
        <div className="finding warn" role="status">
          <span className="ico sm warn" aria-hidden="true">!</span>
          <div style={{ flex: 1 }}><strong style={{ fontSize: 14 }}>Not checked yet</strong><p className="sub">Run Rx Watcher before filling. If it cannot run, review the order by hand.</p></div>
          <button className="btn primary" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Checking…" : "Run Rx Watcher"}</button>
        </div>
      )}
      {r.summary && r.checked && <p className="sub" style={{ fontSize: 14, color: "var(--text)" }}>{r.summary}</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {r.findings.map((f) => <FindingRow key={f.id} f={f} />)}
      </ul>
      {r.llm.error && <p className="label">AI explainer unavailable ({r.llm.error}). Rule results above are complete.</p>}
      <ErrorBox e={err} />

      {/* the prescriber channel */}
      {(msgs.data ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
          <h3 className="h2" style={{ fontSize: 14, marginTop: 10 }}>Prescriber messages <span className="chip" style={{ marginLeft: 6 }}>Sandbox · NCPDP SCRIPT</span></h3>
          {(msgs.data ?? []).slice().reverse().map((m) => (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="bubble me"><span className="label" style={{ color: "inherit", opacity: .85, display: "block", marginBottom: 4 }}>RxChangeRequest · {m.scriptId}</span>{m.body}</div>
              {m.status === "sent" ? <span className="chip warn" style={{ alignSelf: "flex-end" }}><span className="dot pulse" />Waiting for {m.prescriber}</span>
                : <div className="bubble them"><span className="label" style={{ display: "block", marginBottom: 4 }}>RxChangeResponse · {m.response?.by}</span>
                    {m.status === "approved" ? `Approved. New order ${m.response?.newRx}: "${m.proposal?.directions}"${m.proposal?.daysSupply ? `, ${m.proposal.daysSupply} days supply` : ""}.` : `Denied${m.response?.note ? `: ${m.response.note}` : "."}`}</div>}
            </div>
          ))}
          {open && pharmacist && (
            <div className="finding" style={{ flexWrap: "wrap" }}>
              <p className="sub" style={{ flex: "1 1 260px" }}>Sandbox: no prescriber system is connected for this demo. Record the reply you received, or let the practice system answer over <span className="mono">POST /v1/change-requests/{open.id}/response</span>.</p>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="btn success" disabled={reply.isPending} onClick={() => reply.mutate({ id: open.id, response: "approved" })}>Prescriber approved</button>
                <button className="btn" disabled={reply.isPending} onClick={() => reply.mutate({ id: open.id, response: "denied" })}>Prescriber denied</button>
              </span>
            </div>
          )}
        </div>
      )}

      {/* decisions */}
      {pharmacist && r.checked && !decided && mode === "view" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {r.flags > 0 && <button className="btn primary big" disabled={compose.isPending} onClick={() => compose.mutate()}>Ask prescriber to change</button>}
          <button className={`btn big ${r.flags ? "" : "primary"}`} onClick={() => (r.flags ? setMode("approve") : decide.mutate({ action: "approve" }))} disabled={r.findings.some((f) => f.severity === "block")}>{r.flags ? "Approve as written…" : "Approve and fill"}</button>
          <button className="btn big outline-bad" onClick={() => setMode("reject")}>Reject…</button>
        </div>
      )}
      {!pharmacist && r.checked && r.review === "pending" && <p className="sub">A pharmacist must review this order before it can be filled.</p>}

      {mode === "compose" && (
        <form className="enter" onSubmit={(e) => { e.preventDefault(); decide.mutate({ action: "change", message, proposal: { directions, daysSupply: days ? Number(days) : null } }); }} style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <h3 className="h2">Change request to the prescriber</h3>
          <label className="label" htmlFor="cr-msg">Message (you can edit it)</label>
          <textarea id="cr-msg" className="field" rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2" }}><label className="label" htmlFor="cr-dir">Proposed directions</label><input id="cr-dir" className="field" value={directions} onChange={(e) => setDirections(e.target.value)} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label className="label" htmlFor="cr-days">Days supply</label><input id="cr-days" className="field" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} /></div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" className="btn primary" disabled={decide.isPending || message.trim().length < 20}>Send change request</button>
            <button type="button" className="btn ghost" onClick={() => setMode("view")}>Back to review</button>
          </div>
          <p className="label">Sent as RxChangeRequest plus a secure message (sandbox). The order stays on hold until the prescriber answers.</p>
        </form>
      )}
      {(mode === "approve" || mode === "reject") && (
        <form className="enter" onSubmit={(e) => { e.preventDefault(); decide.mutate({ action: mode, reason }); }} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <label className="label" htmlFor="dec-reason">{mode === "approve" ? "Why approve with open findings? (saved for quality review)" : "Why reject this order?"}</label>
          <input id="dec-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" className={`btn ${mode === "approve" ? "primary" : "danger"}`} disabled={reason.trim().length < 5 || decide.isPending}>{mode === "approve" ? `Approve as ${user.name}` : "Reject order"}</button>
            <button type="button" className="btn ghost" onClick={() => setMode("view")}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
