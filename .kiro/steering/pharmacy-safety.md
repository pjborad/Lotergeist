# Pharmacy safety rules

These rules beat any feature request.

1. Synthetic data only. Patient IDs look like `S-0417` (Synthea style). Never add real names, SSNs, dates of birth or real pharmacy details. The `phi-guard` hook and `scripts/phi-guard.sh` block commits that look like PHI.
2. Nothing is ever sent. There is no SMS, email or phone code in this repo. "Approve" only marks a letter `approved` (ready, not sent). Do not add a send path.
3. A pharmacist confirms every tag before the hunt starts. Night Watch may only auto-confirm when no field is below 0.80 confidence, and only when `NIGHT_WATCH_AUTORUN=1`.
4. Never invent a lot. The Coroner emits only lots found verbatim (case-insensitive, whitespace-normalized) in the source text (COR-3). An LLM answer that fails this check is dropped, not "fixed".
5. Confidence below 0.80 means "needs a living witness": explicit human confirmation per lot (COR-4).
6. Serial numbers are not printed on terminals or faxes. The bot infers them FIFO from the pharmacy's on-shelf stock and marks them `serialInferred`. Never present an inferred serial as read from the source.
7. The bot may only touch allowlisted hosts: the RxTerm 98 mock and the local fax store (RPA-5).
8. Persistent banner on every page: "Synthetic data only · Not for clinical use · Not HIPAA-compliant · A pharmacist approves every message".
9. Patient letters read at grade 6 or lower and never contain another patient's ID (UND-2). Placeholders `[PHARMACY NAME]` and `[PHARMACY PHONE]` stay placeholders.
10. Do not claim clinical validity, regulatory compliance or HIPAA compliance anywhere.
