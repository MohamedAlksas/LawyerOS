# LawOffice OS — T12 Submission & Swarm Verification Report

- **Task:** T12 — Document versions, paper originals, and existing-record links (+ full-codebase audit remediation)
- **Branch:** `feature/t12-document-versions`
- **Upstream:** `origin/feature/t12-document-versions`
- **Pull Request:** [PR #23 (Draft)](https://github.com/MohamedAlksas/LawyerOS/pull/23) -> `main` (unmerged; awaiting CI & owner merge)
- **Base (`origin/main`):** `69cde771d3679dd547cfae13cb4dba6c13ca048e`
- **Implementation Checkpoints:**
  - Wave 1–3 Initial Checkpoint: `d5a52f85872a0c5d3626be78c70d62059ca7dcf3`
  - Wave 4B Audit Remediation Checkpoint: `8e9def79ac0151d481327448df53b986294c946b`
  - Prior Attestation Checkpoints: `b251fcf9ff165ae7b5f29612049ce698ebbe948b` -> `f50583518c1496f4f756bd863f2b97b801ca5f3e` (after `f103faf1de67fd58dcc649078c899b51c74cc6b8`) -> `b795180cdd521bea80bf81be55849ba102c5764e` (after `4f244c49402805161b5f28bf59969ac2d278b877`) -> `b2cd74e2c86d27eb755386d73224f53f5859e9d2` (after `7919e82f20c53cd11945d5dd3f568b889f20362e`) -> `1628ab1c048ed5b51193536479be0b26a45ea9cd` (after `fe80a10c1668c4aaa4993f703927a50790fc8e95`)
  - **Final Verified Implementation SHA:** `3b11cd2d931bafbaa7634258b484cdeb59d2cc26` *(this `docs/reviews/T12-submission.md` update is committed in the subsequent report-only attestation commit on `feature/t12-document-versions`)*
- **Project Owner Directives Applied:**
  - ADR 0003 (`docs/adr/0003-initial-malware-scan-deferral.md`): initial malware scanning (`ClamAV`) remains deferred (`NOT_SCANNED_POLICY`, `ADR-0003-INITIAL-NO-MALWARE-SCAN`, `1.0.0`, `"لم يُفحص ضد الفيروسات"`); `CLEAN` is never fabricated and `REQUIRED` fails closed (`503`).
  - Scope exclusions preserved: no T13 financial ledger entries, no OCR/PDF-body indexing, no AI features, no object-storage migration, and no T19 full backup/restore orchestration (only `BackupFilePin` pin/release checks and storage reconciliation cleanup).
  - Owner waived Codex review and authorized Swarm + Ponytail engineering alongside independent read-only Agency subagent audits against committed checkpoints.

## 1. Skills Loaded

- `D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` — task card delivery workflow and evidence reporting discipline.
- `D:/Lawyer/.agents/skills/lawoffice-security-operations/SKILL.md` — private document storage containment, canonical lock ordering, pre-transaction I/O safety, `READ_DOCUMENTS`/`WRITE_DOCUMENTS`/`MANAGE_OPERATIONS` authorization, `BackupFilePin`/`RESTORE_MODE` cleanup guards.
- `D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` — Matter/Proceeding/Party/HearingResult/Deadline domain invariants and manual review preservation for `DRAFT` deadlines and `UNREVIEWED` POAs.
- `D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` — Arabic RTL (`ar-EG`), Cairo timezone handling, sticky-header scroll offset, keyboard navigation, responsive reflow (`390`/`768`/`1440px` + `200%` text scaling), and accessible link/form semantics.
- `D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` — unit, PostgreSQL migration/integration (`T12-MIGRATION` + `T12-TC-01`..`T12-TC-06` + full T03–T11 regression), and Playwright browser verification (`t03`..`t12`).
- `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail/SKILL.md` — minimal root-cause diffs, helper reuse, caller checks, and concise reporting.

## 2. Implemented Scope Summary (`69cde77..3b11cd2`)

- **Schema & Migrations (`prisma/schema.prisma`, `20261126000000_t12_document_versions_and_links`, `20261126010000_t12_fk_index_hygiene`):**
  - Added `PowerOfAttorney.documentId`, `HearingResult.decisionDocumentId`, `Deadline.sourceDocument` FK/index, `UploadAttempt.expectedDocumentVersion` + positive `CHECK`, `BackupFilePin` `[documentVersionId, releasedAt]` index, and additive T12 FK/index hygiene migration (`20261126010000_t12_fk_index_hygiene`, explicitly verified by `migration-upgrade.test.ts` for `_prisma_migrations`, `upload_attempt_document_id_idx` presence, and `backup_file_pin_document_version_id_idx` removal).
- **Document Versions, Paper Originals, Pinning & Storage Cleanup (`src/modules/documents/*`, `src/app/api/documents/[id]/*`):**
  - `beginUpload`/`beginVersionUpload` (`POST /api/documents/[id]/versions`) and `finalizeUpload` record derived `effectiveProceedingId`/`finalProceedingId` in upload/create audit events, lock parents in canonical `matter -> proceeding -> document` / `party -> document` order via `lockActiveDocumentForMutation`, write `ready/` bytes outside `db.$transaction` with conflict/replay cleanup, handle `FAILED` + `0`-byte retryability and `REJECT_DOCUMENT_UPLOAD` audit records, and verify `authorizeDownload` `sizeBytes > 0`, blank/cross-doc `?versionId=`, and `DOCUMENT_NO_STORE_HEADERS` + CSP on `HEAD` `405` / errors.
  - `pinDocumentVersionsForBackup`, `releaseBackupFilePins`, `runExpiredUploadAttemptCleanup`, and `reconcileAndCleanupDocumentStorage` obey `RESTORE_MODE=true`, guard active quarantine/protected/`BackupFilePin` keys across both cleanup phases, drain > 200 expired attempts, harden `readQuarantineBytes`/`readReadyStream`/`readReadyBytes`/`computeSha256`/`promoteToReady` via `O_NOFOLLOW` + `FileHandle` + `ELOOP` containment + `0o600`/`0o700` permissions, and emit `RECONCILE_DOCUMENT_STORAGE` audit events.
  - `listDocuments` clamps `totalPages` to `[1, 1000]` matching `searchParties`.
- **Cross-Repo Backend, Security & API Hardening (`src/lib/*`, `src/app/api/*`, `src/modules/**`, `src/worker/reminder-worker.ts`):**
  - Hardened `auth.ts` + `env.ts` (`TRUSTED_PROXY_IPS` startup IP/CIDR validation rejecting `/0` wildcards and full IPv4-mapped IPv6 CIDRs via 8-group IPv6 expansion, covered in `tests/unit/env.test.ts`), `api/auth/[...all]/route.ts` (rejecting explicit non-null untrusted/empty `Origin` directly on `generate-backup-codes`), `next.config.ts` (`PAGE_CSP_HEADER` excluding `/api/documents/:id/content`, `Cross-Origin-Resource-Policy: same-origin`), `idempotency.ts` (`$` escaping, invalid `Date` guard, `timingSafeEqual`), `party-identity.ts`, `audit.ts`, `normalization.ts`, `content-validator.ts`, `requiredPermission` forwarding on all server actions/routes, and `origin !== null` checks in `action-security.ts`.
  - Remediated reminder/domain/pagination findings: `enqueueMissingSourceReminderJobsBatch` resolves active `Task` reminder generations by `dueDate` so non-date `updateTask` edits never trigger duplicate deliveries after reopen or `TASK` rule re-enable; `reschedulePendingReminderJobs` filters historical `SENT` deliveries (`status: 'SENT'`); `updateProceeding` preserves `parties[].notes` `undefined` vs `null`; `savePowerOfAttorney` resolves `hearing.proceedingId` fallback in pre-locking.
- **Arabic RTL Screens, Accessibility & Tests/CI (`src/app/**`, `src/components/**`, `.github/workflows/**`, `tests/**`, `playwright.*.config.ts`):**
  - Fixed `/verify` roving `role="tablist"` keyboard focus (`totpInputRef` mount focus replacing `autoFocus` on tab switches), removed prohibited `aria-label` on `MAINTAINER` `UserIdentityBadge` `<div>`, added `print:hidden` to list/search filter bars (`matter-list-client`, `party-list-client`, `unified-search-client`), completed read-only UI guards on `reference-settings-client` & `HearingList`, aligned `PENDING` `IconClock` icons, standardized `<span aria-hidden="true">/</span>` breadcrumbs & decorative punctuation (`—`, `•`, `|`), fixed `EmptyStateContainer` & `<ErrorContainer>` `headingLevel` hierarchy across `tasks-view`, `today-view`, `inbox-view`, and 8 standalone not-found/archived pages, updated `role="feed"` -> `role="region"` on `search-results-list`, raised muted text contrast `#64748B` -> `#4D606A`, enlarged checkbox `<label>` touch targets to `min-h-[44px]`, upgraded `nextDateDisposition` `<fieldset><legend>`, hid `"الوحدات القادمة"` for `MAINTAINER`, and removed unused `'audit'` tab type.
  - Strengthened `t10-reminders-worker.test.ts` (`P2002` canonical-key survival + non-date `Task` reopen/re-enable delivery deduplication) and `auth-integration.test.ts` (real `two_factor` cookie + valid TOTP + `sign-out` DB deletion assertions), constrained `playwright-storage-teardown.ts` to `LAWOFFICE_E2E_STORAGE_ROOT` inside `os.tmpdir()`, added `[P3-1..3]` regression checks, and scoped workflow `cancel-in-progress` to non-`main` branches.

## 3. Swarm Execution & Agency Agent Evidence

### Post-`fe80a10` Re-Audits (`1628ab1` -> Polish `3b11cd2`)

| Role/profile | Native invocation or conversation ID | Definition ref | Loaded profile path/name/hash | Owned/examined paths | Inspected SHA | Result and evidence |
|---|---|---|---|---|---|---|
| `agency-backend-architect` (Auditor) | `390fc5d5-d827-43ac-b0d9-1c349c0db6e8` | `D:\Lawyer\.agents\agents\agency-backend-architect.md` | `d:\Lawyer\.agents\skills\engineering-backend-architect\SKILL.md` \| `agency-backend-architect` \| `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` (drift: none) | `src/modules/**`, `src/worker/**`, `prisma/**` | `1628ab1` / `fe80a10` | Verified 0 `[P1]`, 0 `[P2]`, 2 `[P3]` (`reschedulePendingReminderJobs` `SENT` filter; `listDocuments` `totalPages` clamp), 3 `[Polish]` — backend findings & ELOOP hardening fixed in `3b11cd2`. |
| `agency-application-security-engineer` (Auditor) | `d47e9cb0-18b6-4e55-816d-a45bb8575e80` | `D:\Lawyer\.agents\agents\agency-application-security-engineer.md` | `d:\Lawyer\.agents\skills\security-appsec-engineer\SKILL.md` \| `agency-application-security-engineer` \| `77C29A754E6C25B97F189C06D8459B02FD29F4D8DE8602CA53740F4C92A1F259` (drift: none) | `src/lib/**`, `src/app/api/**`, `src/modules/documents/document-storage.ts`, `next.config.ts` | `1628ab1` / `fe80a10` | Verified 0 `[P1]`, 0 `[P2]`, 0 `[P3]`, 3 `[Polish]` (IPv4-mapped IPv6 CIDR rejection, explicit `Origin` check on `generate-backup-codes`, `promoteToReady` `READ_OPEN_FLAGS`/`ELOOP`) — all fixed in `3b11cd2`. |
| `agency-frontend-developer` (Auditor) | `cf0a0db9-adb3-444a-821b-49b2ccbc1125` | `D:\Lawyer\.agents\agents\agency-frontend-developer.md` | `d:\Lawyer\.agents\skills\engineering-frontend-developer\SKILL.md` \| `agency-frontend-developer` \| `69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0` (drift: none) | `src/app/**`, `src/components/**` | `1628ab1` / `fe80a10` | Verified 0 `[P1]`, 1 `[P2]` (`tasks-view` `h1 -> h3` skip), 3 `[P3]` (missing `h1` on standalone error/not-found states, `ErrorContainer` level, contrast/headings), 4 `[Polish]` (`role="feed"` -> `region`, decorative spans, 44px checkbox targets) — all fixed in `3b11cd2`. |
| `agency-test-automation-engineer` (Auditor) | `5aa5a71a-4425-4dca-b3ea-c1e1723472a5` | `D:\Lawyer\.agents\agents\agency-test-automation-engineer.md` | `d:\Lawyer\.agents\skills\testing-test-automation-engineer\SKILL.md` \| `agency-test-automation-engineer` \| `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` (drift: none) | `tests/**`, `playwright*.config.ts`, `.github/workflows/**`, `T12-submission.md` | `1628ab1` / `fe80a10` | Verified 0 `[P1]`, 0 `[P2]`, 0 `[P3]`, 0 `[Polish]`. Added IPv4-mapped IPv6 unit regression coverage in `tests/unit/env.test.ts` for `3b11cd2`. |

### Post-`7919e82` Audits (`b2cd74e`) & Final Swarm Remediation (`fe80a10`)

| Role/profile / Swarm worker | Native invocation or conversation ID | Definition / Board ref | Loaded profile path/name/hash | Owned/examined paths | Inspected SHA | Result and evidence |
|---|---|---|---|---|---|---|
| `agency-backend-architect` (Auditor) | `bf299d91-de9a-44ad-aa0d-945184c75605` | `D:\Lawyer\.agents\agents\agency-backend-architect.md` | `d:\Lawyer\.agents\skills\engineering-backend-architect\SKILL.md` \| `agency-backend-architect` \| `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` (drift: none) | `src/modules/**`, `src/worker/**`, `prisma/**` | `b2cd74e` / `7919e82` | Verified 0 `[P1]`, 1 `[P2]` (`Task` duplicate reminder after non-date edit + reopen/re-enable), 2 `[P3]`, 1 `[Polish]` — all fixed in `fe80a10`. |
| `agency-application-security-engineer` (Auditor) | `b5098479-4ba5-4487-8e84-e08c702df33e` | `D:\Lawyer\.agents\agents\agency-application-security-engineer.md` | `d:\Lawyer\.agents\skills\security-appsec-engineer\SKILL.md` \| `agency-application-security-engineer` \| `77C29A754E6C25B97F189C06D8459B02FD29F4D8DE8602CA53740F4C92A1F259` (drift: none) | `src/lib/**`, `src/app/api/**`, `src/modules/identity/**`, `next.config.ts` | `b2cd74e` / `7919e82` | Verified 0 `[P1]` / 0 `[P2]`, 2 `[P3]` (`TRUSTED_PROXY_IPS` CIDR parity, `computeSha256` `FileHandle`), 2 `[Polish]` — all fixed in `fe80a10`. |
| `agency-frontend-developer` (Auditor) | `b8de25ab-c64a-407c-9a10-64b057f02ccc` | `D:\Lawyer\.agents\agents\agency-frontend-developer.md` | `d:\Lawyer\.agents\skills\engineering-frontend-developer\SKILL.md` \| `agency-frontend-developer` \| `69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0` (drift: none) | `src/app/**`, `src/components/**` | `b2cd74e` / `7919e82` | Verified 0 `[P1]`, 1 `[P2]` (`/verify` `autoFocus` stealing tablist focus), 3 `[P3]`, 4 `[Polish]` — all fixed in `fe80a10`. |
| `agency-test-automation-engineer` (Auditor) | `1fa9319c-8128-4d0e-8d98-786bfd3cace3` | `D:\Lawyer\.agents\agents\agency-test-automation-engineer.md` | `d:\Lawyer\.agents\skills\testing-test-automation-engineer\SKILL.md` \| `agency-test-automation-engineer` \| `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` (drift: none) | `tests/**`, `playwright*.config.ts`, `.github/workflows/**`, `T12-submission.md` | `b2cd74e` / `7919e82` | Verified 0 `[P1]`, 2 `[P2]` (`t10` P2002 key & `auth-integration` 2FA assertions), 2 `[P3]`, 3 `[Polish]` — all fixed in `fe80a10` & this report. |
| Swarm `final2-*` Workers | `89e70ee2` (`final2-backend`, `#107`), `adf40439` (`final2-security`, `#106`), `991bd04d` (`final2-frontend`, `#108`), `c041e58c` (`final2-tests-ci`, `#110`) | Swarm board `#103`–`#110` -> `fe80a10` | Native Swarm workers spawned from coordinator workspace | Disjoint write scopes across Waves 1 & 2 | `b2cd74e..fe80a10` | Landed cleanly and passed 100% of `lint`, `typecheck`, `367/367` unit, `373/373` integration, `build`, and `172/172` E2E tests. |

### Prior Audit & Swarm Build History (`d5a52f8` -> `8e9def7` -> `b251fcf` -> `f103faf` -> `f505835` -> `4f244c4` -> `7919e82`)

- **Wave 1–3 Initial Swarm Build (`d5a52f8`):** `t12-schema`, `t12-docs-core`, `t12-links-search`, `t12-ui-docs`, `t12-ui-links`, `t12-tests` (`#60`–`#72`).
- **Wave 4A/4B T12 Audits (`d5a52f8` -> `8e9def7`):** `586785e3`, `34586092`, `293c96d1`, `ab26c71d` -> `t12-fix-backend` (`#76`), `t12-fix-frontend` (`#75`), `t12-fix-tests` (`#78`).
- **Microscopic T12 Audits & `f103faf` Verifiers (`8e9def7` -> `b251fcf` -> `f103faf`):** `694b3a4c`, `ab97d066`, `79909915`, `7ef2e22e` -> `p12-*` (`#82`, `#83`, `#85`) -> `0a79593a`, `7d48100b`, `a2653a61`, `00c34c36`.
- **Wave 5 Full-Codebase Audits (`f505835` -> `4f244c4`):** `b9206804`, `a4b72b72`, `203ce595`, `139634d1` -> `fix-all-*` (`#90`–`#94`).
- **Wave 6 Polish Audits (`4f244c4`/`b795180` -> `7919e82`):** `419c15a7`, `e2c7b6d7`, `74a6b098`, `2c87bd77` -> `polish-*` (`#98`–`#102`).

## 4. Planned Acceptance Cases (`T12-MIGRATION` & `T12-TC-01`..`T12-TC-07`)

| Case | Level | Coverage & Outcome |
|---|---|---|
| `T12-MIGRATION` | PG + Prisma | **PASS** — `tests/integration/migration-upgrade.test.ts` (`27/27`) & `tests/integration/t12-document-versions.test.ts` deploy `20261126000000_t12_document_versions_and_links` + `20261126010000_t12_fk_index_hygiene` onto populated state and verify `upload_attempt_expected_document_version_check`, `upload_attempt_document_id_idx` presence, `backup_file_pin_document_version_id_idx` removal, and all FK/index constraints. |
| `T12-TC-01` | PG + file + browser | **PASS** — Adding v2 keeps immutable v1 row; S10 version history allows inline preview (`versionId` in iframe `src`) and authorized SHA-256-matching download of historical v1 (`t12-document-versions.test.ts` & `t12-document-versions.spec.ts`). |
| `T12-TC-02` | PG + file | **PASS** — Pre-transaction `writeReadyBytes` rollback deletes orphan `ready/` bytes on DB error; stale `expectedDocumentVersion` marks attempt `REJECTED`; archived `Matter`/`Proceeding`/`hearingId->Proceeding`/`Party`/`Document` and `REQUIRED` scan-policy failures reject without altering `currentVersionId`. |
| `T12-TC-03` | PG + browser | **PASS** — `PATCH /api/documents/[id]` updates `originalPresent`/`originalLocation`/metadata independently of `scanStatus`, preserves `UNKNOWN`/`YES`/`NO` transitions, rejects empty no-op (`400`) & archived parents (`400`), and enforces idempotency/auth/origin boundaries. |
| `T12-TC-04` | PG + API + browser | **PASS** — `PowerOfAttorney.documentId`, `HearingResult.decisionDocumentId`, and `Deadline.sourceDocumentId` reject wrong-scope, non-`READY`, non-`CLIENT` POA, cross-hearing, archived-parent, and unauthorized `null`-unlink calls; preserve unchanged archived links `(مؤرشف)` and keep POA `UNREVIEWED` & Deadline `DRAFT`. |
| `T12-TC-05` | PG + API + browser | **PASS** — `unifiedSearch` (`S12`) matches metadata only without matching PDF bodies or exposing storage keys, excludes pending/failed scans & archived parents unless `includeArchived`, denies `MAINTAINER`, and download routes reject blank/cross-doc `?versionId=`, `currentVersion = null`, and emit `DOCUMENT_NO_STORE_HEADERS` on `HEAD` `405`. |
| `T12-TC-06` | Unit + PG + file | **PASS** — `reconcileAndCleanupDocumentStorage` respects deterministic clock thresholds, protects Phase-1/Phase-2 active & pinned keys across both phases, drains > 200 expired attempts, protects TOCTOU `isKeyReferencedInDb` races, increments `deletedQuarantineCount`, records `RECONCILE_DOCUMENT_STORAGE` audit events, and obeys `RESTORE_MODE=true`. |
| `T12-TC-07` | Browser (`390`/`768`/`1440px`) | **PASS** — Keyboard `Tab`/`Enter` navigation, `200%` text scaling reflow & screenshots (`testInfo.attach`), dirty metadata preservation, `INCOMPLETE` & `REJECTED` retry recovery, `DeadlinesView` retry recovery, Arabic `404` boundary, and `globalTeardown` `os.tmpdir()` cleanup (`storage/` absent). |

## 5. Verification Results on Final Implementation SHA `3b11cd2d931bafbaa7634258b484cdeb59d2cc26`

- `git diff --check`: exit `0`; `Test-Path storage`: `False`
- `npm.cmd run lint`: exit `0`
- `npm.cmd run typecheck`: exit `0`
- `npm.cmd run test`: exit `0` — **`23/23` files, `367/367` unit tests passed** (`22.63s`)
- `NODE_ENV=production npm.cmd run build`: exit `0` (`Compiled successfully in 4.1s`, **`28/28` static pages**)
- `npx.cmd vitest run --no-file-parallelism tests/integration`: exit `0` — **`38/38` files, `373/373` PG integration tests passed** (`715.59s`)
- `npm.cmd run test:e2e` (all 10 Playwright configs, `1 worker`, `retries: 0`): exit `0` — **`172/172` passed (`0` failed, `0` skipped)**:
  - `playwright.config.ts` (`t03`): `28/28` passed (`1.1m`)
  - `playwright.t04.config.ts` (`t04`): `46/46` passed (`1.0m`)
  - `playwright.t05.config.ts` (`t05`): `14/14` passed (`50.7s`)
  - `playwright.t06.config.ts` (`t06`): `28/28` passed (`1.6m`)
  - `playwright.t07.config.ts` (`t07`): `16/16` passed (`1.1m`)
  - `playwright.t08.config.ts` (`t08`): `10/10` passed (`52.4s`)
  - `playwright.t09.config.ts` (`t09`): `10/10` passed (`56.4s`)
  - `playwright.t10.config.ts` (`t10`): `8/8` passed (`38.7s`)
  - `playwright.t11.config.ts` (`t11`): `6/6` passed (`54.2s`)
  - `playwright.t12.config.ts` (`t12`): `6/6` passed (`1.2m`)

## 6. Remaining Limits (`NOT RUN` & Preserved Contracts)

- **Malware scanner execution (`NOT RUN` — deferred under ADR 0003):** Live ClamAV / `freshclam` scanning remains unimplemented and unexecuted in V1 until explicitly enabled.
- **T19 full backup/restore orchestration (`NOT RUN`):** Only T12 `BackupFilePin` pin/release enforcement and storage reconciliation cleanup were implemented and verified; full T19 backup/restore pipeline execution belongs to T19.
- **Preserved browser & schema contracts:** `closeRegenModal` in `src/app/settings/security/security-client.tsx` remains dismissible via `Escape` during in-flight `regenerateBackupCodesAction` per `R11-04` (`tests/e2e/auth-round11-browser.spec.ts:322-387`), `HearingResultClient` leaves `<GuardedLink>` unblocked during `isFrozenRetry` per `T08-TC-03` (`tests/e2e/t08-hearings.spec.ts`) while protecting tab close/reload via `beforeunload`, and `trg_account_password_sync_credential_version` in `prisma/migrations/20261114000000_credential_version/migration.sql` remains untouched (pinned by R14 migration/identity tests).
