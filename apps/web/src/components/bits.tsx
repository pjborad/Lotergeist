import type { ReactNode } from "react";

export const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Footer = () => (
  <footer className="footer">
    <span>Built with Kiro · specs, hooks &amp; steering per organ</span>
    <span className="mono">Every cursed lot, found.</span>
  </footer>
);

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="warnbox">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
        <path d="M10 2l8.5 15h-17z" stroke="#ff8a6e" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 8v4M10 14.5v.5" stroke="#ff8a6e" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export const fmtConf = (n: number) => n.toFixed(2);
