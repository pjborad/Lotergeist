import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Arrow, Empty, Footer, Warn, fmtConf } from "../components/bits";
import { post } from "../lib/api";
import { useCurrentRecall } from "../lib/current";
import { useRecall, useRecalls } from "../lib/hooks";
import { play } from "../lib/sound";
import type { LotView, RecallSummary } from "../lib/types";

const STEPS = [
  { n: "i", name: "Ingest", tech: "openFDA", body: "Night Watch polls enforcement reports. Paste one when the network is dead." },
  { n: "ii", name: "Extract", tech: "LLM + regex", body: "Free-text code_info becomes NDC, lots and expiry, each with a confidence." },
  { n: "iii", name: "Trace", tech: "EPCIS 2.0", body: "Every serial in the lot, followed from factory to shelf through DSCSA events." },
  { n: "iv", name: "Exhume", tech: "RPA", body: "A bot digs dispense records out of a 1998 terminal and a fax inbox." },
  { n: "v", name: "Act", tech: "OSRM + NWS", body: "Quarantine, outreach drafts, shortage risk and a temperature-safe hearse run." }
];

const dotColor = (c: RecallSummary["classification"]) => (c === "I" ? "#ff6b4a" : "#e8b94a");

function Tag({ lot, witnessed, onToggle }: { lot: LotView; witnessed: boolean; onToggle: () => void }) {
  const pct = Math.round(lot.confidence * 100);
  return (
    <div className={`tag rise ${lot.needsWitness && !witnessed ? "witness" : ""}`}>
      <div className="tag-eyelet"><i aria-hidden="true" /></div>
      <div className="tag-body">
        <div style={{ gridColumn: "1 / span 2" }}>
          <div className="k">TOE TAG · LOT</div>
          <div className="lot">{lot.value}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="k">CONFIDENCE</div>
          <div className="conf" title={`source: ${lot.source}`}>{fmtConf(lot.confidence)}</div>
        </div>
        <div><div className="k">NDC</div><div className="v">{lot.ndc || "—"}</div></div>
        <div><div className="k">EXPIRY / BUD</div><div className="v">{lot.expiry || "not on label"}</div></div>
        <div><div className="k">SERIALS</div><div className="v">{lot.serials === null ? "after the hunt" : `${lot.serials} traced`}</div></div>
        <div className="bar"><i style={{ width: `${pct}%`, background: pct >= 95 ? "#3f7a1a" : "#a8641a" }} /></div>
        {lot.needsWitness && (
          <button type="button" className="witness-btn" aria-pressed={witnessed} onClick={onToggle}>
            {witnessed ? "✓ A living witness confirmed this tag" : "Needs a living witness: tap to confirm"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CryptGate() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { id, setId } = useCurrentRecall();
  const { data: recalls } = useRecalls();
  const { data: cur } = useRecall(id);
  const [witnessed, setWitnessed] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState("");

  const refresh = () => qc.invalidateQueries();

  const judge = useMutation({
    mutationFn: (prerun: boolean) => post<{ demoId: string }>("/api/demo/reset", { prerun }),
    onSuccess: async (r, prerun) => {
      play("bell");
      setWitnessed(new Set());
      await refresh();
      setId(r.demoId);
      if (prerun) nav(`/trail?r=${r.demoId}`);
    }
  });

  const summon = useMutation({
    mutationFn: (input: string) => post<{ id: string }>("/api/recalls", { input }),
    onSuccess: async (r) => { play("bell"); setPaste(""); await refresh(); setId(r.id); }
  });

  const confirm = useMutation({
    mutationFn: () => {
      const needs = cur!.lots.some((l) => l.needsWitness);
      const lots = needs ? cur!.lots.filter((l) => !l.needsWitness || witnessed.has(l.value)).map((l) => l.value) : undefined;
      return post(`/api/recalls/${encodeURIComponent(cur!.id)}/confirm`, lots ? { lots } : {});
    },
    onSuccess: async () => { play("seal"); await refresh(); nav(`/trail?r=${encodeURIComponent(cur!.id)}`); }
  });

  const submit = (e: FormEvent) => { e.preventDefault(); if (paste.trim().length >= 3) summon.mutate(paste.trim()); };

  const allWitnessed = !cur || cur.lots.filter((l) => l.needsWitness).every((l) => witnessed.has(l.value));
  const canConfirm = !!cur && cur.lots.length > 0 && ["autopsied", "ready", "error"].includes(cur.status) && allWitnessed;
  const hunted = cur && ["confirmed", "tracing", "exhuming", "ready"].includes(cur.status);
  const s = cur?.stats;

  return (
    <main className="main">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow hot" style={{ margin: 0 }}>FDA ENFORCEMENT REPORT RECEIVED · 02:14 AM · NIGHT WATCH</p>
          <h1 className="flicker">Somewhere out there, a <em>cursed lot</em> is still walking.</h1>
          <p className="lead">Paste or poll an FDA recall. Body Snatcher Rx reads the death notice, follows the lot through every hand that touched it, and tells you which shelves and which patients to reach before dawn.</p>
          <div className="cta-row">
            <button className="btn" onClick={() => judge.mutate(false)} disabled={judge.isPending}>Enter as a judge <Arrow /></button>
            <button className="btn ghost" onClick={() => judge.mutate(true)} disabled={judge.isPending} title="Resets the demo and runs two hunts end to end">
              {judge.isPending ? "Running the hunt…" : "Skip to a finished hunt"}
            </button>
          </div>
          {judge.isError && <p className="errtext" role="alert">{(judge.error as Error).message}</p>}
        </div>
        <div className="stats" aria-label="Hunt statistics for the selected notice">
          <div className="stat"><b>{s?.lots ?? "—"}</b><span>lots identified</span></div>
          <div className="stat"><b>{s?.packages ?? "—"}</b><span>packages traced</span></div>
          <div className="stat"><b className="hot">{s?.patients ?? "—"}</b><span>patients to reach</span></div>
          <div className="stat"><b>{s?.seconds != null ? `${Math.round(s.seconds)}s` : "—"}</b><span>notice to verdict</span></div>
        </div>
      </section>

      <section aria-labelledby="pick" className="picker">
        <div className="picker-head">
          <h2 id="pick" className="sc">Tonight's death notices</h2>
          <span className="mono" style={{ fontSize: 12, color: "var(--dimmer)" }}>openFDA /drug/enforcement · synthetic fixtures</span>
        </div>
        <div role="tablist" aria-label="Recall notices" className="tabs">
          {(recalls ?? []).slice(0, 12).map((r) => (
            <button key={r.id} role="tab" aria-selected={r.id === id} className="tab" onClick={() => { setWitnessed(new Set()); setId(r.id); }}>
              <span className="id">
                <span className="dot" style={{ background: dotColor(r.classification), boxShadow: r.id === id ? `0 0 10px ${dotColor(r.classification)}` : undefined }} />
                {r.recallNumber} · CLASS {r.classification}
              </span>
              <span className="name">{r.productShort}</span>
            </button>
          ))}
        </div>
        <form className="summon" onSubmit={submit} aria-label="Summon a death notice">
          <label className="sr-only" htmlFor="summon">Summon a death notice: paste recall text or a recall number</label>
          <input id="summon" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Summon a death notice: paste recall text or a number like D-0417-2026" />
          <button className="btn ghost" type="submit" disabled={summon.isPending || paste.trim().length < 3}>{summon.isPending ? "Summoning…" : "Summon"}</button>
        </form>
        {summon.isError && <p className="errtext" role="alert">{(summon.error as Error).message}</p>}
      </section>

      {!cur ? (
        <Empty>Loading the crypt… If this takes more than a few seconds, the API is not answering.</Empty>
      ) : (
        <section className="cols">
          <article aria-labelledby="raw" className="notice">
            <div className="notice-head">
              <div>
                <p className="kicker">Notice of Death</p>
                <h3 id="raw">{cur.product}</h3>
              </div>
              <div className="seal">CLASS {cur.classification}</div>
            </div>
            <dl>
              <div><dt>RECALL NUMBER</dt><dd>{cur.recallNumber}</dd></div>
              <div><dt>RECALLING FIRM</dt><dd>{cur.firm}</dd></div>
              {cur.reason && <div className="reason"><dt>REASON</dt><dd>{cur.reason}</dd></div>}
            </dl>
            <div>
              <p className="codeinfo-label">CODE_INFO · FREE TEXT, AS FILED</p>
              <p className="codeinfo">{cur.segments.map((g, i) => (g.hit ? <mark key={i}>{g.t}</mark> : <span key={i}>{g.t}</span>))}</p>
            </div>
            <p className="notice-foot">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" stroke="#5d5446" strokeWidth="1.4" /><path d="M5 8h6" stroke="#5d5446" strokeWidth="1.4" /></svg>
              Highlighted: every span the Coroner lifted. Nothing is invented outside the source text.
            </p>
          </article>

          <article aria-labelledby="coroner" className="coroner">
            <div className="coroner-head">
              <div>
                <p className="eyebrow sm">AGENT · CORONER</p>
                <h3 id="coroner">Coroner's report</h3>
              </div>
              <div className="pills">
                <span className="pill">regex ✓</span>
                <span className={`pill ${cur.passes.llm ? "" : "off"}`} title={cur.passes.llm ? `via ${cur.llmProvider}` : "No LLM configured: regex-only mode"}>{cur.passes.llm ? "LLM ✓" : "LLM –"}</span>
                <span className="pill">reconciled</span>
              </div>
            </div>

            <div className="tags">
              {cur.lots.length === 0 && <Warn>The Coroner found no lot numbers in this notice. Nothing can be traced from it.</Warn>}
              {cur.lots.map((l) => (
                <Tag key={l.value} lot={l} witnessed={witnessed.has(l.value)}
                  onToggle={() => setWitnessed((w) => { const n = new Set(w); n.has(l.value) ? n.delete(l.value) : n.add(l.value); return n; })} />
              ))}
            </div>

            {cur.warnings.map((w) => <Warn key={w}>{w}</Warn>)}
            {cur.coldChain && <Warn>Cold-chain product. Returns will ride the refrigerated hearse; the route checks NWS heat and freeze risk.</Warn>}
            {cur.cached && <p className="mono" style={{ fontSize: 12, color: "var(--dimmer)" }}>spirits are quiet (cached fixture)</p>}

            <div className="coroner-foot">
              <span>A pharmacist confirms every tag before the hunt begins.</span>
              {hunted && cur.status !== "ready" ? (
                <button className="btn" onClick={() => nav(`/trail?r=${encodeURIComponent(cur.id)}`)}>The hunt is under way <Arrow /></button>
              ) : (
                <button className="btn" onClick={() => confirm.mutate()} disabled={!canConfirm || confirm.isPending}>
                  {cur.status === "ready" ? "Hunt again" : "Confirm & follow the trail"} <Arrow />
                </button>
              )}
            </div>
            {!allWitnessed && <p className="errtext" role="status">Tags below 0.80 need a living witness before the hunt can begin.</p>}
            {confirm.isError && <p className="errtext" role="alert">{(confirm.error as Error).message}</p>}
            {cur.status === "ready" && <a href={`#/trail?r=${encodeURIComponent(cur.id)}`} className="mono" style={{ fontSize: 13 }}>See the finished trail →</a>}
          </article>
        </section>
      )}

      <section aria-labelledby="ritual" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h2 id="ritual" className="sc">The ritual, in five incisions</h2>
        <ol className="ritual">
          {STEPS.map((st) => (
            <li key={st.n}>
              <div className="top"><span className="n">{st.n}</span><span className="t">{st.tech}</span></div>
              <div className="name">{st.name}</div>
              <div className="body">{st.body}</div>
            </li>
          ))}
        </ol>
      </section>
      <Footer />
    </main>
  );
}
