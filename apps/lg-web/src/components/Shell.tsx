import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { get, post, type User } from "../lib/api";
import { Icon } from "./kit";

export const AVATAR: Record<string, [string, string]> = {
  pharmacist: ["var(--accent-soft)", "var(--accent-text)"], technician: ["var(--ok-soft)", "var(--ok-text)"],
  cashier: ["var(--warn-soft)", "var(--warn-text)"], admin: ["var(--info-soft)", "var(--info-text)"]
};

export type Theme = "light" | "dark";
const readTheme = (): Theme => { try { return localStorage.getItem("lg-theme") === "dark" ? "dark" : "light"; } catch { return "light"; } };
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(readTheme);
  useEffect(() => { document.documentElement.dataset.theme = t; try { localStorage.setItem("lg-theme", t); } catch { /* private mode */ } }, [t]);
  return [t, setT];
}

export function ThemeSwitch() {
  const [t, setT] = useTheme();
  return (
    <div className="theme" role="group" aria-label="Theme">
      <button aria-pressed={t === "light"} onClick={() => setT("light")}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="3.5" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" /></svg>Light</button>
      <button aria-pressed={t === "dark"} onClick={() => setT("dark")}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M16.5 12.5A7 7 0 017.5 3.5a7 7 0 109 9z" /></svg>Dark</button>
    </div>
  );
}

/** Required on every page (pharmacy-safety rule 8). */
export const SafetyBanner = () => (
  <div className="safety" role="note">Synthetic data only · Not for clinical use · Not HIPAA-compliant · A pharmacist approves every message</div>
);

const NavIcon = {
  patients: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" /></svg>,
  plug: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 01-10 0zM10 14.5v3" /></svg>
};

export function Shell({ user, children }: { user: User; children: ReactNode }) {
  const qc = useQueryClient();
  useTheme();
  const today = useQuery({ queryKey: ["today"], queryFn: () => get("/api/today"), refetchInterval: 15000, enabled: user.role !== "admin" });
  const queue = useQuery({ queryKey: ["rxq"], queryFn: () => get<any[]>("/api/rx"), refetchInterval: 15000, enabled: user.role === "pharmacist" || user.role === "technician" });
  const badges = today.data?.badges ?? { receiving: 0, recalls: 0 };
  const flagged = (queue.data ?? []).filter((r) => r.status === "to_fill" && (r.review === "pending" || r.review === "on_hold")).length;
  const [menu, setMenu] = useState(false);
  const logout = async () => { await post("/api/auth/logout"); qc.clear(); await qc.invalidateQueries({ queryKey: ["me"] }); };
  const [bg, fg] = AVATAR[user.role] ?? AVATAR.pharmacist!;
  const item = (to: string, label: string, icon: ReactNode, badge?: ReactNode) => (
    <NavLink to={to} end={to === "/"}>{icon}{label}{badge}</NavLink>
  );
  const clinical = user.role !== "admin";
  return (
    <div className="app">
      <aside className="side">
        <NavLink to="/" className="brand">
          {Icon.logo(32)}
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}><span style={{ fontWeight: 700, fontSize: 15 }}>Lotergeist</span><span style={{ fontSize: 12, color: "var(--subtle)" }}>Elm Street · Store 7</span></span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          {clinical && <>
            <span className="nav-label">Operations</span>
            {item("/", "Today", Icon.today())}
            {item("/receiving", "Receiving", Icon.truck(), badges.receiving ? <span className="count">{badges.receiving}</span> : null)}
            {item("/inventory", "Inventory", Icon.shelves())}
            {item("/fill", "Fill & pickup", Icon.rx(), flagged ? <span className="count amber" aria-label={`${flagged} need review`}>{flagged}</span> : null)}
            <span className="nav-label">Care</span>
            {user.role !== "cashier" && item("/patients", "Patients", NavIcon.patients)}
            {item("/recalls", "Recalls", Icon.shield(), badges.recalls ? <span className="count red">{badges.recalls}</span> : null)}
          </>}
          {(user.role === "admin" || user.role === "pharmacist") && <>
            <span className="nav-label">Admin</span>
            {item("/integrations", "Integrations", NavIcon.plug)}
          </>}
          {clinical && <>
            <span className="nav-label">Demo tools</span>
            {item("/labels", "Test labels", Icon.tag())}
            {item("/outbox", "Sandbox outbox", Icon.mail())}
          </>}
        </nav>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
          <ThemeSwitch />
          {menu && (
            <div role="menu" style={{ position: "absolute", bottom: "calc(100% - 44px)", left: 0, right: 0, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 12, padding: 6, boxShadow: "var(--shadow-lg)", zIndex: 5 }}>
              <button role="menuitem" onClick={logout} className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }}>Sign out</button>
            </div>
          )}
          <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" className="me">
            <span className="av" style={{ background: bg, color: fg }}>{user.initials}</span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.3 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{user.name}</span><span style={{ fontSize: 12, color: "var(--subtle)" }}>{user.title}</span></span>
          </button>
        </div>
      </aside>
      <div className="content">
        <SafetyBanner />
        {children}
      </div>
    </div>
  );
}

/** Page header from the prototype: breadcrumb, title, actions. */
export function PageHeader({ title, sub, crumb, children }: { title: string; sub?: ReactNode; crumb?: string; children?: ReactNode }) {
  return (
    <header className="top">
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1 className="h1">{title}</h1>
        {sub && <p className="sub" style={{ marginTop: 2 }}>{sub}</p>}
      </div>
      {children}
    </header>
  );
}
export const mainStyle = (extra: CSSProperties = {}): CSSProperties => ({ padding: "28px 32px 64px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1320, boxSizing: "border-box", width: "100%", ...extra });
