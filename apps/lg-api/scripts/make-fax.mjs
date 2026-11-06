// Renders the synthetic recall fax (a PNG that looks like a scanned fax page) for the demo.
// The text is what the browser OCR reads back when you use "Upload the fax instead".
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(path.join(root, "packages/grave-robber/package.json"));
const { chromium } = require("playwright");

const html = `<!doctype html><html><body style="margin:0;background:#fff">
<div style="width:1000px;padding:56px 64px;font:24px/1.5 'Courier New',monospace;color:#111">
  <div style="font-size:20px;color:#444">FAX  ·  HOLLOW CREEK PHARMA  ·  PAGE 1 OF 2  ·  SYNTHETIC DEMO DOCUMENT</div>
  <div style="border-top:3px solid #111;margin:14px 0 22px"></div>
  <div style="font:bold 44px Arial,sans-serif">URGENT: DRUG RECALL</div>
  <div style="margin-top:18px">Recall No. D-0417-2026</div>
  <div>Classification: Class II</div>
  <div>Date: 11/05/2026</div>
  <div style="margin-top:18px">Product: Methylprednisolone Acetate Injectable Suspension, USP 40 mg/mL, 5 mL vial</div>
  <div>NDC 70004-417-05</div>
  <div style="margin-top:18px">Lot PRORX050925-1  EXP 09/30/2027</div>
  <div>Lot PRORX050925-3  EXP 09/30/2027</div>
  <div style="margin-top:18px">Reason: Lack of assurance of sterility.</div>
  <div style="margin-top:18px">Action: Stop dispensing. Quarantine all units of the lots above and contact patients who received them.</div>
  <div style="margin-top:28px;color:#555;font-size:18px">Synthetic data. Not a real recall.</div>
</div></body></html>`;

const out = path.join(root, "apps/lg-web/public/fax/recall-d0417.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 820 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
