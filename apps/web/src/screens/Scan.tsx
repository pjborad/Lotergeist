import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Arrow, Footer, Warn } from "../components/bits";
import { post } from "../lib/api";
import { useCurrentRecall } from "../lib/current";
import { useDemoPackages } from "../lib/hooks";
import { play } from "../lib/sound";
import { startScanner, type ScannerHandle } from "../lib/scanner";
import type { ScanResult } from "../lib/types";

const SAMPLE = "(01)00370004417051(21)000214(10)PRORX050925-1(17)251104";

/** Draws a real GS1 DataMatrix with bwip-js so the camera (or the judge's phone) can read it. */
function DataMatrix({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void import("bwip-js/browser").then((m) => {
      if (!alive || !ref.current) return;
      const b = (m.default ?? m) as unknown as { toCanvas: (c: HTMLCanvasElement, o: Record<string, unknown>) => void };
      try { b.toCanvas(ref.current, { bcid: "gs1datamatrix", text, scale: 8, backgroundcolor: "ECE6D6", barcolor: "141413" }); } catch { /* bad text: leave the canvas blank */ }
    });
    return () => { alive = false; };
  }, [text]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />;
}

export default function Scan() {
  const qc = useQueryClient();
  const { id } = useCurrentRecall();
  const { data: pkgs } = useDemoPackages();
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<"label" | "camera">("label");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastText = useRef<{ t: string; at: number }>({ t: "", at: 0 });

  const scan = useMutation({
    mutationFn: (element: string) => post<ScanResult>("/api/scan", { element }),
    onSuccess: (r) => { setResult(r); setErr(null); play(r.verdict === "CURSED" ? "crack" : "chime"); },
    onError: (e) => { setErr((e as Error).message); setResult(null); }
  });
  const run = scan.mutate;

  const pkg = pkgs?.[idx];
  useEffect(() => { if (mode === "label" && pkg) { setNote(null); run(pkg.raw); } }, [pkg, mode, run]);

  // Webcam (SCN-1): the shared scanner reads about 10 frames a second and accepts a code seen in 2 frames in a row.
  // Falls back to the paste box when there is no camera (SCN-3).
  useEffect(() => {
    if (mode !== "camera") return;
    let h: ScannerHandle | undefined;
    let cancelled = false;
    void startScanner({
      video: videoRef.current!,
      onCode: (t) => {
        const now = Date.now();
        if (t === lastText.current.t && now - lastText.current.at < 2500) { h?.resume(); return; }
        lastText.current = { t, at: now };
        run(t);
        window.setTimeout(() => h?.resume(), 2500); // keep looking so the next package can be scanned
      }
    }).then((x) => { if (cancelled) x.stop(); else h = x; })
      .catch((e: Error) => { if (!cancelled) { setNote(`${e.message || "No camera available here."} Paste the barcode text below instead.`); setMode("label"); } });
    return () => { cancelled = true; h?.stop(); };
  }, [mode, run]);

  const act = useMutation({
    mutationFn: (action: "pull" | "pickup") => {
      const gtin = result!.ais.find((a) => a.ai === "01")!.value;
      const serial = result!.ais.find((a) => a.ai === "21")?.value ?? "";
      return post("/api/quarantine/action", { gtin, serial, action }).then(() => action);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hearse"] })
  });

  const submitManual = useCallback((e: FormEvent) => { e.preventDefault(); if (manual.trim()) { setMode("label"); run(manual.trim()); } }, [manual, run]);

  const verdict = result?.verdict;
  const cursed = verdict === "CURSED";
  const accent = cursed ? "#ff6b4a" : "#b8f27c";

  return (
    <main className="main tight" style={{ gap: 40 }}>
      <section className="row-between">
        <div style={{ flex: "1 1 560px", minWidth: 0 }}>
          <p className="eyebrow">III · GS1 DataMatrix · webcam</p>
          <h1 className="display">Hold it to the light.</h1>
          <p className="lede" style={{ maxWidth: 620 }}>Same drug, same shelf, different lot. Only the 2D code knows which one is cursed.</p>
        </div>
        <div role="group" aria-label="Choose a package to scan" className="pkgs">
          {(pkgs ?? []).map((p, i) => (
            <button key={p.label} className="pkgbtn" aria-pressed={mode === "label" && i === idx} onClick={() => { setIdx(i); setMode("label"); }}>{p.label}</button>
          ))}
          <button className="pkgbtn" aria-pressed={mode === "camera"} onClick={() => setMode(mode === "camera" ? "label" : "camera")}>{mode === "camera" ? "Stop webcam" : "Use webcam"}</button>
        </div>
      </section>

      {note && <Warn>{note}</Warn>}

      <section className="scan-cols">
        <figure className="scope" style={{ ["--accent-c" as string]: accent } as CSSProperties}>
          <div className="scope-top">
            <span className="live"><span aria-hidden="true" className="pulse dot" style={{ background: mode === "camera" ? "#ff6b4a" : "#e8b94a" }} />{mode === "camera" ? "LIVE · zxing-js" : "DEMO LABEL · bwip-js"}</span>
            <span>{mode === "camera" ? "DataMatrix · try harder" : <a href="/labels/labels.pdf" target="_blank" rel="noreferrer">print the test labels (PDF)</a>}</span>
          </div>

          {mode === "label" ? (
            <div className="label-card" key={pkg?.element ?? "none"}>
              {pkg ? <DataMatrix text={pkg.element} label={`GS1 DataMatrix: ${pkg.element}`} /> : <span style={{ color: "#5d5446" }}>loading label…</span>}
            </div>
          ) : (
            <div className="video-wrap"><video ref={videoRef} muted playsInline aria-label="Camera preview" /></div>
          )}

          <div aria-hidden="true" className="brackets">
            <span className="tl" /><span className="tr" /><span className="bl" /><span className="br" />
            <div className="laser beam" />
          </div>
          {cursed && (
            <svg aria-hidden="true" className="crackfx" viewBox="0 0 100 100" preserveAspectRatio="none" key={result?.raw}>
              <path d="M52 0 L48 18 L55 30 L46 47 L53 60 L47 78 L51 100" vectorEffect="non-scaling-stroke" />
              <path d="M55 30 L72 36 L84 52" vectorEffect="non-scaling-stroke" />
              <path d="M46 47 L30 55 L16 70" vectorEffect="non-scaling-stroke" />
            </svg>
          )}

          <figcaption className="scope-bot">
            <span>{result ? `Decoded in ${result.decodedMs} ms` : scan.isPending ? "Decoding…" : "Waiting for a code"}</span>
            <span>{result?.raw ?? ""}</span>
          </figcaption>
        </figure>

        <article aria-live="polite" className={`verdict ${verdict ? (cursed ? "cursed" : "clean") : "idle"}`}>
          {!result && (
            <div>
              <p className="kicker" style={{ color: "var(--dimmer)" }}>VERDICT</p>
              <h2>{scan.isPending ? "…" : "Waiting"}</h2>
              <p className="msg" style={{ color: "var(--dim)" }}>{err ?? "Show the Mirror a package, or pick one of the demo labels above."}</p>
            </div>
          )}
          {result && (
            <>
              <div>
                <p className="kicker" style={{ color: cursed ? "var(--hot)" : "var(--accent)" }}>
                  <span className="icon" aria-hidden="true">
                    {cursed
                      ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="#ff8a6e" strokeWidth="2" strokeLinecap="round" /></svg>
                      : <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9.5l4 4 8-9" stroke="#b8f27c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  VERDICT
                </p>
                <h2>{cursed ? "Cursed" : "Clean"}</h2>
                <p className="msg">{result.message}</p>
              </div>

              {result.checked.recalls === 0 && (
                <Warn>No death notice has been confirmed yet, so every package reads clean. Confirm a notice first, or use "Skip to a finished hunt" on page I.</Warn>
              )}

              <dl className="ais">
                {result.ais.map((a) => (
                  <div key={a.ai}><dt>({a.ai}) {a.name}</dt><dd className={a.hot ? "hot" : ""}>{a.value}</dd></div>
                ))}
              </dl>

              {cursed ? (
                <>
                  {result.location && <p className="mono" style={{ fontSize: 13, color: "var(--dim)" }}>On the shelf at {result.location.pharmacy}{result.location.shelf ? `, shelf ${result.location.shelf}` : ""}</p>}
                  <ol className="trail">
                    {result.trail.map((t, i) => (<li key={i}><i aria-hidden="true" /><time>{t.date}</time>{t.text}</li>))}
                  </ol>
                  <div className="actions">
                    <button className="btn hot" onClick={() => act.mutate("pull")} disabled={act.isPending}>{act.isSuccess && act.data === "pull" ? "Quarantined ✓" : "Quarantine package"}</button>
                    <Link className="btn hot-ghost" to={`/hearse?r=${id ?? ""}`} onClick={() => act.mutate("pickup")}>Add to hearse pickup</Link>
                  </div>
                  {act.isError && <p className="errtext" role="alert">{(act.error as Error).message}</p>}
                </>
              ) : (
                <div className="checked">
                  Checked against {result.checked.recalls} active recall{result.checked.recalls === 1 ? "" : "s"} and {result.checked.shortages} shortage notice{result.checked.shortages === 1 ? "" : "s"} for NDC {result.checked.ndc}.{" "}
                  {result.checked.syncedMinutesAgo !== null ? `Last sync with openFDA: ${result.checked.syncedMinutesAgo} minute${result.checked.syncedMinutesAgo === 1 ? "" : "s"} ago.` : ""}
                </div>
              )}
            </>
          )}
        </article>
      </section>

      <form className="manual-wrap" onSubmit={submitManual}>
        <label htmlFor="speak">Speak the code (no camera? paste the barcode text)</label>
        <div className="manual">
          <input id="speak" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={SAMPLE} autoComplete="off" spellCheck={false} />
          <button className="btn ghost" type="submit" disabled={!manual.trim() || scan.isPending}>Read it <Arrow /></button>
        </div>
        {err && result === null && <span className="errtext" role="alert">{err}</span>}
      </form>
      <Footer />
    </main>
  );
}
