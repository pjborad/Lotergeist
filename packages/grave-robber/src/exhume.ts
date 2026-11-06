import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { hostAllowed } from "./allowlist";
import { faxBelongsTo, faxMatchesNdc, readFaxInbox } from "./fax";
import { parseTerminalLine } from "./parse";
import type { DispenseRow, ExhumeOptions, PharmacyRef, RpaStep } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultSelectors = path.resolve(import.meta.dirname, "../rpa/selectors.json");

/**
 * Grave Robber: drives RxTerm 98 with Playwright (one browser context per pharmacy) and reads
 * fax PDFs. Every move is reported through onStep so the UI can stream it (RPA-6).
 */
export async function exhume(opts: ExhumeOptions): Promise<{ rows: DispenseRow[]; steps: RpaStep[] }> {
  const sel = JSON.parse(fs.readFileSync(opts.selectorsPath ?? defaultSelectors, "utf8"));
  const base = new URL(opts.rxtermUrl);
  const allowed = opts.allowedHosts ?? [base.host, base.hostname];
  const password = opts.password ?? "GRAVE98";
  const delay = opts.stepDelayMs ?? 0;
  const lotSet = new Set(opts.lots.map((l) => l.toUpperCase()));
  const rows: DispenseRow[] = [];
  const steps: RpaStep[] = [];
  let seq = 0;

  const emit = async (ph: PharmacyRef, action: RpaStep["action"], message: string, extra: Partial<RpaStep> = {}) => {
    const s: RpaStep = { seq: ++seq, pharmacyGln: ph.gln, pharmacyName: ph.name, system: ph.system, action, message, ts: Date.now(), ...extra };
    steps.push(s);
    await opts.onStep?.(s);
    if (delay) await sleep(delay);
  };

  const terminalPharmacies = opts.pharmacies.filter((p) => p.system === "rxterm");
  const faxPharmacies = opts.pharmacies.filter((p) => p.system === "fax");

  if (terminalPharmacies.length) {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    try {
      for (const ph of terminalPharmacies) {
        const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
        const page = await ctx.newPage();
        let blocked = 0;
        // RPA-5: nothing leaves the allowlist (this also keeps the terminal's web font from loading)
        await page.route("**/*", (route) => {
          if (hostAllowed(route.request().url(), allowed)) return route.continue();
          blocked++;
          return route.abort();
        });
        try {
          await scrapeTerminal(page, ph);
          if (blocked) await emit(ph, "blocked", `${blocked} off-allowlist request(s) blocked`);
        } catch (e) {
          await emit(ph, "error", `terminal session failed: ${(e as Error).message}`);
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  async function scrapeTerminal(page: Page, ph: PharmacyRef) {
    let found = 0;
    await emit(ph, "start", `Opening RxTerm 98 for ${ph.name}`);
    await page.goto(base.origin + "/");
    await emit(ph, "navigate", "Sign-on screen", { screen: await screen(page) });

    await page.fill(sel.login.user, ph.code);
    await page.fill(sel.login.pass, password);
    await emit(ph, "login", `Signing on as ${ph.code}`);
    await Promise.all([page.waitForURL("**/menu"), page.click(sel.login.submit)]);
    await emit(ph, "navigate", "Main menu: F3 Dispense History", { screen: await screen(page) });

    await Promise.all([page.waitForURL("**/history"), page.click(sel.menu.dispenseHistory)]);
    const ndc = opts.ndcs[0]!;
    for (const q of opts.ndcs) {
      if (q !== opts.ndcs[0]) await page.goto(`${base.origin}/history`);
      await page.fill(sel.history.ndc, q);
      await emit(ph, "search", `QUERY> NDC=${q}`);
      await Promise.all([page.waitForURL(/\/history\?/), page.click(sel.history.submit)]);

      for (let guard = 0; guard < 200; guard++) {
        const text = await screen(page);
        const pager = await page.getAttribute(sel.history.pager, "data-page");
        const pages = await page.getAttribute(sel.history.pager, "data-pages");
        await emit(ph, "page", `Reading page ${pager} of ${pages}`, { screen: text, rowsFound: found });
        for (const line of text.split("\n")) {
          const r = parseTerminalLine(line);
          if (!r) continue;
          if (!lotSet.has(r.lot.toUpperCase())) {
            await emit(ph, "skip", `Rx ${r.rxNumber} is lot ${r.lot}, not recalled`);
            continue;
          }
          found++;
          rows.push({ ...r, ndc: q || ndc, source: "rxterm", pharmacyGln: ph.gln, pharmacyName: ph.name, confidence: 1 });
          await emit(ph, "row", `Row found: Rx ${r.rxNumber} · ${r.patientId} · ${r.fillDate} · lot ${r.lot}`, { rowsFound: found });
        }
        const next = page.locator(sel.history.next);
        if (!(await next.count())) break;
        await Promise.all([page.waitForURL(/page=\d+/), next.click()]);
      }
    }
    await Promise.all([page.waitForURL("**/menu"), page.keyboard.press("F3")]).catch(() => undefined);
    await emit(ph, "logout", `Signing off. ${found} recalled fill(s) exhumed`, { rowsFound: found });
  }

  async function screen(page: Page): Promise<string> {
    return (await page.innerText(sel.history.screen)).replace(/\u00a0/g, " ");
  }

  if (faxPharmacies.length) {
    const inbox = await readFaxInbox(opts.faxDir);
    for (const ph of faxPharmacies) {
      let found = 0;
      await emit(ph, "start", `Fax crypt: ${inbox.filter((f) => f.page && faxBelongsTo(f.page, ph.name)).length} unread fax(es) from ${ph.name}`);
      for (const f of inbox) {
        if (!f.page || !faxBelongsTo(f.page, ph.name)) continue;
        await emit(ph, "fax", `Opening ${f.file}`, { screen: f.text.trim(), confidence: f.page.confidence });
        if (!faxMatchesNdc(f.page, opts.ndcs) || !lotSet.has(f.page.lot.toUpperCase())) {
          await emit(ph, "skip", `${f.file}: NDC ${f.page.ndc} lot ${f.page.lot} not recalled`);
          continue;
        }
        for (const r of f.page.rows) {
          found++;
          rows.push({ ...r, ndc: f.page.ndc, source: "fax", pharmacyGln: ph.gln, pharmacyName: ph.name, confidence: f.page.confidence });
          await emit(ph, "row", `Fax row: Rx ${r.rxNumber} · ${r.patientId} · ${r.fillDate} · lot ${r.lot} (parse conf ${f.page.confidence.toFixed(2)})`, { rowsFound: found, confidence: f.page.confidence });
        }
      }
      await emit(ph, "logout", `Fax inbox done. ${found} recalled fill(s) exhumed`, { rowsFound: found });
    }
  }

  const last = opts.pharmacies[0];
  if (last) await emit(last, "done", `Exhumation complete: ${rows.length} dispense row(s) from ${opts.pharmacies.length} pharmacies`, { rowsFound: rows.length });
  return { rows, steps };
}

/** Instant replay: stream a previously recorded run at the same pace the live bot used (or faster). */
export async function replay(recorded: RpaStep[], onStep: (s: RpaStep) => void | Promise<void>, stepDelayMs = 60): Promise<void> {
  for (const s of recorded) {
    await onStep({ ...s, ts: Date.now() });
    if (stepDelayMs) await sleep(stepDelayMs);
  }
}
