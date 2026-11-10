import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post } from "../lib/api";
import { C, ErrorBox, Icon } from "../components/kit";
import { SafetyBanner, ThemeSwitch } from "../components/Shell";

const field = { width: "100%", boxSizing: "border-box", height: 48, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, color: C.ink, font: "inherit", fontSize: 15 } as const;
const lbl = { fontSize: 13, fontWeight: 500, color: C.ink2 } as const;

const Feature = ({ red, icon, title, text }: { red?: boolean; icon: React.ReactNode; title: string; text: string }) => (
  <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
    <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: red ? "var(--danger-soft)" : "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontWeight: 600 }}>{title}</span><span style={{ color: C.dim, fontSize: 14, lineHeight: 1.5 }}>{text}</span></span>
  </li>
);

export function SignIn() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get("/api/auth/config") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [trusted, setTrusted] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const demo = cfg.data?.demo;
  const store = cfg.data?.stores?.[0];
  useEffect(() => { if (demo && !email) { setEmail(demo.email); setPassword(demo.password); } }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => qc.invalidateQueries({ queryKey: ["me"] });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await post("/api/auth/login", { storeId: store?.id ?? "store-7", email, password, trusted }); await done(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  async function sso() {
    setBusy(true); setErr("");
    try { await post("/api/auth/sso"); await done(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  return (
    <>
    <SafetyBanner />
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexWrap: "wrap" }}>
      <section className="hero" style={{ flex: "1 1 560px", minWidth: 0, position: "relative", overflow: "hidden", padding: "48px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 48, background: "radial-gradient(ellipse 80% 60% at 70% 20%, #1D1838 0%, #0E1020 55%, var(--bg) 100%)", minHeight: 640 }}>
        <div aria-hidden="true" style={{ position: "absolute", right: "12%", top: "12%", width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #F4F1FF 0%, #CFC6F5 45%, #8F82C9 100%)", boxShadow: "0 0 80px 20px var(--accent-soft)" }} />
        <div aria-hidden="true" style={{ position: "absolute", right: "calc(12% - 34px)", top: "calc(12% - 18px)", width: 140, height: 140, borderRadius: "50%", background: "#17152E" }} />
        <div aria-hidden="true">
          {[[18, 22, 3, 0], [42, 12, 2, 1], [58, 34, 2, 2], [28, 44, 2, 3]].map(([l, t, s, d]) => (
            <span key={l} className="star" style={{ position: "absolute", left: `${l}%`, top: `${t}%`, width: s, height: s, borderRadius: "50%", background: C.ink, animationDelay: `${d}s` }} />
          ))}
        </div>
        <div aria-hidden="true" className="fog" style={{ position: "absolute", left: "-10%", right: "-10%", bottom: -40, height: 280, background: "radial-gradient(ellipse 50% 60% at 30% 70%, var(--accent-soft), transparent 70%), radial-gradient(ellipse 40% 50% at 75% 80%, var(--sunken), transparent 70%)" }} />

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
          {Icon.logo(40)}
          <div><div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em" }}>Lotergeist</div><div style={{ fontSize: 12, color: C.dim }}>Pharmacy operations</div></div>
        </div>
        <div style={{ position: "relative", maxWidth: 520, display: "flex", flexDirection: "column", gap: 28 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(34px, 3.6vw, 48px)", lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.025em" }}>From the delivery dock to the medicine cabinet. <span style={{ color: C.violet2 }}>Every lot accounted for.</span></h1>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <Feature icon={<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--accent-text)" strokeWidth="1.6" aria-hidden="true"><path d="M3 4v12M6 4v12M9 4v12M13 4v12M17 4v12" /></svg>} title="Scan once at receiving" text="Lot, expiry and serial captured from the 2D barcode, with a put-away spot." />
            <Feature icon={<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--accent-text)" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="7" r="3.5" /><path d="M3.5 17c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" /></svg>} title="Know who received which lot" text="Each fill links the exact package to the prescription and the patient." />
            <Feature red icon={Icon.shield("var(--danger-text)")} title="Recalls handled in minutes" text="Enter the recall number. Affected stock and patients appear, ready to notify." />
          </ul>
        </div>
        <p style={{ position: "relative", margin: 0, fontSize: 12, color: C.dimmer }}>Demo environment · synthetic data only · not for clinical use</p>
      </section>

      <section style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "28px 24px 48px", background: C.bg, position: "relative" }}>
        <div style={{ position: "absolute", top: 20, right: 24 }}><ThemeSwitch /></div>
        <form onSubmit={submit} style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Sign in</h2>
            <p style={{ margin: 0, color: C.dim, fontSize: 15 }}>Use your pharmacy staff account.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="store" style={lbl}>Pharmacy</label>
            <div style={{ position: "relative" }}>
              <input id="store" value={store?.name ?? "Elm Street Pharmacy · Store 7"} readOnly style={{ ...field, padding: "0 40px 0 14px" }} />
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.6" aria-hidden="true" style={{ position: "absolute", right: 14, top: 16 }}><path d="M4 6l4 4 4-4" /></svg>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="email" style={lbl}>Work email</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <label htmlFor="pw" style={lbl}>Password</label>
              <a href="#" onClick={(e) => { e.preventDefault(); setNote("Ask the pharmacist in charge to reset your password."); }} style={{ fontSize: 13, textDecoration: "none" }}>Forgot password?</a>
            </div>
            <div style={{ position: "relative" }}>
              <input id="pw" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...field, padding: "0 52px 0 14px" }} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 4, top: 4, width: 40, height: 40, border: 0, borderRadius: 8, background: "transparent", color: C.dim, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z" /><circle cx="10" cy="10" r="2.5" /></svg>
              </button>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: C.ink2, cursor: "pointer" }}><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.violet }} />Trust this workstation for 12 hours</label>
          {note && <p role="status" style={{ margin: 0, fontSize: 13, color: C.dim }}>{note}</p>}
          <ErrorBox e={err} />
          <button disabled={busy} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 50, borderRadius: 10, border: 0, background: C.violet, color: C.onAccent, fontWeight: 600, fontSize: 15 }}>{busy ? "Signing in…" : "Sign in"}</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.dimmer, fontSize: 12 }}><span style={{ flex: 1, height: 1, background: C.track }} />or<span style={{ flex: 1, height: 1, background: C.track }} /></div>
          <button type="button" onClick={sso} disabled={busy || !demo} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 50, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, color: C.ink, fontWeight: 500, fontSize: 15 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--accent-text)" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6a3 3 0 016 0v3" /></svg>Continue with badge tap or SSO
          </button>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: C.dimmer }}>
            Access is logged to the audit trail. Demo: badge/SSO signs in the pharmacist and no second factor is set up.
            {demo && <> Other demo staff: <a href="#" onClick={(e) => { e.preventDefault(); setEmail("k.patel@elmstreetrx.example"); setPassword(demo.password); }}>technician</a> · <a href="#" onClick={(e) => { e.preventDefault(); setEmail("m.diaz@elmstreetrx.example"); setPassword(demo.password); }}>cashier</a> · <a href="#" onClick={(e) => { e.preventDefault(); setEmail("s.grant@elmstreetrx.example"); setPassword(demo.password); }}>admin</a>.</>}
          </p>
        </form>
      </section>
    </div>
    </>
  );
}
