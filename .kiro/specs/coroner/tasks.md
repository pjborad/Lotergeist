# Coroner tasks
- [x] COR-1: NDC regex with segment validation
- [x] COR-1/COR-2: lot and date regex pass
- [x] COR-2/COR-3 PBT: noisy text with injected lots; lying LLM
- [x] COR-5: zod schema, one retry, regex-only fallback
- [x] Bedrock and Anthropic clients behind `LlmClient`
- [x] Reconcile with verbatim check and confidence rules
- [x] COR-4: `needsReview` and per-tag confirm in the UI
- [x] Regression tests from the 50 real fixtures (Mon-YY dates, plural "Lots:", semicolon lists)
- [ ] Measure the LLM pass against the regex pass on the 50 fixtures (needs Bedrock or Anthropic credentials)
