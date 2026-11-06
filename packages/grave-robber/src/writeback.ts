import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { hostAllowed } from "./allowlist";
import type { PharmacyRef, RpaStep } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultSelectors = path.resolve(import.meta.dirname, "../rpa/selectors.json");

/** RPA-7: the note the bot types into the prescription record. */
export function buildNote(f: { lot: string; expiry: string; serial: string }): string {
  const exp = f.expiry ? f.expiry.slice(0, 7) : "NONE";
  return `LOT ${f.lot} EXP ${exp} SN ${f.serial}`;
}

export interface WritebackItem { rx: string; note: string }

export interface WritebackResult {
  rx: string;
  note: string;
  readBack: string;
  /** RPA-8: true only if the re-read note equals the scan note exactly */
  verified: boolean;
  attempts: number;
  error?: string;
}

export interface WritebackOptions {
  rxtermUrl: string;
  pharmacy: PharmacyRef;
  items: WritebackItem[];
  password?: string;
  headless?: boolean;
  stepDelayMs?: number;
  /** RPA-9: give up on an item after this many tries (default 2) */
  attempts?: number;
  allowedHosts?: string[];
  selectorsPath?: string;
  onStep?: (s: RpaStep) => void | Promise<void>;
}

/**
 * RPA-7 to RPA-9. Opens each prescription in the FILL QUEUE, presses F6, types the note, then re-reads the
 * saved note from the screen and compares it to what was typed.
 */
export async function writeBack(opts: WritebackOptions): Promise<WritebackResult[]> {
  const sel = JSON.parse(fs.readFileSync(opts.selectorsPath ?? defaultSelectors, "utf8"));
  const base = new URL(opts.rxtermUrl);
  const allowed = opts.allowedHosts ?? [base.host, base.hostname];
  const ph = opts.pharmacy;
  const max = opts.attempts ?? 2;
  const delay = opts.stepDelayMs ?? 0;
  let seq = 0;
  const emit = async (action: RpaStep["action"], message: string, screen?: string) => {
    await opts.onStep?.({ seq: ++seq, pharmacyGln: ph.gln, pharmacyName: ph.name, system: "rxterm", action, message, screen, ts: Date.now() });
    if (delay) await sleep(delay);
  };
  const screen = async (page: Page) => (await page.innerText(sel.rx.screen)).replace(/\u00a0/g, " ").replace(/\n{2,}/g, "\n");

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const results: WritebackResult[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000); // a missing prescription should fail fast, not hang the fill screen
    await page.route("**/*", (route) => (hostAllowed(route.request().url(), allowed) ? route.continue() : route.abort()));

    await emit("start", `Opening RxTerm 98 for ${ph.name}`);
    await page.goto(base.origin + "/");
    await page.fill(sel.login.user, ph.code);
    await page.fill(sel.login.pass, opts.password ?? "GRAVE98");
    await Promise.all([page.waitForURL("**/menu"), page.click(sel.login.submit)]);
    await emit("login", `Signed on as ${ph.code}`, await screen(page));

    for (const item of opts.items) {
      const res: WritebackResult = { rx: item.rx, note: item.note, readBack: "", verified: false, attempts: 0 };
      for (let attempt = 1; attempt <= max && !res.verified; attempt++) {
        res.attempts = attempt;
        try {
          await page.goto(`${base.origin}/queue`);
          await emit("navigate", "F2 FILL QUEUE", await screen(page));
          await Promise.all([page.waitForURL(`**/rx/${item.rx}`), page.click(sel.queue.row.replace("{rx}", item.rx))]);
          await emit("navigate", `Open Rx ${item.rx}`, await screen(page));
          await Promise.all([page.waitForURL("**/notes"), page.click(sel.rx.notes)]);
          await page.fill(sel.rx.noteInput, item.note);
          await emit("writeback", `F6 NOTES> ${item.note}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
          await Promise.all([page.waitForURL(`**/rx/${item.rx}`), page.click(sel.rx.submit)]);
          // RPA-8: re-read what the terminal actually saved
          res.readBack = (await page.innerText(sel.rx.note)).replace(/\u00a0/g, " ");
          res.verified = res.readBack === item.note;
          await emit("verify", res.verified ? `Re-read note matches: ${res.readBack}` : `Re-read note differs: "${res.readBack}"`, await screen(page));
        } catch (e) {
          res.error = (e as Error).message.split("\n")[0];
          await emit("error", `Write-back attempt ${attempt} failed: ${res.error}`);
        }
      }
      if (res.verified) delete res.error;
      results.push(res);
    }
    await emit("done", `Write-back finished: ${results.filter((r) => r.verified).length} of ${results.length} verified`);
    await ctx.close();
  } catch (e) {
    for (const item of opts.items) if (!results.some((r) => r.rx === item.rx)) results.push({ rx: item.rx, note: item.note, readBack: "", verified: false, attempts: 0, error: (e as Error).message.split("\n")[0] });
    await emit("error", `Terminal session failed: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
  return results;
}
