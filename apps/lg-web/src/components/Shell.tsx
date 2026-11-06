import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { get, post, type User } from "../lib/api";

export function Shell({ user, children }: { user: User; children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const today = useQuery({ queryKey: ["today"], queryFn: () => get("/api/today"), refetchInterval: 15000 });
  const badges = today.data?.badges ?? { receiving: 0, recalls: 0 };
  const [q, setQ] = useState("");
  const found = useQuery({ queryKey: ["search", q], queryFn: () => get(`/api/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });

  const logout = async () => { await post("/api/auth/logout"); qc.clear(); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const item = (to: string, label: string, badge?: number, red?: boolean) => (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
      {label}{badge ? <span className={`badge ${red ? "red" : ""}`}>{badge}</span> : null}
    </NavLink>
  );
  return (
    <div className="shell">
      <div className="banner" role="note">Synthetic demo data · Elm Street Pharmacy · Store 7 · Messages go to a sandbox, nothing is really sent</div>
      <aside className="side">
        <div className="brand"><span className="logo" aria-hidden>👻</span> Lotergeist</div>
        <nav className="nav" aria-label="Main">
          {item("/", "Today")}
          {item("/receiving", "Receiving", badges.receiving)}
          {item("/inventory", "Inventory")}
          {item("/fill", "Fill & pickup")}
          {item("/recalls", "Recalls", badges.recalls, true)}
          <div style={{ height: 14 }} />
          {item("/labels", "Print test labels")}
          {item("/outbox", "Sandbox outbox")}
        </nav>
        <div className="user">
          <span className="avatar" style={{ background: user.tint }} aria-hidden>{user.initials}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="dimmer" style={{ fontSize: 12, textTransform: "capitalize" }}>{user.role}</div>
          </div>
          <button className="btn ghost sm" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <header className="top">
        <div className="search">
          <span className="ico" aria-hidden>⌕</span>
          <input aria-label="Scan or search" placeholder="Scan or search a lot, NDC or prescription" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && found.data && (
            <div className="results" role="listbox">
              {found.data.lots.map((l: any) => (
                <button key={l.id} onClick={() => { setQ(""); nav(`/inventory?lot=${l.id}`); }}>
                  <strong>{l.name}</strong> <span className="mono dim">· lot {l.lot} · {l.onHand} on hand</span>
                </button>
              ))}
              {found.data.rx.map((r: any) => (
                <button key={r.rx} onClick={() => { setQ(""); nav(`/fill?rx=${r.rx}`); }}>
                  <span className="mono">Rx {r.rx}</span> <span className="dim">· {r.patient} · {r.drug}</span>
                </button>
              ))}
              {!found.data.lots.length && !found.data.rx.length && <div className="dim" style={{ padding: 10 }}>Nothing found.</div>}
            </div>
          )}
        </div>
        <span className="dimmer" style={{ marginLeft: "auto", fontSize: 12 }}>{user.title}</span>
      </header>
      <main className="main"><div className="page">{children}</div></main>
    </div>
  );
}
