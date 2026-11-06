import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Arrow, Empty, Footer } from "../components/bits";
import { patch, post } from "../lib/api";
import { useAfterlife, useHearse } from "../lib/hooks";
import { kmToPx, pathFrom, project } from "../lib/geo";
import { play } from "../lib/sound";
import type { HearseView } from "../lib/types";

function RouteMap({ h }: { h: HearseView }) {
  const d = pathFrom(h.geometry);
  const [dx, dy] = project(h.depot.lat, h.depot.lon);
  const label = h.avoided
    ? `Pickup route from the depot through ${h.stops.length} pharmacies, bending around a heat advisory zone`
    : h.hazardExposureMin > 0
      ? `Pickup route from the depot through ${h.stops.length} pharmacies, passing straight through a heat advisory zone`
      : `Pickup route from the depot through ${h.stops.length} pharmacies`;
  return (
    <svg viewBox="0 0 800 520" role="img" aria-label={label}>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#161a15" strokeWidth="1" /></pattern>
        <radialGradient id="hot"><stop offset="0%" stopColor="#ff6b4a" stopOpacity="0.55" /><stop offset="100%" stopColor="#ff6b4a" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="800" height="520" fill="url(#grid)" />
      <path d="M0 240 C120 220 180 290 300 270 S520 190 600 230 S760 300 800 280" fill="none" stroke="#14231f" strokeWidth="22" />
      <path d="M60 0 L140 520 M300 0 L280 520 M0 380 L800 360 M0 110 L800 150 M560 0 L600 520 M700 0 L740 520" stroke="#20251f" strokeWidth="3" />
      {h.hazards.map((z) => {
        const [x, y] = project(z.lat, z.lon);
        const r = kmToPx(z.radiusKm);
        return (
          <g key={z.id}>
            <circle className="heat" cx={x} cy={y} r={r} fill="url(#hot)" />
            <circle cx={x} cy={y} r={r} fill="none" stroke="#ff6b4a" strokeWidth="1.5" strokeDasharray="6 6" />
            <text x={x} y={y - 3} textAnchor="middle" fill="#ffb39f" fontFamily="JetBrains Mono, monospace" fontSize="13">{z.label}</text>
            <text x={x} y={y + 15} textAnchor="middle" fill="#ffb39f" fontFamily="JetBrains Mono, monospace" fontSize="12">{z.tempF}°F · {String(z.fromHour).padStart(2, "0")}:00–{String(z.toHour).padStart(2, "0")}:00</text>
          </g>
        );
      })}
      <path d={d} fill="none" stroke="#0b0d0b" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
      <path className="route" d={d} fill="none" stroke={h.hazardExposureMin > 0 ? "#ff8a6e" : "#b8f27c"} strokeWidth="4" strokeDasharray="14 6" strokeLinejoin="round" strokeLinecap="round" />
      {h.stops.map((s) => {
        const [x, y] = project(s.lat, s.lon);
        return (
          <g key={s.id}>
            <circle cx={x} cy={y} r="16" fill="#0b0d0b" stroke={s.cold ? "#7cc4ff" : "#a9a392"} strokeWidth="2.5" />
            <text x={x} y={y + 5} textAnchor="middle" fill="#ece6d6" fontFamily="JetBrains Mono, monospace" fontSize="13" fontWeight="600">{s.id}</text>
          </g>
        );
      })}
      <rect x={dx - 26} y={dy - 20} width="52" height="40" rx="6" fill="#b8f27c" />
      <text x={dx} y={dy + 5} textAnchor="middle" fill="#0b0d0b" fontFamily="JetBrains Mono, monospace" fontSize="12" fontWeight="600">CRYPT</text>
    </svg>
  );
}

function Letters({ items }: { items: NonNullable<ReturnType<typeof useAfterlife>["data"]>["outreach"] }) {
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const cur = items[Math.min(i, items.length - 1)];
  useEffect(() => { setEditing(false); }, [cur?.id]);
  const done = () => qc.invalidateQueries({ queryKey: ["afterlife"] });
  const approve = useMutation({ mutationFn: () => post(`/api/outreach/${cur!.id}/approve`, { approvedBy: "RPh J." }), onSuccess: () => { play("seal"); void done(); } });
  const save = useMutation({ mutationFn: () => patch(`/api/outreach/${cur!.id}`, { text }), onSuccess: () => { setEditing(false); void done(); } });
  const approved = items.filter((x) => x.status === "approved").length;

  return (
    <article className="card letter">
      <div className="card-head">
        <h3>Patient outreach</h3>
        <span className={`badge ${cur?.status === "approved" ? "ok" : ""}`}>{!cur ? "NO LETTERS" : cur.status === "approved" ? `APPROVED · ${cur.approvedBy ?? "RPh"}` : "AWAITING PHARMACIST"}</span>
      </div>
      {!cur ? (
        <p className="text">No patient received a recalled lot, so there is nobody to write to.</p>
      ) : (
        <>
          <p className="to">To: Patient {cur.patientId} · SMS + call · plain language · grade {cur.grade}</p>
          {editing ? (
            <>
              <label className="sr-only" htmlFor="letter-edit">Letter wording</label>
              <textarea id="letter-edit" value={text} onChange={(e) => setText(e.target.value)} />
            </>
          ) : (
            <p className="text">{cur.text}</p>
          )}
          <div className="acts">
            {editing ? (
              <>
                <button className="b1" onClick={() => save.mutate()} disabled={save.isPending || text.trim().length < 10}>Save wording</button>
                <button className="b2" onClick={() => setEditing(false)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="b1" onClick={() => approve.mutate()} disabled={cur.status === "approved" || approve.isPending}>{cur.status === "approved" ? "Approved" : "Approve & queue"}</button>
                <button className="b2" onClick={() => { setText(cur.text); setEditing(true); }}>Edit wording</button>
              </>
            )}
            <div className="pager">
              <button aria-label="Previous letter" onClick={() => setI((x) => (x - 1 + items.length) % items.length)}>‹</button>
              <span>{Math.min(i, items.length - 1) + 1} / {items.length}</span>
              <button aria-label="Next letter" onClick={() => setI((x) => (x + 1) % items.length)}>›</button>
            </div>
          </div>
          <p className="small">{approved} of {items.length} approved · approved means ready, not sent. Spooky in the app, clinical-plain to patients. Nothing sends without a pharmacist.</p>
          {(approve.isError || save.isError) && <p className="small" role="alert" style={{ color: "#8a1f12" }}>{((approve.error ?? save.error) as Error).message}</p>}
        </>
      )}
    </article>
  );
}

export default function Hearse() {
  const qc = useQueryClient();
  const [avoid, setAvoid] = useState(true);
  const { data: h, isLoading } = useHearse(avoid);
  const { data: a } = useAfterlife();
  const runAll = useMutation({ mutationFn: () => post("/api/demo/reset", { prerun: true }), onSuccess: () => qc.invalidateQueries() });

  const hasHazard = !!h && h.hazards.length > 0;
  const coldStops = h?.stops.filter((s) => s.cold).map((s) => s.id) ?? [];
  const note = !hasHazard ? "No advisory on this route" : avoid ? (h.avoided ? `+${h.detourMin ?? 0} min, cold chain protected` : "Could not go around it") : "Fastest path crosses the advisory";

  const s = a?.shortage;
  return (
    <main className="main tight">
      <section className="row-between">
        <div style={{ flex: "1 1 600px", minWidth: 0 }}>
          <p className="eyebrow">IV · Agent · Hearse dispatcher · OSRM + NWS</p>
          <h1 className="display">Bring the bodies home.</h1>
          <p className="lede" style={{ maxWidth: 640 }}>One refrigerated run collects every quarantined package. When the forecast turns, the hearse takes the long way around.</p>
        </div>
        <button className={`switch ${avoid ? "" : "off"}`} aria-pressed={avoid} onClick={() => setAvoid(!avoid)}>
          <span aria-hidden="true" className="track"><span className="knob" /></span>
          <span className="t"><b style={{ fontWeight: 600 }}>Avoid NWS heat advisory</b><span>{note}</span></span>
        </button>
      </section>

      {!isLoading && h && h.stops.length === 0 && (
        <Empty action={<button className="btn" onClick={() => runAll.mutate()} disabled={runAll.isPending}>{runAll.isPending ? "Running the hunt…" : "Skip to a finished hunt"} <Arrow /></button>}>
          Nothing is quarantined yet. Confirm a death notice and let the Grave Robber finish, and the pickup route appears here.
        </Empty>
      )}

      {h && h.stops.length > 0 && (
        <section className="map-cols">
          <figure className="mapcard">
            <RouteMap h={h} />
            <figcaption className="mapcap">
              <span className="legend">
                <span><i aria-hidden="true" style={{ borderColor: "#7cc4ff" }} />cold-chain stop</span>
                <span><i aria-hidden="true" style={{ borderColor: "#a9a392" }} />room temp</span>
              </span>
              <span className="mono">{h.summary}</span>
            </figcaption>
          </figure>

          <aside aria-labelledby="stops" className="manifest">
            <h2 id="stops">The pickup manifest</h2>
            <ol>
              {h.stops.map((s2) => (
                <li key={s2.id} className="stop">
                  <span className={`badge ${s2.cold ? "cold" : ""}`}>{s2.id}</span>
                  <span className="mid"><b>{s2.name}</b><span>{s2.load}</span></span>
                  <span className="eta">
                    <span>{s2.eta}</span>
                    <span style={{ color: s2.tempFlag !== "ok" ? "#ff8a6e" : s2.cold ? "#7cc4ff" : "#8f8a7b" }}>
                      {s2.tempFlag === "hot" ? `${s2.tempC}°C · too warm` : s2.tempFlag === "freezing" ? `${s2.tempC}°C · freezing` : s2.held}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {h.warnings.map((w, i) => (
              <div key={i} className="reefer warn" role="status">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M11 3l9 16H2z" stroke="#f2c26b" strokeWidth="1.5" strokeLinejoin="round" /><path d="M11 9v5M11 16.5v.5" stroke="#f2c26b" strokeWidth="1.6" strokeLinecap="round" /></svg>
                <span>{w.message}</span>
              </div>
            ))}
            <div className="reefer">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M11 2v18M3 6.5l16 9M3 15.5l16-9" stroke="#7cc4ff" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <span>
                {coldStops.length ? `Reefer set to 2–8 °C for stop${coldStops.length > 1 ? "s" : ""} ${coldStops.join(" and ")}. ` : "No refrigerated product on this run. "}
                Forecast and active alerts come from {h.weatherSource === "nws" ? "the National Weather Service" : `${h.weatherSource} (demo advisory)`}; the run leaves the depot at {h.departs}.
              </span>
            </div>
          </aside>
        </section>
      )}

      <section aria-labelledby="after" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h2 id="after" className="sc" style={{ fontSize: 30 }}>The afterlife</h2>
        <div className="after">
          <article className="card">
            <div className="card-head"><h3>Quarantine</h3><span className="mono" style={{ fontSize: 12, color: "var(--hot)" }}>{a?.total ?? 0} held</span></div>
            <div className="bins">
              {(a?.bins ?? []).map((b) => (<div key={b.id} className="bin" title={b.pharmacyName}><b>{b.count}</b><span>{b.id}</span></div>))}
              <div className="bin"><b>{a?.total ?? 0}</b><span>TOTAL</span></div>
            </div>
            <p className="fine">Bins reconcile against EPCIS: every serial received, minus every serial dispensed.</p>
          </article>

          <Letters items={a?.outreach ?? []} />

          <article className="card">
            <div className="card-head">
              <h3>Shortage omen</h3>
              <span className={`omen-badge ${s?.onList ? "risk" : s?.soleSource ? "" : "none"}`}>{s?.onList ? "ON SHORTAGE LIST" : s?.soleSource ? "SOLE-SOURCE" : "NO SHORTAGE"}</span>
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: "#d8d1c0" }}>
              {!s ? "Pick a recall to read its omens." : s.onList ? `${s.genericName} is already on the openFDA shortage list. Pulling more stock deepens it.` : s.soleSource ? "Only one labeler makes this NDC. Pulling two lots may tip it onto the openFDA shortage list." : "This drug is not on the openFDA shortage list right now."}
            </p>
            {s?.substitute && (
              <dl className="kv">
                <div><dt>SUBSTITUTE</dt><dd>{s.substitute}</dd></div>
                <div><dt>NADAC Δ / UNIT</dt><dd>{s.nadacDelta === null ? "unknown" : `${s.nadacDelta >= 0 ? "+" : "−"}$${Math.abs(s.nadacDelta).toFixed(2)}${s.unit ? ` / ${s.unit}` : ""}`}</dd></div>
              </dl>
            )}
            <p className="fine">{s?.source === "fixture" ? "Demo fixture: prices are synthetic. Live, NADAC is pulled weekly from data.medicaid.gov." : "Source: openFDA /drug/shortages."}</p>
          </article>
        </div>
      </section>

      <footer className="closing">
        <span>Every cursed lot, found.</span>
        <Link className="btn ghost" to="/">Back to tonight's notices</Link>
      </footer>
      <Footer />
    </main>
  );
}
