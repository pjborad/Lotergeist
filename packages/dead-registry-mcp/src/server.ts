import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { z } from "zod";

/**
 * dead-registry-mcp: lets Kiro (or any MCP client) query live traces from the Body Snatcher Rx API.
 * Synthetic data only. Talks to the API at API_URL (default http://localhost:4000).
 */
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `API ${res.status}`);
  return body as T;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `${(e as Error).message}. Is the API running at ${API}?` }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildServer() {
  const server = new McpServer({ name: "dead-registry", version: "0.1.0" });

  server.registerTool("summon_recall", {
    description: "Summon an FDA recall by recall number (e.g. D-0417-2026) or by pasted notice text. Returns the recall id. With run=true it also runs the whole hunt (trace, RPA exhumation, quarantine, letters, hearse) when no lot needs a living witness. Synthetic data only.",
    inputSchema: { input: z.string().min(3), run: z.boolean().optional() }
  }, async ({ input, run }) => {
    try {
      const { id } = await api<{ id: string }>("/api/recalls", { method: "POST", body: JSON.stringify({ input }) });
      if (!run) return text({ id });
      await api(`/api/recalls/${id}/confirm`, { method: "POST", body: JSON.stringify({ auto: true }) });
      for (let i = 0; i < 120; i++) {
        const d = await api<{ status: string; error?: string }>(`/api/recalls/${id}`);
        if (d.status === "ready") return text({ id, status: "ready" });
        if (d.status === "error") throw new Error(d.error ?? "hunt failed");
        await sleep(1000);
      }
      return text({ id, status: "still running" });
    } catch (e) { return fail(e); }
  });

  server.registerTool("autopsy", {
    description: "Show the Coroner's extraction for a recall: NDCs, lots, expiry dates, confidence (0-1) and source (regex, llm, both), plus warnings.",
    inputSchema: { recallId: z.string() }
  }, async ({ recallId }) => {
    try {
      const d = await api(`/api/recalls/${encodeURIComponent(recallId)}`);
      return text({ recall: d.recallNumber, product: d.product, needsReview: d.needsReview, ndcs: d.ndcs, lots: d.lots.map((l: any) => ({ lot: l.value, expiry: l.expiry, confidence: l.confidence, source: l.source, needsLivingWitness: l.needsWitness })), warnings: d.warnings });
    } catch (e) { return fail(e); }
  });

  server.registerTool("trace_lot", {
    description: "Chain of custody for an NDC + lot through the synthetic EPCIS crypt: serial counts per stage, which pharmacies received it, and one sample package's custody.",
    inputSchema: { ndc: z.string().describe("10- or 11-digit NDC, e.g. 70004-417-05"), lot: z.string() }
  }, async ({ ndc, lot }) => {
    try {
      const t = await api(`/api/trace-lot?ndc=${encodeURIComponent(ndc)}&lot=${encodeURIComponent(lot)}`);
      return text({ ndc: t.ndc, lot: t.lot, serials: t.totalSerials, orphans: t.orphans, lots: t.lots, pharmacies: t.pharmacies.map((p: any) => ({ name: p.name, received: p.received, onShelf: p.onShelf, dispensed: p.dispensed })), sample: t.sample, ms: t.ms });
    } catch (e) { return fail(e); }
  });

  server.registerTool("who_holds", {
    description: "For a recall whose hunt has run: which synthetic patients received the recalled lot (from the RPA exhumation) and which pharmacy shelves still hold stock, by quarantine bin.",
    inputSchema: { recallId: z.string() }
  }, async ({ recallId }) => {
    try {
      const id = encodeURIComponent(recallId);
      const [t, a] = await Promise.all([api(`/api/recalls/${id}/trace`), api(`/api/afterlife?recalls=${id}`)]);
      if (!t.exhumed) return text("The hunt has not run for this recall yet. Call summon_recall with run=true, or confirm it in the app.");
      return text({
        patients: t.dispenses.map((d: any) => ({ patient: d.patientId, rx: d.rx, lot: d.lot, serial: d.serial, filled: d.fillDate, via: d.source, pharmacy: d.pharmacy })),
        shelves: a.bins.map((b: any) => ({ bin: b.id, pharmacy: b.pharmacyName, packages: b.count })),
        quarantineTotal: a.total
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool("plan_hearse", {
    description: "Plan the pickup route (depot, every pharmacy with quarantined stock, depot) with NWS weather and cold-chain warnings. avoidHeat=true goes around heat advisories.",
    inputSchema: { recallId: z.string(), avoidHeat: z.boolean().optional() }
  }, async ({ recallId, avoidHeat }) => {
    try {
      const h = await api(`/api/hearse?recalls=${encodeURIComponent(recallId)}&avoid=${avoidHeat === false ? 0 : 1}`);
      return text({ summary: h.summary, avoided: h.avoided, departs: h.departs, stops: h.stops.map((s: any) => ({ stop: s.id, name: s.name, load: s.load, eta: s.eta, temp: s.held, tempC: s.tempC })), warnings: h.warnings, weatherSource: h.weatherSource });
    } catch (e) { return fail(e); }
  });

  return server;
}

const arg = process.argv.indexOf("--http");
if (arg !== -1) {
  // Streamable HTTP, stateless: a fresh server + transport per request
  const port = Number(process.argv[arg + 1] ?? process.env.MCP_PORT ?? 4200);
  http.createServer(async (req, res) => {
    if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }).listen(port, () => console.error(`dead-registry-mcp (HTTP) on http://localhost:${port}/mcp -> ${API}`));
} else {
  await buildServer().connect(new StdioServerTransport());
  console.error(`dead-registry-mcp (stdio) -> ${API}`);
}
