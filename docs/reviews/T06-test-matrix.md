# T06 Test Verification Matrix

**Task:** T06 — Matters, proceedings, relationships and office reference settings  
**Workspace:** `D:/Lawyer/work/t06-gemini`  
**Status:** DRAFT (Pre-Implementation Plan)  
**Date:** 2026-11-18  

---

## Acceptance Criteria Mapping (T06-01 to T06-20)

| ID | Description | Target Test Files | Test Type | Planned Assertions & Invariants | Observed Status |
|---|---|---|---|---|---|
| **T06-01** | Matter lifecycle | `tests/unit/matter-validation.test.ts`<br>`tests/integration/matter-lifecycle.test.ts` | Unit & Integration | Create/reload/edit each kind (`LITIGATION`, `CONSULTATION`, `CONTRACT`, `OTHER`); DRAFT without client allowed; ACTIVE requires >=1 CLIENT; missing title/kind rejects; paper location warning truthful; archive/delete rejected | PENDING |
| **T06-02** | File codes | `tests/integration/matter-file-code.test.ts` | Integration (Concurrency) | Atomic `file_code_sequence` with `SELECT ... FOR UPDATE`; concurrent requests produce distinct monotonic codes; no count/max race; Cairo year boundary preserved; retry same key returns same code | PENDING |
| **T06-03** | Office roles | `tests/integration/matter-party-roles.test.ts` | Integration | Same party as CLIENT in matter A and OPPONENT in matter B; multi-client matters; duplicate `(matter, party, role)` rejected; at most one primary contact enforced under concurrency | PENDING |
| **T06-04** | Proceedings | `tests/integration/proceeding-lifecycle.test.ts` | Integration | Known court required even in DRAFT; ACTIVE requires docket number/year/type; leading zeros and Arabic/Latin letters preserved; unknown court keeps matter only; distinct instance data | PENDING |
| **T06-05** | Relationships | `tests/integration/proceeding-hierarchy.test.ts` | Integration (Concurrency) | Cross-matter parent link rejected; self-parenting rejected; cycle detection ($A \to B \to A$ and deep cycles); concurrent opposite parent edits cannot create cycle; deterministic lock ordering | PENDING |
| **T06-06** | Client invariants | `tests/integration/matter-client-invariants.test.ts` | Integration (Concurrency) | Race demoting/removing two clients on ACTIVE matter cannot leave matter clientless; concurrent primary-contact updates; expectedVersion checks prevent silent overwrites | PENDING |
| **T06-07** | POA associations | `tests/integration/matter-authorizations.test.ts` | Integration | Linking POA to matter requires POA holder to be CLIENT in that matter; one POA linked to multiple matters; removing client role reconciles/rejects dependent authorizations; no invalid links | PENDING |
| **T06-08** | Reference settings | `tests/integration/reference-settings.test.ts` | Integration | Office singleton maintenance; courts/practice areas/locations create/edit/deactivate; historical records render; new selection of deactivated item rejected; deactivate/assign races handled | PENDING |
| **T06-09** | Duplicate/search behavior | `tests/unit/matter-search-normalization.test.ts`<br>`tests/integration/matter-search.test.ts` | Unit & Integration | Normalized Arabic/Western digit search without altering source; similar docket warning precedes creation without blocking; bounded stable pagination | PENDING |
| **T06-10** | Versions | `tests/integration/matter-concurrency.test.ts`<br>`tests/integration/proceeding-concurrency.test.ts` | Integration | Stale `expectedVersion` rejected with `CONCURRENCY_CONFLICT`; version increments atomically on update; replay after content edit returns truthful current version and original acknowledgment | PENDING |
| **T06-11** | Atomicity | `tests/integration/matter-atomicity.test.ts` | Integration | Rollback on injected audit failure or child failure; zero partial records or orphaned idempotency rows; audit log preserves actor and redacted change metadata | PENDING |
| **T06-12** | Idempotency/races | `tests/integration/matter-idempotency.test.ts` | Integration (Concurrency) | Scoped `(actorId, command, key)`; replay returns cached result without re-executing; changed payload with same key rejected; barrier forces actual concurrency race | PENDING |
| **T06-13** | Authorization over real transport | `tests/integration/matter-action-transport.test.ts` | Integration (Wire HTTP) | Unauthenticated, expired, genuinely revoked session (`rowCount === 1`), unverified MFA, and MAINTAINER deny with 401/403; forged `allowIncompleteMfa: true` fails closed; untrusted Origin rejected | PENDING |
| **T06-14** | Validation/privacy | `tests/unit/matter-privacy.test.ts`<br>`tests/integration/matter-privacy.test.ts` | Unit & Integration | UUID/enum/length validation; date-only round trips; no decrypted national ID, credentials, or secrets in DTOs, RSC payloads, or audit logs | PENDING |
| **T06-15** | Migrations | `tests/integration/matter-migration-upgrade.test.ts` | Integration (Postgres) | Clean deploy of all migrations and upgrade from accepted T05 baseline; preserve synthetic parties, encrypted IDs, and auth sessions; verify UTC/Cairo session timezone matrix | PENDING |
| **T06-16** | Browser workflows | `tests/e2e/t06-matters.spec.ts` | E2E (Playwright) | Authenticated journey: create Party -> draft Matter -> add Client -> activate -> add draft Proceeding -> complete Proceeding -> link Appeal with different capacities -> inspect paper location -> Party profile view | PENDING |
| **T06-17** | Failure UX | `tests/e2e/t06-matters-failure-ux.spec.ts` | E2E (Playwright) | Field validation, loading, empty vs filtered-empty, server error retry, conflict notice, revoked session redirect, memory-only form retention on conflict | PENDING |
| **T06-18** | Responsive/accessibility | `tests/e2e/t06-matters-a11y.spec.ts` | E2E (Playwright) | 390px, 768px, 1440px viewports, 320px reflow, 200% text zoom, RTL keyboard navigation, focus trap in dialogs, visible contrast, ARIA labels | PENDING |
| **T06-19** | Regression | `tests/unit/` & `tests/integration/` & `tests/e2e/` | Full Suite | All prior suites (T03, T04, T05) pass without skips, fixmes, or sleeps; verified discovery and counts | PENDING |
| **T06-20** | Publication | Git & GitHub Actions CI | Final Gate | Candidate reviewed by independent native DB, AppSec, and Test specialists; local commands pass; PR opened; hosted CI green on final pushed SHA | PENDING |
