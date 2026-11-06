import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { gs1Text } from "../lib/gs1";

function Code({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void import("bwip-js/browser").then((m) => {
      if (!alive || !ref.current) return;
      const b = (m.default ?? m) as unknown as { toCanvas: (c: HTMLCanvasElement, o: Record<string, unknown>) => void };
      try { b.toCanvas(ref.current, { bcid: "gs1datamatrix", text, scale: 4, padding: 4, backgroundcolor: "FFFFFF" }); } catch { /* blank */ }
    });
    return () => { alive = false; };
  }, [text]);
  return <canvas ref={ref} role="img" aria-label={`GS1 DataMatrix ${text}`} />;
}

/** Real GS1 DataMatrix codes for the demo stock. Show them to the camera (print them, or hold up a phone). */
export function Labels() {
  const q = useQuery({ queryKey: ["labels"], queryFn: () => get("/api/demo/labels") });
  const groups = new Map<string, any[]>();
  for (const l of q.data?.labels ?? []) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  return (
    <>
      <div className="spread noprint"><div><h1>Test labels</h1><p className="sub">These are real GS1 DataMatrix codes for the demo stock. Point the camera at the screen or print the page.</p></div><button className="btn" onClick={() => window.print()}>Print</button></div>
      {[...groups].map(([g, ls]) => (
        <section key={g} style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 10 }}>{g}</h3>
          <div className="labelsheet">
            {ls.map((l) => (
              <div className="card" key={`${l.ndc10}-${l.lot}-${l.serial}`}>
                <Code text={gs1Text(l)} />
                <div style={{ fontWeight: 600, marginTop: 6 }}>{l.product}</div>
                <div className="mono dim" style={{ fontSize: 12 }}>NDC {l.ndc10}<br />LOT {l.lot} · EXP {l.expiry}<br />SN {l.serial}</div>
                {l.note && <div className="dimmer" style={{ fontSize: 12 }}>{l.note}</div>}
                {l.scanned && <div className="tag gray" style={{ marginTop: 6 }}>already received</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
