import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get, type User } from "../lib/api";
import { Tag } from "../components/ui";

export function Today({ user }: { user: User }) {
  const q = useQuery({ queryKey: ["today"], queryFn: () => get("/api/today"), refetchInterval: 15000 });
  const t = q.data;
  if (!t) return <p className="dim">Loading…</p>;
  const max = Math.max(1, ...t.expiring.map((e: any) => e.n));
  return (
    <>
      <h1>{t.greeting.title}</h1>
      <p className="sub">{t.greeting.line}</p>

      {t.banner && (
        <div className="recallhead" style={{ margin: "18px 0" }} role="alert">
          <div className="spread">
            <div>
              <Tag tone="red">⚠ Recall {t.banner.id}</Tag>
              <h2 style={{ marginTop: 8, fontSize: 18 }}>{t.banner.product}</h2>
              <p className="dim" style={{ marginTop: 4 }}>
                You received {t.banner.lotsReceived} of the recalled lots · {t.banner.units} units are in the store · {t.banner.patients} patients got it.
              </p>
            </div>
            {user.role === "pharmacist"
              ? <Link className="btn red" to="/recalls">Work this recall</Link>
              : <span className="dim">A pharmacist works recalls.</span>}
          </div>
        </div>
      )}

      <div className="grid4" style={{ margin: "18px 0" }}>
        {t.kpis.map((k: any) => (
          <div className="card kpi" key={k.label}>
            <div className="spread"><span className="dim">{k.label}</span><Tag tone={k.tone}>{k.tag}</Tag></div>
            <div className="v">{k.value}</div>
            <div className="dimmer" style={{ fontSize: 12 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="spread"><h3>Work queue</h3><span className="dimmer">{t.openTasks} open</span></div>
          <div style={{ marginTop: 8 }}>
            {t.tasks.map((k: any, i: number) => (
              <Link key={i} to={k.href} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", color: "inherit" }}>
                <span className="dot" style={{ background: k.dot }} aria-hidden />
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{k.title}</div><div className="dim" style={{ fontSize: 12 }}>{k.sub}</div></div>
                <span className="dimmer">{k.when}</span>
              </Link>
            ))}
            {!t.tasks.length && <p className="dim">Nothing waiting.</p>}
          </div>
        </div>
        <div className="card">
          <h3>Lots expiring by month</h3>
          <div className="row" style={{ alignItems: "flex-end", height: 140, marginTop: 14, gap: 14 }}>
            {t.expiring.map((e: any) => (
              <div key={e.month} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontWeight: 600 }}>{e.n}</div>
                <div style={{ height: Math.max(6, (e.n / max) * 90), background: e.current ? "var(--amber)" : "var(--violet)", borderRadius: 6, margin: "4px 0" }} />
                <div className="dimmer" style={{ fontSize: 12 }}>{e.month}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Lot activity</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Time</th><th>Event</th><th>Product</th><th>Lot</th><th>By</th></tr></thead>
          <tbody>
            {t.feed.map((f: any, i: number) => (
              <tr key={i}><td className="mono dim">{f.time}</td><td>{f.kind}</td><td>{f.product}</td><td className="mono">{f.lot}</td><td className="dim">{f.by}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
