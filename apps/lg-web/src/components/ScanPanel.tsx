import { useEffect, useRef, useState } from "react";
import { msg, post, type ScanInput } from "../lib/api";
import { frameOf, readText } from "../lib/ocr";
import { startScanner, type ScannerHandle } from "../lib/scanner";
import { play } from "../lib/sound";

interface Fields { ndc: string; lot: string; expiry: string; serial: string }

/**
 * One scan card for every screen: webcam DataMatrix (BarcodeDetector or zxing), a USB scanner or typing into the box
 * (scanners act as keyboards and end with Enter), and "Read label text" (browser OCR) for labels with no barcode.
 */
export function ScanPanel({ onScan, title = "Scan the package", busy }: { onScan: (i: ScanInput) => void; title?: string; busy?: boolean }) {
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
    <div className="scan" aria-label={title}>
      <div className="spread" style={{ marginBottom: 10 }}>
        <strong>{title}</strong>
        {on ? <button className="btn ghost sm" onClick={stop}>Stop camera</button> : <button className="btn sm" onClick={start}>Start camera</button>}
      </div>
      <div className="cam" style={on ? undefined : { aspectRatio: "16 / 6" }}>
        <video ref={video} aria-label="Camera preview" />
        {on ? <><div className="frame" /><div className="laser" /></> : <span className="dim" style={{ position: "relative" }}>Camera is off. Use a USB scanner, type, or start the camera.</span>}
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { cb.current({ raw: typed.trim(), source: "typed" }); setTyped(""); } }}>
        <input aria-label="Scan or type a GS1 code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="USB scanner or paste: (01)…(17)…(10)…(21)…" className="mono" style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--line2)", borderRadius: 8, padding: "8px 10px" }} />
        <button className="btn ghost sm" disabled={busy || !typed.trim()}>Check</button>
      </form>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn ghost sm" disabled={!on || ocrBusy} onClick={() => runOcr(frameOf(video.current!))}>{ocrBusy ? "Reading…" : "Read label text (OCR)"}</button>
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>
          Upload a label photo
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void runOcr(f); e.target.value = ""; }} />
        </label>
        <span className="dimmer" style={{ fontSize: 12 }}>OCR runs in your browser. Always check what it read.</span>
      </div>
      {ocr && (
        <div className="card" style={{ marginTop: 12, background: "var(--panel)" }}>
          <strong>OCR read this. Check it, fix it, then use it.</strong>
          {ocr.notes.length > 0 && <div className="warnbox" style={{ margin: "8px 0" }}>{ocr.notes.join(" ")}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            {(["ndc", "lot", "expiry", "serial"] as const).map((k) => (
              <div className="field" key={k} style={{ marginBottom: 0 }}>
                <label htmlFor={`ocr-${k}`}>{k === "ndc" ? "NDC" : k[0]!.toUpperCase() + k.slice(1)}</label>
                <input id={`ocr-${k}`} className="mono" value={ocr.fields[k]} onChange={(e) => setOcr({ ...ocr, fields: { ...ocr.fields, [k]: e.target.value } })} />
              </div>
            ))}
          </div>
          <details style={{ marginTop: 8 }}><summary className="dim">Raw text</summary><pre className="mono dim" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{ocr.text}</pre></details>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" disabled={busy} onClick={() => { cb.current({ fields: ocr.fields, source: "ocr" }); setOcr(null); }}>Use these values</button>
            <button className="btn ghost sm" onClick={() => setOcr(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
