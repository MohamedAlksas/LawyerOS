# T03 — Independent Codex review, round 14

16 November 2026, Africa/Cairo. **CHANGES_REQUESTED**. Application code, migrations, configuration, and committed tests were not modified. No commit, push, PR comment, merge, deployment, or real client data use. This review does not release T04.

## Scope and provenance

- Branch: `feature/t03-identity-sessions`; canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Accepted main/base: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Previous submission: `08e3b6e699450fcfbca39ec3bae47b8250407572`.
- Inspected implementation: `1ca47b89d660ac68b82e00323f588282056f8814`.
- Local/published submission HEAD: `9aa8e5252fb37f06db837317e8075fa0c20fc394`. GitHub metadata independently confirmed this head and draft/open/unmerged PR #8 during this review. HEAD was rechecked after resumption.
- Fixed implementation comparison: `git diff 08e3b6e699450fcfbca39ec3bae47b8250407572...1ca47b89d660ac68b82e00323f588282056f8814`. The later diff to submitted HEAD contains only the round13 review/submission documents.

Reviewed PRODUCT, GLOSSARY, PRD, T03 card, round13 review/submission, GEMINI, review/Git/Agency protocols, relevant security policy, actual changed source/tests, and installed pinned Better Auth provider/adapter code. Project skills read: `.agents/skills/lawoffice-testing/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, and `.agents/skills/graphify/SKILL.md`. Read-only children `/root/standards` and `/root/spec` independently examined their respective axes before the interruption. Their delivered source findings informed the checks below; parent runtime evidence is identified explicitly. These review children do not substitute for Antigravity implementation evidence.

## Standards

### R14-01 / P1 — Baseline can certify a nonfunctional password-security trigger

Location: `src/cli/baseline-identity.ts:951–979,1039–1075`; public acceptance paths at `1166–1183,1264–1276`.

The new catalog query checks trigger/function names, flags and configuration, but does not read the function body, trigger predicate or UPDATE column list. A function retaining its expected name, SECURITY DEFINER and search_path can simply return NEW without rotating credentials. A trigger restricted to another column or WHEN(false) is also not distinguished by the selected metadata; these latter variants are source findings, not separately executed probes.

**Parent reproduction, real PostgreSQL:** install current canonical SQL with a synthetic provisioned/MFA-confirmed owner; replace only the password trigger function body with `BEGIN RETURN NEW; END;`; call actual `runIdentityBaseline`. It succeeds and records two completed migration-history rows. A second call returns `alreadyCompleted: true`. A subsequent raw password-column update leaves credentialVersion at1 and an existing issued session still passes `requireActor`. This raw-update probe leaves account.updatedAt unchanged; it demonstrates loss of the database invariant, not an ordinary remote password-change exploit.

Expected: reject altered security behavior before recording or accepting completed history. This directly remains within R13-02's required “function namespace/body” and altered-trigger verification.

**Suggested fix:** compare the relevant complete trigger/function definitions against a canonical contract, including body, full event mask, UPDATE columns, predicate, arguments and safe configuration. Fail closed on unsupported differences. Add public-baseline regressions for altered bodies/predicates/columns in both unmanaged and already-completed histories. Metadata names alone cannot establish behavioral equivalence.

### R14-02 / P2 — The delayed-response browser test can pass without observing the delayed response

Location: `tests/e2e/auth-round11-browser.spec.ts:300–335`; analogous error branch at `348–382`.

`route.fetch()` is an improvement, but the test never awaits a signal that this fetch completed before pressing Escape. It also never asserts that the intended action was intercepted or that recovery-code generation succeeded. After releasing the barrier, it waits600ms and checks that the reopened dialog is empty. A backend taking longer than600ms, an unsuccessful action, or an interception mismatch can satisfy those assertions without testing a delivered late success. The error branch has the same synchronization gap.

Expected under R13-05: observed backend completion, dismissal/reopening, delivered response, then verification that the stale result is ignored.

**Suggested fix:** add an explicit backend-completed signal after a verified successful action/result or persisted-state change; await it before dismissal. Count/assert interception. After releasing, await response delivery and client processing rather than a fixed delay. Exercise late expected error, fresh successful retry and navigation separately. This is a source-confirmed evidence defect; this review does not claim the modal itself is broken.

## Spec

### R14-03 / P2 — Replacement-session failure still reports failure after committing the password

Location: `src/lib/auth.ts:60–62`; the round13 route delegates directly at `src/app/api/auth/[...all]/route.ts:419` after removing its redundant transaction.

The installed Prisma adapter defaults `transaction` to false (`node_modules/@better-auth/prisma-adapter/dist/index.mjs:464`). The installed password-change provider wraps session deletion, password update and replacement-session creation in `runWithTransaction`, but that wrapper cannot make them atomic with this configuration (`node_modules/better-auth/dist/api/routes/update-user.mjs:173–180`).

**Parent reproduction, real PostgreSQL and genuine route/provider:** authenticate the owner; add a temporary fixture trigger that rejects session INSERT after credentialVersion reaches2; submit change-password. Observed HTTP500, committed credentialVersion2, revoked original session and no replacement cookie. Remove only the fixture fault: the old password returns401 and the new password returns200 with an MFA challenge. The operation changed the password despite reporting failure.

Removing the second increment fixes the previous exact defect, but R13-04 explicitly also requires session-stamp/eviction/postcondition failure checks and coherent recovery. T03 R12-01 states that “Returning500 after a committed password change is not rollback.”

**Suggested fix:** use and verify the pinned adapter's supported transaction configuration so password/version mutation, session revocation and replacement creation roll back together; test that trigger work uses the same transaction. Alternatively define explicit, tested partial-success/recovery behavior. Add replacement INSERT and revocation failure regressions, checking actual passwords, versions, old/replacement sessions and retry behavior. Existing old-proof rejection in this outcome is credited; this finding is not an authorization-bypass claim.

## Plan compliance and credited repairs

Credited from source and passing applicable tests: sign-in pre-read exceptions now stop before provider authentication; no post-authentication credential-version reconstruction; MFA final lookup failures return failure instead of forwarding provider success; duplicate version increment removed; SQL application-table references qualified and function search_path fixed; missing/disabled trigger checks added; role documentation corrected; native clipboard paste added.

Full R13-05 completion remains overstated. The OTP test pastes Latin and fills Arabic-Indic but submits only the Persian leading-zero value (`auth-round11-browser.spec.ts:241–265`). Dialog zoom checks visibility; overflow is measured after navigation to login, not on the security dialog (`425–456`). The new PGOPTIONS test uses a fresh raw pg connection, which is credited, but does not establish the requested full fresh application/baseline role/database-default and password-rotation matrix. Prior managed-history/retained-MFA evidence remains incomplete. Complete those specific acceptance cases and correct the submission's claims.

The native Agency table contains IDs, hashes and verdict summaries, but does not link returned audit artifacts or disclose unavailable durable export as required by `docs/AGENCY_AGENTS.md`. Supply inspectable references or the explicit limitation. Missing references alone do not establish fabrication.

No additional stylistic refactor is requested. In future corrections, keep provider cookie/credential-state handling in a narrow, documented contract; avoid expanding identifier guesses to compensate for an unverified provider interface.

## Actual verification

| Check | Result |
|---|---|
| `npm.cmd test` | Exit0;144/144 unit tests,9 files at unchanged submitted HEAD |
| `npm.cmd run typecheck`; `npm.cmd run lint` | Exit0 each |
| Auth + migration integration files | Exit0;71/71 tests,2 files,78.70s in review-owned isolated PostgreSQL16.8 |
| Two focused parent observers | Exit0;2/2,13.75s; assert the defects described above, not acceptance |
| Fresh Turbopack build | Succeeded during an inadvertently broad diagnostic-config run; startup HTTP readiness in that run failed because the configured database was offline |
| `git diff --check` | Exit0 before final report |
| Fresh browser rendering, webpack build, complete startup/readiness suite | NOT RUN successfully as acceptance checks in this review |

Initial restricted database attempt failed EACCES. The next attempt was temporarily blocked by an automatic-approval service usage limit. On resumption approval succeeded, but the original PostgreSQL endpoint was offline. Docker Desktop was started and a separate review container was created; final results above use only its disposable synthetic databases. The initial diagnostic configuration accidentally merged the broad test include list; that diagnostic-only configuration was corrected before the focused run. Initial environment/harness failures are not product findings.

Ignored diagnostics: `work/t03-r14-review/observer.test.ts`, `vitest.config.mjs`, `observers-final.log`, and `integration-final.log`. No test credentials or actual tokens are included in this report. Graph manifest `work/graphify/1ca47b89d660-837feb45/SOURCE.json` matches the inspected implementation and SHA-256 `fc5e463fac4b686a37668849539061bece56ba4e4199d4ccb2479d56d5aed465`; the verifySchemaEquivalence query found20 nodes and showed18 at a500-token budget. Graph coverage excludes root SQL/configuration and was supplemented by direct inspection.

Review-created container: `9321e0d60e3e4f976032324333234d10fc3546ceaa1caf53f35d4243e94cb741`, name `lawoffice-codex-review-20261116-0200`, label `lawoffice.review=t03-20261116-0200`, loopback port14765. Final catalog inspection found only the base test database and postgres, with no remaining dedicated fixture databases. After verifying exact ID/name/label/port, this container and its disposable storage were removed successfully. Existing stopped containers and owner-installed agent assets were preserved. Docker Desktop remains running.

Standards:2 findings, highestP1. Spec:1 finding, highestP2. **CHANGES_REQUESTED**; no acceptance or merge granted.
