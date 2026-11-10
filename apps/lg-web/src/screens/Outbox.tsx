import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { C, Footer, MONO, pill, TONES, when } from "../components/kit";
import { mainStyle, PageHeader } from "../components/Shell";

const STATUS: Record<string, string> = { delivered: "green", sent: "violet", failed: "red", queued: "amber" };

export function Outbox() {
  const q = useQuery({ queryKey: ["outbox"], queryFn: () => get<any[]>("/api/outbox"), refetchInterval: 3000 });
  return (
    <>
      <PageHeader title="Sandbox outbox" sub="Every text and email Lotergeist “sent”. Nothing leaves this computer." />
      <main style={mainStyle()}>
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ textAlign: "left", fontSize: 12, color: C.dimmer, background: C.well }}>{["When", "Channel", "To", "Message", "Status"].map((h) => <th key={h} scope="col" style={{ padding: "12px 16px", fontWeight: 500 }}>{h}</th>)}</tr></thead>
            <tbody>
              {q.data?.map((o) => (
                <tr key={o.id} style={{ borderTop: `1px solid ${C.line}`, verticalAlign: "top" }}>
                  <td style={{ padding: "12px 16px", color: C.dim, whiteSpace: "nowrap" }}>{when(o.created_at)}</td>
                  <td style={{ padding: "12px 16px" }}><span style={pill(...TONES[o.channel === "sms" ? "violet" : "cold"]!)}>{o.channel === "sms" ? "Text" : "Email"}</span></td>
                  <td style={{ padding: "12px 16px", fontFamily: MONO, fontSize: 13, color: C.ink2, whiteSpace: "nowrap" }}>{o.to_addr}</td>
                  <td style={{ padding: "12px 16px", maxWidth: 560 }}>{o.subject && <div style={{ fontWeight: 500 }}>{o.subject}</div>}<div style={{ color: C.dim, whiteSpace: "pre-wrap" }}>{o.body}</div></td>
                  <td style={{ padding: "12px 16px" }}><span style={pill(...TONES[STATUS[o.status] ?? "gray"]!)}>{o.status}</span></td>
                </tr>
              ))}
              {!q.data?.length && <tr><td colSpan={5} style={{ padding: 16, color: C.dim }}>Empty. Messages appear here when a pharmacist sends recall notices.</td></tr>}
            </tbody>
          </table>
        </div>
        <Footer />
      </main>
    </>
  );
}
