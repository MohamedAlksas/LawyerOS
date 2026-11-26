# LawOffice OS — T12 Submission & Swarm Verification Report

- **Task:** T12 — Document versions, paper originals, and existing-record links
- **Branch:** `feature/t12-document-versions`
- **Base (`origin/main`):** `69cde771d3679dd547cfae13cb4dba6c13ca048e`
- **Wave 4A Audited Implementation Checkpoint:** `d5a52f85872a0c5d3626be78c70d62059ca7dcf3`
- **Final Verified Implementation SHA (post-Wave 4B Swarm remediation):** `8e9def79ac0151d481327448df53b986294c946b` *(this `docs/reviews/T12-submission.md` file is added in the subsequent report-only attestation commit on `feature/t12-document-versions`)*
- **Project Owner Directives Applied:**
  - ADR 0003 (`docs/adr/0003-initial-malware-scan-deferral.md`): initial malware scanning (`ClamAV`) remains deferred (`NOT_SCANNED_POLICY`, `ADR-0003-INITIAL-NO-MALWARE-SCAN`, `1.0.0`, `"لم يُفحص ضد الفيروسات"`); `CLEAN` is never fabricated and `REQUIRED` policy fails closed (`503`).
  - Scope exclusions preserved: no T13 financial ledger entries, no OCR/PDF-body indexing, no AI features, no object-storage migration, and no T19 full backup/restore orchestration (only `BackupFilePin` pin/release checks and storage reconciliation cleanup).
  - Owner waived Codex review and authorized full Swarm + Ponytail implementation and read-only Agency subagent forensic audits; branch stays unmerged for PR CI & owner review.

## 1. Skills Loaded

- `D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` — task card delivery workflow and evidence reporting discipline.
- `D:/Lawyer/.agents/skills/lawoffice-security-operations/SKILL.md` — private document storage containment, version upload/promotion safety, `READ_DOCUMENTS`/`MANAGE_OPERATIONS` authorization checks, `BackupFilePin`/`RESTORE_MODE` cleanup guards.
- `D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` — Matter/Proceeding/Party/HearingResult/Deadline domain invariants and manual review preservation for `DRAFT` deadlines and `UNREVIEWED` POAs.
- `D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` — Arabic RTL (`ar-EG`), Cairo timezone handling, keyboard navigation, responsive reflow (`390`/`768`/`1440px` + `200%` text scaling), and accessible link/form semantics.
- `D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` — unit, PostgreSQL migration/integration (`T12-MIGRATION` + `T12-TC-01`..`T12-TC-06`), and Playwright browser verification (`T12-TC-07`).
- `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail/SKILL.md` — minimal root-cause diffs, helper reuse, caller checks, and concise reporting.

## 2. Implemented Scope Summary

- **Schema & Migration (`prisma/schema.prisma`, `prisma/migrations/20261126000000_t12_document_versions_and_links/migration.sql`):**
  - Added `PowerOfAttorney.documentId`, `HearingResult.decisionDocumentId`, `Deadline` -> `sourceDocument` FK/index, `UploadAttempt.expectedDocumentVersion` + positive `CHECK`, and `BackupFilePin` `[documentVersionId, releasedAt]` index.
- **Document Versions, Paper Originals, Pinning & Storage Cleanup (`src/modules/documents/*`, `src/app/api/documents/[id]/*`):**
  - Implemented `beginVersionUpload` (`POST /api/documents/[id]/versions`), version branch in `finalizeUpload` (promoting `versionNumber + 1` in `ready/`, incrementing `documentVersion`, keeping immutable historical `DocumentVersion` rows), `updateDocumentMetadata` (`PATCH /api/documents/[id]` independently updating paper original presence/location/metadata without mutating scan status), historical `authorizeDownload(actor, documentId, versionId)` (`?versionId=` fail-closed across documents and missing `READ_DOCUMENTS`), `assertLinkableDocument`, `pinDocumentVersionsForBackup`, `releaseBackupFilePins`, and `reconcileAndCleanupDocumentStorage` (with disk-first enumeration, `STALE_VALIDATING_MIN_WINDOW_MS` mtime grace guard, and fresh DB re-check before unlinking unreferenced non-`.part-` files).
- **Existing-Record Links & S12 Metadata-Only Search (`src/modules/parties/*`, `src/modules/scheduling/*`, `src/modules/matters/matter-service.ts`):**
  - Enforced `assertLinkableDocument` and `READ_DOCUMENTS` parity on `PowerOfAttorney.documentId`, `HearingResult.decisionDocumentId`, and `Deadline.sourceDocumentId` (rejecting wrong scope, non-`READY`, archived parents/documents, and cross-proceeding `hearingId`-only mismatches; preserving `UNREVIEWED` POA and `DRAFT` deadline manual review).
  - Extended `unifiedSearch` (`S12`) with `DOCUMENT` category/counts querying metadata fields only (`title`, `originalFilename`, normalized title) and gating `scanStatus IN ('NOT_SCANNED_POLICY', 'CLEAN')` without indexing PDF bodies or exposing storage keys.
- **Arabic RTL Screens & Accessibility (`src/app/(app)/**`, `src/components/**`):**
  - Updated `/documents/[id]` (`DocumentDetailView`) with version history, inline preview (`?versionId=`), add-version upload/retry (preserving duplicate confirmation & idempotency key on `INCOMPLETE` retry and allowing `REJECTED` reset), independent paper-original editor (with stale-closure guard on concurrent upload completion), and `AuthorizationError` (`READ_DOCUMENTS`) handling.
  - Updated `UnifiedSearchClient`, `PoaSection`, `HearingResultClient`, `Hearings` detail page, and `DeadlinesView` (including recoverable `/api/documents` error/retry state) and added `test:e2e:t12` to `package.json`.

## 3. Swarm Execution & Agency Agent Evidence

| Phase | Role / Agent Profile | ID / Roster Name | Resolved Profile & SHA-256 | Ownership & Outcome |
|---|---|---|---|---|
| Wave 1–3 Build & Initial Checks | Swarm Workers (`t12-schema`, `t12-docs-core`, `t12-links-search`, `t12-ui-docs`, `t12-ui-links`, `t12-tests`) | Swarm board `#60`–`#72` | Project-governed Swarm workers | Built schema migration, backend services/routes, Arabic RTL UI, and initial T12 unit/integration/E2E tests at checkpoint `d5a52f8`. |
| Wave 4A Audit (Security) | `agency-application-security-engineer` | `586785e3-a826-4e2d-b93d-a5f82d2f36e8` | `d:\Lawyer\.agents\skills\security-appsec-engineer\SKILL.md` (`77C29A754E6C25B97F189C06D8459B02FD29F4D8DE8602CA53740F4C92A1F259`) | Read-only audit of `d5a52f8`: 0 P1, 1 P2 (`unifiedSearch` `scanStatus` gate), 2 P3 (`READ_DOCUMENTS` parity, `proceeding.archivedAt` & cross-proceeding `hearingId` checks). |
| Wave 4A Audit (Backend Lead) | `agency-backend-architect` | `34586092-a57f-4fc0-b911-13f7ab78457e` | `d:\Lawyer\.agents\skills\engineering-backend-architect\SKILL.md` (`05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF`) | Read-only audit of `d5a52f8`: 1 P1 (`reconcileAndCleanupDocumentStorage` DB-before-disk TOCTOU race), 1 P2 (`unifiedSearch` `scanStatus`), 2 P3 (`proceeding.archivedAt`, `party.archivedAt`), 2 Polish (helper dedup, unused `actor`). |
| Wave 4A Audit (Frontend) | `agency-frontend-developer` | `293c96d1-f8a6-4085-83e0-ddafded7a666` | `d:\Lawyer\.agents\skills\engineering-frontend-developer\SKILL.md` (`69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0`) | Read-only audit of `d5a52f8`: 0 P1, 3 P2 (duplicate-confirm retry, `applyLatestDetail` stale closure, `DeadlinesView` permanent `[]` cache on error), 4 P3, 6 Polish. |
| Wave 4A Audit (Tests & CI) | `agency-test-automation-engineer` | `ab26c71d-9565-4d99-8e52-7a942224f163` | `d:\Lawyer\.agents\skills\testing-test-automation-engineer\SKILL.md` (`AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4`) | Read-only audit of `d5a52f8`: 0 P1, 4 P2 (`Tab` keyboard nav, `T12-MIGRATION`, `package.json` `test:e2e:t12`, `T12-TC-04` archived/update link checks), 4 P3, 2 Polish. |
| Wave 4B Remediation (Backend) | Swarm `t12-fix-backend` | `acc47c65-3eef-4dbd-be80-99c9e6fa4791` (`#76`) | Project-governed Swarm worker | Resolved all security & backend P1/P2/P3/Polish findings in `src/modules/{documents,matters,parties,scheduling}/**`; passed `typecheck` & scoped `eslint`. |
| Wave 4B Remediation (Frontend) | Swarm `t12-fix-frontend` | `9740e531-5198-440e-a62d-1b223c9d413f` (`#75`) | Project-governed Swarm worker | Resolved all UI/accessibility P2/P3/Polish findings in `src/app/(app)/**` & `src/components/**`; passed `typecheck` & scoped `eslint`. |
| Wave 4B Remediation (Tests) | Swarm `t12-fix-tests` | `cca36d23-63cb-4916-8f1c-6233d057fa93` (`#78`) | Project-governed Swarm worker | Resolved all test/migration/E2E findings in `tests/**` (and coordinator added `test:e2e:t12` to `package.json`); landed cleanly in `8e9def7`. |

## 4. Planned Acceptance Cases (`T12-MIGRATION` & `T12-TC-01`..`T12-TC-07`)

| Case | Level | Coverage & Outcome |
|---|---|---|
| `T12-MIGRATION` | PG + Prisma | **PASS** — `tests/integration/migration-upgrade.test.ts` (`27/27`) & `tests/integration/t12-document-versions.test.ts` deploy `20261126000000_t12_document_versions_and_links` onto populated pre-T12 state and verify `upload_attempt_expected_document_version_check` and all 3 new FKs (`ON DELETE SET NULL`). |
| `T12-TC-01` | PG + file + browser | **PASS** — Adding v2 keeps immutable v1 row; S10 version history allows inline preview (`versionId` in iframe `src`) and authorized SHA-256-matching download of historical v1 (`t12-document-versions.test.ts` & `t12-document-versions.spec.ts`). |
| `T12-TC-02` | PG + file | **PASS** — Failing new version upload (`REQUIRED` scan policy unavailability, archived proceeding, or injected DB commit failure) leaves prior `currentVersionId` untouched with zero orphan `ready/` file. |
| `T12-TC-03` | PG + browser | **PASS** — Toggling `originalPresent` (`YES` + `originalLocation` -> `NO`) via `PATCH /api/documents/[id]` updates physical custody independently without clearing or altering `scanStatus`. |
| `T12-TC-04` | PG + API + browser | **PASS** — `PowerOfAttorney.documentId`, `HearingResult.decisionDocumentId` (initial + `correctHearingResult`), and `Deadline.sourceDocumentId` (create/edit/confirm) reject wrong-scope, non-`READY`, archived, cross-proceeding, and unauthorized links; UI pickers exclude ineligible docs and keep POA `UNREVIEWED` / Deadline `DRAFT`. |
| `T12-TC-05` | PG + API + browser | **PASS** — `unifiedSearch` (`S12`) filters `DOCUMENT` by metadata (`title`/`originalFilename`) only, excludes `PENDING`/`FAILED` scans and archived docs unless requested, returns zero storage keys, denies `MAINTAINER` (`وصول مرفوض`), and `?versionId=` fails closed across documents (`404`) and unauthorized actors. |
| `T12-TC-06` | Unit + PG + file | **PASS** — `reconcileAndCleanupDocumentStorage` respects `STALE_VALIDATING_MIN_WINDOW_MS` grace survival for active/recent files, deletes backdated orphans, protects `BackupFilePin` rows until `releaseBackupFilePins`, and enforces `MANAGE_OPERATIONS` authorization. |
| `T12-TC-07` | Browser (`390`/`768`/`1440px`) | **PASS** — Real keyboard `Tab`/`Enter` navigation (`tabToTestId`, `expectVisibleFocus`, `expectTouchTarget`, `expectNotCovered`), `200%` text scaling reflow & screenshots, `INCOMPLETE` retry & `REJECTED` disguised `.jpg` recovery keeping prior version usable, `DeadlinesView` doc-load error/retry, and full `afterAll` cleanup (`storage/t12-e2e` removed). |

## 5. Verification Results on Final Implementation SHA `8e9def79ac0151d481327448df53b986294c946b`

- `npm.cmd run lint`: exit `0`
- `npm.cmd run typecheck`: exit `0`
- `npm.cmd test`: exit `0` — `22/22` files, `356` unit tests passed (`tests/unit/document-validation.test.ts`: `16/16`)
- `npx.cmd vitest run --no-file-parallelism tests/integration/t12-document-versions.test.ts tests/integration/t11-documents.test.ts tests/integration/t09-deadlines-tasks-agenda.test.ts tests/integration/hearing-transactions.test.ts tests/integration/party-communication-poa.test.ts tests/integration/matter-search-archiving.test.ts tests/integration/migration-upgrade.test.ts tests/integration/http-origin-matrix.test.ts tests/integration/audit-fixes-regressions.test.ts tests/integration/db-readiness.test.ts`: exit `0` — `10/10` files, `119` integration tests passed
- `NODE_ENV=production` `npm.cmd run build`: exit `0` (`Compiled successfully`, `28/28` static pages)
- `npx.cmd playwright test --list`: exit `0` (`28` tests in `2` files; `t04`–`t12` configs remain isolated from base config)
- Playwright E2E runs (`1 worker`, `retries: 0`):
  - `npx.cmd playwright test --config=playwright.t12.config.ts`: exit `0` — `6/6` passed (`test-results/t12/t12-document-detail-{390,768,1440}.png` and `t12-document-detail-zoom200-{390,768,1440}.png` generated; `storage/t12-e2e` cleaned)
  - `npx.cmd playwright test --config=playwright.t11.config.ts`: exit `0` — `6/6` passed
  - `npx.cmd playwright test --config=playwright.t05.config.ts`: exit `0` — `14/14` passed
  - `npx.cmd playwright test --config=playwright.t07.config.ts`: exit `0` — `16/16` passed
  - `npx.cmd playwright test --config=playwright.t08.config.ts`: exit `0` — `10/10` passed
  - `npx.cmd playwright test --config=playwright.t09.config.ts`: exit `0` — `9/9` passed
- `git diff --check`: exit `0`; `git status --short`: clean tree (`storage/` empty)

## 6. Remaining Limits (`NOT RUN`)

- **Malware scanner execution (`NOT RUN` — deferred under ADR 0003):** Live ClamAV / `freshclam` scanning remains unimplemented and unexecuted in V1 until explicitly enabled.
- **Unrelated local suites not executed post-Wave 4B:** Other integration files outside the 10-file regression/T12 set (such as T10 reminders/T04/T06-specific files) and Playwright configs `t03`, `t04`, `t06`, `t10` were not run locally in this cycle and run under GitHub Actions CI on the PR.
- **T19 full backup/restore orchestration (`NOT RUN`):** Only T12 `BackupFilePin` pin/release enforcement and storage reconciliation cleanup were implemented and verified; full T19 backup/restore pipeline execution belongs to T19.
