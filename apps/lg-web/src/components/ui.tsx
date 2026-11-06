import type { ReactNode } from "react";
import type { Check } from "../lib/api";

export const Tag = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`tag ${tone}`}>{children}</span>;

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <div role="list">
      {checks.map((c) => (
        <div className={`check ${c.state}`} role="listitem" key={c.id}>
          <span className="m" aria-hidden>{c.state === "pass" ? "✓" : c.state === "fail" ? "✕" : "!"}</span>
          <div>
            <div><span className="sr" style={{ position: "absolute", left: -9999 }}>{c.state}: </span>{c.label}</div>
            {c.detail && <div className="dim" style={{ fontSize: 12 }}>{c.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export const statusTone = (s: string) => ({ recall: "red", exp: "amber", ok: "green", low: "violet" } as Record<string, string>)[s] ?? "gray";
export const Err = ({ e }: { e: string }) => (e ? <div className="err" role="alert" style={{ margin: "10px 0" }}>{e}</div> : null);
export const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
