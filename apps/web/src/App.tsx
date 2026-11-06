import { useSyncExternalStore } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CurrentRecallProvider, useCurrentRecall } from "./lib/current";
import { useRecalls } from "./lib/hooks";
import { reducedMotion, setSound, soundOn, subscribeSound } from "./lib/sound";
import BodyTrail from "./screens/BodyTrail";
import CryptGate from "./screens/CryptGate";
import Hearse from "./screens/Hearse";
import Scan from "./screens/Scan";
import SoulCatcher from "./screens/SoulCatcher";

export function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M14 3h12l6 9-4 25H12L8 12z" stroke="#b8f27c" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20 12v14M15 17h10" stroke="#b8f27c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 31l3-1M27 30l3 1M11 22l2 0M27 22l2 0" stroke="#5c6a52" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => false);
  const locked = reducedMotion();
  return (
    <button
      className="candle"
      aria-pressed={on}
      disabled={locked}
      title={locked ? "Sound stays off with reduced motion" : on ? "Sound on" : "Sound off"}
      aria-label={locked ? "Sound is off because reduced motion is on" : on ? "Turn sound off" : "Turn sound on"}
      onClick={() => setSound(!on)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2c1.6 2.2 2.4 3.6 2.4 5a2.4 2.4 0 01-4.8 0c0-1.4.8-2.8 2.4-5z" fill={on ? "#f2b544" : "none"} stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 11h6v7H7z" stroke="currentColor" strokeWidth="1.4" />
        {!on && <path d="M3 17L17 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
      </svg>
    </button>
  );
}

function Shell() {
  const { id } = useCurrentRecall();
  const { error } = useRecalls();
  const loc = useLocation();
  const q = id ? `?r=${encodeURIComponent(id)}` : "";
  const link = (to: string, label: string) => (
    <NavLink to={{ pathname: to, search: q }} end aria-current={loc.pathname === to ? "page" : undefined}>{label}</NavLink>
  );
  return (
    <div className="app">
      <div aria-hidden="true" className="fog fogbg" />
      <div role="note" className="banner">Synthetic data only · Not for clinical use · Not HIPAA-compliant · A pharmacist approves every message</div>
      {error && <div role="alert" className="apierr">{(error as Error).message}</div>}
      <header className="header">
        <Link to={{ pathname: "/", search: q }} className="brand">
          <Logo />
          <span className="brand-text"><span className="brand-name">Body Snatcher Rx</span><span className="brand-tag">LOT-LEVEL RECALL HUNTER</span></span>
        </Link>
        <nav className="nav" aria-label="Stages">
          {link("/", "I · Death Notice")}
          {link("/trail", "II · Body Trail")}
          {link("/scan", "III · Scan")}
          {link("/hearse", "IV · Hearse")}
          {link("/fill", "V · Soul Catcher")}
          <SoundToggle />
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<CryptGate />} />
        <Route path="/trail" element={<BodyTrail />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/hearse" element={<Hearse />} />
        <Route path="/fill" element={<SoulCatcher />} />
        <Route path="*" element={<CryptGate />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <CurrentRecallProvider>
      <Shell />
    </CurrentRecallProvider>
  );
}
