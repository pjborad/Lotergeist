import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { actorFromToken, login, logout, type SessionUser } from "./auth";
import { audit, HttpError, todayIso, type Actor, type Ctx } from "./core";
import { fillQueue, printLabel, rxDetail, scanFill, sell, sendBack, verifyDispense } from "./fill";
import { adjustLot, listLots, lotDetail, moveLot } from "./inventory";
import { parseLabelText } from "./ocr-text";
import { auditReport, closeRecall, confirmRecallLot, listRecalls, lookupRecall, messageDraft, recallImpact, recallResults, recallView, respondToManufacturer, scheduleReturn, sendNotifications, smsSegments, merge } from "./recall";
import { confirmPutaway, deliveryView, listDeliveries, PROBLEM_KINDS, reportProblem, scanReceive } from "./receiving";
import { seedDatabase, expectedPackages, FILL_PACKAGES, PRODUCTS } from "./seed";
import { gtinOf, ndc11Digits } from "./domain";
import { ingestFaxInbox, pollOpenFda, todayView } from "./today";

declare module "fastify" { interface FastifyRequest { actor?: Actor; user?: SessionUser } }

const COOKIE = "lg_session";
const scanBody = z.object({
  raw: z.string().min(1).max(400).optional(),
  fields: z.object({ ndc: z.string().max(20).optional(), lot: z.string().max(30).optional(), expiry: z.string().max(20).optional(), serial: z.string().max(30).optional() }).optional(),
  source: z.enum(["datamatrix", "ocr", "typed"]).optional()
});
const witnessBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).optional();

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) return reply.code(422).send({ error: "Some fields are missing or wrong.", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code });
    app.log.error(err);
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? "Something went wrong." });
  });

  // ---- sessions: everything under /api needs one, except sign-in and the public config
  const PUBLIC = new Set(["/api/health", "/api/auth/login", "/api/auth/sso", "/api/auth/config", "/api/auth/logout"]);
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0]!;
    if (!url.startsWith("/api/") || PUBLIC.has(url)) return;
    const s = actorFromToken(ctx, req.cookies[COOKIE]);
    if (!s) return reply.code(401).send({ error: "Please sign in.", code: "unauthenticated" });
    req.actor = s.actor;
    req.user = s.user;
  });
  const A = (req: FastifyRequest) => req.actor!;
  const only = (req: FastifyRequest, ...roles: Actor["role"][]) => {
    if (!roles.includes(A(req).role)) throw new HttpError(403, `A ${A(req).role} cannot do that.`, "forbidden");
  };

  app.get("/api/health", async () => ({ ok: true, today: todayIso(ctx), notifier: ctx.notify.name }));

  // ---- auth
  app.get("/api/auth/config", async () => ({
    stores: ctx.db.all<{ id: string; name: string }>("SELECT id, name FROM stores"),
    demo: ctx.cfg.demo ? { email: "j.rivera@elmstreetrx.example", password: "moonlight-rx-2026", note: "Demo environment: staff accounts j.rivera, k.patel and m.diaz share this password." } : null
  }));
  const loginBody = z.object({ storeId: z.string(), email: z.string().min(3).max(120), password: z.string().min(1).max(200), trusted: z.boolean().optional() });
  const setCookie = (reply: FastifyReply, token: string, ttl: number) => reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: Math.floor(ttl / 1000), secure: ctx.cfg.cookieSecure });
  app.post("/api/auth/login", async (req, reply) => {
    const b = loginBody.parse(req.body);
    const ws = `${req.headers["user-agent"]?.includes("Mac") ? "Mac" : "PC"} workstation · ${req.ip}`;
    const r = login(ctx, { ...b, trusted: !!b.trusted, workstation: ws });
    setCookie(reply, r.token, r.ttl);
    audit(ctx, { id: r.user.id, name: r.user.name, role: r.user.role, storeId: r.user.storeId, workstation: ws }, "auth.login", "user", r.user.id);
    return { user: r.user };
  });
  // Demo stand-in for "badge tap or SSO": signs in the pharmacist on duty. Disabled outside demo mode.
  app.post("/api/auth/sso", async (req, reply) => {
    if (!ctx.cfg.demo) throw new HttpError(501, "SSO is not configured.");
    const r = login(ctx, { storeId: "store-7", email: "j.rivera@elmstreetrx.example", password: "moonlight-rx-2026", trusted: false, workstation: `SSO badge · ${req.ip}` });
    setCookie(reply, r.token, r.ttl);
    return { user: r.user };
  });
  app.post("/api/auth/logout", async (req, reply) => { const t = req.cookies[COOKIE]; if (t) logout(ctx, t); reply.clearCookie(COOKIE, { path: "/" }); return { ok: true }; });
  app.get("/api/me", async (req) => ({ user: req.user, store: ctx.db.get("SELECT * FROM stores WHERE id = ?", A(req).storeId), today: todayIso(ctx) }));

  // ---- today
  app.get("/api/today", async (req) => todayView(ctx, A(req)));

  // ---- receiving
  app.get("/api/deliveries", async () => listDeliveries(ctx));
  app.get("/api/deliveries/:id", async (req) => {
    const d = deliveryView(ctx, (req.params as { id: string }).id);
    if (!d) throw new HttpError(404, "Unknown delivery.");
    return d;
  });
  app.post("/api/deliveries/:id/scan", async (req) => { only(req, "technician", "pharmacist"); return scanReceive(ctx, A(req), (req.params as { id: string }).id, scanBody.parse(req.body)); });
  app.post("/api/packages/:id/putaway", async (req) => {
    only(req, "technician", "pharmacist");
    const b = z.object({ witness: witnessBody }).parse(req.body ?? {});
    return confirmPutaway(ctx, A(req), Number((req.params as { id: string }).id), b.witness);
  });
  app.post("/api/packages/:id/problem", async (req) => {
    only(req, "technician", "pharmacist");
    const b = z.object({ kind: z.enum(PROBLEM_KINDS), note: z.string().max(200).optional() }).parse(req.body);
    return reportProblem(ctx, A(req), Number((req.params as { id: string }).id), b.kind, b.note);
  });

  // ---- inventory
  app.get("/api/lots", async (req) => listLots(ctx, req.query as { filter?: string; q?: string }));
  app.get("/api/lots/:id", async (req) => lotDetail(ctx, Number((req.params as { id: string }).id)));
  app.post("/api/lots/:id/move", async (req) => { only(req, "technician", "pharmacist"); return moveLot(ctx, A(req), Number((req.params as { id: string }).id), z.object({ location: z.string() }).parse(req.body).location); });
  app.post("/api/lots/:id/adjust", async (req) => {
    only(req, "technician", "pharmacist");
    const b = z.object({ count: z.number().int(), reason: z.string().max(200), witness: witnessBody }).parse(req.body);
    return adjustLot(ctx, A(req), Number((req.params as { id: string }).id), b.count, b.reason, b.witness);
  });

  // ---- fill & pickup
  app.get("/api/rx", async () => fillQueue(ctx));
  app.get("/api/rx/:rx", async (req) => rxDetail(ctx, A(req), (req.params as { rx: string }).rx));
  app.post("/api/rx/:rx/scan", async (req) => scanFill(ctx, A(req), (req.params as { rx: string }).rx, scanBody.parse(req.body)));
  const did = (req: FastifyRequest) => Number((req.params as { id: string }).id);
  app.post("/api/dispenses/:id/label", async (req) => printLabel(ctx, A(req), did(req)));
  app.post("/api/dispenses/:id/verify", async (req) => verifyDispense(ctx, A(req), did(req), z.object({ checklist: z.array(z.boolean()) }).parse(req.body).checklist));
  app.post("/api/dispenses/:id/sendback", async (req) => sendBack(ctx, A(req), did(req), z.object({ reason: z.string().max(200) }).parse(req.body).reason));
  app.post("/api/dispenses/:id/sell", async (req) => sell(ctx, A(req), did(req), z.object({ idChecked: z.boolean(), counseled: z.boolean(), signature: z.boolean() }).parse(req.body)));

  // ---- recalls
  const rid = (req: FastifyRequest) => (req.params as { id: string }).id;
  app.get("/api/recalls", async () => listRecalls(ctx));
  app.get("/api/fax", async () => ctx.db.all("SELECT id, received_at, from_name, pages, image, status, recall_id FROM fax_inbox ORDER BY id DESC"));
  app.post("/api/recalls/lookup", async (req) => {
    only(req, "pharmacist");
    const b = z.object({ number: z.string().max(40).optional(), text: z.string().max(20000).optional() }).parse(req.body);
    const v = await lookupRecall(ctx, A(req), b, { autoConfirm: true });
    ctx.db.run("UPDATE fax_inbox SET status = 'read' WHERE recall_id = ?", v.id);
    return { recall: v, impact: recallImpact(ctx, v.id) };
  });
  app.get("/api/recalls/:id", async (req) => ({ recall: recallView(ctx, rid(req)), impact: recallImpact(ctx, rid(req)) }));
  app.post("/api/recalls/:id/confirm-lot", async (req) => {
    const v = confirmRecallLot(ctx, A(req), rid(req), z.object({ lot: z.string() }).parse(req.body).lot);
    return { recall: v, impact: recallImpact(ctx, rid(req)) };
  });
  app.get("/api/recalls/:id/messages", async (req) => {
    const d = messageDraft(ctx, rid(req));
    return { ...d, smsPreview: merge(d.sms, d.fields), smsInfo: smsSegments(merge(d.sms, d.fields)) };
  });
  app.post("/api/recalls/:id/preview", async (req) => {
    const b = z.object({ sms: z.string().max(1000), emailSubject: z.string().max(300), emailBody: z.string().max(6000) }).parse(req.body);
    const d = messageDraft(ctx, rid(req));
    const sms = merge(b.sms, d.fields);
    return { smsPreview: sms, smsInfo: smsSegments(sms), emailSubject: merge(b.emailSubject, d.fields), emailBody: merge(b.emailBody, d.fields) };
  });
  app.post("/api/recalls/:id/notifications", async (req) => {
    const b = z.object({ sms: z.string().min(10).max(1000), emailSubject: z.string().min(3).max(300), emailBody: z.string().min(10).max(6000), attest: z.boolean() }).parse(req.body);
    return sendNotifications(ctx, A(req), rid(req), { sms: b.sms, emailSubject: b.emailSubject, emailBody: b.emailBody }, b.attest);
  });
  app.get("/api/recalls/:id/results", async (req) => recallResults(ctx, rid(req)));
  app.post("/api/recalls/:id/return-pickup", async (req) => scheduleReturn(ctx, A(req), rid(req)));
  app.post("/api/recalls/:id/manufacturer-response", async (req) => respondToManufacturer(ctx, A(req), rid(req)));
  app.post("/api/recalls/:id/close", async (req) => { closeRecall(ctx, A(req), rid(req)); return { ok: true }; });
  app.get("/api/recalls/:id/report.pdf", async (req, reply) => {
    only(req, "pharmacist");
    const pdf = await auditReport(ctx, rid(req));
    audit(ctx, A(req), "recall.report", "recall", rid(req));
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="recall-${rid(req)}-audit.pdf"`).send(pdf);
  });
  app.post("/api/night-watch/run", async (req) => { only(req, "pharmacist"); return pollOpenFda(ctx); });

  // ---- OCR text -> fields (the OCR itself runs in the browser)
  app.post("/api/ocr/parse", async (req) => parseLabelText(z.object({ text: z.string().max(20000) }).parse(req.body).text));

  // ---- sandbox outbox
  app.get("/api/outbox", async (req) => {
    const q = req.query as { recall?: string };
    return ctx.db.all(`SELECT o.*, n.recall_id, n.patient_id FROM outbox o LEFT JOIN notifications n ON n.id = o.notification_id ${q.recall ? "WHERE n.recall_id = ?" : ""} ORDER BY o.id DESC LIMIT 200`, ...(q.recall ? [q.recall] : []));
  });
  // A patient replying STOP to a text: honoured from then on (spec: opt-out keyword STOP)
  app.post("/api/sms/inbound", async (req) => {
    const b = z.object({ from: z.string().min(7).max(30), body: z.string().max(200) }).parse(req.body);
    if (!/^\s*stop\s*$/i.test(b.body)) return { handled: false };
    const digits = b.from.replace(/\D/g, "");
    const p = ctx.db.get<{ id: string }>("SELECT id FROM patients WHERE replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?", `%${digits.slice(-10)}`);
    if (!p) return { handled: false };
    ctx.db.run("UPDATE patients SET sms_opt_out = 1 WHERE id = ?", p.id);
    audit(ctx, null, "sms.opt_out", "patient", p.id);
    return { handled: true, patient: p.id };
  });

  app.get("/api/search", async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").trim();
    if (q.length < 2) return { lots: [], rx: [] };
    return { lots: listLots(ctx, { q }).rows.slice(0, 6), rx: fillQueue(ctx).filter((r) => [r.rx, r.patient, r.drug].some((v) => v.toLowerCase().includes(q.toLowerCase()))).slice(0, 6) };
  });

  app.get("/api/audit", async (req) => { only(req, "pharmacist"); return ctx.db.all("SELECT * FROM audit ORDER BY id DESC LIMIT 100"); });

  // ---- demo helpers: the labels a camera can scan, and a reset
  app.get("/api/demo/labels", async () => {
    const dm = (p: { ndc10: string; lot: string; expiry: string; serial: string }) => ({ ...p, gtin: gtinOf(p.ndc10), product: PRODUCTS.find((x) => x.ndc10 === p.ndc10)?.name ?? p.ndc10 });
    const receiving = expectedPackages().map((e) => ({ ...dm(e), group: `Receiving · ${e.delivery}`, scanned: !!ctx.db.get("SELECT 1 FROM packages WHERE gtin = ? AND serial = ?", gtinOf(e.ndc10), e.serial) }));
    const fill = FILL_PACKAGES.flatMap((f) => {
      const row = f.serial
        ? { serial: f.serial }
        : ctx.db.get<{ serial: string }>("SELECT k.serial FROM packages k JOIN lots l ON l.id = k.lot_id WHERE l.ndc11 = ? AND l.lot = ? AND k.status = 'on_shelf' ORDER BY k.id LIMIT 1", ndc11Digits(f.ndc10), f.lot);
      const exp = ctx.db.get<{ expiry: string }>("SELECT expiry FROM lots WHERE ndc11 = ? AND lot = ?", ndc11Digits(f.ndc10), f.lot)?.expiry ?? "";
      return row ? [{ ...dm({ ndc10: f.ndc10, lot: f.lot, expiry: exp, serial: row.serial }), group: "Fill & pickup", note: f.note, scanned: false }] : [];
    });
    return { labels: [...receiving, ...fill] };
  });
  app.post("/api/demo/reset", async (req) => {
    only(req, "pharmacist");
    ctx.db.clearAll();
    seedDatabase(ctx.db, ctx.cfg, ctx.now());
    await ingestFaxInbox(ctx);
    return { ok: true };
  });

  // ---- built web app
  app.get("/fax/:file", async (req, reply) => {
    const f = path.join(ctx.cfg.assetsDir, "fax", path.basename((req.params as { file: string }).file));
    if (!fs.existsSync(f)) return reply.code(404).send({ error: "no such fax" });
    return reply.type("image/png").send(fs.readFileSync(f));
  });
  if (fs.existsSync(path.join(ctx.cfg.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: ctx.cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html").send(fs.readFileSync(path.join(ctx.cfg.webDist, "index.html")));
    });
  }
  return app;
}
