/* Design kit lifted from the Lotergeist mockups (Dashboard/Receive/Inventory/Dispense/Recall .dc.html). */
import type { CSSProperties, ReactNode } from "react";
import type { Check } from "../lib/api";

export const C = {
  bg: "var(--bg)", side: "var(--surface)", card: "var(--surface)", well: "var(--surface-2)", line: "var(--border)", line2: "var(--border-strong)", chip: "var(--sunken)", track: "var(--border)",
  ink: "var(--text)", ink2: "var(--text)", dim: "var(--muted)", dimmer: "var(--subtle)", faint: "var(--subtle)",
  violet: "var(--accent)", violet2: "var(--accent-text)", violet3: "var(--accent-text)", red: "var(--danger)", red2: "var(--danger-text)", red3: "var(--danger-text)", redText: "var(--danger-text)",
  green: "var(--ok)", green2: "var(--ok-text)", amber: "var(--warn)", amber2: "var(--warn-text)", orange2: "var(--warn-text)", cold: "var(--info-text)", cold2: "var(--info-text)", ctrl: "var(--warn)",
  onAccent: "var(--on-accent)", accentSoft: "var(--accent-soft)", okSoft: "var(--ok-soft)", warnSoft: "var(--warn-soft)", dangerSoft: "var(--danger-soft)", infoSoft: "var(--info-soft)"
};
export const MONO = "'JetBrains Mono', monospace";

/** pill(c, bg) exactly as the mockups build them */
export const pill = (c: string, bg: string, extra: CSSProperties = {}): CSSProperties => ({ display: "inline-block", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, padding: "3px 10px", borderRadius: 999, color: c, background: bg, ...extra });
export const TONES: Record<string, [string, string]> = {
  green: ["var(--ok-text)", "var(--ok-soft)"], violet: ["var(--accent-text)", "var(--accent-soft)"], orange: ["var(--warn-text)", "var(--warn-soft)"],
  amber: ["var(--warn-text)", "var(--warn-soft)"], red: ["var(--danger-text)", "var(--danger-soft)"], cold: ["var(--info-text)", "var(--info-soft)"], gray: ["var(--muted)", "var(--sunken)"]
};
export const Pill = ({ tone, children, style }: { tone: keyof typeof TONES | string; children: ReactNode; style?: CSSProperties }) => {
  const [c, bg] = TONES[tone] ?? TONES.gray!;
  return <span style={pill(c, bg, style)}>{children}</span>;
};

export const card = (extra: CSSProperties = {}): CSSProperties => ({ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "var(--shadow)", ...extra });
export const btn = (kind: "primary" | "ghost" | "red" | "green" = "primary", extra: CSSProperties = {}): CSSProperties => ({
  minHeight: 44, padding: kind === "ghost" ? "0 16px" : "0 20px", borderRadius: 10, fontSize: 14,
  border: kind === "ghost" ? `1px solid ${C.line2}` : 0,
  background: { primary: C.violet, ghost: C.card, red: C.red, green: C.green }[kind],
  color: { primary: C.onAccent, ghost: C.ink, red: "#fff", green: "#04261A" }[kind],
  fontWeight: kind === "ghost" ? 400 : 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", ...extra
});
export const disabledBtn: CSSProperties = { background: C.chip, color: C.dimmer, border: `1px solid ${C.line}` };
export const input = (extra: CSSProperties = {}): CSSProperties => ({ height: 46, boxSizing: "border-box", padding: "0 14px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, color: C.ink, font: "inherit", fontSize: 15, ...extra });
export const label: CSSProperties = { fontSize: 12, color: C.dimmer };

export const Footer = () => (
  <p style={{ margin: 0, fontSize: 12, color: C.dimmer }}>Demo environment · synthetic data only · not for clinical use · not HIPAA-compliant · a pharmacist approves every message</p>
);

export function ErrorBox({ e }: { e: string }) {
  if (!e) return null;
  return <div role="alert" style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--danger)", background: C.dangerSoft, color: C.red3, fontSize: 14 }}>{e}</div>;
}

// ---- icons (paths copied from the mockups)
const I = ({ children, size = 18, stroke = "currentColor", w = 1.6 }: { children: ReactNode; size?: number; stroke?: string; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={stroke} strokeWidth={w} aria-hidden="true">{children}</svg>
);
export const Icon = {
  today: (s?: string) => <I stroke={s}><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></I>,
  truck: (s?: string) => <I stroke={s}><path d="M2 5h10v9H2zM12 8.5h3.2l2.8 3v2.5h-6z" /><circle cx="5.5" cy="15.5" r="1.5" /><circle cx="14.5" cy="15.5" r="1.5" /></I>,
  shelves: (s?: string) => <I stroke={s}><path d="M3 4h14M3 10h14M3 16h14M4 4v12M16 4v12" /></I>,
  rx: (s?: string) => <I stroke={s}><rect x="5" y="2.5" width="10" height="15" rx="2" /><path d="M8 7h4M10 5v4M8 12.5h4" /></I>,
  shield: (s?: string, size?: number) => <I stroke={s} size={size}><path d="M10 2.5l7 3v4.5c0 4-3 6.8-7 8-4-1.2-7-4-7-8V5.5z" /><path d="M10 7v4M10 13.5v.3" strokeLinecap="round" /></I>,
  scan: (s?: string, size?: number) => <I stroke={s} size={size}><path d="M3 5V3h2M15 3h2v2M17 15v2h-2M5 17H3v-2M6 7v6M9 7v6M12 7v6M14 7v6" /></I>,
  search: (s?: string) => <I stroke={s}><circle cx="9" cy="9" r="5.5" /><path d="M13 13l4 4" /></I>,
  tag: (s?: string) => <I stroke={s}><path d="M3 3h6l8 8-6 6-8-8z" /><circle cx="6.5" cy="6.5" r="1.2" /></I>,
  mail: (s?: string) => <I stroke={s}><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3 5.5l7 5 7-5" /></I>,
  chevron: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--subtle)" strokeWidth="1.6" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>,
  arrow: (s = "#fff") => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={s} strokeWidth="1.8" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>,
  logo: (size = 34) => (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true"><rect width="34" height="34" rx="9" fill="var(--accent-soft)" /><path d="M20 7a10 10 0 1 0 8 15A8.5 8.5 0 0 1 20 7z" fill="var(--accent)" /><path d="M14 14v7M10.5 17.5h7" stroke="var(--surface)" strokeWidth="2.2" strokeLinecap="round" /></svg>
  ),
  okSmall: () => <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="var(--ok-soft)" /><path d="M6.5 10.2l2.3 2.3 4.7-4.8" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  failSmall: () => <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="var(--danger-soft)" /><path d="M7 7l6 6M13 7l-6 6" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  warnSmall: () => <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="var(--warn-soft)" /><path d="M10 6v5M10 13.6v.2" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  okBig: (size = 44) => <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="var(--ok-soft)" /><path d="M14 22.5l5.5 5.5L30 17" stroke="var(--ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
};

/** The mockups' check rows: green tick, plus red cross / amber ! for the states a live system also produces. */
export function CheckList({ checks, cols = true }: { checks: Check[]; cols?: boolean }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: cols ? "repeat(auto-fit, minmax(220px, 1fr))" : "1fr", gap: 10 }}>
      {checks.map((c) => (
        <li key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: c.state === "fail" ? C.red3 : c.state === "warn" ? C.amber2 : C.ink2 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>{c.state === "pass" ? Icon.okSmall() : c.state === "fail" ? Icon.failSmall() : Icon.warnSmall()}</span>
          <span><span className="sr">{c.state === "pass" ? "Passed: " : c.state === "fail" ? "Failed: " : "Warning: "}</span>{c.label}{c.detail ? <span style={{ display: "block", fontSize: 12, color: C.dimmer }}>{c.detail}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Step bars used by Fill & pickup and the recall header. */
export function StepBars({ names, current, sep = "." }: { names: string[]; current: number; sep?: string }) {
  return (
    <ol aria-label="Steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${names.length}, minmax(0, 1fr))`, gap: 8 }}>
      {names.map((t, k) => {
        const done = k < current, cur = k === current;
        return (
          <li key={t} aria-current={cur ? "step" : undefined} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ height: 4, borderRadius: 999, background: done ? C.green : cur ? C.violet : C.track }} />
            <span style={{ fontSize: 13, fontWeight: cur ? 600 : 400, color: done ? C.green2 : cur ? C.ink : C.dimmer }}>{k + 1}{sep} {t}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
export const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
