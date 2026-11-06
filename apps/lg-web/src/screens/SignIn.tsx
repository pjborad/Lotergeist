import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post } from "../lib/api";

export function SignIn() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get("/api/auth/config") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const done = () => qc.invalidateQueries({ queryKey: ["me"] });
  const storeId = cfg.data?.stores?.[0]?.id ?? "store-7";

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await post("/api/auth/login", { storeId, email, password, trusted }); await done(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  async function sso() {
    setBusy(true); setErr("");
    try { await post("/api/auth/sso"); await done(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  const demo = cfg.data?.demo;
  return (
    <div className="login">
      <div className="art" aria-hidden>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 96 }}>👻</div>
          <h2 style={{ fontSize: 28, marginTop: 8 }}>Every lot, accounted for.</h2>
          <p className="dim" style={{ marginTop: 8 }}>From the dock to the patient, and back again when a recall hits.</p>
        </div>
      </div>
      <div className="form">
        <form onSubmit={submit} style={{ width: 360, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 26 }}>Sign in to Lotergeist</h1>
          <p className="dim" style={{ margin: "6px 0 20px" }}>{cfg.data?.stores?.[0]?.name ?? "Elm Street Pharmacy · Store 7"}</p>
          <div className="field"><label htmlFor="em">Work email</label><input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <label className="row dim" style={{ marginBottom: 14 }}><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} /> Trusted workstation (stay signed in for 12 hours)</label>
          {err && <div className="err" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn" style={{ width: "100%" }} disabled={busy}>Sign in</button>
          <button type="button" className="btn ghost" style={{ width: "100%", marginTop: 8 }} onClick={sso} disabled={busy || !demo}>Badge tap / SSO (demo stand-in)</button>
          {demo && (
            <div className="card" style={{ marginTop: 20, fontSize: 13 }}>
              <strong>Demo accounts</strong>
              <p className="dim" style={{ marginTop: 4 }}>{demo.note}</p>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {[["j.rivera", "Pharmacist"], ["k.patel", "Technician"], ["m.diaz", "Cashier"]].map(([u, r]) => (
                  <button type="button" key={u} className="chip" onClick={() => { setEmail(`${u}@elmstreetrx.example`); setPassword(demo.password); }}>{r} · {u}@elmstreetrx.example</button>
                ))}
              </div>
              <p className="dimmer" style={{ marginTop: 8 }}>No second factor is set up in this demo.</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
