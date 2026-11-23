# LawOffice OS Task T09 Submission — Manually Confirmed Deadlines, Tasks, and the Agenda

**Task ID:** T09 — Manually confirmed deadlines, tasks, and the agenda  
**Date:** 2026-11-23  
**Canonical Origin:** `https://github.com/MohamedAlksas/LawyerOS.git`  
**Worktree & Branch:** `D:/Lawyer/work/t09-gemini` on `feature/t09-deadlines-tasks`  
**Base Commit (origin/main):** `26249e1ec24eb57edbcf6805d01e646ef4887f53`  
**Final Implementation SHA:** `0eaf6a0ada89ea510ed0334f031a0b9fff1f81a8`  
**Report-Only Attestation Note:** This submission document (`docs/reviews/T09-submission.md`) is committed on top of `0eaf6a0ada89ea510ed0334f031a0b9fff1f81a8` with zero code/test/config edits.  
**Predecessor Status Note:** PR #17 (T08) was squash-merged into `origin/main` at `26249e1ec24eb57edbcf6805d01e646ef4887f53` by the project owner, and work proceeded on explicit owner instruction. `docs/reviews/T08-review.md` is not present in the `origin/main` tree (`D:/Lawyer/docs/reviews/T08-review.md` in the root checkout reflects an earlier `CHANGES_REQUESTED` snapshot prior to PR #17 finalization and merge).

---

## 1. Summary of Behavior Delivered

Task T09 extends LawOffice OS with manually confirmed legal deadlines (`Deadline`), standalone and linked operational tasks (`Task` reusing T08's table), Cairo-anchored agenda views (`/today`, `/agenda`), and expanded archive guards — preserving Arabic RTL (`lang="ar-EG"`, `dir="rtl"`) and strict privacy (`Cache-Control: private, no-store`, zero confidential browser storage).

1. **Pure Cairo Calendar & DST Utilities (`src/lib/cairo-date.ts`):**
   - Server/client-safe `Africa/Cairo` calendar-day computation (`getCairoTodayDateString`, `addCairoDays`, Sat–Fri `getCairoWeekRange`, `getCairoMonthRange`, `isCairoDateOverdue`, `validateOptionalCalendarTime`, `formatTimeOrUnspecified`).
   - Ensures calendar-day `@db.Date` rows remain identical across `Africa/Cairo` and non-Cairo (`America/New_York`) browser profiles across Cairo midnight and DST transitions.

2. **Legal Deadlines (`src/modules/scheduling/deadline-*`):**
   - `createDeadline` (`DRAFT`), `updateDeadlineDraft`, `confirmDeadline` (`DRAFT -> CONFIRMED` requiring `dueDate`, `source`, `basisNotes`, and explicit lawyer confirmation `«راجعت الموعد واعتمدته»`), `changeDeadlineDate` (requires reason if `CONFIRMED`, clears reviewer/confirmation metadata, returns to `DRAFT`, cancels `PENDING` reminder `JobRun` rows), `completeDeadline` (`CONFIRMED -> COMPLETED` requiring `completionDescription` + `completedDate`), and `cancelDeadline` (`DRAFT`/`CONFIRMED` -> `CANCELLED` with reason + `JobRun` cancellation).
   - Never derives or auto-confirms appeal/legal deadlines from hearing results (`T09-TC-07`).
   - Enforces `Matter -> Proceeding -> Deadline` `FOR UPDATE` row locks, same-matter validation, `expectedVersion` optimistic concurrency, scoped `IdempotencyRecord` claims, and atomic `AuditEvent` + `JobRun` (`deadline_reminder_<id>_v<version>`) persistence inside `prisma.$transaction`.
   - Rejects deferred `sourceDocumentId` / `evidenceDocumentId` with `VALIDATION_ERROR` until T12 introduces the `Document` table.

3. **Productivity Module — Tasks & Agenda (`src/modules/productivity/*`):**
   - Extends T08's `Task` model cleanly (`matterId` nullable for standalone tasks, optional `deadlineId`, `details`, `dueTime` with SQL CHECK enforcing `due_date IS NOT NULL` when `due_time` is set, `IN_PROGRESS` status, `completedAt`/`completedById`).
   - `completeTask` updates only the task and never completes or modifies any linked `Deadline`.
   - `getTodayOverview` (S02) and `listAgenda` (S07) support `today`, `list`, `day`, `week`, and `month` views with court & type filters, separating timed hearings, unknown-time items (`«الساعة غير محددة»`, never grouped at `00:00`), `DRAFT` deadlines (`«مواعيد تحتاج مراجعة»`), confirmed/overdue deadlines, dated/overdue tasks, undated tasks (`agenda-undated-tasks-group`), and same-day court conflicts.
   - Truthful `operatingAlerts` report real counts without claiming T10 background reminder delivery or T19 backup telemetry.

4. **Archive Guards & Client Search Fix (`src/modules/matters/matter-service.ts`):**
   - Enabled open `CONFIRMED` legal deadline checks (`status: 'CONFIRMED', completedAt: null`) inside `archiveMatter` and `archiveProceeding` alongside scheduled hearing checks (`ActiveObligationError`).
   - Fixed `searchMatterClients` (`src/modules/matters/matter-service.ts:2912`) so non-phone text queries containing letters plus digits (e.g., `"لا يوجد اسم مطابق yuq4f"`) do not match unrelated client phone substrings.

5. **Arabic RTL Screens & Navigation (`src/app/(app)/{today,agenda,tasks,deadlines}`, `src/components/{productivity,deadlines,matters}/*`, `next.config.ts`):**
   - Implemented `/today` (S02), `/agenda` (S07 with Arabic A4 `@media print` header & Cairo timestamp), `/tasks` (S08a), `/deadlines` (S08b), and Matter detail `«المهام والمواعيد»` tab (`tab-tasks-deadlines`).
   - Added `/today`, `/agenda`, `/tasks`, `/deadlines`, `/deadlines/:path*` to `NO_STORE_PATHS` and enforced `requireActor({ requiredPermission: 'READ_CLIENT_DATA' })` and generic static page titles.
   - Preserved in-memory frozen `idempotencyKey` retry / conflict notices and fixed `src/components/matters/matter-detail-client.tsx` so lifecycle modal frozen-retry banners render only after HTTP submission settles (`!isLifecycleSubmitting` / `!isProceedingLifecycleSubmitting`).

---

## 2. Skills Loaded

| Skill | Actual Path Read | Task Application |
|---|---|---|
| `lawoffice-delivery` | `D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` | Task scoping, native agent delegation workflow, report attestation discipline. |
| `lawoffice-domain` | `D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` | Same-matter invariants, manual deadline confirmation, `JobRun` outbox atomicity, archive obligation guards. |
| `lawoffice-arabic-ui` | `D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` | Arabic RTL (`ar-EG`), `«الساعة غير محددة»`, distinct task/deadline controls, offline/error/conflict UX, zero browser storage caching. |
| `lawoffice-testing` | `D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` | Real PostgreSQL tests (`T09-TC-01`..`07`), DST/Cairo clock tests, migration upgrade check, responsive & a11y browser checks. |
| `ponytail` (full mode) | `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail/SKILL.md` | Smallest complete diff reusing T08 `Task`/`JobRun`, omitting unrequested speculative tables (`TaskChecklistItem`). |

---

## 3. Slice Routing & Native Agency Agent Evidence

**Slice Routing Decision:** Retained default T09 routing from `docs/AGENCY_AGENT_ROUTING.json` (`agency-backend-architect` lead + `agency-frontend-developer` + `agency-test-automation-engineer`).

| Role / Profile | Native Conversation ID | Definition Path | Loaded Profile Path / YAML Name / SHA-256 | Owned / Examined Paths | Inspected SHA(s) | Key Findings, Actions & Reconciliation |
|---|---|---|---|---|---|---|
| **Lead Backend Architect** (`agency-backend-architect`) | `fd1afd3d-8531-419c-81c3-7f4508fef77e` | `.agents/agents/agency-backend-architect.md` | `.agents/skills/engineering-backend-architect/SKILL.md`<br>YAML: `agency-backend-architect`<br>SHA-256: `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` (no drift) | `prisma/schema.prisma`, `prisma/migrations/20261123000000_*`, `src/lib/cairo-date.ts`, `src/modules/scheduling/*`, `src/modules/productivity/*`, `src/modules/matters/matter-service.ts`, `src/app/api/{today,agenda,tasks,deadlines}/**`, unit & PG integration tests | `26249e1` (preflight)<br>`17f34f5` (reconciliation)<br>`6558573` (targeted search fix) | Delivered T09 schema/migration, Cairo DST utils, Deadline/Task/Agenda services & HTTP APIs, archive guards; fixed `searchMatterClients` mixed text+digit phone-matching bug; reconciled Phase 3 & Phase 4 with **ACCEPT** (0 P0/P1/P2 defects). |
| **Supporting Frontend Developer** (`agency-frontend-developer`) | `6e57e005-a05d-4abf-a570-a6e0d9ab7a71` | `.agents/agents/agency-frontend-developer.md` | `.agents/skills/engineering-frontend-developer/SKILL.md`<br>YAML: `agency-frontend-developer`<br>SHA-256: `69D473C132831E0861BBF3CC50BB933C1DC231D74872B08731C3B453D79925F0` (no drift) | `next.config.ts`, `src/app/(app)/{today,agenda,tasks,deadlines}/page.tsx`, `src/app/(app)/matters/[id]/page.tsx`, `src/components/{productivity,deadlines}/*`, `src/components/matters/matter-detail-client.tsx`, `src/components/{desktop-sidebar,tablet-drawer}.tsx` | `26249e1` (preflight)<br>`36d4a57` (UI build)<br>`17f34f5` (lifecycle modal fix) | Built S02/S07/S08 Arabic RTL routes, print view, Matter detail tab, and navigation updates; fixed premature frozen-retry banner rendering in `matter-detail-client.tsx` modals while submitting (`ee5913d`). |
| **Supporting Test Automation Engineer** (`agency-test-automation-engineer`) | `9fcbb669-a6fe-42f8-890c-fa805bf3cd7c` | `.agents/agents/agency-test-automation-engineer.md` | `.agents/skills/testing-test-automation-engineer/SKILL.md`<br>YAML: `agency-test-automation-engineer`<br>SHA-256: `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` (no drift) | `package.json`, `playwright.config.ts`, `playwright.t09.config.ts`, `tests/helpers/t04-constants.ts`, `tests/e2e/t04-04-accessibility-keyboard.spec.ts`, `tests/e2e/t09-deadlines-tasks-agenda.spec.ts` | `26249e1` (preflight)<br>`e9ca65c` (E2E suite) | Authored Playwright T09 E2E config/suite (9/9 pass); promoted T09 routes in `t04-constants.ts`; caught and fixed T04-04 8-Tab limit (`tabThrough(page, 14)`) and `playwright.config.ts` `testIgnore` so `test:e2e:t04` passes 46/46. |

---

## 4. Acceptance Test Matrix (`T09-TC-01` through `T09-TC-07`)

All tests ran against isolated PostgreSQL (`lawoffice_t08_test` on `127.0.0.1:5433`, plus temporary isolated DB for fresh migration check) using synthetic fixtures only.

| Case ID | Level | Setup & Steps Exercised | Observed Result | Command & Exit | Evidence Reference |
|---|---|---|---|---|---|
| **T09-TC-01** | PG + Browser | Matter + undated `DRAFT` deadline. Attempt confirm without date/source/basis/checkbox; then submit valid date, source, basis notes, and `«راجعت الموعد واعتمدته»`. | Incomplete draft creates 0 `JobRun` rows; invalid confirm rejected; valid confirm records reviewer, timestamp, `CONFIRM_DEADLINE` audit, 1 `PENDING` `JobRun`, and moves item to confirmed list in UI & PG. | `npm.cmd run test:e2e:t09` (exit `0`)<br>`vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `tests/integration/t09-deadlines-tasks-agenda.test.ts`<br>`tests/e2e/t09-deadlines-tasks-agenda.spec.ts` |
| **T09-TC-02** | PG | Confirmed deadline with `PENDING` `JobRun`. Change date with reason; retry stale `expectedVersion`; check outbox before and after re-confirmation. | Date change requires reason, returns status to `DRAFT`, clears confirmation metadata, sets old `JobRun` to `CANCELLED`, rejects stale `expectedVersion` (`ConcurrencyConflictError`), rejects same-key payload mismatch, and creates versioned `_v4` `JobRun` only after explicit reapproval. | `vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `tests/integration/t09-deadlines-tasks-agenda.test.ts` |
| **T09-TC-03** | PG + Browser | Undated task + confirmed deadline on same Matter. Reject `dueTime` without `dueDate`; create & complete undated task; try completing deadline without description/date, then complete with execution details. | Undated task saves cleanly; time-without-day fails validation in UI/API and SQL CHECK; `completeTask` leaves linked `Deadline` `CONFIRMED`; deadline completion requires description + date and writes `COMPLETE_DEADLINE` audit while cancelling `JobRun`. | `npm.cmd run test:e2e:t09` (exit `0`)<br>`vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `tests/integration/t09-deadlines-tasks-agenda.test.ts`<br>`tests/e2e/t09-deadlines-tasks-agenda.spec.ts` |
| **T09-TC-04** | Unit + PG + Browser | Frozen clocks at Cairo midnight & spring DST (`2027-04-30`), plus `Africa/Cairo` and `America/New_York` Playwright browser profiles viewing `/agenda` (`day`/`week`/`month`) and `/today`. | Calendar days stay identical in Cairo and New York browsers; unknown times render under `«الساعة غير محددة»` (`agenda-unknown-time-group`); undated tasks render under `agenda-undated-tasks-group`; advancing clock marks past confirmed deadlines `isOverdue`; same-day court conflicts warned. | `npm.cmd run test` (exit `0`)<br>`npm.cmd run test:e2e:t09` (exit `0`) | `tests/unit/cairo-date.test.ts`<br>`tests/integration/t09-deadlines-tasks-agenda.test.ts`<br>`tests/e2e/t09-deadlines-tasks-agenda.spec.ts` |
| **T09-TC-05** | PG | Two Matters, cross-matter links, `archiveMatter`/`archiveProceeding` with open `CONFIRMED` deadline, SQL CHECK & `_faultInject` audit/outbox rollback, concurrent `confirmDeadline` race, fresh + T08->T09 upgrade. | Cross-matter links throw `CrossMatterLinkForbiddenError`; archive guards throw `ActiveObligationError`; fault injection rolls back all rows; clean retry succeeds; fresh + T08->T09 migrations pass. | `vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `tests/integration/t09-deadlines-tasks-agenda.test.ts` |
| **T09-TC-06** | HTTP + Browser | Unauthenticated, `MAINTAINER`, and `OWNER` actors across `/api/{today,agenda,tasks,deadlines}` and UI routes (`/today`, `/agenda`, `/tasks`, `/deadlines`, `/matters/[id]`) at `390px`, `768px`, `1440px` + 200% scale. | Unauthenticated blocked (`401`/redirect); `MAINTAINER` blocked (`403`/`«وصول مرفوض»`); `Cache-Control: private, no-store`; zero sensitive data in `localStorage`/`sessionStorage`/`IndexedDB`; populated/empty/offline/500 retry, A4 print view, keyboard focus trap & Escape restore, and reflow pass. | `npm.cmd run test:e2e:t09` (exit `0`)<br>`vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `test-results/t09/t09-390.png`<br>`test-results/t09/t09-768.png`<br>`test-results/t09/t09-1440.png`<br>`test-results/t09/t09-agenda-print.png` |
| **T09-TC-07** | PG | `Proceeding` with `DRAFT` manual deadline; record and correct `HearingResult`. | `recordHearingResult` and `correctHearingResult` leave existing `DRAFT` deadline dates/status untouched and derive zero automatic appeal dates or confirmations. | `vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts` (exit `0`) | `tests/integration/t09-deadlines-tasks-agenda.test.ts` |

---

## 5. Verification Commands Executed & Real Exits

### On Final Implementation SHA `6558573b7c353c7c6bad769d5fb44b58b261a0bc`

| Command | Exit Code | Observed Result |
|---|:---:|---|
| `npm.cmd run lint` | `0` | Clean (`eslint .`, 0 errors, 0 warnings) |
| `npm.cmd run typecheck` | `0` | Clean (`tsc --noEmit`) |
| `npm.cmd run test` | `0` | **20/20 files, 312/312 unit tests passed** (`cairo-date.test.ts` 5/5) |
| `npm.cmd run build` | `0` | Next.js 16.4.6 Turbopack production build succeeded (43 routes compiled) |
| `npx.cmd vitest run tests/integration/t09-deadlines-tasks-agenda.test.ts tests/integration/matter-search-archiving.test.ts tests/integration/matter-transport-auth.test.ts` | `0` | **3/3 files, 41/41 real PG integration tests passed** (`matter-transport-auth` 14, `t09` 8, `matter-search-archiving` 19) |
| `npm.cmd run test:e2e:t07` | `0` | **16/16 passed** (`desktop-1440`, `tablet-768`, `mobile-390`) |
| `npm.cmd run test:e2e:t08` | `0` | **17/17 passed** (`desktop-1440`, `tablet-768`, `mobile-390`, `cairo-profile`, `newyork-profile`) |
| `npm.cmd run test:e2e:t09` | `0` | **9/9 passed** (`desktop-1440`, `tablet-768`, `mobile-390`, `cairo-profile`, `newyork-profile`) |
| `git diff --check` | `0` | Clean (no trailing whitespace / conflict markers) |

### Prior Comprehensive Run on `17f34f5463a5217a9ee2a36d21db573354cede73` (before UI-only fix `ee5913d` & 1-line `searchMatterClients` guard `6558573`)

| Command | Exit Code | Observed Result |
|---|:---:|---|
| `npm.cmd run test:integration` | `0` | **35/35 files, 333/333 integration tests passed** (`451.81s`) |
| `npm.cmd run test:e2e:t03` | `0` | **60/60 passed** |
| `npm.cmd run test:e2e:t04` | `0` | **46/46 passed** |
| `npm.cmd run test:e2e:t05` | `0` | **22/22 passed** |
| `npm.cmd run test:e2e:t06` | `0` | **66/66 passed** |

---

## 6. Migrations, Dependencies & Limits

- **Migration Path:** `prisma/migrations/20261123000000_t09_deadlines_tasks_agenda/migration.sql`
  - Adds `IN_PROGRESS` to `TaskStatus`; makes `task.matter_id` nullable while retaining existing rows; adds `deadline_id`, `details`, `due_time`, `completed_at`, `completed_by_id`, indexes, and `task_due_time_requires_due_date_check`.
  - Creates `DeadlineStatus` and `deadline` with `deadline_due_time_requires_due_date_check`, `deadline_confirmed_fields_check`, `deadline_completed_fields_check`, and supporting indexes.
  - Safe deployment: `npx.cmd prisma migrate deploy`. Tested on both a fresh database and a populated T08 schema upgrade inside `tests/integration/t09-deadlines-tasks-agenda.test.ts`.
- **Future Task Dependencies (Explicitly Out of Scope in T09):**
  - **T10 (Reminder Worker):** T09 atomically creates/cancels durable `JobRun` (`REMINDER_DELIVERY`) records; no polling worker, lease claiming, email/push dispatch, or `ReminderDelivery` dispatch occurs in T09.
  - **T12 (Documents):** `Deadline.sourceDocumentId` is stored as a nullable field; passing a non-null ID is rejected with `VALIDATION_ERROR` until T12 introduces the `Document` table and FK constraints.
- **`NOT RUN` Limits:**
  - Full 35-file `npm.cmd run test:integration` and `test:e2e:t03..t06` were not re-executed after `ee5913d`/`6558573` (no auth/T03/T04/T05/T06 files changed after `17f34f5`; `t07`, `t08`, `t09`, and all targeted T06/T07/T09 integration tests ran and passed on `6558573`).
  - Native screen reader AT walkthroughs and live HTTPS production mobile testing remain outside local automated Playwright runs.
