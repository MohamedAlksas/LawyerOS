# T06 Checkpoints & Execution State

**Task:** T06 — Matters, proceedings, relationships and office reference settings  
**Workspace:** `D:/Lawyer/work/t06-gemini`  
**Branch:** `feature/t06-matters-proceedings`  
**Base Commit:** `8e7c773c39a97ff5a0e634be9b6eb0b145b4985d` (`origin/main`)  
**Current Implementation Checkpoint:** `8e7c773c39a97ff5a0e634be9b6eb0b145b4985d`  
**Status:** In Progress — Phase 2 Contract Frozen & Preflight Complete -> Phase 3 Parallel Implementation

---

## 1. Specialist Roster & Native Invocation Map

| Role | Profile Name | Frontmatter Name | Definition Path | Invocation / Conv ID | Preflight Status | Implementation Ownership |
|---|---|---|---|---|---|---|
| Coordinator | Antigravity Parent | `self` | N/A | Parent Session | COMPLETE | Coordination, git, checkpoints, review handoffs |
| Backend Author | `agency-backend-architect` | `agency-backend-architect` | `.agents/agents/agency-backend-architect.md` | `37734ea6-bebe-4991-9804-cd1a89adf49a` | COMPLETE | `src/modules/matters/`, `src/modules/settings/`, `prisma/schema.prisma`, `prisma/migrations/`, backend tests |
| Frontend Author | `agency-frontend-developer` | `agency-frontend-developer` | `.agents/agents/agency-frontend-developer.md` | `7f73047f-c482-4fcd-8ef9-9edcccd887af` | COMPLETE | `src/app/(app)/matters/`, `src/app/(app)/settings/reference/`, UI components, browser tests |
| DB Reviewer | `agency-database-optimizer` | `agency-database-optimizer` | `.agents/agents/agency-database-optimizer.md` | Standby for Phase 5 | QUEUED | Read-only SQL/schema, concurrency, indices, migration review |
| Test Reviewer | `agency-test-automation-engineer` | `agency-test-automation-engineer` | `.agents/agents/agency-test-automation-engineer.md` | `4fd90964-589d-4519-b957-e49ee7c11f0f` | COMPLETE (Preflight) | Read-only test adequacy, independent test execution, verification |
| Security Reviewer | `agency-application-security-engineer` | `agency-application-security-engineer` | `.agents/agents/agency-application-security-engineer.md` | Standby for Phase 5 | QUEUED | Read-only auth/MFA/session, transport security, data privacy |

---

## 2. Schedule & Phasing Status

- [x] **Phase 1: Environment & Baseline Setup**
  - Worktree `D:/Lawyer/work/t06-gemini` initialized from `origin/main` (`8e7c773`).
  - Reference files copied with verified SHA-256 hashes.
  - `.env.test` configured with port 3206 and `lawoffice_t06_test` database.
  - `npm.cmd ci` completed and Prisma client generated.
  - Base checks verified: `typecheck` and `lint` passed (0 errors).
- [x] **Phase 2: Contract Checkpoint & Specialist Preflight**
  - Finalized and froze `docs/assignments/T06-interface-contract.md`.
  - Finalized `docs/reviews/T06-test-matrix.md` (T06-01 through T06-20).
  - Backend Author Preflight (`37734ea6-bebe-4991-9804-cd1a89adf49a`) verified: schema, atomic sequence allocator, and cross-row invariants.
  - Frontend Author Preflight (`7f73047f-c482-4fcd-8ef9-9edcccd887af`) verified: component architecture, RTL `bdi` isolation, viewports (390/768/1440), and error mapping.
  - Test Specialist Preflight (`4fd90964-589d-4519-b957-e49ee7c11f0f`) verified: concurrency barriers, migration upgrade plan, and wire transport security.
- [ ] **Phase 3: Parallel Implementation**
  - Backend: Schema, Migration 7, Matter & Reference modules, atomic fileCode allocator, Server Actions, integration tests.
  - Frontend: Matter list/detail/create/edit screens, Proceeding screens, Reference settings screen, Arabic RTL polish.
- [ ] **Phase 4: Integration Checkpoint**
  - Combined candidate committed and verified locally.
- [ ] **Phase 5: Independent Support Reviews**
  - Database Reviewer (`agency-database-optimizer`).
  - Security Reviewer (`agency-application-security-engineer`).
  - Test Reviewer (`agency-test-automation-engineer`).
- [ ] **Phase 6: Reconciliation & Hosted CI**
  - Remediate all specialist findings.
  - Full suite verification (unit, integration, e2e, build).
  - Push branch, open Draft PR, verify hosted CI.
  - Generate `docs/reviews/T06-submission.md`.
