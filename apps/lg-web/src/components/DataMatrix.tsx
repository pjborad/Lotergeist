import { useEffect, useRef } from "react";

/** Draws a real GS1 DataMatrix with bwip-js. */
export function DataMatrix({ text, size, dark = false, label }: { text: string; size?: number; dark?: boolean; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void import("bwip-js/browser").then((m) => {
      if (!alive || !ref.current) return;
      const b = (m.default ?? m) as unknown as { toCanvas: (c: HTMLCanvasElement, o: Record<string, unknown>) => void };
      try {
        b.toCanvas(ref.current, dark
          ? { bcid: "gs1datamatrix", text, scale: 4, backgroundcolor: "0B0E14", barcolor: "E6EAF2" }
          : { bcid: "gs1datamatrix", text, scale: 4, padding: 4, backgroundcolor: "FFFFFF" });
      } catch { /* bad text: blank */ }
    });
    return () => { alive = false; };
  }, [text, dark]);
  return <canvas ref={ref} role="img" aria-label={label ?? `GS1 DataMatrix ${text}`} style={size ? { width: size, height: size, imageRendering: "pixelated" } : { maxWidth: "100%" }} />;
}
