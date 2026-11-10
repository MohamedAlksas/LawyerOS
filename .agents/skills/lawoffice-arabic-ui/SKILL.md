---
name: lawoffice-arabic-ui
description: Implements and verifies LawOffice OS operational screens, PWA shell, and Arabic print layouts. Use when a task changes UI, forms, responsive behavior, or printable output.
---

# Arabic office UI

Use [DESIGN](../../../DESIGN.md) and assigned screen IDs in [SCREENS](../../../docs/SCREENS.md). This is a daily operational tool for one Egyptian lawyer. Prioritize today's work, readable forms, and clear outcomes; no marketing page or unsolicited visual redesign.

- Documentation stays English; application copy stays Arabic. Use `lang="ar-EG"`, `dir="rtl"`, and `bdi`/LTR isolation for phones, references, and mixed text. Preserve stored names and support Arabic/Latin input digits.
- Use the local Arabic font and shared tokens. Keep labels, errors, selection, and focus readable. Color alone cannot convey status. Do not expose database enums or implementation details in user flows.
- Build only the assigned journey. T04 is a shell/PWA foundation, not 15 fake business screens. Empty states must be authentic, without static totals presented as operational data.
- Distinguish loading, empty, saving, confirmed success, error, disconnection, expired session, and version conflict. Success follows server confirmation. An uncertain network outcome requires checking/retrying the original idempotency key, not a new financial/hearing submission.
- Keep unsent confidential input only in current page memory. No confidential localStorage, IndexedDB, service-worker, or public CDN caches. Installation does not imply offline synchronization.
- Unknown hearing time stays visibly unknown. Hearings, tasks, and legal deadlines remain distinct. Full reversal and actual partial refund have separate actions and consequences.
- Inspect rendered output at 390/768/1440 widths, long Arabic/mixed text, keyboard navigation, visible focus, error feedback, and 200% text zoom. Check narrow reflow where affected. Screenshots support actual interaction rather than replacing it.
- Inspect generated PDF Arabic text, page breaks, headings/totals, and agreement with source data; successful file generation alone is insufficient.

Mark unavailable browser/PDF checks `NOT RUN`, identifying missing evidence. Never claim accessibility or visual acceptance from source inspection. The lawyer's observed pilot is a separate acceptance step.
