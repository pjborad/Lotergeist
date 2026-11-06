/// <reference path="./pdf-parse.d.ts" />
import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { ndcKeys } from "@bsrx/gs1";
import { parseFaxText, type FaxPage } from "./parse";

export interface FaxFile { file: string; text: string; page: FaxPage | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * pdf-parse 1.x (an old pdf.js) throws "bad XRef entry" on the very first parse in a fresh process,
 * then works. A retry makes the bot dependable. Found by running the API outside of vitest.
 */
async function parseWithRetry(data: Buffer, attempts = 3) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await pdfParse(Buffer.from(data)); } catch (e) { last = e; }
  }
  throw last;
}

/** RPA-3: read every fax PDF in the inbox with text extraction. */
export async function readFaxInbox(dir: string): Promise<FaxFile[]> {
  if (!fs.existsSync(dir)) return [];
  const out: FaxFile[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".pdf")).sort()) {
    const data = fs.readFileSync(path.join(dir, f));
    const parsed = await parseWithRetry(data);
    out.push({ file: f, text: parsed.text, page: parseFaxText(parsed.text) });
  }
  return out;
}

export function faxBelongsTo(page: FaxPage, pharmacyName: string): boolean {
  return norm(page.pharmacyName) === norm(pharmacyName.replace(" · ", " "));
}

export function faxMatchesNdc(page: FaxPage, ndcs: string[]): boolean {
  const want = new Set(ndcs.flatMap((n) => ndcKeys(n)));
  return ndcKeys(page.ndc).some((k) => want.has(k));
}
