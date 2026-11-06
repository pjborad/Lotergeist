import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Arrow, Empty, Footer, Warn } from "../components/bits";
import { useCurrentRecall } from "../lib/current";
import { useRecall, useRecallStream, useTrace } from "../lib/hooks";
import type { PipelineEvent, RpaStepView } from "../lib/types";

const BUSY = new Set(["confirmed", "tracing", "exhuming"]);

function Join() {
  return (
    <div aria-hidden="true" className="stage-join">
      <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
        <path d="M0 10h28" stroke="#5c6a52" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M6 5l3 10M14 5l3 10M22 5l-3 10" stroke="#8f8a7b" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function FaxSheet({ step, count }: { step: RpaStepView | null; count: number }) {
  if (!step?.screen) {
    return <div className="fax-empty">No fax opened yet.<br />The Grave Robber reads the inbox after the terminals.</div>;
  }
  const lines = step.screen.split("\n").map((l) => l.trim()).filter(Boolean);
  const from = lines.find((l) => l.startsWith("FROM")) ?? "";
  const title = lines.find((l) => /^Dispense Log/i.test(l)) ?? "Dispense Log";
  const body = lines.filter((l) => l !== from && l !== title && !/^PG\b/.test(l) && !l.startsWith("-- END")).join("\n");
  return (
    <div className="fax-stack">
      <div aria-hidden="true" className="fax-back" />
      <div className="fax-sheet rise" key={step.seq}>
        <div className="top"><span>{from.replace(/PG.*$/, "").trim()}</span><span>PG 1/1</span></div>
        <div className="t">{title}</div>
        <pre>{body}</pre>
        <div className="ocr">text layer · {(body.match(/^Rx /gm) ?? []).length} rows · parse conf {(step.confidence ?? 1).toFixed(2)}</div>
      </div>
      <span className="sr-only">{count} fax(es) read</span>
    </div>
  );
}

export default function BodyTrail() {
  const { id } = useCurrentRecall();
  const { data: recall } = useRecall(id);
  const busy = !!recall && BUSY.has(recall.status);
  const { data: trace } = useTrace(id, busy);
  const [live, setLive] = useState<RpaStepView[]>([]);
  const [filter, setFilter] = useState<"all" | "rxterm" | "fax">("all");

  useEffect(() => setLive([]), [id]);
  useRecallStream(id, (e: PipelineEvent) => {
    if (e.type === "rpa.step") setLive((l) => [...l.slice(-300), e.data as RpaStepView]);
  });

  const steps = useMemo(() => {
    const base = trace?.steps ?? [];
    const seen = new Set(base.map((s) => s.seq));
    return [...base, ...live.filter((s) => !seen.has(s.seq))];
  }, [trace?.steps, live]);

  const termStep = [...steps].reverse().find((s) => s.system === "rxterm" && s.screen);
  // prefer the latest fax that was actually exhumed, not one the bot skipped as "not recalled"
  const faxStep = [...steps].map((s, i) => ({ s, next: steps[i + 1] })).reverse().find((x) => x.s.action === "fax" && x.s.screen && x.next?.action !== "skip")?.s ?? [...steps].reverse().find((x) => x.action === "fax" && x.screen) ?? null;
  const lastMsg = steps.at(-1);
  const faxCount = steps.filter((s) => s.action === "fax").length;

  const rows = (trace?.dispenses ?? []).filter((r) => filter === "all" || r.source === filter);
  const nTerm = (trace?.dispenses ?? []).filter((r) => r.source === "rxterm").length;
  const nFax = (trace?.dispenses ?? []).filter((r) => r.source === "fax").length;

  if (!id || !recall) return <main className="main tight"><Empty>Loading the trail…</Empty></main>;

  const notStarted = !trace?.traced;
  return (
    <main className="main tight">
      <section className="row-between">
        <div style={{ flex: "1 1 640px", minWidth: 0 }}>
          <p className="eyebrow">II · Chain of custody · lot {trace?.lotLabel ?? "—"}</p>
          <h1 className="display">The Body Trail</h1>
          <p className="lede">Stitched from GS1 EPCIS 2.0 events and records the bot exhumed from systems with no API. Each grave marker is one hand the lot passed through.</p>
        </div>
        <div className="chips" aria-label="Trace totals">
          <span className="chip">{trace?.serials ?? 0} serials</span>
          <span className="chip">{trace?.orphans ?? 0} orphans</span>
          <span className="chip hot">{trace?.inPatientHands ?? 0} in patient hands</span>
        </div>
      </section>

      {recall.status === "error" && <Warn>The hunt stopped: {recall.error ?? "unknown error"}. Go back to the death notice and try again.</Warn>}
      {notStarted && recall.status !== "error" && (
        <Empty action={<Link className="btn" to={`/?r=${encodeURIComponent(recall.id)}`}>Back to the death notice <Arrow /></Link>}>
          {recall.recallNumber} has not been confirmed yet. A pharmacist confirms every tag, then the trail appears here.
        </Empty>
      )}

      {!notStarted && trace && (
        <>
          <section aria-labelledby="trail">
            <h2 id="trail" className="sr-only">Trail of custody events</h2>
            <ol className="stages">
              {trace.stages.map((n, k) => (
                <li key={n.key}>
                  <div className={`stage ${n.hot ? "hot" : ""}`}>
                    <div className="top"><span className="biz">{n.label}</span><span className={`src ${n.source === "RPA" ? "rpa" : n.source === "LIVE" ? "live" : ""}`}>{n.source}</span></div>
                    <div className="who">{n.who}</div>
                    <div className="where">{n.where}</div>
                    <div className="foot"><span>{n.when}</span><span className="c">{n.countLabel}</span></div>
                  </div>
                  {k < trace.stages.length - 1 && <Join />}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="exhume" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="exh-head">
              <div>
                <p className="eyebrow sm">AGENT · GRAVE ROBBER · PLAYWRIGHT</p>
                <h2 id="exhume">The exhumation</h2>
              </div>
              <span className="note">Legacy rows become EPCIS <code>dispensing</code> events.</span>
            </div>
            <div className="crt-wrap">
              <figure className="crt-frame">
                <div className="crt" aria-live="off">
                  <div aria-hidden="true" className="lines" />
                  <div aria-hidden="true" className="scanline sweep" />
                  <pre>{termStep?.screen?.replace(/\n{2,}/g, "\n") ?? "RxTERM 98  v4.2  ** STANDBY **\n────────────────────────────────────────────────\nWAITING FOR THE BOT TO SIGN ON…"}</pre>
                  <pre style={{ marginTop: 10 }}>BOT&gt; {lastMsg?.message ?? "idle"}<span className="cursor">█</span></pre>
                </div>
                <figcaption className="crt-cap">
                  <span className="mono">RxTerm 98 · mock green-screen · no API</span>
                  <span className="st"><span aria-hidden="true" className={`led ${busy ? "" : "off"}`} />{busy ? "bot working" : trace.exhumed ? "bot finished" : "bot standby"}</span>
                </figcaption>
              </figure>
              <figure className="fax">
                <figcaption className="fax-cap"><span>FAX CRYPT · INBOX</span><span>{faxCount} read</span></figcaption>
                <FaxSheet step={faxStep} count={faxCount} />
              </figure>
            </div>
          </section>

          <section aria-labelledby="rows" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="row-between" style={{ alignItems: "center" }}>
              <h2 id="rows" className="sc" style={{ fontSize: 26 }}>Exhumed dispenses</h2>
              <div role="group" aria-label="Filter by source" className="filter">
                {([["all", `All ${trace.dispenses.length}`], ["rxterm", `RxTerm 98 ${nTerm}`], ["fax", `Fax ${nFax}`]] as const).map(([k, label]) => (
                  <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th scope="col">RX #</th><th scope="col">PATIENT</th><th scope="col">LOT · SERIAL</th><th scope="col">FILLED</th><th scope="col">RISEN FROM</th><th scope="col">EPCIS EVENT</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ color: "var(--dim)" }}>{busy ? "The bot is still digging…" : "No dispenses exhumed yet."}</td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={`${r.rx}-${r.serial}`}>
                      <td className="m">{r.rx}</td>
                      <td><span className="patient"><svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden="true"><path d="M2 15V6a5 5 0 0110 0v9z" stroke="#a9a392" strokeWidth="1.3" /></svg>{r.patientId}</span></td>
                      <td className="lotcell" title={r.serialInferred ? "Serial inferred: oldest on-shelf package of this lot at that pharmacy" : undefined}>{r.lot} · {r.serial || "unassigned"}</td>
                      <td style={{ color: "var(--dim)" }}>{new Date(r.fillDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</td>
                      <td><span className={r.source === "fax" ? "src-fax" : "src-term"}>{r.source === "fax" ? "Fax" : "RxTerm 98"}</span></td>
                      <td className="ev">{r.eventWritten ? "✓ bizStep: dispensing" : "– no serial to write"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tfoot">
              <span>Patient IDs are synthetic (Synthea). Names appear only to the pharmacist on duty.</span>
              <Link className="btn" to={`/scan?r=${encodeURIComponent(recall.id)}`}>Check a package on the shelf <Arrow /></Link>
            </div>
          </section>
        </>
      )}
      <Footer />
    </main>
  );
}
