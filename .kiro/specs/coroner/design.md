# Coroner design

1. **Regex pass** (`regex-pass.ts`). Finds lot keywords (`lot`, `lots`, `lot#`, `lot no.`, `lot code`, `batch`), then walks the text after each keyword token by token. Dates (`Month D, YYYY`, `MM/YYYY`, `Mon-YY`, `YYYY-MM-DD`, ...) are consumed and attached to every lot since the last date. Dose tokens (`5mL`, `500-Count`), bare years, NDCs and stop words (`NDC`, `UPC`, `Serial`) are skipped. A list may continue across `;` only if the next token has the same character shape as the previous lot.
2. **Confidence**: 0.88 for alphanumeric lots, 0.82 for bare digits, -0.02 for later list items, +0.07 when an expiry was found, capped at 0.95.
3. **LLM pass** (`llm.ts`). `LlmClient` with Bedrock Converse and Anthropic implementations; `createLlmFromEnv`. System prompt from `.kiro/steering/coroner-prompt.md`. Output validated with zod; one retry; then regex-only (COR-5).
4. **Reconcile** (`reconcile.ts`). Keep an LLM lot only if it appears verbatim in the source (COR-3). Agreement sets `source: both` and confidence to max(regex, llm, 0.9). Disagreeing expiry keeps regex and drops confidence to 0.79. LLM-only lots are capped at 0.85.
5. `needsReview` is true when any confidence is under 0.80, or no lot or NDC was found (COR-4).
6. Emits `recall.autopsied { recallId, needsReview }`.
