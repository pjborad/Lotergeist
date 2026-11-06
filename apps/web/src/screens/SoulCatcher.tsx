import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Arrow, Footer, Warn } from "../components/bits";
import { post } from "../lib/api";
import { useFills, useFillScans, useFillStream } from "../lib/hooks";
import { startScanner, type ScannerHandle } from "../lib/scanner";
import { play } from "../lib/sound";
import type { FillItem, FillScanResult, FillStepView, FillVerdict, PipelineEvent } from "../lib/types";

const SAMPLE = "(01)00370004417051(17)271208(10)PRORX051125-2(21)000522";

const VERDICT: Record<FillVerdict, { word: string; color: string; tone: string; icon: JSX.Element }> = {
  CAPTURED: {
    word: "Captured", color: "#b8f27c", tone: "ok",
    icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M4 11.5l5 5 9-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  },
  WRONG_VESSEL: {
    word: "Wrong vessel", color: "#f2c26b", tone: "warn",
    icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M11 3l9 16H2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M11 9v5M11 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  },
  CURSED: {
    word: "Cursed", color: "#ff6b4a", tone: "bad",
    icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M5 5l12 12M17 5L5 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
  },
  DEPARTED: {
    word: "Departed", color: "#a9a392", tone: "dim",
    icon: <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M6 3h10M6 19h10M7 3c0 5 8 5 8 8s-8 3-8 8M15 3c0 5-8 5-8 8s8 3 8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  }
};

const writebackText = (r: FillScanResult, live: FillStepView[] | undefined) => {
  if (!r.fillAllowed) return { text: "Not written: the fill was blocked, so nothing goes into RxTerm 98.", tone: "dim" };
  if (r.writeback === "verified") return { text: "Written to RxTerm 98, verified.", tone: "ok" };
  if (r.writeback === "failed") return { text: "Not written back. The scan is kept and the bot will retry on the next run.", tone: "bad" };
  return { text: live?.at(-1)?.message ?? "Queued for the bot…", tone: "warn" };
};

export default function SoulCatcher() {
  const qc = useQueryClient();
  const { data: fills } = useFills();
  const { data: scans } = useFillScans();
  const [rx, setRx] = useState<string | null>(null);
  const [result, setResult] = useState<FillScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cam, setCam] = useState<"off" | "starting" | "on" | "error">("off");
  const [camMsg, setCamMsg] = useState<string | null>(null);
  const [backend, setBackend] = useState<string>("");
  const [steps, setSteps] = useState<Record<number, FillStepView[]>>({});
  const [usb, setUsb] = useState(false);
  const [typed, setTyped] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const handle = useRef<ScannerHandle | null>(null);
  const rxRef = useRef<string | null>(null);

  // pick the first waiting prescription (the "next" one) and keep it picked
  const current: FillItem | undefined = fills?.find((f) => f.rx === rx) ?? fills?.find((f) => f.status === "waiting") ?? fills?.[0];
  useEffect(() => { rxRef.current = current?.rx ?? null; }, [current?.rx]);

  useFillStream((e: PipelineEvent) => {
    if (e.type === "fill.step") {
      const s = e.data as FillStepView;
      setSteps((m) => ({ ...m, [s.scanId]: [...(m[s.scanId] ?? []), s].slice(-40) }));
    }
    if (e.type === "fill.writeback") {
      const w = e.data as { scanId: number; status: FillScanResult["writeback"] };
      setResult((r) => (r && r.id === w.scanId ? { ...r, writeback: w.status } : r));
    }
  });

  const scan = useMutation({
    mutationFn: (v: { raw: string; device: "webcam" | "usb" | "typed" }) => post<FillScanResult>(`/api/fills/${rxRef.current}/scan`, v),
    onSuccess: (r) => {
      setResult(r);
      setErr(null);
      play(r.verdict === "CAPTURED" ? "chime" : r.verdict === "CURSED" ? "crack" : "seal");
      void qc.invalidateQueries({ queryKey: ["fills"] });
      void qc.invalidateQueries({ queryKey: ["fill-scans"] });
    },
    onError: (e) => {
      setErr((e as Error).message);
      setResult(null);
      window.setTimeout(() => { videoRef.current?.play().catch(() => undefined); handle.current?.resume(); }, 1500); // garbled: try again
    }
  });
  const submit = scan.mutate;

  const stopCamera = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setCam("off");
  }, []);

  const startCamera = useCallback(async () => {
    if (!videoRef.current || handle.current) return;
    setCam("starting");
    setCamMsg(null);
    try {
      const h = await startScanner({
        video: videoRef.current,
        onCode: (text) => { videoRef.current?.pause(); submit({ raw: text, device: "webcam" }); } // freeze the frame on capture
      });
      handle.current = h;
      setBackend(h.backend === "barcode-detector" ? "BarcodeDetector" : "zxing-js");
      setCam("on");
    } catch (e) {
      setCam("error");
      setCamMsg((e as Error).message.includes("Permission") || (e as Error).name === "NotAllowedError" ? "Camera permission was denied. Use a USB scanner or type the code." : (e as Error).message || "No camera available. Use a USB scanner or type the code.");
    }
  }, [submit]);

  // SOUL-1: ask for the camera when the screen opens. SOUL-12: stop it when the user leaves.
  useEffect(() => {
    void startCamera();
    return () => { handle.current?.stop(); handle.current = null; };
  }, [startCamera]);

  const again = () => {
    setResult(null);
    setErr(null);
    setTyped("");
    setRx(null);
    void videoRef.current?.play().catch(() => undefined);
    handle.current?.resume();
  };

  const manual = (e: FormEvent) => { e.preventDefault(); if (typed.trim()) submit({ raw: typed.trim(), device: usb ? "usb" : "typed" }); };

  const v = result ? VERDICT[result.verdict] : null;
  const frame = result ? (result.verdict === "CAPTURED" ? "ok" : result.verdict === "CURSED" ? "bad" : "warn") : cam === "on" ? "search" : "idle";
  const wb = result ? writebackText(result, steps[result.id]) : null;
  const liveSteps = result ? steps[result.id] : undefined;
  const screenText = liveSteps?.findLast?.((s) => s.screen)?.screen;

  return (
    <main className="main tight" style={{ gap: 36 }}>
      <section>
        <p className="eyebrow">V · Soul Catcher · scan at fill · GS1 DataMatrix</p>
        <h1 className="display">Catch the lot before it leaves.</h1>
        <p className="lede">Hold the package to the lantern. We read the real 2D code, name the drug from openFDA, flag it against every active recall, and write the lot into the old terminal. A recalled lot never gets out.</p>
      </section>

      {cam === "error" && camMsg && <Warn>{camMsg}</Warn>}

      <section className="sc-grid">
        {/* ---- the prescription ticket */}
        <article className="sc-ticket" aria-labelledby="sc-rx">
          <p className="kicker">Prescription waiting</p>
          {current ? (
            <>
              <h2 id="sc-rx">Rx {current.rx}</h2>
              <dl>
                <div><dt>PATIENT</dt><dd>{current.patientId}</dd></div>
                <div><dt>DRUG</dt><dd>{current.drug}</dd></div>
                <div><dt>NDC</dt><dd className="mono">{current.ndc}</dd></div>
                <div><dt>STORE</dt><dd>{current.pharmacy}</dd></div>
              </dl>
            </>
          ) : <h2 id="sc-rx">The queue is empty</h2>}
          <p className="kicker" style={{ marginTop: 6 }}>FILL QUEUE · RxTerm 98 F2</p>
          <ul className="sc-queue">
            {(fills ?? []).map((f) => (
              <li key={f.rx}>
                <button className="sc-q" aria-pressed={f.rx === current?.rx} disabled={scan.isPending} onClick={() => { setRx(f.rx); setResult(null); setErr(null); void videoRef.current?.play().catch(() => undefined); handle.current?.resume(); }}>
                  <span className="mono">{f.rx}</span>
                  <span className="d">{f.drug}</span>
                  <span className={`chip2 ${f.status === "filled" ? "ok" : f.lastVerdict ? "bad" : ""}`}>{f.status === "filled" ? "FILLED" : f.lastVerdict ? f.lastVerdict.replace("_", " ") : "WAITING"}</span>
                </button>
              </li>
            ))}
          </ul>
        </article>

        {/* ---- the lantern */}
        <figure className={`sc-lantern ${frame}`}>
          <div className="sc-top">
            <span className="live"><span aria-hidden="true" className={`dot ${cam === "on" && !result ? "pulse" : ""}`} style={{ background: cam === "on" ? "#f2b544" : "#5d5446" }} />{cam === "on" ? `LIVE · ${backend}` : cam === "starting" ? "STARTING CAMERA…" : "CAMERA OFF"}</span>
            <span>{cam === "on" ? "1280×720 · rear camera" : ""}</span>
          </div>
          <div className="sc-view">
            <video ref={videoRef} muted playsInline aria-label="Camera preview" />
            <div aria-hidden="true" className="sc-aim"><span className="tl" /><span className="tr" /><span className="bl" /><span className="br" />{cam === "on" && !result && <div className="laser beam" />}</div>
            {cam !== "on" && !result && <div className="sc-off">{cam === "starting" ? "Waking the lantern…" : "The lantern is dark."}</div>}
            {result?.verdict === "CURSED" && (
              <svg aria-hidden="true" className="crackfx" viewBox="0 0 100 100" preserveAspectRatio="none" key={result.id}>
                <path d="M52 0 L48 18 L55 30 L46 47 L53 60 L47 78 L51 100" vectorEffect="non-scaling-stroke" />
                <path d="M55 30 L72 36 L84 52" vectorEffect="non-scaling-stroke" />
                <path d="M46 47 L30 55 L16 70" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
          </div>
          <figcaption className="sc-bot">
            <span>{scan.isPending ? "Reading the spirit…" : result ? `Saved in ${result.savedMs} ms` : err ? err : cam === "on" ? "Hold the package inside the frame" : "Use the scanner or type the code below"}</span>
            <span className="btns">
              {cam === "on" ? <button className="mini" onClick={stopCamera}>Stop camera</button> : <button className="mini" onClick={() => void startCamera()}>Start camera</button>}
              {(result || err) && <button className="mini strong" onClick={again}>Scan another</button>}
            </span>
          </figcaption>
        </figure>

        {/* ---- the soul card */}
        <article className={`sc-soul ${v?.tone ?? "idle"}`} aria-live="polite" aria-labelledby="sc-soul-h">
          <p className="kicker" id="sc-soul-h">SOUL CARD</p>
          {!result ? (
            <p className="sc-wait">{scan.isPending ? "Reading…" : "Nothing caught yet. The drug name, lot, expiry and serial appear here the moment the code is read."}</p>
          ) : (
            <>
              <div className="sc-ribbon" role="status" style={{ ["--vc" as string]: v!.color }}>
                <span className="ico">{v!.icon}</span>
                <span className="word">{v!.word}</span>
                <span className="sub">{result.verdict === "CAPTURED" ? "fill allowed" : "fill blocked"}</span>
              </div>
              <p className="sc-msg">{result.message}</p>
              {result.flags.length > 1 && <ul className="sc-flags">{result.flags.map((f) => (<li key={f.verdict}>{f.message}</li>))}</ul>}
              <h3 className="sc-drug">{result.drug}</h3>
              <p className="sc-src">{result.drugSource === "openfda" ? `Named live by openFDA /drug/ndc${result.labeler ? ` · ${result.labeler}` : ""}` : result.drugSource === "catalog" ? "Named from the demo catalog (synthetic drug)" : "Not found in openFDA"}</p>
              <dl className="sc-fields">
                <div><dt>LOT</dt><dd className={result.verdict === "CURSED" ? "hot" : ""}>{result.lot}</dd></div>
                <div><dt>EXPIRY</dt><dd>{result.expiry || "none printed"}</dd></div>
                <div><dt>SERIAL</dt><dd>{result.serial || "none"}</dd></div>
                <div><dt>NDC</dt><dd>{result.ndc}</dd></div>
              </dl>
              {result.verdict === "CURSED" && result.recallNumber && (
                <p className="sc-recall">Recall <b>{result.recallNumber}</b>. Pull this package and send it to quarantine.</p>
              )}
            </>
          )}
        </article>
      </section>

      {/* ---- write-back strip */}
      <section aria-labelledby="sc-wb" className="sc-wb">
        <div className="sc-wb-head">
          <div>
            <p className="eyebrow sm">AGENT · GRAVE ROBBER · RPA WRITE-BACK</p>
            <h2 id="sc-wb" className="sc" style={{ fontSize: 24 }}>Into the old terminal</h2>
          </div>
          {wb && <span className={`sc-wb-status ${wb.tone}`} role="status">{wb.text}</span>}
        </div>
        <div className="crt sc-mini">
          <div aria-hidden="true" className="lines" />
          <pre>{screenText ?? (result?.fillAllowed ? "RxTERM 98  v4.2  ** PRESCRIPTION **\nWAITING FOR THE BOT…" : "RxTERM 98  v4.2  ** STANDBY **\nA captured scan is typed into the Rx notes (F6) as:\nLOT <lot> EXP <yyyy-mm> SN <serial>")}</pre>
          <pre>BOT&gt; {result?.fillAllowed ? (result.note ?? liveSteps?.at(-1)?.message ?? "queued") : "idle"}<span className="cursor">█</span></pre>
        </div>
      </section>

      {/* ---- fallbacks and recent scans */}
      <section className="sc-fallback">
        <form onSubmit={manual} className="manual-wrap">
          <label htmlFor="sc-typed">Speak the code {usb ? "(USB scanner is typing here)" : "(no camera? paste the GS1 text)"}</label>
          <div className="manual">
            <input id="sc-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={SAMPLE} autoComplete="off" spellCheck={false} autoFocus={usb} />
            <button type="submit" className="btn ghost" disabled={!typed.trim() || scan.isPending || !current}>Read it <Arrow /></button>
            <button type="button" className="btn ghost" aria-pressed={usb} onClick={() => setUsb(!usb)}>{usb ? "USB scanner on" : "Use USB scanner"}</button>
          </div>
          <span className="sc-hint">A keyboard-wedge USB 2D scanner types the code and presses Enter. Focus the box and scan.</span>
        </form>

        <div className="sc-recent">
          <h3 className="sc" style={{ fontSize: 20 }}>Recent scans</h3>
          <ul>
            {(scans ?? []).slice(0, 6).map((s) => {
              const vv = VERDICT[s.verdict];
              return (
                <li key={s.id} className={vv.tone}>
                  <span className="w" style={{ color: vv.color }}>{vv.icon}{vv.word}</span>
                  <span className="mono">Rx {s.rx}</span>
                  <span className="mono">lot {s.lot}</span>
                  {s.recallNumber && <span className="mono">{s.recallNumber}</span>}
                </li>
              );
            })}
            {!scans?.length && <li className="dim">No scans yet.</li>}
          </ul>
        </div>
      </section>
      <Footer />
    </main>
  );
}
