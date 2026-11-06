/**
 * Printable GS1 DataMatrix test labels for the Mirror screen (spec 6.7).
 * Usage: pnpm labels   ->  apps/web/public/labels/{package-a.png,package-b.png,labels.pdf}
 */
import fs from "node:fs";
import path from "node:path";
import bwipjs from "bwip-js/node";
import PDFDocument from "pdfkit";
import { buildElementString, ndc10ToGtin14 } from "@bsrx/gs1";

const out = path.resolve(import.meta.dirname, "../public/labels");
fs.mkdirSync(out, { recursive: true });
const gtin = ndc10ToGtin14("70004-417-05");
const labels = [
  { file: "package-a.png", title: "Package A · shelf C-12 · expect CURSED", serial: "000214", lot: "PRORX050925-1", expiry: "2025-11-04" },
  { file: "package-b.png", title: "Package B · shelf C-13 · expect CLEAN", serial: "000522", lot: "PRORX051125-2", expiry: "2025-12-08" }
];

const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: "Body Snatcher Rx test labels (synthetic)" } });
doc.pipe(fs.createWriteStream(path.join(out, "labels.pdf")));
doc.font("Helvetica-Bold").fontSize(18).text("Body Snatcher Rx · test labels", { align: "left" });
doc.font("Helvetica").fontSize(10).fillColor("#555").text("Synthetic data only. Print at 100%, hold a label up to the webcam on the Scan page.", { align: "left" });
let y = 130;
for (const l of labels) {
  const text = buildElementString({ gtin, serial: l.serial, lot: l.lot, expiry: l.expiry });
  const png = await bwipjs.toBuffer({ bcid: "gs1datamatrix", text, scale: 6, padding: 6, backgroundcolor: "FFFFFF" });
  fs.writeFileSync(path.join(out, l.file), png);
  doc.rect(54, y, 504, 190).lineWidth(0.5).strokeColor("#999").stroke();
  doc.image(png, 74, y + 20, { width: 150 });
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(13).text(l.title, 250, y + 28, { width: 290 });
  doc.font("Courier").fontSize(10).text(text, 250, y + 70, { width: 290 });
  doc.font("Helvetica").fontSize(10).fillColor("#444").text(`NDC 70004-417-05 · GTIN ${gtin}`, 250, y + 130);
  y += 220;
}
doc.end();
console.log(`wrote ${labels.length} labels and labels.pdf to ${out}`);

// ---- Soul Catcher labels: one per verdict. Print at 20 mm on matte paper (glossy glares under a webcam).
const fillLabels = [
  { file: "fill-alendronate-cursed.png", ndc: "0054-0282-59", lot: "AC2040A", exp: "260400", serial: "SN0001", rx: "0099104", expect: "CURSED", note: "real recall D-0526-2026 (confirm it first)" },
  { file: "fill-alendronate-clean.png", ndc: "0054-0282-59", lot: "AC2105B", exp: "270500", serial: "SN0042", rx: "0099104", expect: "CAPTURED", note: "same real drug, other lot" },
  { file: "fill-methyl-clean.png", ndc: "70004-417-05", lot: "PRORX051125-2", exp: "271208", serial: "000522", rx: "0099101", expect: "CAPTURED", note: "synthetic methylprednisolone, clean lot" },
  { file: "fill-methyl-cursed.png", ndc: "70004-417-05", lot: "PRORX050925-1", exp: "251104", serial: "000214", rx: "0099102", expect: "CURSED", note: "synthetic recall D-0417-2026 (confirm it first)" },
  { file: "fill-ondansetron-wrong.png", ndc: "70004-088-12", lot: "224010", exp: "270831", serial: "000020", rx: "0099101", expect: "WRONG VESSEL", note: "ondansetron package on a methylprednisolone Rx" },
  { file: "fill-methyl-expired.png", ndc: "70004-417-05", lot: "PRORX040925-9", exp: "250930", serial: "000999", rx: "0099105", expect: "DEPARTED", note: "expired package" }
];
const sheet = new PDFDocument({ size: "LETTER", margin: 40, info: { Title: "Body Snatcher Rx Soul Catcher labels (synthetic)" } });
sheet.pipe(fs.createWriteStream(path.join(out, "labels-fill.pdf")));
sheet.font("Helvetica-Bold").fontSize(18).text("Soul Catcher test labels");
sheet.font("Helvetica").fontSize(10).fillColor("#555").text("Print at 100% on matte paper. Each label is about 22 mm square: stick it on an empty bottle. Hold it 15 to 20 cm from the webcam with a lamp beside it. Synthetic data except the real drug name and recall D-0526-2026.");
const cell = { w: 250, h: 190 };
for (const [i, l] of fillLabels.entries()) {
  const text = buildElementString({ gtin: ndc10ToGtin14(l.ndc), serial: l.serial, lot: l.lot, expiryRaw: l.exp }, { order: ["01", "17", "10", "21"] });
  const png = await bwipjs.toBuffer({ bcid: "gs1datamatrix", text, scale: 8, padding: 4, backgroundcolor: "FFFFFF" });
  fs.writeFileSync(path.join(out, l.file), png);
  const x = 40 + (i % 2) * (cell.w + 24);
  const y = 120 + Math.floor(i / 2) * (cell.h + 14);
  sheet.rect(x, y, cell.w, cell.h).lineWidth(0.5).strokeColor("#999").stroke();
  sheet.image(png, x + 14, y + 16, { width: 62 });
  sheet.fillColor("#000").font("Helvetica-Bold").fontSize(12).text(`Use on Rx ${l.rx}`, x + 92, y + 16, { width: cell.w - 104 });
  sheet.font("Helvetica-Bold").fontSize(13).fillColor(l.expect === "CAPTURED" ? "#2d5a12" : "#8a1f12").text(`Expect ${l.expect}`, x + 92, y + 36, { width: cell.w - 104 });
  sheet.font("Helvetica").fontSize(9).fillColor("#444").text(l.note, x + 92, y + 56, { width: cell.w - 104 });
  sheet.font("Courier").fontSize(8).fillColor("#000").text(`${text}`, x + 14, y + 100, { width: cell.w - 28 });
  sheet.font("Courier").fontSize(8).fillColor("#666").text(`lot ${l.lot}  exp ${l.exp}  sn ${l.serial}`, x + 14, y + 140, { width: cell.w - 28 });
}
sheet.end();
console.log(`wrote ${fillLabels.length} Soul Catcher labels and labels-fill.pdf`);
