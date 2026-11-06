import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { Tag, when } from "../components/ui";

export function Outbox() {
  const q = useQuery({ queryKey: ["outbox"], queryFn: () => get<any[]>("/api/outbox"), refetchInterval: 3000 });
  return (
    <>
      <h1>Sandbox outbox</h1>
      <p className="sub">Every text and email the app “sent”. Nothing leaves this computer. A real provider would be plugged in behind the same interface.</p>
      <div className="card" style={{ marginTop: 16, padding: 0, overflow: "auto" }}>
        <table>
          <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>
            {q.data?.map((o) => (
              <tr key={o.id}>
                <td className="dim">{when(o.created_at)}</td><td><Tag tone={o.channel === "sms" ? "violet" : "cold"}>{o.channel}</Tag></td>
                <td className="mono">{o.to_addr}</td>
                <td style={{ maxWidth: 520 }}>{o.subject && <strong>{o.subject}<br /></strong>}<span className="dim" style={{ whiteSpace: "pre-wrap" }}>{o.body}</span></td>
                <td>{o.status}</td>
              </tr>
            ))}
            {!q.data?.length && <tr><td colSpan={5} className="dim">Empty.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
