import express, { type Request, type Response } from "express";
import { ndcKeys } from "@bsrx/gs1";
import { generateWorld, type Fill, type QueueItem, type World } from "@bsrx/crypt-seed";

/** RxTerm 98: a deliberately awful 1998 green-screen pharmacy terminal, served as HTML. No API, no JSON. */

const PASSWORD = "GRAVE98";
const SCREEN_DATE = "11/05/98";
const RULE = "─".repeat(48);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const mmddyy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`;

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RxTERM 98</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>
html,body{margin:0;background:#031407;color:#57ff7a}
body{font-family:VT323,'Courier New',monospace;font-size:22px;line-height:1.3;text-shadow:0 0 6px rgba(87,255,122,.55);padding:22px 26px}
#screen{margin:0;white-space:pre-wrap}
.row{white-space:pre}
a{color:#57ff7a} input{font:inherit;color:#57ff7a;background:#031407;border:0;border-bottom:1px solid #57ff7a;outline:none;caret-color:#57ff7a;width:22ch;text-shadow:inherit}
input:focus{background:#0a2a12}
button{font:inherit;color:#031407;background:#57ff7a;border:0;padding:0 12px;margin-left:8px;cursor:pointer}
.err{color:#ffb000}
form{margin:0}
</style></head><body>
<main id="screen">${body}</main>
<script>
document.addEventListener('keydown',function(e){
  var map={PageDown:'F8',PageUp:'F7'};var k=map[e.key]||e.key;
  if(/^F\\d+$/.test(k)){var a=document.querySelector('[data-key="'+k+'"]');if(a){e.preventDefault();a.click();}}
});
var f=document.querySelector('input');if(f)f.focus();
</script></body></html>`;
}

const header = (title: string) => `<div class="row">RxTERM 98  v4.2  ** ${title} **${" ".repeat(Math.max(1, 46 - title.length - 22))}${SCREEN_DATE}</div><div class="row">${RULE}</div>`;

export interface AppOptions {
  world?: World;
  pageSize?: number;
  latencyMs?: number;
}

export function createApp(opts: AppOptions = {}) {
  const world = opts.world ?? generateWorld();
  const pageSize = opts.pageSize ?? Number(process.env.RXTERM_PAGE_SIZE ?? 5);
  const latency = opts.latencyMs ?? Number(process.env.RXTERM_LATENCY_MS ?? 120);
  const byCode = new Map(world.parties.filter((p) => p.system === "rxterm" && p.code).map((p) => [p.code!, p]));
  const fillsByGln = new Map<string, Fill[]>();
  for (const f of world.fills) if (f.system === "rxterm") (fillsByGln.get(f.pharmacyGln) ?? fillsByGln.set(f.pharmacyGln, []).get(f.pharmacyGln)!).push(f);

  const queueByGln = new Map<string, QueueItem[]>();
  for (const q of world.queue ?? []) (queueByGln.get(q.pharmacyGln) ?? queueByGln.set(q.pharmacyGln, []).get(q.pharmacyGln)!).push(q);
  // F6 notes live in memory: this is a mock terminal, a restart (or /reset-notes) clears them
  const notes = new Map<string, string>();
  const noteKey = (gln: string, rx: string) => `${gln}|${rx}`;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use((_req, _res, next) => (latency ? setTimeout(next, latency) : next()));

  const session = (req: Request) => {
    const m = /(?:^|;\s*)rx98=([A-Z0-9]+)/.exec(req.headers.cookie ?? "");
    return m ? byCode.get(m[1]!) : undefined;
  };
  const need = (req: Request, res: Response) => {
    const p = session(req);
    if (!p) res.redirect("/");
    return p;
  };

  app.get("/health", (_req, res) => { res.json({ ok: true, terminal: "RxTERM 98 v4.2", pharmacies: byCode.size }); });

  app.get("/", (req, res) => {
    const err = req.query.err ? `<div class="row err">?INVALID USER ID OR PASSWORD</div>` : "";
    res.send(page(`${header("SIGN ON")}
<div class="row">PHARMACY SYSTEMS GROUP  (C) 1998  ALL RIGHTS RESERVED</div>
<div class="row"> </div>${err}
<form method="post" action="/login" autocomplete="off">
<div class="row">USER ID  &gt; <input name="user" aria-label="User ID" maxlength="8"></div>
<div class="row">PASSWORD &gt; <input name="pass" type="password" aria-label="Password" maxlength="12"><button type="submit">ENTER</button></div>
</form>
<div class="row"> </div><div class="row">ENTER=SIGN ON</div>`));
  });

  app.post("/login", (req, res) => {
    const user = String(req.body.user ?? "").trim().toUpperCase();
    const pass = String(req.body.pass ?? "");
    if (!byCode.has(user) || pass !== PASSWORD) return res.redirect("/?err=1");
    res.setHeader("Set-Cookie", `rx98=${user}; Path=/; HttpOnly; SameSite=Strict`);
    res.redirect("/menu");
  });

  app.get("/menu", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    res.send(page(`${header("MAIN MENU")}
<div class="row">STORE: ${esc(ph.name.toUpperCase())}</div>
<div class="row"> </div>
<div class="row">  F1  PATIENT PROFILE        (OFFLINE)</div>
<div class="row"><a href="/queue" data-key="F2">  F2  FILL QUEUE</a></div>
<div class="row"><a href="/history" data-key="F3">  F3  DISPENSE HISTORY</a></div>
<div class="row">  F4  INVENTORY              (OFFLINE)</div>
<div class="row"><a href="/logout" data-key="F10"> F10  SIGN OFF</a></div>`));
  });

  app.get("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "rx98=; Path=/; Max-Age=0");
    res.redirect("/");
  });

  app.get("/history", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    const ndc = String(req.query.ndc ?? "").trim();
    const lot = String(req.query.lot ?? "").trim().toUpperCase();
    const pageNo = Math.max(1, Number(req.query.page ?? 1) || 1);

    if (!ndc) {
      return res.send(page(`${header("DISPENSE HISTORY")}
<div class="row">STORE: ${esc(ph.name.toUpperCase())}</div>
<form method="get" action="/history" autocomplete="off">
<div class="row">QUERY&gt; NDC=<input name="ndc" aria-label="NDC" maxlength="14"> LOT=<input name="lot" aria-label="Lot" maxlength="20" style="width:16ch"><button type="submit">ENTER</button></div>
</form>
<div class="row">${RULE}</div>
<div class="row"><a href="/menu" data-key="F3">F3=EXIT</a></div>`));
    }

    const keys = new Set(ndcKeys(ndc));
    const hits = (fillsByGln.get(ph.gln) ?? []).filter((f) => keys.has(f.ndc11.replace(/-/g, "")) && (!lot || f.lot.toUpperCase() === lot));
    const pages = Math.max(1, Math.ceil(hits.length / pageSize));
    const cur = Math.min(pageNo, pages);
    const slice = hits.slice((cur - 1) * pageSize, cur * pageSize);
    const q = (p: number) => `/history?ndc=${encodeURIComponent(ndc)}&lot=${encodeURIComponent(lot)}&page=${p}`;
    const rows = slice.map((f) => `<div class="row">${f.rx.padEnd(7)} ${f.patientId}  ${mmddyy(f.fillDate)}  ${String(f.qty).padStart(2)}  ${esc(f.lot)}</div>`).join("\n");
    const shown = Math.min(cur * pageSize, hits.length);
    res.send(page(`${header("DISPENSE HISTORY")}
<div class="row">QUERY&gt; NDC=${esc(ndc)}${lot ? `  LOT=${esc(lot)}` : ""}</div>
<div class="row">${RULE}</div>
<div class="row">RX#     PT-ID   FILLED    QTY  LOT</div>
${rows || '<div class="row">NO RECORDS FOUND</div>'}
<div class="row"> </div>
<div class="row"><a href="/menu" data-key="F3">F3=EXIT</a>  ${cur > 1 ? `<a href="${q(cur - 1)}" data-key="F7">F7=PREV</a>` : "F7=PREV"}  ${cur < pages ? `<a href="${q(cur + 1)}" data-key="F8">F8=NEXT</a>` : "F8=NEXT"}  <span id="pager" data-page="${cur}" data-pages="${pages}" data-total="${hits.length}">** ${shown} OF ${hits.length} **</span></div>
<div class="row">PAGE ${cur} OF ${pages}</div>`));
  });

  // ---- FILL QUEUE (F2) and per-prescription F6 NOTES
  app.get("/queue", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    const items = queueByGln.get(ph.gln) ?? [];
    const rows = items.map((q) => {
      const has = notes.has(noteKey(ph.gln, q.rx));
      return `<div class="row"><a href="/rx/${q.rx}" data-rx="${q.rx}">${q.rx.padEnd(7)} ${q.patientId}  ${esc(q.drug.slice(0, 30).padEnd(30))} ${String(q.qty).padStart(2)}  ${has ? "NOTED" : "WAITING"}</a></div>`;
    }).join("\n");
    res.send(page(`${header("FILL QUEUE")}
<div class="row">STORE: ${esc(ph.name.toUpperCase())}</div>
<div class="row">RX#     PT-ID   DRUG                           QTY STATUS</div>
<div class="row">${RULE}</div>
${rows || '<div class="row">QUEUE EMPTY</div>'}
<div class="row"> </div>
<div class="row"><a href="/menu" data-key="F3">F3=EXIT</a>  <span id="queue-count" data-count="${items.length}">** ${items.length} WAITING **</span></div>`));
  });

  app.get("/rx/:rx", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    const q = (queueByGln.get(ph.gln) ?? []).find((x) => x.rx === req.params.rx);
    if (!q) return res.status(404).send(page(`${header("PRESCRIPTION")}<div class="row err">?RX NOT FOUND</div><div class="row"><a href="/queue" data-key="F3">F3=EXIT</a></div>`));
    const note = notes.get(noteKey(ph.gln, q.rx));
    res.send(page(`${header("PRESCRIPTION")}
<div class="row">RX# ${q.rx}   PATIENT ${q.patientId}</div>
<div class="row">DRUG   ${esc(q.drug)}</div>
<div class="row">NDC    ${q.ndc11}   QTY ${q.qty}</div>
<div class="row">${RULE}</div>
<div class="row">NOTES&gt; <span id="note" data-note="${esc(note ?? "")}">${note ? esc(note) : "(NONE)"}</span></div>
<div class="row"> </div>
<div class="row"><a href="/rx/${q.rx}/notes" data-key="F6">F6=NOTES</a>  <a href="/queue" data-key="F3">F3=EXIT</a></div>`));
  });

  app.get("/rx/:rx/notes", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    const q = (queueByGln.get(ph.gln) ?? []).find((x) => x.rx === req.params.rx);
    if (!q) return res.redirect("/queue");
    res.send(page(`${header("RX NOTES")}
<div class="row">RX# ${q.rx}   ${esc(q.drug)}</div>
<form method="post" action="/rx/${q.rx}/notes" autocomplete="off">
<div class="row">NOTES&gt; <input name="note" aria-label="Notes" maxlength="80" style="width:60ch"><button type="submit">ENTER</button></div>
</form>
<div class="row"><a href="/rx/${q.rx}" data-key="F3">F3=EXIT</a></div>`));
  });

  app.post("/rx/:rx/notes", (req, res) => {
    const ph = need(req, res);
    if (!ph) return;
    const q = (queueByGln.get(ph.gln) ?? []).find((x) => x.rx === req.params.rx);
    if (!q) return res.redirect("/queue");
    // the 1998 field is 80 columns of upper-case ASCII; anything else is dropped, like the real thing
    const note = String(req.body.note ?? "").toUpperCase().replace(/[^\x20-\x7e]/g, "").slice(0, 80);
    notes.set(noteKey(ph.gln, q.rx), note);
    res.redirect(`/rx/${q.rx}`);
  });

  // demo helper, not part of the "legacy" surface the bot is allowed to use
  app.post("/reset-notes", (_req, res) => { notes.clear(); res.json({ ok: true }); });

  return app;
}
