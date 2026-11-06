import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { rng } from "./rng";
import type { Fill, World } from "./world";

const mmdd = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

/**
 * Fax-only pharmacies send dispense logs as PDFs. Text stays selectable so pdf-parse can read it,
 * and a layer of vector speckle and streaks makes the page look like a bad scan.
 */
export async function writeFaxPdfs(world: World, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".pdf")) fs.unlinkSync(path.join(dir, f));
  const faxGlns = new Map(world.parties.filter((p) => p.kind === "pharmacy" && p.system === "fax").map((p) => [p.gln, p]));
  const groups = new Map<string, Fill[]>();
  for (const f of world.fills) {
    if (!faxGlns.has(f.pharmacyGln)) continue;
    const k = `${f.pharmacyGln}|${f.ndc11}|${f.lot}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  const written: string[] = [];
  let n = 0;
  for (const [k, rows] of groups) {
    const [gln, ndc11, lot] = k.split("|") as [string, string, string];
    const ph = faxGlns.get(gln)!;
    n++;
    const file = path.join(dir, `fax-${String(n).padStart(2, "0")}-${ph.name.split(" ")[0]!.toLowerCase()}-${lot.toLowerCase()}.pdf`);
    const R = rng(world.seed + n);
    const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: `Dispense Log - ${ph.name}`, Producer: "FAX-O-MATIC 3000 (synthetic)" } });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    doc.rect(0, 0, 612, 792).fill("#ebe7da");
    doc.fillColor("#23211c");
    doc.font("Courier").fontSize(10).text(`FROM: (555) 010-${2200 + n}`, 54, 54, { continued: true }).text("PG 1/1", { align: "right" });
    doc.moveTo(54, 72).lineTo(558, 72).strokeColor("#23211c").stroke();
    doc.font("Times-Bold").fontSize(20).text(`Dispense Log - ${ph.name.replace(" · ", " ")}`, 54, 90);
    doc.font("Courier").fontSize(11);
    doc.text(`NDC: ${ndc11}   LOT: ${lot}`, 54, 126);
    doc.text(`PRODUCT: ${rows[0]!.productName}`, 54, 142);
    doc.text("RUN DATE: 11/05/25", 54, 158);
    doc.moveDown(1.2);
    doc.fontSize(13);
    for (const f of rows) doc.text(`Rx ${f.rx}  ${f.patientId}  ${mmdd(f.fillDate)}  #${f.qty}`, 54, doc.y + 6);
    doc.fontSize(9).text("-- END OF LOG --", 54, doc.y + 24);
    // scan noise
    for (let i = 0; i < 220; i++) {
      doc.rect(R.next() * 612, R.next() * 792, 0.6 + R.next() * 1.8, 0.6 + R.next() * 1.8).fillOpacity(0.18 + R.next() * 0.25).fill("#23211c");
    }
    for (let i = 0; i < 4; i++) {
      const y = R.next() * 792;
      doc.moveTo(0, y).lineTo(612, y + R.next() * 3).lineWidth(0.4).strokeOpacity(0.15).stroke("#23211c");
    }
    doc.end();
    await new Promise<void>((res) => out.on("finish", () => res()));
    written.push(file);
  }
  return written;
}
