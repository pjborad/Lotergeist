# Costume UI, scan and safety

## Requirements (EARS)
- **SCN-1** WHEN a GS1 DataMatrix is in camera view, THE system SHALL decode GTIN (01), serial (21), lot (10) and expiry (17) within 1.5 seconds.
- **SCN-2** IF the lot matches an active recall, THEN THE system SHALL show CURSED with the patient trail; otherwise CLEAN.
- **SCN-3** IF no camera is available, THEN THE system SHALL accept a typed or pasted barcode string.
- **UX-1** THE app SHALL offer a judge demo mode reachable from the landing page with no login.
- **UX-2** WHERE the user prefers reduced motion, THE UI SHALL disable animations and the audio SHALL stay off.
- **UX-3** THE UI SHALL meet WCAG 2.2 AA contrast for all text.
- **SAFE-1** THE app SHALL show a persistent "Synthetic data, not for clinical use" banner.
- **SAFE-2** THE repository SHALL fail its pre-commit hook if a file matches PHI patterns (SSN, real DOB plus name pairs).

## Notes
Full WCAG validation needs manual testing with assistive technologies; UX-3 uses the design's palette but no automated contrast audit or screen-reader pass has been run yet.
The four screens come from the uploaded design (I Death Notice, II Body Trail, III Scan, IV Hearse). The spec's separate Morgue screen lives inside IV as "The afterlife".
