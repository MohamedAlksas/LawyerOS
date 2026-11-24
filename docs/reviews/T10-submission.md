# LawOffice OS Task T10 Submission — Durable Reminders, Worker Leases, and the In-App Inbox

**Task ID:** T10 — Durable reminders, worker leases, and the in-app inbox
**Date:** 2026-11-24
**Canonical Origin:** `https://github.com/MohamedAlksas/LawyerOS.git`
**Worktree & Branch:** `D:/Lawyer/work/t10-gemini` on `feature/t10-reminders`
**Base Commit (`origin/main`):** `dedbf40f15922cfd07dad856659db83b881e1cf2`
**Review Checkpoint SHA:** `03be778503147e9051ed516e10a551227f2f35c1`
**Final Implementation SHA:** `33cfc9fa4a08fd0680497c1ff9cda2022aec4c51`
**Report-Only Attestation Note:** This submission document (`docs/reviews/T10-submission.md`) is committed on top of `33cfc9fa4a08fd0680497c1ff9cda2022aec4c51` with zero code, schema, test, or configuration edits.
**Predecessor Status Note:** `docs/reviews/T09-review.md` does not exist on `origin/main`. T09 (`7f419b2`, PR #18) and its CI origin fix (`dedbf40`, PR #19) were merged into `origin/main` by the project owner, delivered T09 source/migrations (`src/modules/scheduling/deadline-service.ts`, `src/modules/productivity/productivity-service.ts`, `prisma/migrations/20261123000000_t09_deadlines_tasks_agenda/migration.sql`) were verified present on `dedbf40`, and work proceeded on the project owner's explicit start authorization.

---

## 1. Summary of Behavior Delivered

Task T10 implements durable PostgreSQL-backed reminder outbox/queue processing, expiring worker leases with bounded retry/backoff, live source recheck before delivery, configurable `Africa/Cairo` reminder policies, `RESTORE_MODE` dispatch blocking, and the Arabic RTL in-app inbox (`/inbox`) without adding Redis or external infrastructure:

1. **Backwards-Compatible Schema & Non-Destructive Migration (`prisma/schema.prisma`, `prisma/migrations/20261124000000_t10_durable_reminders_worker_inbox/migration.sql`):**
   - Extended `JobRunStatus` (`PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`) and `JobRun` (`source_version`, `payload_version`, `attempt_count`, `max_attempts`, `available_at` backfilled from `scheduled_at` for existing T08/T09 rows, `next_attempt_at`, `lease_until`, `locked_by`, `completed_at`, `last_error`, SQL CHECK constraints, and `[status, available_at, lease_until]` index).
   - Added `ReminderRule` (`HEARING`/`DEADLINE`/`TASK`, `IN_APP`, SQL CHECK constraints on `day_offset` `0..365` and `HH:mm` format, idempotently seeded defaults `7, 3, 1` days @ `09:00` for Hearings/Deadlines and `1` day @ `09:00` for Tasks), `ReminderDelivery` (`PENDING`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED`, unique `(source_type, source_id, source_version, rule_key, channel, recipient_user_id)` with `map: "reminder_delivery_source_rule_channel_recipient_key"`), and `WorkerHeartbeat`.
2. **Cairo Reminder Instant & Redaction (`src/lib/cairo-date.ts`, `src/lib/env.ts`):**
   - `computeCairoReminderInstant(eventDateYmd, dayOffset, reminderTimeHHmm)` converts `Africa/Cairo` wall-clock reminder times to UTC `Date` across spring/fall DST transitions without mutating unknown `Hearing.hearingTime` values.
   - `isWorkerDispatchDisabled()` enforces `RESTORE_MODE` / `REMINDER_DISPATCH_DISABLED`; `redactErrorMessage()` strips connection URLs, credentials, bearer/JWT tokens, key-value secret fields, and hex/base64 blobs before persisting or logging errors.
3. **Outbox Integration & Durable Worker (`src/modules/reminders/reminder-outbox.ts`, `src/worker/reminder-worker.ts`, `src/worker/index.ts`):**
   - `hearing-service.ts`, `deadline-service.ts`, and `productivity-service.ts` preserve T08/T09's single primary `PENDING` `JobRun` contract (`hearing_reminder_<id>`, `deadline_reminder_<id>_v<version>`) while tracking active `Task` reminders and cancelling both `PENDING` and `RUNNING` obsolete jobs upon date change, rescheduling, cancellation, or completion.
   - `claimOrRetireNextReminderJob` uses atomic `FOR UPDATE SKIP LOCKED` claims, fences expired `RUNNING` holders (`status = 'RUNNING' AND locked_by = workerId`), retires expired max-attempt poison-pill jobs to `FAILED` without cutting off queued healthy jobs, evaluates live source eligibility + `dueDate` changes before delivery (`Hearing` `SCHEDULED`, `Deadline` `CONFIRMED`, `Task` `OPEN|IN_PROGRESS`), inserts `ReminderDelivery` (`status: 'SENT'`, `readAt: null`) and chains any remaining future rule offsets inside `prisma.$transaction`.
   - In `RESTORE_MODE` / `REMINDER_DISPATCH_DISABLED`, `runReminderWorkerTick` records `WorkerHeartbeat` (`restoreMode: true`) and claims/delivers 0 jobs. `src/worker/index.ts` exposes `npm run worker` with graceful `SIGINT`/`SIGTERM` cleanup and redacted fatal startup error reporting.
4. **Inbox Service, HTTP APIs & Arabic RTL UI (`src/modules/reminders/*`, `src/app/api/reminders/*`, `src/app/(app)/inbox/page.tsx`, `src/components/reminders/inbox-view.tsx`, `src/components/productivity/today-view.tsx`):**
   - `listInbox`, `markReminderRead` (updates `readAt` only; never completes linked tasks/deadlines), `retryFailedReminderJob` (audited `RETRY_REMINDER_JOB` with scoped idempotency), `listReminderRules`, and `updateReminderRule` (with optimistic `expectedVersion` checks).
   - Authenticated routes (`/api/reminders/inbox`, `/api/reminders/inbox/[id]/read`, `/api/reminders/jobs/[id]/retry`, `/api/reminders/rules`) enforce `requireActor`, `Origin`/`sec-fetch-site`, and `Cache-Control: private, no-store`; `/inbox` and `/inbox/:path*` added to `NO_STORE_PATHS` (`next.config.ts`), `DesktopSidebar`, and `TabletDrawer` (retaining 6 items in `MobileBottomNav`).
   - Arabic RTL `/inbox` UI renders worker status/last refresh/errors, failed job retries, unread/read/overdue separation, policy editor, offline/error retry handling, and an explicit Arabic disclosure that closed-app/offline mobile notifications are not guaranteed; `/today` `operatingAlerts` exposes live unread/failed reminder counts and a link to `/inbox`.

---

## 2. Skills Loaded

| Skill | Actual Path Read | Task Application |
|---|---|---|
| `lawoffice-delivery` | `D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md` | Isolated worktree execution, explicit predecessor bypass escalation, native Agency subagent delegation, checkpoint freeze, and honest submission reporting. |
| `lawoffice-domain` | `D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md` | Reusing PostgreSQL `JobRun` outbox without Redis/second bus, preserving unknown hearing time, version/source recheck, and `SENT` vs `readAt` separation. |
| `lawoffice-arabic-ui` | `D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md` | Formal Arabic RTL `/inbox` (`ar-EG`, `dir="rtl"`, `<bdi dir="ltr">`), explicit closed-app/offline delivery notice, zero client sensitive storage, 390/768/1440 + 200% zoom reflow. |
| `lawoffice-testing` | `D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md` | Controlled clock DST tests, real PG worker lease races, fault injection, `RESTORE_MODE`, secret-redaction assertions, migration upgrade check, and real browser verification. |
| `ponytail` (full mode) | `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail/SKILL.md` | Smallest complete diff preserving T08/T09 outbox tests, reusing `readSchedulingFromRequest` / `writeSchedulingFromRequest`, skipping unrequested email/push/Redis infra. |

---

## 3. Native Agency Agent Execution Evidence

**Slice Routing Decision:** Retained default T10 routing from `docs/AGENCY_AGENT_ROUTING.json` (`agency-backend-architect` lead + `agency-devops-automator` + `agency-test-automation-engineer`). All three ran natively via `invoke_subagent` using canonical definitions.

| Role / Profile | Native Conversation ID | Definition Path | Loaded Profile Path / YAML Name / SHA-256 | Owned / Examined Paths | Inspected SHA(s) | Key Findings, Actions & Reconciliation |
|---|---|---|---|---|---|---|
| **Lead Backend Architect** (`agency-backend-architect`) | `fa9911f9-c9ca-4cc4-b241-dc72881fb502` | `.agents/agents/agency-backend-architect.md` | `.agents/skills/engineering-backend-architect/SKILL.md`<br>YAML: `agency-backend-architect`<br>SHA-256: `05A2FD1CBC4E1C05147B3574FE4CAD69A08E851A72D43A4591427DF6BD061AAF` (no drift) | `prisma/schema.prisma`, `prisma/migrations/20261124000000_*`, `src/lib/{cairo-date,env}.ts`, `src/modules/reminders/*`, `src/modules/{scheduling,productivity}/*`, `src/worker/*`, `src/app/api/reminders/*`, `src/app/(app)/inbox/page.tsx`, `src/components/*`, tests | `dedbf40` (preflight & implementation -> `03be778`)<br>`03be778` -> `08d5b69` (reconciliation) | Paused cleanly before edits on absent `T09-review.md`; implemented T10 schema, worker, outbox, `/inbox` APIs/UI, and tests cleanly; reconciled all P1/P2/P3 support findings (`Task` live eligibility, poison-pill loop draining, `try/finally` E2E cleanup, startup `.catch`, schema index `map:`). |
| **Supporting DevOps Automator** (`agency-devops-automator`) | `f9101aac-bcd1-4105-ac28-5bde2e7b4e13` | `.agents/agents/agency-devops-automator.md` | `.agents/skills/engineering-devops-automator/SKILL.md`<br>YAML: `agency-devops-automator`<br>SHA-256: `90538C1E472410EEB408B3AB99ACCFA3AA6FF723F4AF2CB2BCB0BB59F98E209E` (no drift) | `src/worker/{index,reminder-worker}.ts`, `src/lib/env.ts`, `prisma/migrations/20261124000000_*`, `prisma/schema.prisma`, `package.json`, `next.config.ts`, `src/app/api/reminders/*`, `public/sw.js` | `dedbf40` (preflight)<br>`03be778` (Round 1)<br>`08d5b69` (Round 2) | Round 1: `P0/P1/P2 = 0`; raised 3 actionable P3 items (unhandled `main()` error, poison-pill poll termination, schema unique index `map:`) + 2 non-blocking P3 awareness notes (`tsx` in `devDependencies`, minor regex patterns). Round 2 on `08d5b69`: verified all 3 fixed (`prisma validate` 0, bogus-env startup failure exit `1` redacted, `typecheck` 0, unit `317/317`); PG integration/E2E/build `NOT RUN` inside DevOps read-only pass. |
| **Supporting Test Automation Engineer** (`agency-test-automation-engineer`) | `77e663d8-2d6e-4d65-97fd-b229c67f3532` | `.agents/agents/agency-test-automation-engineer.md` | `.agents/skills/testing-test-automation-engineer/SKILL.md`<br>YAML: `agency-test-automation-engineer`<br>SHA-256: `AF5A9B7EF8ECEDF45988AE39EE169050B036037466A4D7FC4BF476FAD847CAB4` (no drift) | `tests/unit/reminder-policy.test.ts`, `tests/integration/t10-reminders-worker.test.ts`, `tests/e2e/t10-reminders-inbox.spec.ts`, `playwright.t10.config.ts`, `tests/integration/{t09-*,hearing-*}`, `tests/helpers/t04-constants.ts`, `test-results/t10/*.png` | `dedbf40` (preflight)<br>`03be778` (Round 1)<br>`08d5b69` (Round 2) | Round 1: caught `[P1]` `updateTask` silent reminder drop, `[P2]` poison-pill tick truncation, `[P2]` E2E fixture leak in `T10-TC-05`/`07` affecting `t10-inbox-1440.png`, and `[P2]` negative/RBAC/filter/a11y test gaps. Round 2 on `08d5b69`: verified all P1/P2 fixes, inspected clean `t10-inbox-1440.png` `(1)`, ran `t10-reminders-worker.test.ts` (`8/8` passed in 14.89s); Playwright/CLI daemon marked `NOT RUN` in Round 2 support pass. |

---

## 4. Acceptance Test Matrix (`T10-TC-01` through `T10-TC-07`)

All PostgreSQL and browser checks ran against isolated test DBs using synthetic fixtures only.

| Case ID | Level | Setup & Steps Exercised | Observed Result | Command & Exit | Evidence Reference |
|---|---|---|---|---|---|
| **T10-TC-01** | PG + Controlled Clock | Confirmed deadline with due reminder; race two `claimNextReminderJob` workers, fence expired holder, advance clock beyond lease expiry (`leaseUntil <= now`), and run recovery tick; also test expired max-attempt poison pill ahead of healthy queued job. | `FOR UPDATE SKIP LOCKED` prevents simultaneous ownership; fenced expired holder cannot commit/fail claim; expired lease reclaimed and yields 1 `ReminderDelivery`; poison pill retires to `FAILED` without blocking healthy queued job. | `npx.cmd vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`) | `tests/integration/t10-reminders-worker.test.ts` |
| **T10-TC-02** | PG + Fault Injection | Due `Hearing` reminder with `_faultInject: 'beforeCommit'` then `'afterCommit'`, followed by recovery after expired lease replay. | Pre-commit failure rolls back delivery (`0` items), records retry backoff, and retry completes cleanly; post-commit crash leaves `SUCCEEDED` + same 1 `ReminderDelivery` row without duplicate items or `sourceVersion` drift. | `npx.cmd vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`) | `tests/integration/t10-reminders-worker.test.ts` |
| **T10-TC-03** | PG | Claimed pending jobs; exercise source date change, cancellation, completion (`Deadline`/`Hearing`), and non-date `Task` edit (`IN_PROGRESS`, `title`, `dueTime`) + `dueDate` change. | Live recheck cancels obsolete/changed-date/completed reminders with `0` deliveries; non-date `Task` edits preserve active reminder delivery while `dueDate` change supersedes v1 -> v2. | `npx.cmd vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`) | `tests/integration/t10-reminders-worker.test.ts` |
| **T10-TC-04** | Unit + PG | Unknown-time `Hearing` (`hearingTime: null`) and `Africa/Cairo` DST transition dates (`2027-04-29` spring forward, `2027-10-28` fall back), executed twice under controlled clock. | `computeCairoReminderInstant` shifts days accurately and honors Cairo wall-clock offset across DST; worker creates 1 `ReminderDelivery` (`SENT`), leaves `Hearing.hearingTime` `null`, and second tick creates no duplicate. | `npm.cmd run test` (exit `0`)<br>`vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`) | `tests/unit/reminder-policy.test.ts`<br>`tests/integration/t10-reminders-worker.test.ts` |
| **T10-TC-05** | PG + Browser | Repeated failures reaching `maxAttempts = 5` (`FAILED`), idle extra tick verification, deliberate UI/service retry (`retryFailedReminderJob`), `UnsupportedTransitionError`/`IdempotencyPayloadMismatchError`, and marking unread `SENT` reminder read in `/inbox`. | Exponential backoff stops at limit (`FAILED`), stays idle until manual retry, manual retry transitions to `PENDING` -> `SENT`, `SENT` vs `readAt` stay separate, and marking read leaves linked `Task` `OPEN` and `Deadline` `CONFIRMED`. | `vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`)<br>`npx.cmd playwright test --config=playwright.t10.config.ts` (exit `0`) | `tests/integration/t10-reminders-worker.test.ts`<br>`tests/e2e/t10-reminders-inbox.spec.ts` |
| **T10-TC-06** | PG + HTTP + E2E | Due jobs under `RESTORE_MODE`/`REMINDER_DISPATCH_DISABLED`, unauthenticated & `MAINTAINER` callers on inbox/retry/rules HTTP endpoints, and synthetic secret/payload fault injection. | Worker claims/delivers `0` jobs and updates `WorkerHeartbeat` (`restoreMode: true`); HTTP rejects unauthenticated (`401`) and `MAINTAINER` (`403`) with `Cache-Control: private, no-store`; `lastError`/`payload`/`AuditEvent`/UI redact secrets. | `vitest run tests/integration/t10-reminders-worker.test.ts` (exit `0`)<br>`npx.cmd playwright test --config=playwright.t10.config.ts` (exit `0`) | `tests/integration/t10-reminders-worker.test.ts`<br>`tests/e2e/t10-reminders-inbox.spec.ts` |
| **T10-TC-07** | Browser (`390/768/1440px`) | Populated `/inbox` with unread, overdue, worker-failed banner, filter tabs (`all`/`unread`/`overdue`), rule save, offline loss + stale refresh recovery, keyboard focus, and 200% zoom reflow. | Clear Arabic UI displays `نبض عامل التذكيرات`, last update timestamp, failure alert + retry, unread/overdue states, Arabic closed-app/offline delivery limits notice (`لا يضمن النظام وصول التنبيهات عند إغلاق التطبيق أو انقطاع الاتصال بالإنترنت`), and zero horizontal overflow. | `npx.cmd playwright test --config=playwright.t10.config.ts` (exit `0`) | `test-results/t10/t10-inbox-390.png`<br>`test-results/t10/t10-inbox-768.png`<br>`test-results/t10/t10-inbox-1440.png` |

---

## 5. Verification Commands Executed & Real Exits

### On Final Implementation SHA `33cfc9fa4a08fd0680497c1ff9cda2022aec4c51`

| Command | Exit Code | Observed Result |
|---|:---:|---|
| `npm.cmd run lint` | `0` | Clean (`eslint .`, 0 errors, 0 warnings) |
| `npm.cmd run typecheck` | `0` | Clean (`tsc --noEmit`) |
| `npm.cmd run test` | `0` | **21/21 files, 319/319 unit tests passed** (`tests/unit/reminder-policy.test.ts` 7/7, covering DST, redaction of Basic/JSON/44-char base64 keys, and `computeWorkerHealth` states) |
| `npm.cmd run build` | `0` | Next.js 16.4.6 Turbopack production build succeeded (48 routes compiled including `/inbox`, `/api/reminders/*`) |
| `npx.cmd vitest run --no-file-parallelism tests/integration/t10-reminders-worker.test.ts tests/integration/t09-deadlines-tasks-agenda.test.ts tests/integration/hearing-transactions.test.ts tests/integration/hearing-archive-guards.test.ts` | `0` | **4/4 files, 27/27 real PG integration tests passed** (`t10` 8 including `cancelDeadline` clearing `FAILED` job, `t09` 8, `hearing-transactions` 5, `hearing-archive-guards` 6) |
| `npx.cmd playwright test --config=playwright.t10.config.ts` | `0` | **5/5 passed** (`desktop-1440`, `tablet-768`, `mobile-390`) |
| `git diff --check` | `0` | Clean (zero whitespace/conflict markers) |

### Prior Verification Run on Agency-Reviewed SHA `08d5b69a0b26a540c88f912fa68354accc26f8ca`

| Command | Exit Code | Observed Result |
|---|:---:|---|
| `npx.cmd prisma validate` | `0` | Valid (`prisma/schema.prisma`) |
| `npm.cmd run lint` | `0` | Clean (`eslint .`, 0 errors, 0 warnings) |
| `npm.cmd run typecheck` | `0` | Clean (`tsc --noEmit`) |
| `npm.cmd run test` | `0` | **21/21 files, 317/317 unit tests passed** (`tests/unit/reminder-policy.test.ts` 5/5) |
| `npm.cmd run build` | `0` | Next.js 16.4.6 Turbopack production build succeeded (48 routes compiled including `/inbox`, `/api/reminders/*`) |
| `npx.cmd vitest run --no-file-parallelism tests/integration/t10-reminders-worker.test.ts tests/integration/t09-deadlines-tasks-agenda.test.ts tests/integration/hearing-transactions.test.ts tests/integration/hearing-archive-guards.test.ts tests/integration/audit-fixes-regressions.test.ts` | `0` | **5/5 files, 37/37 real PG integration tests passed** (`t10` 8, `t09` 8, `audit-fixes-regressions` 10, `hearing-transactions` 5, `hearing-archive-guards` 6) |
| `npx.cmd playwright test --config=playwright.t10.config.ts` | `0` | **5/5 passed** (`desktop-1440`, `tablet-768`, `mobile-390`) |
| `npx.cmd playwright test --config=playwright.t09.config.ts` (Lead verification on final edits) | `0` | **9/9 passed** (`desktop-1440`, `tablet-768`, `mobile-390`, `cairo-profile`, `newyork-profile`) |
| `npx.cmd playwright test --config=playwright.t04.config.ts` (Lead verification on final edits) | `0` | **46/46 passed** (shell nav, RTL, responsive, keyboard, privacy, auth boundaries) |
| Fail-closed worker startup redaction check (`DATABASE_URL` missing DB name w/ synthetic secret, DevOps Round 2) | `1` (expected) | `[ReminderWorker] fatal startup error: ... Secret values are redacted.` (zero stack trace or secret leakage) |
| `git diff --check` | `0` | Clean (zero whitespace/conflict markers) |

### Prior Verification Run on Checkpoint `03be778503147e9051ed516e10a551227f2f35c1`

| Command | Exit Code | Observed Result |
|---|:---:|---|
| `npx.cmd vitest run --no-file-parallelism tests/integration/migration-upgrade.test.ts tests/integration/startup-process.test.ts` | `0` | **2/2 files, 30/30 real PG integration tests passed** |
| Worker CLI live process check (`tsx src/worker/index.ts`, `WORKER_POLL_INTERVAL_MS=1000`, `RESTORE_MODE=true` then `false`) | Controlled `SIGTERM` | Verified real worker PID heartbeat updates (`restoreMode=true` -> `claimed=0`, `restoreMode=false` -> `lastSuccessAt` recorded) and zero lingering PIDs |

---

## 6. Migrations, Residual Notes & `NOT RUN` Limits

- **Migration Path:** `prisma/migrations/20261124000000_t10_durable_reminders_worker_inbox/migration.sql`
  - Safely expands `JobRunStatus` and `JobRun`, backfills `available_at` from `scheduled_at` for existing rows, adds CHECK constraints, creates `reminder_rule` (seeding default `7/3/1` day Hearing/Deadline and `1` day Task rules with `ON CONFLICT DO NOTHING`), `reminder_delivery`, and `worker_heartbeat`.
  - Forward-deployable via `npx.cmd prisma migrate deploy`; verified on both a fresh DB and a populated T09-to-T10 upgrade inside `tests/integration/t10-reminders-worker.test.ts`.
- **Non-Blocking Residual Notes (`P3` from Support Reviews):**
  - `package.json` `"worker": "tsx src/worker/index.ts"` keeps `tsx` in `devDependencies` (consistent with `"auth:provision-owner"`); T18 production Docker packaging will bundle or compile the worker entrypoint.
  - Windows `child.kill('SIGTERM')` uses `TerminateProcess`, so graceful in-process POSIX `SIGINT`/`SIGTERM` shutdown exit code `0` in `src/worker/index.ts` remains outside native Windows signal semantics (`NOT RUN`).
  - Minor non-blocking residual items: un-mocked live worker daemon E2E loop and `T10-TC-04` DST check with a custom modified rule (covered separately by `reminder-policy.test.ts` unit tests + `listEnabledRulesForEventType` DB loading).
- **`NOT RUN` Limits:**
  - After the final polish commit `33cfc9fa4a08fd0680497c1ff9cda2022aec4c51` (cancelling obsolete `FAILED` jobs in `cancelSourceReminderJobs`, strengthening `redactErrorMessage` for Basic/JSON/44-char keys, removing duplicate `ensureDefaultReminderRules` call in `reminder-worker.ts`, adding `InboxView` unmount abort & `401` session recheck, and extending `reminder-policy.test.ts`/`t10-reminders-worker.test.ts`), `prisma validate`, `audit-fixes-regressions.test.ts`, `migration-upgrade.test.ts`, `startup-process.test.ts`, unrelated prior domain integration suites (`matter-*`, `party-*`, `auth-*`), and `playwright.t03`..`t09` were not re-run locally (all verified previously on `08d5b69`/`03be778`; GitHub Actions CI runs the complete suite upon PR).
  - Live assistive-technology screen reader walkthroughs and live HTTPS mobile push/closed-app testing remain outside local Playwright runs.
