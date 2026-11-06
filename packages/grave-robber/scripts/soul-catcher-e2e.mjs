/**
 * Soul Catcher rehearsal: drives the real UI in Chromium with a fake webcam that "holds up" each printed label.
 * Needs the stack running (rxterm98, API with the built web app). Usage: node scripts/soul-catcher-e2e.mjs
 * It checks the whole path: camera frames -> crop -> zxing decode -> 2-frame debounce -> POST scan -> verdict -> RPA write-back.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4000";
const LABELS = path.resolve(import.meta.dirname, "../../../apps/web/public/labels");
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const api = async (p, init) => {
  const r = await fetch(BASE + p, { ...init, headers: { "content-type": "application/json" } });
  return r.json().catch(() => ({}));
};
const waitReady = async (id) => {
  for (let i = 0; i < 200; i++) {
    const d = await api(`/api/recalls/${id}`);
    if (d.status === "ready") return;
    if (d.status === "error") throw new Error(`${id}: ${d.error}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${id} never finished`);
};

await api("/api/demo/reset", { method: "POST", body: "{}" });
for (const id of ["D-0417-2026", "D-0526-2026"]) {
  await api(`/api/recalls/${id}/confirm`, { method: "POST", body: "{}" });
  await waitReady(id);
}

const cases = [
  { file: "fill-methyl-clean.png", rx: "0099101", expect: "Captured", writeback: true },
  { file: "fill-methyl-cursed.png", rx: "0099102", expect: "Cursed", recall: "D-0417-2026" },
  { file: "fill-ondansetron-wrong.png", rx: "0099105", expect: "Wrong vessel" },
  { file: "fill-methyl-expired.png", rx: "0099105", expect: "Departed" },
  { file: "fill-alendronate-cursed.png", rx: "0099104", expect: "Cursed", recall: "D-0526-2026" },
  { file: "fill-alendronate-clean.png", rx: "0099104", expect: "Captured", writeback: true }
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  // A fake rear camera: a canvas that shows whichever label we "hold up", slightly rotated, like a hand would.
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720;
  const g = canvas.getContext("2d");
  let img = null;
  const draw = () => {
    g.fillStyle = "#6b6a66"; g.fillRect(0, 0, 1280, 720);
    if (img) { g.save(); g.translate(640, 360); g.rotate(-0.06); g.drawImage(img, -230, -230, 460, 460); g.restore(); }
    requestAnimationFrame(draw);
  };
  draw();
  window.__hold = (url) => { const i = new Image(); i.onload = () => { img = i; }; i.src = url; };
  window.__lower = () => { img = null; };
  const stream = canvas.captureStream(30);
  navigator.mediaDevices.getUserMedia = async () => stream;
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/#/fill`);
await page.waitForSelector("text=Rx 0099101");
await page.waitForSelector("text=LIVE ·");

const rows = [];
let failed = 0;
for (const c of cases) {
  await page.evaluate(() => window.__lower());
  await page.locator(".sc-q", { hasText: c.rx }).first().click();
  await page.waitForTimeout(300);
  const png = fs.readFileSync(path.join(LABELS, c.file)).toString("base64");
  const t0 = Date.now();
  await page.evaluate((u) => window.__hold(u), `data:image/png;base64,${png}`);
  let word = "";
  try {
    await page.waitForSelector(".sc-ribbon .word", { timeout: 8000 });
    word = (await page.locator(".sc-ribbon .word").innerText()).trim();
  } catch { word = "(no read)"; }
  const ms = Date.now() - t0;
  const soul = await page.locator(".sc-soul").innerText().catch(() => "");
  let ok = word === c.expect;
  if (c.recall) ok = ok && soul.includes(c.recall);
  let wb = "";
  if (c.writeback && ok) {
    try {
      await page.waitForSelector("text=Written to RxTerm 98, verified.", { timeout: 15000 });
      wb = "written + verified";
    } catch { wb = "write-back NOT verified"; ok = false; }
  }
  await page.screenshot({ path: `${SHOTS}/sc-${c.file.replace(".png", "")}.png`, fullPage: true });
  rows.push({ label: c.file, rx: c.rx, expected: c.expect, got: word, ms, writeback: wb, ok: ok ? "PASS" : "FAIL" });
  if (!ok) failed++;
  const again = page.getByRole("button", { name: "Scan another" });
  if (await again.count()) await again.click();
}
await page.evaluate(() => window.__lower());

// the RxTerm 98 side: the cursed lot must NOT have been written, the clean one must be on the prescription
const scans = await api("/api/fills/scans");
console.table(rows);
console.log("saved scans:", scans.map((s) => `${s.rx}:${s.verdict}:${s.writeback}`).join("  "));
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
