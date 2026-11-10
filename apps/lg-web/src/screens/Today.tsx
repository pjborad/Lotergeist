import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { get, type User } from "../lib/api";
import { C, Footer, Icon, MONO, pill, TONES } from "../components/kit";
import { mainStyle, PageHeader } from "../components/Shell";

const EVENT_TONE: Record<string, string> = { Sold: "green", Filled: "violet", Received: "cold", Shelved: "cold", Quarantined: "red", Returned: "orange", Adjusted: "amber", Moved: "violet", Released: "green" };
const TAG_TONE: Record<string, string> = { orange: "orange", green: "green", violet: "violet", red: "red" };

/** Header search: type a lot, NDC or Rx, or scan a package with a USB scanner (it types the GS1 code and Enter). */
function ScanOrSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const found = useQuery({ queryKey: ["search", q], queryFn: () => get(`/api/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const go = (to: string) => { setQ(""); nav(to); };
  return (
    <div style={{ flex: "0 1 380px", position: "relative" }}>
      <label htmlFor="q" className="sr">Scan or search</label>
      <span style={{ position: "absolute", left: 14, top: 13 }}>{Icon.scan("var(--subtle)")}</span>
      <input id="q" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && found.data?.lots?.[0]) go(`/inventory?lot=${found.data.lots[0].id}`); if (e.key === "Escape") setQ(""); }}
        placeholder="Scan a package, or search NDC, lot, Rx #" autoComplete="off"
        style={{ width: "100%", boxSizing: "border-box", height: 44, padding: "0 14px 0 42px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, color: C.ink, font: "inherit", fontSize: 14 }} />
      {q.trim().length >= 2 && found.data && (
        <div className="results" role="listbox" style={{ position: "absolute", top: 50, left: 0, right: 0, zIndex: 20, background: C.card, border: `1px solid ${C.line2}`, borderRadius: 12, padding: 6, boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
          {found.data.scanned && <div style={{ padding: "6px 10px", fontSize: 12, color: C.dimmer }}>Scanned lot <span style={{ fontFamily: MONO }}>{found.data.scanned.lot}</span>{found.data.scanned.serial ? <> · serial <span style={{ fontFamily: MONO }}>{found.data.scanned.serial}</span></> : null}</div>}
          {found.data.lots.map((l: any) => (
            <button key={l.id} role="option" onClick={() => go(`/inventory?lot=${l.id}`)} style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", textAlign: "left", border: 0, background: "transparent", color: C.ink, padding: "10px", borderRadius: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{l.name}</span><span style={{ fontSize: 12, color: C.dimmer, fontFamily: MONO }}>Lot {l.lot} · {l.onHand} on hand</span></span>
              {l.status === "recall" && <span style={pill(...TONES.red!)}>Recalled</span>}
            </button>
          ))}
          {found.data.rx.map((r: any) => (
            <button key={r.rx} role="option" onClick={() => go(`/fill?rx=${r.rx}`)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", color: C.ink, padding: 10, borderRadius: 8 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{r.patient}</span><span style={{ fontSize: 12, color: C.dimmer, fontFamily: MONO }}>Rx {r.rx} · {r.drug}</span>
            </button>
          ))}
          {!found.data.lots.length && !found.data.rx.length && <div style={{ padding: 10, fontSize: 14, color: C.dim }}>Nothing found.</div>}
        </div>
      )}
    </div>
  );
}

export function Today({ user }: { user: User }) {
  const q = useQuery({ queryKey: ["today"], queryFn: () => get("/api/today"), refetchInterval: 15000 });
  const t = q.data;
  const max = Math.max(1, ...(t?.expiring ?? []).map((e: any) => e.n));
  const thisMonth = t?.expiring?.[0];
  const monthEnd = new Date(); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  return (
    <>
      <PageHeader title={t?.greeting.title ?? "Today"} sub={t?.greeting.line}><ScanOrSearch /></PageHeader>
      <main style={mainStyle()}>
        {t?.banner && (
          <Link to={user.role === "pharmacist" ? "/recalls" : "/inventory?filter=recall"} className="glow" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "18px 20px", borderRadius: 14, border: "1px solid var(--danger)", background: "linear-gradient(90deg, var(--danger-soft), var(--danger-soft))", color: C.ink, textDecoration: "none" }}>
            <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: "var(--danger-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>{Icon.shield("var(--danger-text)", 22)}</span>
            <span style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{t.banner.status === "notified" ? "Recall in progress" : "Recall fax received"}: {t.banner.id} · {t.banner.drug}</span>
              <span style={{ fontSize: 14, color: C.redText }}>You received {t.banner.lotsReceived} of the recalled lots. {t.banner.units} units on hand and {t.banner.patients} patients have already picked up.</span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 18px", borderRadius: 10, background: C.red, color: "#fff", fontWeight: 600, fontSize: 14 }}>
              {user.role === "pharmacist" ? (t.banner.status === "notified" ? "Open recall" : "Start recall") : "See held lots"}{Icon.arrow()}
            </span>
          </Link>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
          {(t?.kpis ?? []).map((k: any) => (
            <div key={k.label} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: C.dim }}><span>{k.label}</span><span style={pill(...(TONES[TAG_TONE[k.tone] ?? "violet"]!), { padding: "2px 8px", display: "inline" })}>{k.tag}</span></div>
              <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>{k.value}</div>
              <div style={{ fontSize: 13, color: C.dimmer }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "stretch" }}>
          <section aria-labelledby="work" style={{ flex: "1 1 520px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="work" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Your work queue</h2><span style={{ fontSize: 13, color: C.dimmer }}>{t?.openTasks ?? 0} open</span></div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
              {(t?.tasks ?? []).map((k: any, i: number) => (
                <li key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                  <Link to={k.href} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 4px", color: C.ink, textDecoration: "none" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: k.dot }} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 500 }}>{k.title}</span><span style={{ fontSize: 13, color: C.dimmer }}>{k.sub}</span></span>
                    <span style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap" }}>{k.when}</span>
                    {Icon.chevron()}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="exp" style={{ flex: "1 1 360px", minWidth: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="exp" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Expiring lots</h2><Link to="/inventory?filter=exp" style={{ fontSize: 13, textDecoration: "none" }}>View all</Link></div>
            <div role="img" aria-label={`Lots expiring by month: ${(t?.expiring ?? []).map((e: any) => `${e.month} ${e.n}`).join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 150, paddingBottom: 4, borderBottom: `1px solid ${C.track}` }}>
              {(t?.expiring ?? []).map((b: any, i: number) => (
                <div key={b.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 12, color: C.ink2 }}>{b.n}</span>
                  <span style={{ width: "100%", maxWidth: 44, borderRadius: "6px 6px 2px 2px", height: Math.round((b.n / max) * 110), background: i === 0 ? C.amber : "var(--accent-soft)" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: -10 }}>
              {(t?.expiring ?? []).map((b: any) => <span key={b.month} style={{ flex: 1, textAlign: "center", fontSize: 12, color: C.dimmer }}>{b.month}</span>)}
            </div>
            {thisMonth && (
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.dim }}>
                {thisMonth.n ? `${thisMonth.n} lot${thisMonth.n === 1 ? "" : "s"} expire this month. Pull them to the return-to-vendor bin before ${monthEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.` : "Nothing expires this month."}
              </p>
            )}
          </section>
        </div>

        <section aria-labelledby="act" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="act" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Lot activity</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", fontSize: 12, color: C.dimmer }}>{["Time", "Event", "Product", "Lot", "By"].map((h) => <th key={h} scope="col" style={{ padding: "10px 8px", fontWeight: 500 }}>{h}</th>)}</tr></thead>
              <tbody>
                {(t?.feed ?? []).map((f: any, i: number) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: "12px 8px", color: C.dim, whiteSpace: "nowrap" }}>{f.time}</td>
                    <td style={{ padding: "12px 8px" }}><span style={pill(...TONES[EVENT_TONE[f.kind] ?? "gray"]!, { padding: "3px 10px" })}>{f.kind}</span></td>
                    <td style={{ padding: "12px 8px" }}>{f.product}</td>
                    <td style={{ padding: "12px 8px", fontFamily: MONO, fontSize: 13, color: C.ink2 }}>{f.lot}</td>
                    <td style={{ padding: "12px 8px", color: C.dim }}>{f.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <Footer />
      </main>
    </>
  );
}
