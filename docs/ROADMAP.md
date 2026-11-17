# Implementation milestones and Gemini tasks

## Delivery approach

Each milestone contains small tasks, each with references, scope, tests, and a submission. Gemini implements one task at a time; Codex reviews the diff, behavior, and evidence. Do not automatically advance to work that depends on an unreviewed result. If the tools do not share the same folder, the project owner transfers assignments and submissions; this plan assumes no automatic connection between them.

There are 21 main task numbers. T15 is divided into three independent assignments, making 23 initial delivery units. If a task proves too large for a reviewable change, split it before implementation while retaining its number and documenting why.

Task states: `READY → IN_PROGRESS → SUBMITTED → CHANGES_REQUESTED / ACCEPTED`. `BLOCKED` identifies missing information or a dependency, rather than difficulty alone. Requested fixes remain part of the same task. Do not change requirements merely to make a test pass. Product decisions, legal rules, and real data questions return to the project owner and the lawyer when needed.

An initial organizational estimate is 6–10 weeks of part-time work, including user testing and reviews, not a delivery promise. Record implementation/review time for the first two tasks, then re-estimate. Progress means accepted tasks, not files generated or coding speed.

## M0 — Reproducible environment

**Depends on:** the current plan. **Output:** a synthetic-data-only scaffold and a documented version register.

| Task | Allowed work | Submission requirement |
|---|---|---|
| T01 Tool compatibility | Verify a supported Node LTS, Next.js/React, Prisma 7, Better Auth, Tailwind, and Playwright; choose compatible patches | `docs/DEPENDENCIES.md` lists versions, sources, and verification date; one lockfile; install/build from a clean checkout |
| T02 Operational foundation | TypeScript strict project, environment validation, local PostgreSQL, secret-free health endpoint, CI | Clear startup README; synthetic `.env.example`; explicit failure for missing environment variables; CI lint/typecheck/build |

**Stop condition:** if the auth adapter and ORM are incompatible, submit a compatibility report. Do not independently replace the database or authentication. No real data or public ports.

## M1 — Identity and UI shell

| Task | Scope | Submission requirement |
|---|---|---|
| T03 Login and sessions | Secure owner provisioning, public registration disabled, TOTP/recovery, logout/revocation, S14 security section | Direct unauthorized requests, expired sessions, and single-use recovery tested; no default owner with a known password |
| T04 Arabic UI and PWA | Shell, navigation, genuine empty states, manifest/icons, PWA installation, limited DTOs, saving/error/offline feedback | 390/768/1440 widths, keyboard and RTL; local installability followed by HTTPS testing in T18; public-assets-only caching; no fake production data |

**Demo:** secure login, open the home page, revoke the session from another screen. Do not build 15 fake screens before their journeys exist.

## M2 — Parties, matters, and proceedings

| Task | Scope | Submission requirement |
|---|---|---|
| T05 Parties and clients | Party records, client profile, communication, powers of attorney, search, duplicate warnings | Original names preserved; support the same person in different roles as relations are added; no unnecessary mandatory identity data; optional identity numbers encrypted with recoverable keys and versions |
| T06 Matters, proceedings, and settings | Matter, Proceeding, parties, court-instance links; office/court/type/paper-location reference lists in S14 | Matter before a docket number; first instance and appeal; differing party capacities; relationship constraints; disabling a reference item preserves historical records |
| T07 Search and archiving | Normalized search, filters, pagination, rule-based archiving, audit trail | Arabic/Latin digits; no broken links; prevent unjustified archiving with critical open work |

**Demo:** one client with two matters, and one matter with two clients and two proceedings, with explicit incomplete data. Use a real database to test relationships and conflicts.

## M3 — Hearings, deadlines, and agenda

| Task | Scope | Submission requirement |
|---|---|---|
| T08 Hearing and result | Scheduling, a hearing without a time, result/adjournment/tasks in one transaction | Repeated requests do not duplicate; a failed step rolls everything back; corrections require a reason and history |
| T09 Deadlines and tasks | Draft/manually confirmed Deadline, Tasks, agenda | No automatic legal-period calculation; timezone, DST, and overdue behavior correct |
| T10 Reminders | Database jobs/outbox/leases, in-app inbox, monitoring and failure | Safe worker restart; a changed date cancels old reminders; UI explains closed-app notification limits |

**Demo:** record a result on mobile, adjourn, prepare a memorandum, and see the desktop agenda update. Test network failure and concurrent editing.

## M4 — Private document archive

| Task | Scope | Submission requirement |
|---|---|---|
| T11 Upload and preview | Quarantine, allowed formats, checksum, private storage, download authorization; ClamAV deferred initially by ADR 0003 | Reject disguised/oversized/traversal files; atomic finalization and private authorization; truthful NOT_SCANNED_POLICY. Scanner failure/timeout/staleness tests required only upon later activation |
| T12 Versions and paper originals | Immutable versions, paper original/location, Proceeding/Hearing links | Old versions remain; failed finalization/database writes create no broken reference; orphan cleanup respects backup pins |

**Demo:** a mobile photo and a 20-page PDF, re-upload, and download without a session. Before M4 is complete, the application is experimental rather than a trusted archive.

## M5 — Administrative finance

| Task | Scope | Submission requirement |
|---|---|---|
| T13 Ledger and collection | Limited account dictionary, balanced posting, fees/payment/allocation/receipt | 15,000 fees minus 5,000 collected = 10,000 outstanding; no floats or edits to posted entries |
| T14 Expenses and client advances | Lawyer-funded expenses, advances, reimbursement, office expenses | The 1,200 reimbursable expense remains separate; spending an advance reduces the client liability without recording income |
| T15a Reversal | Full reversal of an erroneous entry; release allocations with reason and immutable history | Reverse only once; retain history; no duplicate actual cash outflow |
| T15b Refunds and adjustments | Partial/full refund and fee adjustment with allocations | Refundable-amount limits, one cash movement, no treating reversal as an actual refund, safe concurrency |
| T15c Distribution and statement | Multi-client payments, consolidated statement, restricted opening-balance command for T21, reconciliation | Payer differs from debtor; no over-allocation; opening positions do not count as collection; balances match acceptance examples |

**Special condition:** finance transaction integration tests are required. A correct-looking screen with unbalanced entries is unacceptable. Use examples in DATA_MODEL and WORKFLOWS; review every receipt/disbursement path.

## M6 — Printing, exports, and migration tools

| Task | Scope | Submission requirement |
|---|---|---|
| T16 Printing and export | Hearing list, matter summary, administrative receipt, client statement, private ZIP export | Connected Arabic PDF text and sensible pagination; formula-injection-safe CSV; no unauthorized disclosure |
| T17 Import | Template, preview, validation, documented row acceptance, idempotent import batches | Explain faulty rows; ambiguous dates stop for review; repeated batch does not duplicate; rollback limits before subsequent links are explicit |

**Demo:** import a synthetic batch containing errors and duplicates, print a statement matching the database, and reopen exported documents.

## M7 — Operations and recovery

| Task | Scope | Submission requirement |
|---|---|---|
| T18 Restricted deployment | Production Compose, least privilege, HTTPS/private network, updates and secrets | No public database port; registration disabled; sanitized health checks; mobile smoke test outside the home network |
| T19 Backup/restore | Consistent DB/files backup, current/old recovery keys, offsite/offline copies, monitoring/status in S14 | Independent restore, complete manifest, matching finance/dates/files, test identity decryption and MFA login, old sessions revoked, no job dispatch during restore, measured RPO/RTO |

**Stop condition:** any failed recovery or possible document disclosure blocks production data. Upgrades require a valid backup and a schema-compatible rollback plan; reverting the image alone cannot reverse every migration.

## M8 — Pilot and office handover

| Task | Scope | Submission requirement |
|---|---|---|
| T20 Lawyer pilot | Five near-term matters, then 7–14 days of daily use according to available hearings | User completes core journeys; fix comprehension problems before adding features |
| T21 Migration and go-live | Batches following MIGRATION, one-page lawyer guide, documented responsibilities | Every near-term date checked against paper; opening balances approved; actual backup and restore |

The system is not accepted merely because it builds or shows a dashboard. The project owner signs off on technical review, and the lawyer confirms sample-data accuracy and usability. Record open issues and how they will be handled.

## After V1

Prioritize by actual use: generic opt-in external reminders, file QR labels, reviewed memorandum/contract templates, local OCR tested on Arabic samples, then AI assistance with page citations and explicit agreement on processing location. Each feature gets a small PRD and separate assessment; do not slip it into a bug fix.
