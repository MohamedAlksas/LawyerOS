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
  - `aa54924f3a7a40f02218c993229923ffe104c038` (Initial T13 implementation & submission)
  - `3971bf47a2c3cb60dfd28cfe3a94e15df0d31617` (P2 closure & submission alignment)
  - `11f576dc6dcddf44e6f5294ac075a7fd34263f17` -> `736a40d62d97302875d5839d7e897c07d98a9bc8` (Audited by 5 read-only microscopic agents and superseded by full 4-phase Agency remediation)
- **Final Verified Implementation SHA**: `fa911caa17f8895544acc7b3dfa6c6c79ea4de28`
- **Submission / Report-Only Attestation Commit (`HEAD` & Independently Verified Remote Pushed SHA)**: Committed directly on top of `fa911caa17f8895544acc7b3dfa6c6c79ea4de28`, touching only `docs/reviews/T13-submission.md` (`git diff --name-only fa911caa17f8895544acc7b3dfa6c6c79ea4de28..HEAD` verified report-only; see PR #25 head / `git ls-remote origin refs/heads/feature/t13-fees-collections`).

## Skills Loaded

Every implementation phase and verification step read the local project skills directly from disk:

- `d:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` — Task execution order, strict GitHub branch/PR workflow, report-only attestation separation, and submission protocol.
- `d:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md` — `bigint` EGP piastres, separation of fees vs reimbursable expenses vs client advances, immutability of posted financial entries, atomic transaction/receipt/idempotency rules.
- `d:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` — `Matter` vs `Proceeding` separation, scoped `ClientMatterParty` client checks, and unlinking/demotion obligation guards.
- `d:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` — Arabic RTL workspace, Bidi digit isolation, Cairo timezone dates, focus/modal accessibility, and `@media print` receipt formatting.
- `d:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` — Real PostgreSQL integration testing, migration/upgrade verification, E2E isolation, and strict `NOT RUN` accounting.

## Slice Routing Decision & Agency Agent Evidence

Task-level routing follows `docs/AGENCY_AGENT_ROUTING.json` (`T13`: Lead `agency-backend-architect`, Support `agency-database-optimizer`, `agency-test-automation-engineer`, supplemented during full-codebase audit and 4-phase remediation by `agency-application-security-engineer` and `agency-frontend-developer` per `docs/AGENCY_AGENTS.md`). Same-session persona fallback was not used; every phase and confirmation audit ran in a distinct native `invoke_subagent` session.

### Installed Profile & Skill Verification (SHA-256)

| Agency Role | Definition Path | Definition SHA-256 | Profile Skill Path | Profile SHA-256 |
| --- | --- | --- | --- | --- |
| `agency-backend-architect` | `D:/Lawyer/.agents/agents/agency-backend-architect.md` | `E357ED74D54D358E903F14F2F2C4A79E77E9B71C59CFEC3F1FD319B29CBA14B4` | `D:/Lawyer/.agents/skills/engineering-backend-architect/SKILL.md` | `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` |
| `agency-database-optimizer` | `D:/Lawyer/.agents/agents/agency-database-optimizer.md` | `E260D8BBC32BB73A232571B1FBDDB452B680A83607B757BE374A662C3D5D95BE` | `D:/Lawyer/.agents/skills/engineering-database-optimizer/SKILL.md` | `BD5F5E6813C8931C1387689F6A4D6137E3385734D402F72BD0DFC4292F7EE068` |
| `agency-application-security-engineer` | `D:/Lawyer/.agents/agents/agency-application-security-engineer.md` | `CEB1DAE321159422C0076688DC479D26451EC0EF1E8497186F5576A427B383D9` | `D:/Lawyer/.agents/skills/security-appsec-engineer/SKILL.md` | `77C29A754E6C25B97F189C06D8459B02FD29F4D8DE8602CA53740F4C92A1F259` |
| `agency-frontend-developer` | `D:/Lawyer/.agents/agents/agency-frontend-developer.md` | `D893C2C1CD277F52595F4ABE77F8775B81A69B6D5E61CEE15061476F38943496` | `D:/Lawyer/.agents/skills/engineering-frontend-developer/SKILL.md` | `69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0` |
| `agency-test-automation-engineer` | `D:/Lawyer/.agents/agents/agency-test-automation-engineer.md` | `5CA889B023BAA6774E3BC13D5E015CBF9F06FC2C2157C646D5231642C3D4BC8E` | `D:/Lawyer/.agents/skills/testing-test-automation-engineer/SKILL.md` | `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` |

### Native Agency Sessions & Reconciliation

| Phase / Role | Native Conversation ID | Checkpoint Inspected / Produced | Owned Scope & Findings / Actions | Reconciliation / Checks Run |
| --- | --- | --- | --- | --- |
| Initial Build Lead (`agency-backend-architect`) | `c085e01a-2513-44e9-a8bb-d24f458631fe` | `7c3d09b` -> `aa54924` | Core schema, ledger posting, receipt allocation, API routes, initial UI & integration tests | Reconciled into `aa54924` |
| Initial Support 1 (`agency-database-optimizer`) | `78902a6d-71ea-4b9e-9110-3221223bc154` | `aa54924` / `3971bf4` | DB schema, balanced triggers, composite FK & sequence locking audit | `aa54924` / `3971bf4` findings integrated |
| Initial Support 2 (`agency-test-automation-engineer`) | `2de4e9d0-0892-49f3-abca-17364a9ce901` | `aa54924` / `3971bf4` | Unit, integration, E2E test rigor & assertion audit | `aa54924` / `3971bf4` findings integrated |
| P2 Closure Lead (`agency-backend-architect`) | `1689b32c-75e3-4568-a64a-0d9be9132fcd` | `aa54924` -> `3971bf4` | Closed initial review items on `3971bf4` | Reconciled prior to audit expansion |
| Microscopic Audit: Backend (`agency-backend-architect`) | `11945c6d-44e8-456a-8f17-1347753543a8` | `736a40d` (read-only) | Identified client demotion/unlink guard gap, read snapshot isolation, openCharges bound, Cairo year allocation, duplicate receipt upsert | Fixed in Phase 2 (`5b4a7383`); `NOT RUN` (read-only) |
| Microscopic Audit: Database (`agency-database-optimizer`) | `52fb9392-4834-4bc4-9472-d33da2c683a0` | `736a40d` (read-only) | Identified missing `MoneyAccount` & `ReceiptSequence` immutability triggers, `BEFORE TRUNCATE` triggers, `FeeAgreement` status/cross-matter FK guards, `1:1` `feeCharge`, and hot indexes | Fixed in Phase 1 (`87acbaa2`); `NOT RUN` (read-only) |
| Microscopic Audit: AppSec (`agency-application-security-engineer`) | `20557e06-7690-4d53-98cf-2bb14c8fc53f` | `736a40d` (read-only) | Identified 128 KB JSON body cap (`413`), `Sec-Fetch-Site` allowlist, CSP header on finance API, `NO_STORE_PATHS` for `/finance`, strict parser upper bound, `sanitize-return-to` `/finance` | Fixed in Phase 2 (`5b4a7383`); `NOT RUN` (read-only) |
| Microscopic Audit: Frontend (`agency-frontend-developer`) | `3b732c74-4376-401d-8e3f-64841370f265` | `736a40d` (read-only) | Identified Bidi digit isolation (`<bdi dir="ltr">`), stale overview/statement/receipt race guards, locked-form indeterminate state & `useLeaveGuard`, modal focus return & print selector, `DRAFT` edit UI, responsive `allocation-amount-*` | Fixed in Phase 3 (`92f33952`); `NOT RUN` (read-only) |
| Microscopic Audit: Tests/Submission (`agency-test-automation-engineer`) | `64e741f8-63ae-456e-89ca-f0e221c200cb` | `736a40d` (read-only) | Identified shared storage teardown regex risk, client/server parser constant divergence, missing `migration-upgrade.test.ts` T13 checks, `T13-TC-01..07` submission table drift, PR #23 SHA typo | Fixed in Phase 4 (`ac094a3a`) + report update; `NOT RUN` (read-only) |
| Remediation Phase 1 Lead (`agency-database-optimizer`) | `87acbaa2-e9a6-49bb-8418-ffaab9b5072e` | `736a40d` -> `fa911ca` | Authored `prisma/migrations/20261128000000_t13_ledger_integrity_and_indexes/migration.sql` & `prisma/schema.prisma` | `prisma validate`, `prisma generate`, `prisma migrate deploy`, `prisma migrate status` (exit `0`) |
| Remediation Phase 2 Lead (`agency-backend-architect`) | `5b4a7383-cd9f-449c-88ef-7b5f5284ce89` | `736a40d` -> `fa911ca` | Hardened `matter-service.ts`, `finance-types.ts`, `finance-http.ts`, `receipt-allocator.ts`, `finance-service.ts`, `next.config.ts`, `sanitize-return-to.ts`, `matters/[id]/page.tsx`, `transactions/[id]/route.ts` | Verified by coordinator lint/typecheck/unit/integration suite on `fa911ca` |
| Remediation Phase 3 Lead (`agency-frontend-developer`) | `92f33952-9a2d-4dcf-9406-11e6f5802d0e` | `736a40d` -> `fa911ca` | Hardened `finance/page.tsx`, `productivity-ui-types.ts`, `globals.css`, `matter-detail-client.tsx`, `finance-workspace.tsx` | Verified by coordinator build & Playwright E2E on `fa911ca` |
| Remediation Phase 4 Lead (`agency-test-automation-engineer`) | `ac094a3a-4c15-48d9-88c2-7894fdad1921` | `736a40d` -> `fa911ca` | Updated `playwright-storage-teardown.ts`, `t13-ui-constants.ts`, `finance-validation.test.ts`, `sanitize-return-to.test.ts`, `migration-upgrade.test.ts`, `t13-finance-ledger.test.ts`, `t13-finance.spec.ts` | Verified by coordinator full test suite on `fa911ca` |
| Post-Fix Audit: Database (`agency-database-optimizer`) | `10941005-9bc4-40f7-94b9-845ff23852ee` | `fa911ca` (read-only) | Confirmed 24 migrations, 22 T13 triggers, 1:1 `feeCharge`, paired dimensions, cross-matter FKs, `TRUNCATE` blocks, & hot indexes | **`CLOSURE_NO_FINDINGS`** (`NOT RUN` — read-only) |
| Post-Fix Audit: AppSec (`agency-application-security-engineer`) | `ea2a94db-bd48-4afa-a293-880621c9de30` | `fa911ca` (read-only) | Confirmed `0 [P0] / 0 [P1] / 0 [P2]`; flagged 1 non-blocking `[P3]` (missing `{ error: '...' }` on base `z.string()` / `z.union()` in `src/modules/finance/finance-types.ts` yields Zod `"Invalid input"` on omitted/wrong-type keys) | **1 `[P3]` non-blocking** (`NOT RUN` — read-only) |
| Post-Fix Audit: Tests & UI (`agency-test-automation-engineer`) | `dc6a9a36-1e3f-4a84-9b17-f3b1e7fe1e34` | `fa911ca` (read-only) | Confirmed E2E/integration/unit isolation, storage regex scope, responsive + print checks, zero skipped/relaxed assertions | **`CLOSURE_NO_FINDINGS`** (`NOT RUN` — read-only) |

## Changed Files (`7c3d09ba..HEAD`)

All `38` implementation/test files below match `git diff --name-status 7c3d09ba28ff678e7f395ec3453d86732ab01dc5..fa911caa17f8895544acc7b3dfa6c6c79ea4de28`, plus `docs/reviews/T13-submission.md` updated in the final report-only attestation commit:

### Added (`24` implementation/test files + `1` submission report)
- `docs/reviews/T13-submission.md`
- `playwright.t13.config.ts`
- `prisma/migrations/20261127000000_t13_balanced_ledger_fees_receipts/migration.sql`
- `prisma/migrations/20261127010000_t13_fee_agreement_status_guard/migration.sql`
- `prisma/migrations/20261128000000_t13_ledger_integrity_and_indexes/migration.sql`
- `src/app/(app)/finance/page.tsx`
- `src/app/api/finance/route.ts`
- `src/app/api/finance/statement/route.ts`
- `src/app/api/finance/agreements/route.ts`
- `src/app/api/finance/agreements/[id]/approve/route.ts`
- `src/app/api/finance/transactions/route.ts`
- `src/app/api/finance/transactions/[id]/route.ts`
- `src/app/api/finance/receipts/[id]/route.ts`
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

### Modified (`14` existing files)
- `next.config.ts` (`NO_STORE_PATHS` extended with `'/finance'` and `'/finance/:path*'`)
- `package.json` (`test:e2e` includes `playwright.t13.config.ts` and `test:e2e:t13`)
- `prisma/schema.prisma` (T13 finance models, 1:1 `MoneyLine.feeCharge`, constraints, indexes, `@default(now())` on `ReceiptSequence.updatedAt`)
- `src/app/(app)/matters/[id]/page.tsx` (UUID-validated `id` for `returnTo` & initial `MatterFinanceSummary` SSR load)
- `src/app/globals.css` (`body:has(#app-shell-modal-root > *) #app-shell-content { display: none !important; }` for `@media print`)
- `src/components/desktop-sidebar.tsx` (shows Finance navigation only for allowed roles, excluding `MAINTAINER`)
- `src/components/tablet-drawer.tsx` (shows Finance navigation only for allowed roles, excluding `MAINTAINER`)
- `src/components/matters/matter-detail-client.tsx` (Finance tab + `focus-visible:ring-2` + `"إعادة المحاولة"` retry on SSR error)
- `src/components/productivity/productivity-ui-types.ts` (`returnFocusRef` + skips `document.body` focus capture/restore in `useAccessibleModal`)
- `src/lib/sanitize-return-to.ts` (`'/finance'` in `ALLOWED_EXACT_ROUTES`)
- `src/modules/matters/matter-service.ts` (`assertNoClientFinancialObligations` on `CLIENT` demotion and party unlinking)
- `tests/helpers/playwright-storage-teardown.ts` (tightened regex `/^(?:lawoffice-t\d+-e2e-)/`)
- `tests/helpers/t04-constants.ts` (aligned nav item helpers/assertions)
- `tests/integration/migration-upgrade.test.ts` (added T13 migration/trigger/index/SQL behavioral upgrade checks)
- `tests/unit/sanitize-return-to.test.ts` (covers `'/finance'` & preserved query parameters)

## Acceptance Matrix (`T13-TC-01` .. `T13-TC-07` per `docs/tasks/T13.md`)

| TC ID | Acceptance Requirement (`docs/tasks/T13.md`) | Verified Test Cases & Coverage |
| --- | --- | --- |
| `T13-TC-01` | Draft fee agreement `15,000` EGP changes no balance; approve `6,000` + `9,000` creates balanced `1,500,000`-piastre obligation. | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-01..03`, `T13-REVIEW-GUARDS`) + `tests/e2e/t13-finance.spec.ts` (`T13-TC-01`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`) |
| `T13-TC-02` | Record `5,000` EGP fee collection toward matching charge -> `10,000` EGP remaining due, balanced `MoneyLine` rows, `PaymentAllocation`, sequential `Receipt`, audit entry, Arabic confirmation, updated statement. | `tests/integration/t13-finance-ledger.test.ts` + `tests/e2e/t13-finance.spec.ts` (`T13-TC-02`) |
| `T13-TC-03` | Retry with same `idempotencyKey` after committed post returns same transaction & receipt; same key with different payload rejects; reprint reuses same `receiptNumber` without new payment/number. | `tests/integration/t13-finance-ledger.test.ts` + `tests/e2e/t13-finance.spec.ts` (`T13-TC-03`) |
| `T13-TC-04` | Concurrent `4,000` collections on `5,000` remaining -> only 1 succeeds (`1,000` remaining, 1 receipt) via scoped `fee_charge` lock; concurrent draft edit vs approval resolves cleanly with `CONCURRENCY_CONFLICT` / `ALREADY_POSTED` and zero deadlocks. | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-04`, `T13-TC-04b`) |
| `T13-TC-05` | Negative validation: zero/negative/float amounts, mismatched debtor/matter, unbalanced/empty `lines`, excess overpayment without implicit advance, unimplemented `OFFICE_EXPENSE`, DB/HTTP `409` edit/delete rejection on posted ledger/approved/cancelled agreements/receipts. | `tests/unit/finance-validation.test.ts` (8 tests) + `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-05`) |
| `T13-TC-06` | Audit-log failure rolls back ledger, allocations, receipt, sequence & idempotency; unauthenticated/`MAINTAINER` requests receive `401`/`403`; Finance nav item hidden in both desktop sidebar (`1440px`) and tablet/mobile drawer (`768px`/`390px`). | `tests/integration/t13-finance-ledger.test.ts` (`T13-TC-06`, HTTP `413` & `Sec-Fetch-Site` checks) + `tests/e2e/t13-finance.spec.ts` (`T13-TC-06`, `T13-AUTH-REDIRECT`) |
| `T13-TC-07` | UI verification: Arabic RTL matter Finance tab across `1440px`, `768px`, `390px`, `200%` text zoom, `Tab`/`Escape` focus management, `@media print` receipt view, and standalone `/finance` workspace; zero client-document/storage leaks. | `tests/e2e/t13-finance.spec.ts` (`T13-TC-01..03`, `T13-TC-06` `@responsive`, `T13-TC-07` `@responsive @a11y`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`) |

## Verification Commands & Observed Results (After Final Code Edit `fa911ca`)

All commands ran in `D:/Lawyer/work/t13-gemini` against commit `fa911caa17f8895544acc7b3dfa6c6c79ea4de28` with synthetic test data only:

1. `git diff --check` -> **exit `0`** (no whitespace errors)
2. `npx prisma validate && npx prisma generate` -> **exit `0`**
3. `npx prisma migrate deploy` & `npx prisma migrate status` (against `lawoffice_test`) -> **exit `0`** (`24 migrations found in prisma/migrations`, database schema up to date)
4. `npm.cmd run lint` -> **exit `0`**
5. `npm.cmd run typecheck` -> **exit `0`**
6. `npm.cmd run test` -> **exit `0`**: **`24/24` files passed, `377/377` unit tests passed** (`finance-validation.test.ts`: `8/8`, `sanitize-return-to.test.ts`: `32/32`)
7. `$env:NODE_ENV='production'; npm.cmd run build` -> **exit `0`**: Next.js production build succeeded across **`33`** routes (`/finance` dynamic `ƒ`)
8. `npx.cmd vitest run --no-file-parallelism tests/integration` -> **exit `0`**: **`39/39` files passed, `383/383` real PostgreSQL integration tests passed** (`468.76s`; `migration-upgrade.test.ts`: `28/28`, `t13-finance-ledger.test.ts`: `9/9`)
9. `npm.cmd run test:e2e` -> **exit `0`**: **`11/11` Playwright configs passed, `181/181` E2E tests passed** (`t03`: `28/28` `1.0m`, `t04`: `46/46` `56.0s`, `t05`: `14/14` `47.6s`, `t06`: `28/28` `1.4m`, `t07`: `16/16` `1.1m`, `t08`: `10/10` `49.5s`, `t09`: `10/10` `53.8s`, `t10`: `8/8` `36.3s`, `t11`: `6/6` `40.3s`, `t12`: `6/6` `52.9s`, `t13`: `9/9` `42.6s`)
10. `Test-Path D:/Lawyer/work/t13-gemini/storage` -> **`False`** (zero leaked E2E storage directories after suite teardown)

## Manual Demo Steps and Observations

- Verified interactively and via automated Playwright runs (`playwright.t13.config.ts`) in Arabic RTL (`dir="rtl"`, Cairo date/time, `<bdi dir="ltr">` isolated numeric figures):
  - Created and edited a `DRAFT` fee agreement from the matter Finance tab and standalone `/finance` selector, confirming summary totals remain `0.00 ج.م` until explicit approval.
  - Approved a multi-client fee agreement (`6,000` + `9,000` EGP = `15,000` EGP) and recorded a `5,000` EGP collection with live client balance updates (`10,000` EGP remaining) and Arabic receipt preview/print rendering (`@media print` hides shell chrome and renders only `#app-shell-modal-root`).
  - Reprinted the issued receipt, confirming `receiptNumber` permanence and zero duplicate ledger transactions.
  - Verified `MAINTAINER` sees no Finance nav link in either desktop sidebar or mobile/tablet drawer and receives HTTP `403` on finance endpoints.

## Screenshots / Sample PDF Paths

- Automated Playwright runs capture screenshot attachments into ephemeral, gitignored `test-results/t13/` via `testInfo.attach` on `@responsive` / `@a11y` / print tests (`T13-TC-06`, `T13-TC-07`). No screenshots or real client PDFs are committed to Git.
- Sample PDF binary generation: `NOT RUN` (out of scope for T13; T13 delivers HTML/CSS `@media print` receipts inside the printable modal portal, while Playwright PDF binary export belongs to T16/later document templates).

## Schema / Data Migrations

- `prisma/migrations/20261127000000_t13_balanced_ledger_fees_receipts/migration.sql` — Core T13 models (`FeeAgreement`, `FeeCharge`, `MoneyAccount`, `MoneyTransaction`, `MoneyLine`, `PaymentAllocation`, `Receipt`, `ReceiptSequence`), composite unique/FK constraints, balanced ledger `DEFERRABLE` trigger, and immutability triggers.
- `prisma/migrations/20261127010000_t13_fee_agreement_status_guard/migration.sql` — Prevents mutating approved fee agreements and blocks non-`DRAFT` activation shortcuts.
- `prisma/migrations/20261128000000_t13_ledger_integrity_and_indexes/migration.sql` — Hardens ledger immutability & multi-layer DB invariants:
  - `trg_money_account_immutable` & `trg_receipt_sequence_immutable` (rejects `UPDATE`/`DELETE` on immutable account identity and monotonic sequence history).
  - `trg_finance_table_no_truncate()` across all 8 T13 finance tables (`BEFORE TRUNCATE`).
  - Paired dimension check (`money_line_dimensions_paired_check`), cross-matter/client integrity triggers (`trg_money_account_integrity`, `trg_money_line_integrity`, `trg_fee_agreement_integrity`, `trg_fee_charge_integrity`), and 1:1 `MoneyLine.feeCharge`.
  - Recreated `trg_money_line_balanced` (`AFTER INSERT OR UPDATE OR DELETE DEFERRABLE INITIALLY DEFERRED`).
  - `fee_agreement` 3-state & `CANCELLED` immutability triggers, `ON DELETE RESTRICT` on `money_transaction_idempotency_record_id_fkey`, receipt format & year checks, and 6 hot query/FK indexes.
- Migration upgrade path verified cleanly in `tests/integration/migration-upgrade.test.ts` (all `24` migrations from empty schema + `22` T13 triggers + `9` T13 indexes).

## Security & Privacy Effects

- **Origin & CSRF / Request Guards** (`src/modules/finance/finance-http.ts`): `verifyFinanceReadOrigin` and `verifyFinanceMutationOrigin` enforce same-origin + `Sec-Fetch-Site` allowlist (`same-origin` / `none`), bounded `readFinanceJsonBody` enforces a `128 KB` limit returning HTTP `413` (`PAYLOAD_TOO_LARGE`), and `FINANCE_NO_STORE_HEADERS` emits `Cache-Control: no-store` plus strict CSP (`default-src 'none'`).
- **Route & Navigation Hardening**: `next.config.ts` adds `'/finance'` and `'/finance/:path*'` to `NO_STORE_PATHS`; `src/lib/sanitize-return-to.ts` whitelists `'/finance'` with safe parameter validation; `src/app/(app)/finance/page.tsx` and `src/app/(app)/matters/[id]/page.tsx` validate UUID parameters before passing `returnTo` or rendering.
- **Authorization & Domain Guards**: Finance routes allow `OWNER`, `LAWYER`, and `SECRETARY` (denying `MAINTAINER` and unauthenticated users with `403`/`401`), preserve `billingEnabled` advisory-only until T15c, and `matter-service.ts` (`assertNoClientFinancialObligations`) blocks unlinking or demoting a `CLIENT` who holds active `FeeAgreement`s, `FeeCharge`s, `PaymentAllocation`s, `Receipt`s, or `MoneyLine`s.
- **AppSec Post-Fix Confirmation (`ea2a94db`)**: `0 [P0] / 0 [P1] / 0 [P2]`; 1 non-blocking `[P3]` disclosed below.

## Rollback / Recovery Notes

- Because PR #25 is unmerged and T13 tables do not hold production client records, rollback before merge closes PR #25 and reverts branch `feature/t13-fees-collections`.
- Once T13 migrations are applied to an environment, preserve additive schema integrity or restore from coordinated PostgreSQL pre-upgrade dump/checkpoint rather than hand-dropping ledger triggers (`BEFORE TRUNCATE` and immutability triggers enforce audit preservation).

## Known Limitations / `NOT RUN` Checks

1. **Remaining Non-Blocking `[P3]` Finding (AppSec `ea2a94db`)**: In `src/modules/finance/finance-types.ts`, base `z.string()` / `z.union()` primitives prior to `.uuid()` / union branches omit `{ error: '...' }`, so missing keys or non-string/wrong-type JSON values return Zod 4's English default `"Invalid input"` instead of an Arabic validation message. Valid types, empty strings, bad UUIDs, invalid amounts, and business rules all return Arabic messages. Kept unedited on `fa911ca` so the full `377` unit + `383` PG + `181` E2E verification and 3 post-fix audits remain anchored to an unchanged commit.
2. **Standalone `/finance` Responsive Matrix**: The `390px` / `768px` / `1440px` + `200%` zoom + `@media print` responsive E2E assertions (`T13-TC-06`, `T13-TC-07`) ran on the Matter Finance tab (`/matters/[id]`) and `MAINTAINER` navigation drawer, while standalone `/finance` OWNER workflow E2E tests (`T13-TC-01..03`, `T13-AUTH-REDIRECT`, `T13-DRAFT-EDIT-AND-2CLIENT-EXCESS`) executed at desktop `1440px`. Both screens render the shared `FinanceWorkspace` component.
3. **Out-of-Scope / Later-Task Items (`NOT RUN`)**: Reimbursable expenses (`T14`), client advances & retainers (`T15a`), corrections/reversals/refunds (`T15b`), office billing-enabled gating (`T15c`), Playwright binary PDF rendering & ClamAV attachment scanning (`T16+`), and full production backup/restore drills (`T19`).
4. **GitHub Actions CI**: Triggered upon pushing this report-only update commit; final remote workflow status reported with the push verification.
