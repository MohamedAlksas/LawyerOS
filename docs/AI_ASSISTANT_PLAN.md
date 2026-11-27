# LawOffice OS — Post-V1 AI Legal Assistant Implementation Plan

- **Status:** Approved architecture blueprint (`Post-V1 / V2` — **deferred until `T13`–`T21` completion**)
- **Governing ADR:** [ADR 0005](file:///D:/Lawyer/docs/adr/0005-post-v1-ai-legal-assistant.md)
- **Target Audience:** Future Codex planning & Antigravity implementation slices after V1 sign-off

---

## 1. Objectives & Core Invariants

The AI Legal Assistant helps an Egyptian solo/small-firm lawyer answer general Egyptian legal questions, query and summarize live office case records, and summarize single uploaded `READY` documents without compromising client confidentiality, financial immutability, or manual legal-deadline review.

Non-negotiable invariants inherited from `PRODUCT.md`, `SECURITY_OPERATIONS.md`, and ADR 0005:

1. **Zero autonomous writes:** The assistant never mutates `Matter`, `Proceeding`, `Hearing`, `Deadline`, `Task`, `PowerOfAttorney`, `Document`, or financial ledger tables. Suggestions only open standard LawOffice OS creation forms pre-filled for manual lawyer confirmation.
2. **Authorized `OWNER` access only:** All endpoints and pages require `requireActor({ requiredPermission: ... })` with `OWNER` role. `MAINTAINER` is strictly denied (`403`) with hidden navigation links.
3. **Paid Tier + spend cap fail-closed:** `AI_ASSISTANT_ENABLED=false` by default; real-data use requires `AI_BILLING_TIER=paid`, valid `GEMINI_API_KEY`, and monthly spend below the configured cap (default `\$9.00/month`, warning at `80%`, hard stop at `100%`).
4. **Zero transcript/PII persistence:** Chat messages remain ephemeral in client memory only (never PostgreSQL, `localStorage`, or `sessionStorage`). National IDs/passports, phones, emails, addresses, and storage keys are stripped before API calls; party names are tokenized (`[الموكل 1]`, `[الخصم 1]`) and rehydrated locally.

---

## 2. Planned Schema Addition (Additive Migration Only)

Add a single lightweight counter model in `prisma/schema.prisma` (no chat transcript or prompt-text columns):

```prisma
model AiMonthlyUsage {
  id               String   @id @default(cuid())
  yearMonth        String   @unique // Format: "YYYY-MM" in Africa/Cairo
  requestCount     Int      @default(0)
  inputTokens      Int      @default(0)
  outputTokens     Int      @default(0)
  estimatedCostUsd Decimal  @db.Decimal(10, 6) @default(0)
  updatedAt        DateTime @updatedAt
}
```

- Enforce non-negative `CHECK` constraints in migration SQL.
- Atomic increment via `INSERT ... ON CONFLICT ("yearMonth") DO UPDATE` inside budget accounting.
- Audit actions (`AI_ASSISTANT_QUERY`, `AI_ASSISTANT_DOCUMENT_SUMMARY`, `AI_ASSISTANT_REJECTED`) recorded in `AuditEvent` with metadata only (`modelTier`, `matterId`, `documentId`, `inputTokens`, `outputTokens`, `estimatedCostUsd` — zero user prompt or reply content).

---

## 3. Environment & Security Configuration (`src/lib/env.ts`)

Add validated environment variables (optional unless `AI_ASSISTANT_ENABLED=true`):

- `AI_ASSISTANT_ENABLED` (`'true' | 'false'`, default `'false'`)
- `AI_BILLING_TIER` (`'paid' | 'free-synthetic-only'`, default `'paid'` required whenever `NODE_ENV=production` and `AI_ASSISTANT_ENABLED=true`)
- `GEMINI_API_KEY` (server-only secret; added to `sanitizeAuditRecord` redaction patterns)
- `AI_MONTHLY_BUDGET_USD` (positive decimal string, default `'9.00'`)
- `AI_FLASH_MODEL` (pinned default Flash model ID)
- `AI_PRO_MODEL` (pinned Pro model ID for opt-in `"تحليل قانوني معمّق"`)

---

## 4. Module Architecture (`src/modules/assistant/`)

| File | Responsibility |
|---|---|
| `assistant-types.ts` | Zod schemas for `/api/assistant/chat` and `/api/assistant/summarize-document`, model tier enum (`'flash' \| 'pro'`), citation DTOs, and pre-filled form suggestion DTOs (`task`, `deadline_draft`, `communication_note`). |
| `pii-redactor.ts` | Strips encrypted/raw national IDs, passports, phones, emails, addresses, and storage keys (`quarantineKey`, `readyKey`); builds per-request reversible placeholder map (`[الموكل 1]` -> real name) so names never leave the server unmasked in structured queries and are rehydrated before returning to the `OWNER` UI. |
| `office-tools.ts` | Read-only function-calling tools wrapping existing domain services (`matter-service`, `hearing-service`, `deadline-service`, `productivity-service`, `document-service`, and post-T15 read-only finance summaries) under `actor`, piping all returned DTOs through `pii-redactor.ts`. |
| `budget-guard.ts` | Reads/updates `AiMonthlyUsage` (`Africa/Cairo` `YYYY-MM`), triggers `80%` soft-warning metadata, blocks requests at `>= 100%` (`\$9.00`), and applies per-actor rate limiting. |
| `gemini-client.ts` | Official `@google/genai` SDK wrapper supporting tool-calling loop (bounded max steps/tokens), `flash`/`pro` model routing, single `READY` document buffer transmission (strictly rejecting `ID_COPY` and `sizeBytes > MAX_DOCUMENT_BYTES`), strict timeouts, and sanitized error mapping. |
| `assistant-service.ts` | Orchestrates `requireActor('OWNER')` -> gate/budget check -> tool-assisted query or confirmed single-document summary -> local placeholder rehydration -> descriptive `AuditEvent` -> response with separated `officeFacts` (with entity links) and `legalGuidance` (with mandatory lawyer verification banner). |

---

## 5. API Routes (`src/app/api/assistant/`)

1. **`POST /api/assistant/chat`**
   - Cookie/Origin/CSRF-guarded (`verifyActionSecurity` / trusted-origin checks, `Cache-Control: private, no-store`).
   - Accepts ephemeral conversation turns from client memory + optional `matterId` context + `modelTier: 'flash' | 'pro'`.
   - Returns structured Arabic response: answer markdown, separated office-record citations (`/matters/[id]`, `/hearings/[id]`, `/deadlines`, `/documents/[id]`), optional pre-filled suggestion descriptors, and current monthly budget status (`usedUsd`, `capUsd`, `nearLimit`).
2. **`POST /api/assistant/summarize-document`**
   - Requires explicit `{ documentId, versionId?, confirmedExternalTransfer: true, modelTier }` in request body.
   - Re-verifies `OWNER`, `scanStatus === 'READY'` (or `NOT_SCANNED_POLICY` ready state per ADR 0003), `documentType !== 'ID_COPY'`, and reads bytes safely via `LocalDocumentStorage.readReadyBytes` (respecting `O_NOFOLLOW` / size bounds).
   - Never caches or stores extracted document summary back into `Document` unless the lawyer manually edits metadata.

---

## 6. Arabic RTL UI & Pre-Filled Form Integration (`src/app/(app)/assistant/`, `src/components/assistant/`)

1. **Dedicated `/assistant` Page:**
   - Arabic RTL layout (`dir="rtl"`, `lang="ar-EG"`), mobile-first (`390`/`768`/`1440px`, `>= 44px` touch targets, `text-base sm:text-xs` inputs, WCAG AA contrast).
   - Persistent top disclaimer banner: clarifies that general legal guidance requires manual verification of official texts/Court of Cassation rulings, and shows monthly credit meter (`\$9.00` cap, `80%` warning).
   - Mode toggle: **`سريع (Gemini Flash)`** (default) vs **`تحليل قانوني معمّق (Gemini Pro)`**.
   - Visual split in assistant replies:
     - **بيانات من سجلات المكتب** (verified facts + clickable internal links)
     - **إرشاد قانوني عام** (advisory text + verification warning)
   - Suggestion action cards that navigate to existing creation screens (`/tasks?prefill=...`, `/deadlines?prefill=...`, `/parties/[id]?prefillNote=...`) for manual review and submission.
2. **Contextual Entry Points:**
   - **`/matters/[id]`:** Button **"اسأل / لخّص هذه القضية"** opening `/assistant?matterId=[id]` (or side drawer).
   - **`/documents/[id]`:** Button **"لخّص هذا المستند"** (hidden/disabled for `ID_COPY` or non-ready files), opening an explicit Arabic confirmation modal before calling `/api/assistant/summarize-document`.

---

## 7. Verification & Acceptance Plan (When Scheduled Post-V1)

- **Unit tests (`tests/unit/`):** PII redaction & placeholder round-trip (`[الموكل 1]`/`[الخصم 1]`), `AI_ASSISTANT_ENABLED` / `AI_BILLING_TIER=paid` gate validation, budget math & `80%`/`100%` thresholds, `ID_COPY` rejection, pre-filled suggestion sanitizer.
- **PostgreSQL integration tests (`tests/integration/`):** Additive `AiMonthlyUsage` migration & `CHECK` constraints, `OWNER`-only / `MAINTAINER`-denied authorization, concurrent budget increment cap enforcement, descriptive-only `AuditEvent` payload assertion (confirming zero prompt/response/national-ID leakage), and `LocalDocumentStorage` containment with mocked Gemini SDK responses.
- **Playwright E2E (`tests/e2e/`, mocked HTTP/SDK boundary — zero live paid calls in CI):** `/assistant` Arabic RTL & `390`/`768`/`1440px` + `200%` zoom, `Flash`/`Pro` toggle, contextual matter link, `ID_COPY` block + confirmation modal on `READY` PDF, pre-filled task/deadline form navigation (verifying zero DB write before manual submit), and client storage privacy audit (confirming empty `localStorage`/`sessionStorage` after chat).
