import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { ndcToGtin14Candidates } from "@bsrx/gs1";
import { fleschKincaidGrade } from "@bsrx/undertaker";
import { parsePaste, recordFromText } from "@bsrx/summoner";
import type { Ctx } from "./ctx";
import { DEMO_ID, nightWatch, resetDemo } from "./demo";
import { planHearseForRecalls } from "./hearse";
import { getScan, listFills, listScans, nextFill, retryFailedWritebacks, runWriteback, scanFill } from "./fills";
import { ConfirmError, confirmRecall, runHunt, summonRecord } from "./pipeline";
import { afterlifeView, demoPackages, HttpError, listRecalls, outreachRows, recallDetail, scanElement, toOutreach, traceView } from "./views";

const readyIds = (ctx: Ctx) => ctx.db.all<{ id: string }>("SELECT id FROM recalls WHERE status = 'ready' ORDER BY demo DESC, id").map((r) => r.id);
const idsFrom = (ctx: Ctx, q: unknown) => (typeof q === "string" && q ? q.split(",").filter(Boolean) : readyIds(ctx));

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) return reply.code(422).send({ error: "invalid request", issues: err.issues });
    if (err instanceof HttpError || err instanceof ConfirmError) return reply.code(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "internal error" });
  });

  app.get("/api/health", async () => ({
    ok: true, events: await ctx.store.countEvents(), recalls: listRecalls(ctx).length,
    llm: ctx.llm?.name ?? null, rpaMode: ctx.cfg.rpaMode, weatherMode: ctx.cfg.weatherMode, router: ctx.cfg.osrmUrl ? "osrm" : "straight-line"
  }));

  // ---- recalls
  app.get("/api/recalls", async () => listRecalls(ctx));

  // SUM-2: paste text or a recall number; answers well inside 2 s
  app.post("/api/recalls", async (req, reply) => {
    const { input } = z.object({ input: z.string().min(3).max(20000) }).parse(req.body);
    const p = parsePaste(input);
    let rec;
    if (p.kind === "number") {
      const r = await ctx.openfda.fetchByNumber(p.recallNumber);
      rec = r.records[0];
      if (!rec) throw new HttpError(404, `No recall ${p.recallNumber} on openFDA or in the fixtures.`);
    } else rec = recordFromText(p.text);
    const id = await summonRecord(ctx, rec);
    return reply.code(201).send({ id });
  });

  app.get("/api/recalls/:id", async (req) => {
    const d = await recallDetail(ctx, (req.params as { id: string }).id);
    if (!d) throw new HttpError(404, "unknown recall");
    return d;
  });

  app.post("/api/recalls/:id/confirm", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z.object({ lots: z.array(z.string()).optional(), auto: z.boolean().optional() }).parse(req.body ?? {});
    confirmRecall(ctx, id, body);
    void runHunt(ctx, id);
    return reply.code(202).send({ id, status: "confirmed" });
  });

  app.get("/api/recalls/:id/trace", async (req) => {
    const v = await traceView(ctx, (req.params as { id: string }).id);
    if (!v) throw new HttpError(404, "unknown recall");
    return v;
  });

  const sse = (req: any, reply: any, id: string) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive",
      "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*"
    });
    const send = (e: { id: number }) => res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    const since = Number(req.headers["last-event-id"] ?? (req.query as { since?: string }).since ?? 0) || 0;
    res.write("retry: 2000\n\n");
    for (const e of ctx.bus.since(id, since)) send(e);
    const off = ctx.bus.subscribe(id, send);
    const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => { off(); clearInterval(beat); });
  };
  app.get("/api/recalls/:id/stream", (req, reply) => sse(req, reply, (req.params as { id: string }).id));

  // ---- Soul Catcher: scan at fill
  app.get("/api/fills", async () => listFills(ctx));
  app.get("/api/fills/next", async () => nextFill(ctx));
  app.get("/api/fills/scans", async () => listScans(ctx));
  app.get("/api/fills/stream", (req, reply) => sse(req, reply, "fills"));
  app.post("/api/fills/:rx/scan", async (req, reply) => {
    const { raw, device } = z.object({ raw: z.string().min(1).max(300), device: z.enum(["webcam", "usb", "typed"]).optional() }).parse(req.body);
    return reply.code(201).send(await scanFill(ctx, (req.params as { rx: string }).rx, { raw, device }));
  });
  app.post("/api/fills/:rx/writeback", async (req) => {
    const row = ctx.db.get<{ id: number }>("SELECT id FROM fill_scans WHERE rx_number = ? AND verdict = 'CAPTURED' ORDER BY id DESC LIMIT 1", (req.params as { rx: string }).rx);
    if (!row) throw new HttpError(404, "No captured scan for that prescription. Nothing to write back.");
    return runWriteback(ctx, row.id);
  });
  app.post("/api/fills/retry", async () => { await retryFailedWritebacks(ctx); return { ok: true, scans: listScans(ctx) }; });
  app.get("/api/fills/scans/:id", async (req) => {
    const s = getScan(ctx, Number((req.params as { id: string }).id));
    if (!s) throw new HttpError(404, "unknown scan");
    return s;
  });

  // chain of custody for any NDC + lot (also used by dead-registry-mcp)
  app.get("/api/trace-lot", async (req) => {
    const q = z.object({ ndc: z.string(), lot: z.string() }).parse(req.query);
    const gtins = ndcToGtin14Candidates(q.ndc);
    if (!gtins.length) throw new HttpError(422, "That is not a valid NDC.");
    const trace = await ctx.store.trace({ gtins, lots: [q.lot] });
    const sample = (await ctx.store.serialsFor({ gtins, lots: [q.lot] }))[0];
    const custody = sample ? await ctx.store.custody(sample.gtin, sample.serial) : [];
    return { ndc: q.ndc, lot: q.lot, gtins, ...trace, sample: sample ? { gtin: sample.gtin, serial: sample.serial, custody } : null };
  });

  // ---- afterlife + hearse
  app.get("/api/afterlife", async (req) => afterlifeView(ctx, idsFrom(ctx, (req.query as { recalls?: string }).recalls)));
  app.get("/api/hearse", async (req) => {
    const q = req.query as { recalls?: string; avoid?: string };
    return planHearseForRecalls(ctx, idsFrom(ctx, q.recalls), q.avoid !== "0");
  });

  // UND-3: approval only marks a letter ready. Nothing in this codebase sends a message.
  app.post("/api/outreach/:id/approve", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { approvedBy } = z.object({ approvedBy: z.string().max(40).optional() }).parse(req.body ?? {});
    const row = ctx.db.get("SELECT * FROM outreach WHERE id = ?", id);
    if (!row) throw new HttpError(404, "unknown letter");
    ctx.db.run("UPDATE outreach SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?", approvedBy ?? "RPh on duty", Date.now(), id);
    return toOutreach(ctx.db.get("SELECT * FROM outreach WHERE id = ?", id));
  });
  app.patch("/api/outreach/:id", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { text } = z.object({ text: z.string().min(10).max(1200) }).parse(req.body);
    if (!ctx.db.get("SELECT 1 FROM outreach WHERE id = ?", id)) throw new HttpError(404, "unknown letter");
    ctx.db.run("UPDATE outreach SET draft_text = ?, reading_grade = ?, written_by = 'pharmacist', status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?", text, fleschKincaidGrade(text), id);
    return toOutreach(ctx.db.get("SELECT * FROM outreach WHERE id = ?", id));
  });
  app.get("/api/recalls/:id/outreach", async (req) => outreachRows(ctx, [(req.params as { id: string }).id]));

  app.post("/api/quarantine/action", async (req) => {
    const b = z.object({ gtin: z.string(), serial: z.string(), action: z.enum(["pull", "pickup"]) }).parse(req.body);
    const row = ctx.db.get("SELECT id FROM quarantine WHERE gtin = ? AND serial = ?", b.gtin, b.serial);
    if (!row) throw new HttpError(404, "that package is not in any quarantine list yet");
    ctx.db.run(`UPDATE quarantine SET ${b.action === "pull" ? "pulled" : "pickup"} = 1 WHERE gtin = ? AND serial = ?`, b.gtin, b.serial);
    return { ok: true, ...b };
  });

  // ---- scan
  app.post("/api/scan", async (req) => {
    const { element } = z.object({ element: z.string().min(8).max(300) }).parse(req.body);
    return scanElement(ctx, element);
  });
  app.get("/api/demo/packages", async () => demoPackages(ctx));

  // ---- demo + night watch
  app.post("/api/demo/reset", async (req) => {
    const b = z.object({ prerun: z.boolean().optional() }).parse(req.body ?? {});
    return { ...(await resetDemo(ctx, b)), demoId: DEMO_ID };
  });
  app.post("/api/night-watch/run", async () => nightWatch(ctx));

  // ---- built web app, when present
  if (fs.existsSync(path.join(ctx.cfg.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: ctx.cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html").send(fs.readFileSync(path.join(ctx.cfg.webDist, "index.html")));
    });
  }
  return app;
}
