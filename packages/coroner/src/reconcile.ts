import { normalizeLot, parseNdc } from "@bsrx/gs1";
import { toIsoDate } from "./dates";
import type { LlmOutput } from "./llm";
import type { RegexResult } from "./regex-pass";
import { REVIEW_THRESHOLD, type Autopsy, type ExtractedLot, type ExtractedNdc } from "./types";

/** Whitespace-stripped, upper-cased text: the basis of the COR-3 verbatim check. */
export const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export function appearsVerbatim(source: string, value: string): boolean {
  const v = squash(value);
  return v.length > 0 && squash(source).includes(v);
}

function normaliseLlmExpiry(e: string | null | undefined): string | undefined {
  if (!e) return undefined;
  return toIsoDate(e) ?? undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reconcile(source: string, regex: RegexResult, llm: LlmOutput | null): Autopsy {
  const warnings: string[] = [];
  const lots = new Map<string, ExtractedLot>();

  for (const r of regex.lots) lots.set(normalizeLot(r.value), { ...r });

  if (llm) {
    for (const l of llm.lots) {
      // COR-3: never emit a lot that is not in the source text
      if (!appearsVerbatim(source, l.value)) {
        warnings.push(`Dropped LLM lot "${l.value}": not found in the source text.`);
        continue;
      }
      const key = normalizeLot(l.value);
      const llmExpiry = normaliseLlmExpiry(l.expiry);
      const hit = lots.get(key);
      if (hit) {
        hit.source = "both";
        hit.confidence = round2(Math.max(hit.confidence, l.confidence, 0.9));
        if (!hit.expiry && llmExpiry) hit.expiry = llmExpiry;
        else if (hit.expiry && llmExpiry && hit.expiry !== llmExpiry) {
          warnings.push(`Expiry for ${hit.value} differs between regex (${hit.expiry}) and LLM (${llmExpiry}); regex kept.`);
          hit.confidence = round2(Math.min(hit.confidence, 0.79));
        }
      } else {
        lots.set(key, { value: l.value.trim(), expiry: llmExpiry, confidence: round2(Math.min(l.confidence, 0.85)), source: "llm" });
      }
    }
  }

  const ndcs = new Map<string, ExtractedNdc>();
  for (const n of regex.ndcs) ndcs.set(n.value, { ...n });
  if (llm) {
    for (const raw of llm.ndcs) {
      const v = raw.trim();
      if (!parseNdc(v) || !appearsVerbatim(source, v)) continue;
      const hit = ndcs.get(v);
      if (hit) { hit.source = "both"; hit.confidence = round2(Math.max(hit.confidence, 0.9)); }
      else ndcs.set(v, { value: v, confidence: 0.8, source: "llm" });
    }
  }

  const lotList = [...lots.values()];
  const ndcList = [...ndcs.values()];
  if (lotList.some((l) => !l.expiry)) warnings.push("No expiry is printed for at least one lot. Confirm before tracing.");
  if (lotList.length === 0) warnings.push("No lot numbers found in the notice.");
  if (ndcList.length === 0) warnings.push("No NDC found in the notice.");

  const needsReview =
    lotList.length === 0 || ndcList.length === 0 ||
    lotList.some((l) => l.confidence < REVIEW_THRESHOLD) ||
    ndcList.some((n) => n.confidence < REVIEW_THRESHOLD);

  return {
    ndcs: ndcList,
    lots: lotList,
    notes: llm?.notes ?? "",
    warnings,
    needsReview,
    passes: { regex: true, llm: llm !== null, reconciled: true }
  };
}
