import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, msg, post, type User } from "../lib/api";
import { PageHeader } from "../components/Shell";
import { ErrorBox, when } from "../components/kit";

type Scope = "availability.check" | "inventory.read" | "recall.read" | "rx.change" | "patient.read";
interface Partner { id: string; partner: string; kind: "REST" | "MCP" | "FHIR"; status: "active" | "revoked"; scopes: Scope[]; keyPrefix: string; ipAllowlist: string[]; baa: boolean; approvedBy: string | null; purpose: string; lastUsed: number | null; ratePerMin: number; note: string; calls24h: number; denied24h: number; webhooks: { id: number; url: string; events: string[]; active: boolean }[] }
interface Data {
  partners: Partner[]; scopes: Record<Scope, string>; events: string[]; canEdit: boolean;
  activity: { id: number; at: number; partner: string; surface: string; method: string; path: string; tool: string | null; status: number; latencyMs: number; denied: string | null }[];
  deliveries: { id: number; status: string; http_status: number | null; attempt: number; at: number; url: string; type: string; partner: string; error: string | null }[];
  security: { checks: { label: string; ok: boolean; detail: string }[]; auditChain: { ok: boolean; rows: number } };
  sink: { id: number; at: number; event: string; verified: number }[];
}
const KIND_CHIP = { REST: "chip info", MCP: "chip accent", FHIR: "chip ok" } as const;
const origin = typeof window !== "undefined" ? window.location.origin : "";

const EXAMPLES = {
  REST: { blurb: "For hospital and clinic systems. Check whether a medicine is in stock before discharge, without seeing any patient data.", endpoint: `${origin}/v1`, auth: "OAuth 2.0 client credentials (POST /oauth/token)", method: "GET", path: "/v1/availability?ndc=70004-623-15&qty=2", body: null as unknown },
  MCP: { blurb: "For AI agents. Each agent signs in as its own client, sees only the tools its scopes allow, and every tool call is logged.", endpoint: `${origin}/mcp`, auth: "OAuth 2.0 bearer token · Streamable HTTP (stateless JSON-RPC)", method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_recall_status", arguments: { ndc: "70004-417-05", lot: "PRORX050925-1" } } } as unknown },
  FHIR: { blurb: "For EHRs that prefer health-data standards. Read-only; patient resources only under a signed BAA.", endpoint: `${origin}/fhir/r4`, auth: "OAuth 2.0 bearer token (SMART Backend Services in production)", method: "GET", path: "/fhir/r4/Medication?code=http://hl7.org/fhir/sid/ndc|70004-623-15", body: null as unknown }
};

export function Integrations({ user }: { user: User }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["integrations"], queryFn: () => get<Data>("/api/integrations"), refetchInterval: 8000 });
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["integrations"] });
  const on = { onSuccess: () => { setErr(""); refresh(); }, onError: (e: unknown) => setErr(msg(e)) };
  const update = useMutation({ mutationFn: (b: { id: string; body: unknown }) => post(`/api/integrations/${b.id}`, b.body), ...on });
  const rotate = useMutation({ mutationFn: (id: string) => post<{ clientId: string; clientSecret: string }>(`/api/integrations/${id}/rotate`), onSuccess: (r) => { setSecret(r); refresh(); }, onError: (e) => setErr(msg(e)) });
  const x = d.data;
  const edit = !!x?.canEdit;
  const today = x?.activity.filter((a) => a.at > Date.now() - 86_400_000) ?? [];
  const blocked = today.filter((a) => a.status >= 400).length;

  return (
    <>
      <PageHeader crumb="Admin · every call is scoped, signed and logged" title="Integrations & API">
        {edit && <button className="btn primary" onClick={() => setNewOpen(!newOpen)}>+ New connection</button>}
      </PageHeader>
      <main className="page">
        {!edit && <div className="finding" role="note"><span className="ico sm info" aria-hidden="true">i</span><p className="sub" style={{ flex: 1 }}>You can look, but only an admin (S. Grant in this demo) can change partners, scopes or keys.</p></div>}
        <ErrorBox e={err} />
        {secret && (
          <div className="card pad enter" role="alert" style={{ borderColor: "var(--warn)", display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="h2">Copy this secret now</h2>
            <p className="sub">It is shown once. Lotergeist keeps only a hash. Rotating again makes this one stop working.</p>
            <div className="kv"><div><div className="label">client_id</div><div className="mono" style={{ overflowWrap: "anywhere" }}>{secret.clientId}</div></div><div><div className="label">client_secret</div><div className="mono" style={{ overflowWrap: "anywhere" }}>{secret.clientSecret}</div></div></div>
            <div><button className="btn" onClick={() => setSecret(null)}>I saved it</button></div>
          </div>
        )}
        {newOpen && edit && x && <NewConnection scopes={x.scopes} onDone={(s) => { setSecret(s); setNewOpen(false); refresh(); }} onError={setErr} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <Kpi label="Active connections" value={String(x?.partners.filter((p) => p.status === "active").length ?? "—")} chip={x ? { cls: "chip ok", t: `${x.partners.filter((p) => p.status === "revoked").length} revoked` } : undefined} />
          <Kpi label="API calls, last 24 hours" value={String(today.length)} sub={today.length ? `${(((today.length - blocked) / today.length) * 100).toFixed(1)}% allowed` : "No calls yet"} />
          <Kpi label="Blocked requests" value={String(blocked)} chip={blocked ? { cls: "chip warn", t: "Scope, IP or token" } : { cls: "chip ok", t: "None" }} />
          <Kpi label="Audit chain" value={x?.security.auditChain.ok ? "Intact" : "Broken"} sub={`${x?.security.auditChain.rows ?? 0} entries verified`} />
        </div>

        <section className="card" aria-labelledby="conn" style={{ overflow: "hidden" }}>
          <div style={{ padding: "18px 20px" }}><h2 id="conn" className="h2">Connected partners</h2></div>
          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ minWidth: 980 }}>
              <thead><tr><th scope="col">Partner</th><th scope="col">How</th><th scope="col">Can see</th><th scope="col">Allowlist</th><th scope="col">Last call</th><th scope="col">Status</th>{edit && <th scope="col"><span className="sr">Actions</span></th>}</tr></thead>
              <tbody>
                {x?.partners.map((p) => (
                  <tr key={p.id}>
                    <td><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontWeight: 500 }}>{p.partner}</span><span className="label">{p.note || p.purpose}</span><span className="label mono">{p.id} · key {p.keyPrefix}…</span></span></td>
                    <td><span className={KIND_CHIP[p.kind]}>{p.kind === "REST" ? "REST API" : p.kind === "MCP" ? "MCP" : "FHIR R4"}</span></td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(Object.keys(x.scopes) as Scope[]).map((s) => {
                          const has = p.scopes.includes(s);
                          return (
                            <span key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <button className="switch" role="switch" aria-checked={has} aria-label={`${s} for ${p.partner}`} disabled={!edit || p.status === "revoked" || update.isPending}
                                onClick={() => update.mutate({ id: p.id, body: { scopes: has ? p.scopes.filter((y) => y !== s) : [...p.scopes, s] } })} />
                              <span className="mono" style={{ fontSize: 12, color: has ? "var(--text)" : "var(--subtle)" }}>{s}</span>
                            </span>
                          );
                        })}
                        {p.scopes.includes("patient.read") && <span className="label">BAA on file · approved by {p.approvedBy}</span>}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{p.ipAllowlist.length ? p.ipAllowlist.join(", ") : <span className="chip warn">any IP</span>}</td>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{p.lastUsed ? when(p.lastUsed) : "never"}<div className="label">{p.calls24h} calls · {p.denied24h} denied</div></td>
                    <td><span className={p.status === "active" ? "chip ok" : "chip bad"}>{p.status === "active" ? "Active" : "Revoked"}</span></td>
                    {edit && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button className="btn" disabled={rotate.isPending || p.status === "revoked"} onClick={() => rotate.mutate(p.id)}>Rotate secret</button>
                          {p.status === "active"
                            ? <button className="btn outline-bad" onClick={() => update.mutate({ id: p.id, body: { status: "revoked" } })}>Revoke</button>
                            : <button className="btn" onClick={() => update.mutate({ id: p.id, body: { status: "active" } })}>Restore</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "stretch" }}>
          <TryIt partners={x?.partners ?? []} canEdit={edit} onRotate={(id) => rotate.mutateAsync(id)} onCalled={refresh} />
          <section className="card pad" aria-labelledby="sec" style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="sec" className="h2">Security</h2>
            {x?.security.checks.map((c) => (
              <div key={c.label} className="finding" style={{ padding: "10px 12px" }}>
                <span className={`ico sm ${c.ok ? "ok" : "warn"}`} aria-hidden="true">{c.ok ? "✓" : "!"}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 500 }}><span className="sr">{c.ok ? "OK: " : "Attention: "}</span>{c.label}</span><span className="label">{c.detail}</span></span>
              </div>
            ))}
            {user.role === "admin" && <a className="btn" href="/api/audit/export">Export audit log (NDJSON)</a>}
          </section>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "stretch" }}>
          <section className="card" aria-labelledby="log" style={{ flex: "1 1 560px", minWidth: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", flexWrap: "wrap", gap: 8 }}><h2 id="log" className="h2">API activity</h2><span className="label">Arguments stored as a hash, never raw</span></div>
            <div style={{ overflowX: "auto", maxHeight: 420 }}>
              <table className="t" style={{ minWidth: 620, fontSize: 13 }}>
                <thead><tr><th scope="col">Time</th><th scope="col">Client</th><th scope="col">Call</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {x?.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</td>
                      <td>{a.partner}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{a.surface} {a.method} {a.path}{a.tool ? ` · ${a.tool}` : ""}</td>
                      <td><span className={a.status < 400 ? "chip ok" : "chip bad"}>{a.status}{a.denied ? ` · ${a.denied}` : ""} · {a.latencyMs} ms</span></td>
                    </tr>
                  ))}
                  {x && !x.activity.length && <tr><td colSpan={4} className="sub">No partner calls yet. Use “Try it” above.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <Webhooks x={x} edit={edit} onError={setErr} onDone={refresh} />
        </div>
        <p className="label" style={{ margin: 0 }}>Demo environment · synthetic partners and data · nothing here contacts a real pharmacy, wholesaler or EHR</p>
      </main>
    </>
  );
}

const Kpi = ({ label, value, sub, chip }: { label: string; value: string; sub?: string; chip?: { cls: string; t: string } }) => (
  <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="label">{label}</span><span style={{ fontSize: 28, fontWeight: 600 }}>{value}</span>
    {sub && <span className="sub">{sub}</span>}{chip && <span className={chip.cls} style={{ alignSelf: "flex-start" }}>{chip.t}</span>}
  </div>
);

function NewConnection({ scopes, onDone, onError }: { scopes: Record<Scope, string>; onDone: (s: { clientId: string; clientSecret: string }) => void; onError: (e: string) => void }) {
  const [partner, setPartner] = useState("");
  const [kind, setKind] = useState<"REST" | "MCP" | "FHIR">("REST");
  const [sc, setSc] = useState<Scope[]>(["availability.check"]);
  const [ip, setIp] = useState("");
  const [baa, setBaa] = useState(false);
  const [purpose, setPurpose] = useState("");
  const create = useMutation({
    mutationFn: () => post<{ clientId: string; clientSecret: string }>("/api/integrations", { partner, kind, scopes: sc, ipAllowlist: ip.split(/[\s,]+/).filter(Boolean), baa, purpose }),
    onSuccess: (r) => onDone({ clientId: r.clientId, clientSecret: r.clientSecret }), onError: (e) => onError(msg(e))
  });
  return (
    <form className="card pad enter" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 className="h2">New connection</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">Partner name</span><input className="field" value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Riverside Regional Hospital (synthetic)" /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">Connects by</span><select className="field" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="REST">REST API</option><option value="MCP">MCP (AI agent)</option><option value="FHIR">FHIR R4</option></select></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">IP allowlist (optional, comma separated)</span><input className="field" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.20.0.15" /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Permissions (least access by default)</legend>
        {(Object.keys(scopes) as Scope[]).map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="switch" role="switch" aria-checked={sc.includes(s)} aria-label={s} onClick={() => setSc(sc.includes(s) ? sc.filter((x) => x !== s) : [...sc, s])} />
            <span style={{ display: "flex", flexDirection: "column" }}><span className="mono">{s}</span><span className="label">{scopes[s]}</span></span>
          </span>
        ))}
      </fieldset>
      {sc.includes("patient.read") && (
        <div className="finding warn" style={{ flexDirection: "column" }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={baa} onChange={(e) => setBaa(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />A signed business associate agreement is on file</label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}><span className="label">Documented purpose (saved with your approval)</span><input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
        </div>
      )}
      <div><button className="btn primary" disabled={partner.trim().length < 3 || !sc.length || create.isPending} type="submit">Create and show secret</button></div>
    </form>
  );
}

/** A real call against the partner API: get a token with client credentials, then call the endpoint. */
function TryIt({ partners, canEdit, onRotate, onCalled }: { partners: Partner[]; canEdit: boolean; onRotate: (id: string) => Promise<{ clientId: string; clientSecret: string }>; onCalled: () => void }) {
  const [kind, setKind] = useState<"REST" | "MCP" | "FHIR">("REST");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [path, setPath] = useState(EXAMPLES.REST.path);
  const [body, setBody] = useState("");
  const [out, setOut] = useState<{ status: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ex = EXAMPLES[kind];
  const pick = (k: typeof kind) => { setKind(k); setPath(EXAMPLES[k].path); setBody(EXAMPLES[k].body ? JSON.stringify(EXAMPLES[k].body, null, 2) : ""); setOut(null); const p = partners.find((x) => x.kind === k && x.status === "active"); if (p) { setClientId(p.id); setClientSecret(""); } };
  const run = async () => {
    setBusy(true); setOut(null);
    try {
      const t = await fetch("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }) });
      const tj = await t.json();
      if (!t.ok) { setOut({ status: t.status, text: `POST /oauth/token -> ${t.status}\n${JSON.stringify(tj, null, 2)}` }); return; }
      const method = kind === "MCP" ? "POST" : "GET";
      const r = await fetch(path, { method, headers: { authorization: `Bearer ${tj.access_token}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, body: method === "POST" ? body : undefined });
      const txt = await r.text();
      let pretty = txt;
      try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* not JSON */ }
      setOut({ status: r.status, text: `POST /oauth/token -> 200 (scope: ${tj.scope}, expires in ${tj.expires_in}s)\n${method} ${path} -> ${r.status}\n\n${pretty}` });
    } catch (e) { setOut({ status: 0, text: msg(e) }); } finally { setBusy(false); onCalled(); }
  };
  return (
    <section className="card pad" aria-labelledby="dev" style={{ flex: "1 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 id="dev" className="h2">Connect a system · try it live</h2>
        <div className="tabs" role="tablist" aria-label="Connection type">
          {(["REST", "MCP", "FHIR"] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => pick(k)}>{k === "REST" ? "REST API" : k === "MCP" ? "MCP server" : "FHIR R4"}</button>)}
        </div>
      </div>
      <p className="sub" style={{ fontSize: 14 }}>{ex.blurb}</p>
      <div className="kv"><div><div className="label">Endpoint</div><div className="mono" style={{ marginTop: 4, overflowWrap: "anywhere" }}>{ex.endpoint}</div></div><div><div className="label">Sign-in</div><div style={{ marginTop: 4, fontSize: 13 }}>{ex.auth}</div></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">client_id</span><input className="field mono" value={clientId} onChange={(e) => setClientId(e.target.value)} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">client_secret</span><input className="field mono" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} /></label>
      </div>
      {canEdit && clientId && <button className="btn" style={{ alignSelf: "flex-start" }} onClick={async () => { const s = await onRotate(clientId); setClientSecret(s.clientSecret); }}>Rotate {clientId} and fill in the new secret</button>}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">{kind === "MCP" ? "POST" : "GET"} path</span><input className="field mono" value={path} onChange={(e) => setPath(e.target.value)} /></label>
      {kind === "MCP" && <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="label">JSON-RPC body</span><textarea className="field mono" rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></label>}
      <div><button className="btn primary" disabled={busy || !clientId || !clientSecret} onClick={run}>{busy ? "Calling…" : "Send request"}</button></div>
      {out && <pre aria-live="polite" className="mono enter" style={{ margin: 0, padding: 16, borderRadius: 12, background: "var(--sunken)", border: "1px solid var(--border)", overflow: "auto", maxHeight: 360, fontSize: 12, lineHeight: 1.6, color: out.status && out.status < 400 ? "var(--text)" : "var(--danger-text)" }}>{out.text}</pre>}
    </section>
  );
}

function Webhooks({ x, edit, onError, onDone }: { x?: Data; edit: boolean; onError: (e: string) => void; onDone: () => void }) {
  const [partner, setPartner] = useState("int-mercy-clinic");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["recall.matched"]);
  const [created, setCreated] = useState<{ id: number; secret: string } | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      // Empty URL = the built-in sink, which verifies the signature (so the demo can prove it end to end).
      const r = await post<{ id: number; secret: string }>(`/api/integrations/${partner}/webhooks`, { url: url || `http://localhost:${window.location.port === "5173" ? "4000" : window.location.port || "4000"}/hooks/sink/next`, events });
      return r;
    },
    onSuccess: (r) => { setCreated(r); onDone(); }, onError: (e) => onError(msg(e))
  });
  return (
    <section className="card pad" aria-labelledby="wh" style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="wh" className="h2">Webhooks</h2>
      <p className="sub">Signed with HMAC-SHA256 (<span className="mono">X-Lotergeist-Signature: t=…,v1=…</span>), retried with backoff. Payloads carry ids and counts, never patient details.</p>
      {edit && (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select aria-label="Partner" className="field" value={partner} onChange={(e) => setPartner(e.target.value)}>{x?.partners.map((p) => <option key={p.id} value={p.id}>{p.partner}</option>)}</select>
          <input aria-label="Webhook URL" className="field mono" placeholder="https://partner.example/hooks (empty = built-in test sink)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{x?.events.map((ev) => <button type="button" key={ev} className={`pill${events.includes(ev) ? " on" : ""}`} onClick={() => setEvents(events.includes(ev) ? events.filter((y) => y !== ev) : [...events, ev])}>{ev}</button>)}</div>
          <div><button className="btn" type="submit" disabled={!events.length || add.isPending}>Add webhook</button></div>
          {created && <p className="label">Webhook {created.id} signing secret (shown once): <span className="mono">{created.secret}</span></p>}
        </form>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflow: "auto" }}>
        {x?.deliveries.map((d) => (
          <li key={d.id} className="finding" style={{ padding: "8px 12px", alignItems: "center" }}>
            <span className={d.status === "delivered" ? "chip ok" : d.status === "failed" ? "chip bad" : "chip warn"}>{d.status}</span>
            <span style={{ flex: 1, minWidth: 0 }}><span className="mono" style={{ fontSize: 12 }}>{d.type}</span><span className="label" style={{ display: "block", overflowWrap: "anywhere" }}>{d.partner} · {d.url}{d.error ? ` · ${d.error}` : ""} · try {d.attempt}</span></span>
          </li>
        ))}
        {x && !x.deliveries.length && <li className="sub">No deliveries yet. They start when a subscribed event happens (for example a recall match).</li>}
      </ul>
      {!!x?.sink.length && <p className="label">Built-in sink received {x.sink.length} event(s); {x.sink.filter((s) => s.verified).length} with a valid signature.</p>}
    </section>
  );
}
