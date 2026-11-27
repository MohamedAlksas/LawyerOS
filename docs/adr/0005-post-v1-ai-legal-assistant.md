---
status: accepted-owner-decision
date: 2026-11-27
---

# ADR 0005 — Post-V1 Arabic AI Legal Assistant (Gemini API Paid Tier)

## Decision and scope

The project owner approved designing an Arabic RTL AI Legal Assistant for **Post-V1 (`V2`)** delivery, deferred until the remaining V1 operational, financial, printing, and backup tasks (`T13`–`T21`) are complete. This ADR records the settled architecture, privacy, billing, and authorization contract so future implementation follows a reviewed specification without modifying V1 scope or altering `AGENTS.md` V1 exclusions.

No application code, dependencies, schema changes, or runtime integration are authorized under this planning decision.

## Provider, billing, and privacy gate

1. **Official Gemini API (`Paid Tier`) only:** The assistant uses the official Gemini Developer API on Google's **Paid Tier** (which excludes API prompts and responses from Google model training), intended to be funded via the owner's official **Google AI Pro** \$10/month Google Cloud / AI Studio developer credits. Unofficial consumer web scraping, session cookie reuse, or browser automation against consumer Gemini apps is explicitly prohibited.
2. **Fail-closed activation gate:**
   - Default configuration: `AI_ASSISTANT_ENABLED=false`.
   - Real office data requires explicit `AI_BILLING_TIER=paid` confirmation alongside a valid server-side API key (`GEMINI_API_KEY` redacted from logs/audit records). Free-tier API usage is permitted only in synthetic development/test fixtures and must fail closed if real client data is targeted without `AI_BILLING_TIER=paid`.
3. **Monthly spend guard (`\$9.00` cap):** Enforce an application-level default monthly budget of **\$9.00/month** inside the \$10/month developer credit, emitting an early warning at `80%` (`\$7.20`) and failing closed (`429` / `503` Arabic notice) at `100%` (`\$9.00`), paired with per-user rate limiting.

## Data scope, PII redaction, and document summarization

1. **Structured office records (read-only):** Authorized queries may read structured records through dedicated read-only service adapters calling existing domain permissions (`requireActor`): matters, proceedings, hearings and hearing results, deadlines, tasks, communication notes, document metadata, and (once `T13`–`T15` land) read-only client/matter financial summaries.
2. **Single-document summarization on demand only:** The assistant may summarize **one** `READY` PDF or image at a time only upon explicit lawyer action (`"لخّص هذا المستند"`). Bulk OCR, background archive-wide indexing, and `pgvector` embeddings over all stored documents remain excluded.
3. **Strict PII redaction & placeholder tokenization:**
   - Encrypted national IDs/passports, phone numbers, email addresses, street addresses, and internal storage keys (`quarantineKey`, `readyKey`, `storageKey`) must **never** be sent to the model.
   - Party names in structured record payloads are tokenized into neutral placeholders (`[الموكل 1]`, `[الخصم 1]`) before transmission and restored locally in server/UI rendering.
   - Single-document `READY` summarization requires an explicit per-request confirmation dialog notifying the lawyer that the document bytes will be sent to Gemini API (Paid Tier). Documents classified as `ID_COPY` are strictly blocked from AI transmission.

## Authorization, human-in-the-loop, and retention

1. **`OWNER` only (`MAINTAINER` denied):** Every assistant route, action, and UI entry point enforces `requireActor` restricted to `OWNER`. `MAINTAINER` accounts receive fail-closed denial and no UI links.
2. **Zero direct database writes:** The assistant cannot create, update, archive, or delete domain or financial records. Instead, it may output structured suggestion cards that open standard LawOffice OS forms pre-filled via URL/client state for manual lawyer review and saving (preserving manual review for `DRAFT` deadlines, `UNREVIEWED` POAs, and immutable financial entries).
3. **Ephemeral chat & descriptive audit only:** Chat history lives only in browser memory for the active session (no PostgreSQL transcript persistence and no `localStorage`/`sessionStorage` usage). PostgreSQL persists only:
   - Descriptive `AuditEvent` entries (actor, timestamp, operation type, referenced `matterId`/`documentId`, selected model tier, token counts — **never** prompt text, model responses, or document contents).
   - A lightweight monthly usage/cost counter table for enforcing the `\$9.00/month` cap.
4. **Arabic RTL UX & grounding separation:** Provide `/assistant` in navigation, contextual triggers on `/matters/[id]` (`"اسأل / لخّص هذه القضية"`) and `/documents/[id]` (`"لخّص هذا المستند"`), default **`Gemini Flash`** with opt-in **"تحليل قانوني معمّق (`Gemini Pro`)"**, and clear visual separation between verified office facts (with clickable record links) and general Egyptian legal guidance (with mandatory lawyer verification notice).
