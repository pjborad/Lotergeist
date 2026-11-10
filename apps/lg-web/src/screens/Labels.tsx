import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { gs1Text } from "../lib/gs1";
import { DataMatrix } from "../components/DataMatrix";
import { btn, C, Footer, MONO, pill, TONES } from "../components/kit";
import { mainStyle, PageHeader } from "../components/Shell";

/** Real GS1 DataMatrix codes for the demo stock. Point the camera at the screen, a phone, or a printout. */
export function Labels() {
  const q = useQuery({ queryKey: ["labels"], queryFn: () => get("/api/demo/labels") });
  const groups = new Map<string, any[]>();
  for (const l of q.data?.labels ?? []) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  return (
    <>
      <PageHeader title="Test labels" sub="Real GS1 DataMatrix codes for the demo stock. Hold them up to the camera, or print this page.">
        <button className="noprint" onClick={() => window.print()} style={btn("primary", { minHeight: 44, fontSize: 14 })}>Print labels</button>
      </PageHeader>
      <main style={mainStyle()}>
        {[...groups].map(([g, ls]) => (
          <section key={g} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{g}</h2>
            <div className="labelsheet">
              {ls.map((l) => (
                <div key={`${l.ndc10}-${l.lot}-${l.serial}`} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ background: "#fff", borderRadius: 8, padding: 8, display: "flex", justifyContent: "center" }}><DataMatrix text={gs1Text(l)} label={`Label for ${l.product} lot ${l.lot} serial ${l.serial}`} /></div>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{l.product}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.dim, lineHeight: 1.6 }}>NDC {l.ndc10}<br />LOT {l.lot} · EXP {l.expiry}<br />SN {l.serial}</span>
                  {l.note && <span style={{ fontSize: 12, color: C.dimmer }}>{l.note}</span>}
                  {l.scanned && <span style={pill(...TONES.gray!, { alignSelf: "flex-start" })}>Already received</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
        <Footer />
      </main>
    </>
  );
}
