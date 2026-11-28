# Task T13 Submission Report — Fees, Fee Agreements, Collections & Client Statements

## Summary

- **Task**: `T13` (`docs/tasks/T13.md`) — Fees, fee agreements (`DRAFT` / `APPROVED` / `CANCELLED`), balanced ledger postings, atomic fee collections & allocations, sequential receipts & reprints, client statements, matter Finance tab, and `/finance` standalone workspace.
- **Branch**: `feature/t13-fees-collections`
- **Upstream**: `origin/feature/t13-fees-collections`
- **Canonical Remote**: `https://github.com/MohamedAlksas/LawyerOS.git`
- **Pull Request**: [Draft PR #25](https://github.com/MohamedAlksas/LawyerOS/pull/25) -> `main` (unmerged; awaiting independent Codex review)
- **Base (`origin/main`)**: `7c3d09ba28ff678e7f395ec3453d86732ab01dc5`
- **Predecessors Verified Accepted & Merged on `origin/main`**:
  - PR #23 merge commit: `90ad1c2d1d7276191dc11d4f7076ea501b66d799`
  - PR #24 (`T12`) merge commit: `7c3d09ba28ff678e7f395ec3453d86732ab01dc5`
- **Implementation Checkpoints**:
  - `aa54924f3a7a40f02218c993229923ffe104c038` (Initial T13 implementation)
  - `3971bf47a2c3cb60dfd28cfe3a94e15df0d31617` (P2 closure)
  - `736a40d62d97302875d5839d7e897c07d98a9bc8` -> `fa911caa17f8895544acc7b3dfa6c6c79ea4de28` (4-phase Agency audit remediation)
  - `75d2661a9c97ad31d15f433d1244aaf8132b2c4a` (Prior submission report attestation, followed by full-codebase 6-agent audit & Swarm hardening)
- **Final Verified Implementation SHA**: `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`
- **Submission / Report-Only Attestation Commit (`HEAD` & Independently Verified Remote Pushed SHA)**: Committed directly on top of `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`, touching only `docs/reviews/T13-submission.md` (`git diff --name-only b23b9a09424c78d5d3da5886ec3e72d621e7bc0a..HEAD` verified report-only; see PR #25 head / `git ls-remote origin refs/heads/feature/t13-fees-collections`).

## Skills Loaded

Every implementation phase and verification step read the local project skills directly from disk:

- `d:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` — Task execution order, strict GitHub branch/PR workflow, report-only attestation separation, and submission protocol.
- `d:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md` — `bigint` EGP piastres, separation of fees vs reimbursable expenses vs client advances, immutability of posted financial entries, atomic transaction/receipt/idempotency rules.
- `d:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` — `Matter` vs `Proceeding` separation, scoped `ClientMatterParty` client checks, and unlinking/demotion obligation guards.
- `d:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` — Arabic RTL workspace, Bidi digit isolation, Cairo timezone dates, focus/modal accessibility, and `@media print` receipt formatting.
- `d:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` — Real PostgreSQL integration testing, migration/upgrade verification, E2E isolation, and strict `NOT RUN` accounting.

## Slice Routing Decision & Agency Agent Evidence

Task-level routing follows `docs/AGENCY_AGENT_ROUTING.json` (`T13`: Lead `agency-backend-architect`, Support `agency-database-optimizer`, `agency-test-automation-engineer`, supplemented by `agency-application-security-engineer` and `agency-frontend-developer` under `docs/AGENCY_AGENTS.md`). Same-session persona fallback was not used; all implementation audit phases and final post-fix confirmation audits ran in distinct native `invoke_subagent` sessions, and the final `fa911ca -> b23b9a0` hardening pass ran via disjoint coordinator-managed Swarm workers (`t13-db`, `t13-backend`, `t13-frontend`, `t13-tests`) followed by 3 independent native Agency confirmations on `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`.

### Installed Profile & Skill Verification (SHA-256)

| Agency Role | Definition Path | Definition SHA-256 | Profile Skill Path | Profile SHA-256 |
| --- | --- | --- | --- | --- |
| `agency-backend-architect` | `D:/Lawyer/.agents/agents/agency-backend-architect.md` | `E357ED74D54D358E903F14F2F2C4A79E77E9B71C59CFEC3F1FD319B29CBA14B4` | `D:/Lawyer/.agents/skills/engineering-backend-architect/SKILL.md` | `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` |
| `agency-database-optimizer` | `D:/Lawyer/.agents/agents/agency-database-optimizer.md` | `E260D8BBC32BB73A232571B1FBDDB452B680A83607B757BE374A662C3D5D95BE` | `D:/Lawyer/.agents/skills/engineering-database-optimizer/SKILL.md` | `BD5F5E6813C8931C1387689F6A4D6137E3385734D402F72BD0DFC4292F7EE068` |
| `agency-application-security-engineer` | `D:/Lawyer/.agents/agents/agency-application-security-engineer.md` | `CEB1DAE321159422C0076688DC479D26451EC0EF1E8497186F5576A427B383D9` | `D:/Lawyer/.agents/skills/security-appsec-engineer/SKILL.md` | `77C29A754E6C25B97F189C06D8459B02FD29F4D8DE8602CA53740F4C92A1F259` |
| `agency-frontend-developer` | `D:/Lawyer/.agents/agents/agency-frontend-developer.md` | `D893C2C1CD277F52595F4ABE77F8775B81A69B6D5E61CEE15061476F38943496` | `D:/Lawyer/.agents/skills/engineering-frontend-developer/SKILL.md` | `69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0` |
| `agency-test-automation-engineer` | `D:/Lawyer/.agents/agents/agency-test-automation-engineer.md` | `5CA889B023BAA6774E3BC13D5E015CBF9F06FC2C2157C646D5231642C3D4BC8E` | `D:/Lawyer/.agents/skills/testing-test-automation-engineer/SKILL.md` | `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` |

### Native Agency Sessions & Final Confirmations on `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`

| Phase / Role | Native Conversation ID | Checkpoint Inspected / Produced | Owned Scope & Findings / Actions | Reconciliation / Checks Run |
| --- | --- | --- | --- | --- |
| Prior Build & Audit Leads (`7c3d09b` -> `fa911ca`) | `c085e01a-2513-44e9-a8bb-d24f458631fe`, `1689b32c-75e3-4568-a64a-0d9be9132fcd`, `87acbaa2-e9a6-49bb-8418-ffaab9b5072e`, `5b4a7383-cd9f-449c-88ef-7b5f5284ce89`, `92f33952-9a2d-4dcf-9406-11e6f5802d0e`, `ac094a3a-4c15-48d9-88c2-7894fdad1921` | `7c3d09b` -> `fa911ca` | Initial T13 delivery + 4-phase audit remediation (`20261128000000`, backend/http/matters, RTL/Bidi UI, upgrade/E2E expansion) | Reconciled in `fa911ca` |
| Full-Codebase 6-Agent Read-Only Audit on `75d2661` | `7fa600fb-531e-4f53-b1bd-e9a7852a9981` (AppSec), `f29a3443-8f66-4b9a-9e85-e25e7f76b32d` (DB), `c4e90c4c-637a-4767-9a5d-eeaeb4624796` (Core Backend), `a59c9ae2-8eb0-4ffe-88a7-f7b8695930a6` (Frontend) | `75d2661` (read-only) | Identified T13 DB ledger/allocation/agreement guards (`P0-3`/`P1-3`), archived client guards (`P1-1`/`P1-5`), `.strict()` + Zod base Arabic error fallbacks (`P1-2`/`[P3]`), `protectedVersionWhere` (`P2-5`), `openCharges`/tie-breakers (`P2-7`/`P2-8`), `statementGenRef`/frozen draft-approve/noValidate/matter-filter (`finance-workspace.tsx`), `party-profile-client.tsx` stale placeholder, and T13 test gaps | All T13 findings fixed in `b23b9a0`; T01–T12 findings separated to `fix/full-codebase-audit-hardening` |
| Final Post-Fix Confirmation: Database (`agency-database-optimizer`) | `059121e7-75fc-401f-9a6e-8935acd6fc6c` | `b23b9a0` (read-only) | Confirmed `20261128010000_t13_ledger_allocation_agreement_guards` triggers (`money_allocation` integrity + deferred bounds, `fee_charge`/`fee_agreement` deferred integrity, `REVERSAL`/`REFUND`/receipt guards, `CANCELLED` & `APPROVED` immutability, `ON DELETE RESTRICT` on `agreement_document_id`, `DRAFT`/`POSTED` line guard, `search_path`, no `BEGIN;`/`COMMIT;`) + `approveFeeAgreement` & `postTransaction` lock order & archived client rejection | **`CLOSURE_NO_FINDINGS`** (`NOT RUN` — read-only) |
| Final Post-Fix Confirmation: AppSec (`agency-application-security-engineer`) | `0f274be7-7dde-4f65-ad1f-8316de53b60d` | `b23b9a0` (read-only) | Confirmed `.strict()` on all 8 schemas, Arabic `{ error: '...' }` on all base primitives (resolving prior `[P3]` finding), Arabic `unrecognized_keys` translation, archived client locks/checks, `protectedVersionWhere.feeAgreements`, frozen draft/approve forms & `noValidate`, `party-finance-link` | **`CLOSURE_NO_FINDINGS`** (`NOT RUN` — read-only) |
| Final Post-Fix Confirmation: Tests & UI (`agency-test-automation-engineer`) | `69e19542-ca02-4248-9bab-83c891133a43` | `b23b9a0` (read-only) | Confirmed unit strict/Arabic coverage, `migration-upgrade.test.ts` (`25` migrations + new triggers + APPROVED agreement/charge checks), `t13-finance-ledger.test.ts` (`T13-P0-3-DB-GUARDS`, `T13-ARCHIVED-AND-ORDERING`, clean `$disconnect()`/env restore), `t13-finance.spec.ts` (`mobile-bottom-nav`, `party-finance-link`, frozen retry), and conditional `cleanupMatterFixtures` | **`CLOSURE_NO_FINDINGS`** (`NOT RUN` — read-only) |

## Changed Files (`7c3d09ba..HEAD`)

All `43` implementation/test files below match `git diff --name-status 7c3d09ba28ff678e7f395ec3453d86732ab01dc5..b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`, with `docs/reviews/T13-submission.md` updated in the final report-only attestation commit:

### Added (`25` files, incl. `T13-submission.md`)
- `docs/reviews/T13-submission.md`
- `playwright.t13.config.ts`
- `prisma/migrations/20261127000000_t13_balanced_ledger_fees_receipts/migration.sql`
- `prisma/migrations/20261127010000_t13_fee_agreement_status_guard/migration.sql`
- `prisma/migrations/20261128000000_t13_ledger_integrity_and_indexes/migration.sql`
- `prisma/migrations/20261128010000_t13_ledger_allocation_agreement_guards/migration.sql`
- `src/app/(app)/finance/page.tsx`
- `src/app/api/finance/agreements/[id]/approve/route.ts`
- `src/app/api/finance/agreements/route.ts`
- `src/app/api/finance/receipts/[id]/route.ts`
- `src/app/api/finance/route.ts`
- `src/app/api/finance/statement/route.ts`
- `src/app/api/finance/transactions/[id]/route.ts`
- `src/app/api/finance/transactions/route.ts`
- `src/components/finance/finance-workspace.tsx`
- `src/modules/finance/finance-errors.ts`
- `src/modules/finance/finance-http.ts`
- `src/modules/finance/finance-service.ts`
- `src/modules/finance/finance-types.ts`
- `src/modules/finance/index.ts`
- `src/modules/finance/receipt-allocator.ts`
- `tests/e2e/t13-finance.spec.ts`
- `tests/helpers/t13-ui-constants.ts`
- `tests/integration/t13-finance-ledger.test.ts`
- `tests/unit/finance-validation.test.ts`

### Modified (`18` existing files)
- `next.config.ts` (`NO_STORE_PATHS` extended with `'/finance'` and `'/finance/:path*'`)
- `package.json` (`test:e2e` includes `playwright.t13.config.ts` and `test:e2e:t13`)
- `prisma/schema.prisma` (T13 finance models, 1:1 `MoneyLine.feeCharge`, `FeeAgreement.agreementDocument` `onDelete: Restrict`, constraints, indexes, `@default(now())` on `ReceiptSequence.updatedAt`)
- `src/app/(app)/matters/[id]/page.tsx` (UUID-validated `id` for `returnTo` & initial `MatterFinanceSummary` SSR load)
- `src/app/globals.css` (`body:has(#app-shell-modal-root > *) #app-shell-content { display: none !important; }` for `@media print`)
- `src/components/desktop-sidebar.tsx` (shows Finance navigation only for allowed roles, excluding `MAINTAINER`)
- `src/components/matters/matter-detail-client.tsx` (Finance tab + `focus-visible:ring-2` + `"إعادة المحاولة"` retry on SSR error)
- `src/components/parties/party-profile-client.tsx` (replaced stale "not enabled" notice with active `/finance` access card linking `data-testid="party-finance-link"`)
- `src/components/productivity/productivity-ui-types.ts` (`returnFocusRef` + skips `document.body` focus capture/restore in `useAccessibleModal`)
- `src/components/tablet-drawer.tsx` (shows Finance navigation only for allowed roles, excluding `MAINTAINER`)
- `src/lib/sanitize-return-to.ts` (`'/finance'` in `ALLOWED_EXACT_ROUTES`)
- `src/modules/documents/document-service.ts` (`protectedVersionWhere` includes `{ feeAgreements: { some: {} } }`)
- `src/modules/matters/matter-service.ts` (`assertNoClientFinancialObligations` on `CLIENT` demotion and party unlinking)
- `tests/helpers/matter-test-helper.ts` (`cleanupMatterFixtures` safely cleans conditional T13 finance rows when present)
- `tests/helpers/playwright-storage-teardown.ts` (tightened regex `/^(?:lawoffice-t\d+-e2e-)/`)
- `tests/helpers/t04-constants.ts` (aligned nav item helpers/assertions)
- `tests/integration/migration-upgrade.test.ts` (verifies all 4 T13 migrations / 25 total, new triggers, and SQL fee-agreement/charge invariants)
- `tests/unit/sanitize-return-to.test.ts` (covers `'/finance'` & preserved query parameters)

## Acceptance Matrix (`T13-TC-01` .. `T13-TC-07` per `docs/tasks/T13.md`)

| TC ID | Acceptance Requirement (`docs/tasks/T13.md`) | Verified Test Cases & Coverage |
| --- | --- | --- |
| `T13-TC-01` | Draft fee agreement `15,000` EGP changes no balance; approve `6,000` + `9,000` creates balanced `1,500,000`-piastre obligation. | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-01..03`, `T13-P0-3-DB-GUARDS`, `T13-ARCHIVED-AND-ORDERING`) + `tests/e2e/t13-finance.spec.ts` (`T13-TC-01`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`) |
| `T13-TC-02` | Record `5,000` EGP fee collection toward matching charge -> `10,000` EGP remaining due, balanced `MoneyLine` rows, `PaymentAllocation`, sequential `Receipt`, audit entry, Arabic confirmation, updated statement. | `tests/integration/t13-finance-ledger.test.ts` + `tests/e2e/t13-finance.spec.ts` (`T13-TC-02`) |
| `T13-TC-03` | Retry with same `idempotencyKey` after committed post returns same transaction & receipt; same key with different payload rejects; reprint reuses same `receiptNumber` without new payment/number. | `tests/integration/t13-finance-ledger.test.ts` + `tests/e2e/t13-finance.spec.ts` (`T13-TC-03`, plus frozen draft/approve idempotent retry coverage) |
| `T13-TC-04` | Concurrent `4,000` collections on `5,000` remaining -> only 1 succeeds (`1,000` remaining, 1 receipt) via scoped `fee_charge` lock; concurrent draft edit vs approval resolves cleanly with `CONCURRENCY_CONFLICT` / `ALREADY_POSTED` and zero deadlocks. | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-04`, `T13-TC-04b`) |
| `T13-TC-05` | Negative checks: zero/negative/float amounts, unknown `.strict()` keys, missing/wrong-type fields, archived client approval/default-payer rejection, mismatched debtor/matter, unbalanced/empty `lines`, excess overpayment without implicit advance, `OFFICE_EXPENSE`, DB/HTTP `409` edit/delete rejection on posted ledger/approved/cancelled agreements/receipts. | `tests/unit/finance-validation.test.ts` (10 tests) + `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-05`, `T13-P0-3-DB-GUARDS`, `T13-ARCHIVED-AND-ORDERING`) |
| `T13-TC-06` | Audit-log failure rolls back ledger, allocations, receipt, sequence & idempotency; unauthenticated/`MAINTAINER` requests receive `401`/`403`; Finance nav item hidden in desktop sidebar (`1440px`), `tablet-drawer` (`768px`), and `mobile-bottom-nav` (`390px`). | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-06`, HTTP `413` & `Sec-Fetch-Site` checks) + `tests/e2e/t13-finance.spec.ts` (`T13-TC-06`, `T13-AUTH-REDIRECT`) |
| `T13-TC-07` | UI verification: Arabic RTL matter Finance tab across `1440px`, `768px`, `390px`, `200%` text zoom, `Tab`/`Escape` focus management, `@media print` receipt view, standalone `/finance` workspace, and `/parties/[id]` `/finance` navigation link; zero client-document/storage leaks. | `tests/e2e/t13-finance.spec.ts` (`T13-TC-01..03`, `T13-TC-06` `@responsive`, `T13-TC-07` `@responsive @a11y`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`) |

## Verification Commands & Observed Results (After Final Code Edit `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a`)

All commands ran in `D:/Lawyer/work/t13-gemini` against commit `b23b9a09424c78d5d3da5886ec3e72d621e7bc0a` with synthetic test data only:

1. `git diff --check` -> **exit `0`** (no whitespace errors)
2. `npx prisma validate && npx prisma generate` -> **exit `0`**
3. `npx prisma migrate deploy` & `npx prisma migrate status` (against `lawoffice_test` via `DATABASE_URL = TEST_DATABASE_URL`) -> **exit `0`** (`25 migrations found in prisma/migrations`, database schema up to date)
4. `npm.cmd run lint` -> **exit `0`**
5. `npm.cmd run typecheck` -> **exit `0`**
6. `npm.cmd run test` -> **exit `0`**: **`24/24` files passed, `379/379` unit tests passed** (`finance-validation.test.ts`: `10/10`, `sanitize-return-to.test.ts`: `32/32`)
7. `$env:NODE_ENV='production'; npm.cmd run build` -> **exit `0`**: Next.js production build succeeded across **`33`** routes (`/finance` dynamic `ƒ`)
8. `npx.cmd vitest run --no-file-parallelism tests/integration` -> **exit `0`**: **`39/39` files passed, `385/385` real PostgreSQL integration tests passed** (`541.10s`; `migration-upgrade.test.ts`: `28/28`, `t13-finance-ledger.test.ts`: `11/11`)
9. `npm.cmd run test:e2e` -> **exit `0`**: **`11/11` Playwright configs passed, `181/181` E2E tests passed** (`t03`: `28/28` `1.3m`, `t04`: `46/46` `1.2m`, `t05`: `14/14` `56.8s`, `t06`: `28/28` `1.6m`, `t07`: `16/16` `1.2m`, `t08`: `10/10` `57.2s`, `t09`: `10/10` `59.8s`, `t10`: `8/8` `38.6s`, `t11`: `6/6` `45.4s`, `t12`: `6/6` `55.9s`, `t13`: `9/9` `45.7s`)
10. `Test-Path D:/Lawyer/work/t13-gemini/storage` -> **`False`** (zero leaked E2E storage directories after suite teardown)

## Manual Demo Steps and Observations

- Verified via Playwright runs (`playwright.t13.config.ts`) in Arabic RTL (`dir="rtl"`, Cairo date/time, `<bdi dir="ltr">` isolated numeric figures):
  - Created and edited a `DRAFT` fee agreement, exercised frozen draft reset and frozen approve idempotent retry under simulated network abort, and approved a split client agreement (`6,000` + `9,000` = `15,000` EGP).
  - Recorded a `5,000` EGP fee collection, verified remaining `10,000` EGP due, previewed/reprinted receipt with unchanged `receiptNumber`, and navigated via `party-finance-link` on `/parties/[id]` -> `/finance`.
  - Verified `MAINTAINER` sees no Finance nav link in desktop sidebar, tablet drawer (`768px`), or mobile bottom nav (`390px`) and receives HTTP `403`.

## Screenshots / Sample PDF Paths

- Automated Playwright runs capture screenshot attachments into ephemeral, gitignored `test-results/t13/` via `testInfo.attach` on `@responsive` / `@a11y` / print tests (`T13-TC-06`, `T13-TC-07`). No screenshots or real client PDFs are committed to Git.
- Sample PDF binary generation: `NOT RUN` (out of scope for T13; T13 delivers HTML/CSS `@media print` receipts inside the printable modal portal, while Playwright PDF binary export belongs to T16/later templates).

## Schema / Data Migrations

- `prisma/migrations/20261127000000_t13_balanced_ledger_fees_receipts/migration.sql` — Core T13 models, composite FKs, balanced ledger `DEFERRABLE` trigger, and immutability triggers.
- `prisma/migrations/20261127010000_t13_fee_agreement_status_guard/migration.sql` — Prevents mutating approved fee agreements and blocks non-`DRAFT` activation shortcuts.
- `prisma/migrations/20261128000000_t13_ledger_integrity_and_indexes/migration.sql` — `MoneyAccount`/`ReceiptSequence` immutability triggers, `BEFORE TRUNCATE` guards across all 8 finance tables, paired dimension check, cross-matter/client triggers, `1:1` `MoneyLine.feeCharge`, `ON DELETE RESTRICT` idempotency FK, and 6 hot query/FK indexes.
- `prisma/migrations/20261128010000_t13_ledger_allocation_agreement_guards/migration.sql` — `money_allocation` compatibility/bounds triggers (`BEFORE INSERT` + `DEFERRABLE INITIALLY DEFERRED`), `fee_charge`/`fee_agreement` deferred integrity (`SUM(charges) = total` & `APPROVED` binding), `money_transaction` `REVERSAL`/`REFUND` CHECKs + trigger, `receipt` `POSTED`/amount/`payment_method` trigger, `CANCELLED` + `APPROVED` full immutability + `ON DELETE RESTRICT` on `agreement_document_id`, and `DRAFT`-only editable `trg_money_line_immutable` (no `BEGIN;`/`COMMIT;`, `SET search_path = public, pg_catalog`).
- Migration upgrade path verified cleanly in `tests/integration/migration-upgrade.test.ts` (all `25` migrations from empty schema + new T13 triggers & invariants).

## Security & Privacy Effects

- **Strict Validation & Origin/CSRF Guards** (`src/modules/finance/finance-types.ts`, `src/modules/finance/finance-http.ts`): All 8 Zod schemas enforce `.strict()` and Arabic error messages across all base primitives and `unrecognized_keys`; `verifyFinanceReadOrigin` / `verifyFinanceMutationOrigin` enforce same-origin + `Sec-Fetch-Site` (`same-origin` / `none`), `128 KB` body cap (`413`), `no-store`, and strict CSP.
- **Authorization & Domain Guards**: Finance routes restrict access to `OWNER`, `LAWYER`, and `SECRETARY` (`MAINTAINER` denied `403`, unauthenticated `401`); `approveFeeAgreement` and `postTransaction` lock and reject archived `Party` rows; `document-service.ts` (`protectedVersionWhere`) protects `feeAgreements`-linked documents; `matter-service.ts` blocks unlinking/demoting `CLIENT` parties with active financial obligations.
- **Post-Fix Confirmation (`0f274be7`, `059121e7`, `69e19542`)**: All 3 independent native Agency audits returned **`CLOSURE_NO_FINDINGS`** (`0 [P0] / 0 [P1] / 0 [P2] / 0 [P3]`).

## Rollback / Recovery Notes

- Because PR #25 is unmerged and T13 tables hold no production client records, rollback before merge closes PR #25 and reverts branch `feature/t13-fees-collections`.
- Once T13 migrations are applied to an environment, preserve additive schema integrity or restore from coordinated PostgreSQL pre-upgrade dump/checkpoint rather than bypassing immutability/truncate triggers.

## Known Limitations / `NOT RUN` Checks

1. **Standalone `/finance` Responsive Matrix**: The `390px` / `768px` / `1440px` + `200%` zoom + `@media print` responsive E2E assertions (`T13-TC-06`, `T13-TC-07`) ran on the Matter Finance tab (`/matters/[id]`) and `MAINTAINER` sidebar/drawer/bottom-nav, while standalone `/finance` OWNER workflows ran at desktop `1440px` (`T13-TC-01..03`, `T13-AUTH-REDIRECT`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`). Both screens share `FinanceWorkspace`.
2. **Out-of-Scope / Later-Task Items (`NOT RUN`)**: Reimbursable expenses (`T14`), client advances & retainers (`T15a`), corrections/reversals/refunds (`T15b`), office billing-enabled gating (`T15c`), Playwright binary PDF rendering & ClamAV attachment scanning (`T16+`), and full production backup/restore drills (`T19`).
3. **GitHub Actions CI**: Triggered upon pushing this report-only attestation commit; final remote workflow status verified and reported with the submission update.
