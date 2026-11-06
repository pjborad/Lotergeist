/**
 * Lotergeist rehearsal: drives the real UI in Chromium with a fake webcam that "holds up" printed DataMatrix labels
 * and a text label, and checks scan -> checks -> put away, fill, OCR of a label, and the fax OCR -> recall flow.
 * Needs the API (4000) and web app (5173) running. Usage: node scripts/lotergeist-e2e.mjs
 * Resets the demo data first.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? "/tmp/lg-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const require = createRequire(path.resolve(import.meta.dirname, "../../../apps/lg-api/package.json"));
const bwip = require("bwip-js");
const PW = "moonlight-rx-2026";

const gs1 = (l) => {
  const e = l.expiry.replace(/-/g, "");
  return `(01)${l.gtin}(17)${e.slice(2, 8)}(10)${l.lot}(21)${l.serial}`;
};
const png = async (text) => (await bwip.toBuffer({ bcid: "gs1datamatrix", text, scale: 6, padding: 10, backgroundcolor: "FFFFFF" })).toString("base64");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`); };

const browser = await chromium.launch();
const FAKE_CAM = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720;
  const g = canvas.getContext("2d");
  let img = null, text = null;
  const draw = () => {
    g.fillStyle = "#6b6a66"; g.fillRect(0, 0, 1280, 720);
    if (img) { g.save(); g.translate(640, 360); g.rotate(-0.05); g.drawImage(img, -230, -230, 460, 460); g.restore(); }
    if (text) {
      g.fillStyle = "#fff"; g.fillRect(140, 120, 1000, 480);
      g.fillStyle = "#000"; g.font = "bold 44px Arial"; g.textBaseline = "top";
      text.forEach((line, i) => g.fillText(line, 180, 160 + i * 70));
    }
    requestAnimationFrame(draw);
  };
  draw();
  window.__hold = (url) => { text = null; const i = new Image(); i.onload = () => { img = i; }; i.src = url; };
  window.__holdText = (lines) => { img = null; text = lines; };
  window.__lower = () => { img = null; text = null; };
  const stream = canvas.captureStream(30);
  navigator.mediaDevices.getUserMedia = async () => stream;
};

async function session(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(FAKE_CAM);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { storeId: "store-7", email: `${who}@elmstreetrx.example`, password: PW, trusted: true } });
  if (!r.ok()) throw new Error("login failed " + r.status());
  return { ctx, page };
}

try {
  // reset
  const pharm = await session("j.rivera");
  await pharm.ctx.request.post(`${BASE}/api/demo/reset`, { data: {} });
  await pharm.ctx.request.post(`${BASE}/api/auth/login`, { data: { storeId: "store-7", email: "j.rivera@elmstreetrx.example", password: PW, trusted: true } }); // reset clears sessions
  const labels = (await (await pharm.ctx.request.get(`${BASE}/api/demo/labels`)).json()).labels;
  const find = (lot, serial) => labels.find((l) => l.lot === lot && (!serial || l.serial === serial));

  // 1. RECEIVING with the camera -------------------------------------------------------------
  const tech = await session("k.patel");
  let p = tech.page;
  await p.goto(`${BASE}/#/receiving`);
  await p.waitForSelector("text=Receive & put away");
  await p.getByRole("button", { name: "Start camera" }).click();
  await p.waitForSelector(".cam .frame");
  const amox = find("AMX0926B", "10443850");
  await p.evaluate((u) => window.__hold(u), `data:image/png;base64,${await png(gs1(amox))}`);
  await p.waitForSelector("text=Transaction information verified", { timeout: 15000 });
  check("camera reads a DataMatrix and the four checks run", true);
  const where = await p.locator("text=/Aisle \\d · Bay/").first().innerText();
  check("put-away location suggested", /Aisle 2 · Bay [ABC] · Shelf \d · Bin \d+/.test(where), where);
  await p.screenshot({ path: path.join(SHOTS, "receive-scan.png") });
  await p.getByRole("button", { name: "Confirm put-away" }).click();
  await p.waitForSelector("text=/36 of 38/", { timeout: 8000 }).then(() => check("progress moves to 36 of 38", true), () => check("progress moves to 36 of 38", false));
  await p.evaluate(() => window.__lower());

  // an unknown serial must fail TI/TS and be reportable
  const bad = { ...find("OX25L072"), serial: "99999999" };
  await p.waitForTimeout(2200);
  await p.evaluate((u) => window.__hold(u), `data:image/png;base64,${await png(gs1(bad))}`);
  await p.waitForSelector("text=not in the supplier", { timeout: 15000 }).then(() => check("unknown serial fails the TI/TS check", true), () => check("unknown serial fails the TI/TS check", false));
  check("Confirm is disabled on a failed check", await p.getByRole("button", { name: "Confirm put-away" }).isDisabled());
  await p.evaluate(() => window.__lower());

  // 2. OCR of a printed label ------------------------------------------------------------------
  await p.waitForTimeout(2200);
  await p.evaluate(() => window.__holdText(["NDC 70004-226-01  Amoxicillin 500 mg", "LOT AMX0626C", "EXP 01/2028", "SN 10440999"]));
  await p.getByRole("button", { name: "Read label text (OCR)" }).click();
  await p.waitForSelector("text=OCR read this", { timeout: 90000 });
  const lot = await p.locator("#ocr-lot").inputValue();
  const ndc = await p.locator("#ocr-ndc").inputValue();
  check("browser OCR reads lot and NDC from a label", lot === "AMX0626C" && ndc === "70004-226-01", `ndc=${ndc} lot=${lot}`);
  await p.screenshot({ path: path.join(SHOTS, "receive-ocr.png") });
  await tech.ctx.close();

  // 3. FILL with the camera -----------------------------------------------------------------
  const t2 = await session("k.patel");
  p = t2.page;
  await p.goto(`${BASE}/#/fill?rx=0072210`);
  await p.waitForSelector("text=Daniel Brooks");
  await p.getByRole("button", { name: "Start camera" }).click();
  await p.waitForSelector(".cam .frame");
  const pen = find("GX4471C", "0000907");
  await p.evaluate((u) => window.__hold(u), `data:image/png;base64,${await png(gs1(pen))}`);
  await p.waitForSelector("text=Print label", { timeout: 15000 }).then(() => check("fill scan saves lot and serial, moves to Label", true), () => check("fill scan saves lot and serial, moves to Label", false));
  await p.screenshot({ path: path.join(SHOTS, "fill-scan.png") });
  await t2.ctx.close();

  // 4. RECALL: fax image -> OCR -> lots -> impact -> notify ---------------------------------------
  p = pharm.page;
  await p.goto(`${BASE}/#/recalls`);
  await p.waitForSelector("text=Fax inbox");
  await p.getByRole("button", { name: "Read with OCR" }).click();
  await p.waitForSelector("text=Patients found", { timeout: 120000 }).then(() => check("fax image read by OCR opens the recall", true), () => check("fax image read by OCR opens the recall", false));
  const body = await p.locator("main").innerText();
  check("both recalled lots found from the fax", body.includes("PRORX050925-1") && body.includes("PRORX050925-3"));
  check("197 units held, 17 patients", /197/.test(body) && /17/.test(body));
  await p.screenshot({ path: path.join(SHOTS, "recall-review.png"), fullPage: true });
  const confirms = p.getByRole("button", { name: "Confirm lot" });
  for (let n = await confirms.count(); n > 0; n = await confirms.count()) { await confirms.first().click(); await p.waitForTimeout(500); }
  await p.getByRole("button", { name: /Next: write the message/ }).click();
  await p.waitForSelector("text=Text message");
  await p.getByLabel(/I am the pharmacist/).check();
  await p.getByRole("button", { name: /^Send \d+ messages/ }).click();
  await p.waitForSelector("text=Messages sent to the sandbox", { timeout: 10000 });
  await p.waitForSelector("text=/12 \\/ 13/", { timeout: 15000 }).then(() => check("12 of 13 texts delivered, 1 pending", true), () => check("12 of 13 texts delivered, 1 pending", false));
  await p.screenshot({ path: path.join(SHOTS, "recall-done.png"), fullPage: true });

  // 5. After the recall, the recalled lot is blocked at the dock
  await p.goto(`${BASE}/#/inventory?filter=recall`);
  await p.waitForSelector("tbody tr td.mono");
  check("recalled lots show in inventory", (await p.locator("tbody tr").count()) >= 2);
} catch (e) {
  console.log("ERROR", e);
  results.push({ name: "script", ok: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
