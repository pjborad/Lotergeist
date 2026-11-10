import { useEffect, useRef, useState } from "react";
import { msg, post, type ScanInput } from "../lib/api";
import { frameOf, readText } from "../lib/ocr";
import { startScanner, type ScannerHandle } from "../lib/scanner";
import { play } from "../lib/sound";
import { btn, C, ErrorBox, Icon, input, label, MONO } from "./kit";

interface Fields { ndc: string; lot: string; expiry: string; serial: string }
const small = { minHeight: 44, fontSize: 14 } as const;

/**
 * The live scanner card, in the Receive mockup's style: webcam DataMatrix (BarcodeDetector or zxing), a USB scanner or
 * typing (scanners type the code and press Enter), and "Read label text" (browser OCR) for labels without a barcode.
 */
export function ScanPanel({ onScan, title, hint, busy }: { onScan: (i: ScanInput) => void; title: string; hint?: string; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const handle = useRef<ScannerHandle | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocr, setOcr] = useState<{ fields: Fields; notes: string[]; text: string } | null>(null);
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => () => handle.current?.stop(), []);

  async function start() {
    setErr("");
    try {
      handle.current = await startScanner({ video: video.current!, onCode: (raw) => { play("chime"); cb.current({ raw, source: "datamatrix" }); window.setTimeout(() => handle.current?.resume(), 1800); } });
      setOn(true);
    } catch (e) { setErr(msg(e)); }
  }
  function stop() { handle.current?.stop(); handle.current = null; setOn(false); }
  async function runOcr(src: HTMLCanvasElement | Blob) {
    setOcrBusy(true); setErr("");
    try {
      const { text } = await readText(src);
      const p = await post<{ ndc?: string; lot?: string; expiry?: string; serial?: string; notes: string[] }>("/api/ocr/parse", { text });
      setOcr({ fields: { ndc: p.ndc ?? "", lot: p.lot ?? "", expiry: p.expiry ?? "", serial: p.serial ?? "" }, notes: p.notes, text });
    } catch (e) { setErr(msg(e)); } finally { setOcrBusy(false); }
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 20, alignItems: "center", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ position: "relative", width: on ? "100%" : 132, height: on ? 300 : 132, flexShrink: 0, borderRadius: 12, background: C.bg, border: `1px solid ${C.line2}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <video ref={video} aria-label="Camera preview" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: on ? "block" : "none" }} />
          {!on && Icon.scan(C.violet, 56)}
          {on && <span aria-hidden="true" style={{ position: "absolute", inset: "12% 30%", border: `2px solid ${C.violet}`, borderRadius: 12, boxShadow: "0 0 0 999px rgba(11,14,20,0.35)" }} />}
          <span className="laser" aria-hidden="true" style={{ position: "absolute", left: on ? "30%" : 8, right: on ? "30%" : 8, height: 2, background: C.violet, boxShadow: "0 0 12px 2px var(--accent-soft)" }} />
        </div>
        {!on && (
          <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: C.violet3, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: C.violet }} />Ready to scan · 2D DataMatrix</h2>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{title}</p>
            {hint && <p style={{ margin: 0, fontSize: 14, color: C.dim, lineHeight: 1.6 }}>{hint}</p>}
          </div>
        )}
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {on ? <button onClick={stop} style={btn("ghost", small)}>Stop camera</button> : <button onClick={start} style={btn("primary", small)}>{Icon.scan(C.bg)}Scan with camera</button>}
          <button disabled={!on || ocrBusy} onClick={() => runOcr(frameOf(video.current!))} style={btn("ghost", { ...small, opacity: !on ? 0.5 : 1 })}>{ocrBusy ? "Reading…" : "Read label text (OCR)"}</button>
          <label style={{ ...btn("ghost", small), cursor: "pointer" }}>Upload a label photo<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void runOcr(f); e.target.value = ""; }} /></label>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { cb.current({ raw: typed.trim(), source: "typed" }); setTyped(""); } }} style={{ display: "flex", gap: 10 }}>
          <label htmlFor="typed" className="sr">USB scanner or typed GS1 code</label>
          <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="USB scanner, or type (01)…(17)…(10)…(21)…" autoComplete="off" style={input({ flex: 1, fontFamily: MONO, fontSize: 13 })} />
          <button disabled={busy || !typed.trim()} style={btn("ghost", { ...small, minHeight: 46 })}>Check</button>
        </form>
        <span style={{ fontSize: 12, color: C.dimmer }}>OCR runs in this browser; nothing is uploaded. Always check what it read.</span>
        <ErrorBox e={err} />
        {ocr && (
          <div style={{ background: C.well, border: `1px solid ${C.line2}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <strong style={{ fontSize: 14 }}>OCR read this. Check it, fix it, then use it.</strong>
            {ocr.notes.length > 0 && <span style={{ fontSize: 13, color: C.amber2 }}>{ocr.notes.join(" ")}</span>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {(["ndc", "lot", "expiry", "serial"] as const).map((k) => (
                <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label htmlFor={`ocr-${k}`} style={label}>{k === "ndc" ? "NDC" : k[0]!.toUpperCase() + k.slice(1)}</label>
                  <input id={`ocr-${k}`} value={ocr.fields[k]} onChange={(e) => setOcr({ ...ocr, fields: { ...ocr.fields, [k]: e.target.value } })} style={input({ fontFamily: MONO, fontSize: 14, height: 42 })} />
                </div>
              ))}
            </div>
            <details><summary style={{ fontSize: 12, color: C.dimmer, cursor: "pointer" }}>Raw OCR text</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: MONO, fontSize: 11, color: C.dim }}>{ocr.text}</pre></details>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={() => { cb.current({ fields: ocr.fields, source: "ocr" }); setOcr(null); }} style={btn("primary", small)}>Use these values</button>
              <button onClick={() => setOcr(null)} style={btn("ghost", small)}>Discard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
