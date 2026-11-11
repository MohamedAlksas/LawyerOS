# T02 — Independent Codex review

Latest review: **CHANGES_REQUESTED** at published head `111c8256692f79fa8d22c243ec1ba2d52ee66264`. See [correction-round review](T02-review-round2.md) and [the next correction assignment](T02-corrections-round2.md). The original review below is preserved as historical evidence; T03 remains unreleased.

Decision: **CHANGES_REQUESTED**. Keep PR #4 draft. T03 is not released.

Review date: 11 November 2026, Africa/Cairo.

- PR: https://github.com/MohamedAlksas/LawyerOS/pull/4
- Implementation branch/upstream: `feature/t02-runtime-ci` / `origin/feature/t02-runtime-ci`.
- Accepted, integrated T01 base: `d3fd8f8b5e110858605092553d05911c2914ba37`.
- Inspected implementation: `9130333f329bd2596a29393ce8a172b8f4cfcb4f`.
- Inspected published PR head: `017015d92504564278f5027ddce46f0587058404`.
- Implementation-to-head diff changes only `docs/reviews/T02-submission.md`.
- Diff reviewed: `git diff d3fd8f8b5e110858605092553d05911c2914ba37...017015d92504564278f5027ddce46f0587058404` (17 files).
- Review checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t02-review`. The active `D:/Lawyer` checkout was preserved.

Codex inspected the implementation and independently exercised its public behavior. Separate Standards and Spec reviewers inspected the pinned diff; their findings are retained below as separate axes. Shared finding IDs identify overlap without treating the two axes as separate defects. The correction assignment is [T02-corrections](T02-corrections.md).

## Standards

1. **R01 / P1 — Integration success does not require PostgreSQL success.** `tests/integration/db-readiness.test.ts:41–62` returns normally when configuration is absent and accepts an error when the database is unavailable. Under `.agents/skills/lawoffice-testing/SKILL.md` and `docs/REVIEW_PROTOCOL.md`, meaningful real PostgreSQL evidence cannot be replaced with a successful result that accepts either outcome. Reproduction: remove both database variables and run `npm run test:integration`; all three tests pass. Set an unreachable synthetic `TEST_DATABASE_URL` and run only the live case; it still passes. Expected: the required live case fails on either condition. Impact: CI can pass without proving a working database.

2. **R02 / P1 — Test isolation is optional.** `src/lib/env.ts:52–56` falls back to `DATABASE_URL` in test mode when `TEST_DATABASE_URL` is missing; the integration test independently repeats that fallback at line 42. The foundation/testing instructions require a disposable database separate from operational databases. A call to `validateEnv({ NODE_ENV: 'test', DATABASE_URL: operationalExample })` accepts the operational URL. Expected: reject missing explicit test configuration before connecting. No destructive operation currently exists; this is an unsafe foundation for subsequent database tests.

3. **R03 / P2 — Production connections are not reused or tracked for shutdown.** `src/lib/db.ts:36–38` caches only outside production, while `closeDbPool()` at lines 118–123 closes only that cache. Two production calls to `getDbPool()` return different pools. This violates T02's reusable connection requirement. Repeated readiness requests create independent pools, and the advertised teardown cannot close them. Expected: bounded shared ownership and reliable shutdown in production too.

4. **R04 / P2 — A timed-out probe retains its running query/client.** `src/lib/db.ts:63–79` races a timer without cancelling or bounding the underlying query. A controlled pending-query reproduction returns a timeout while its acquired client remains unreleased; release occurs only after the query is manually completed. The task promises a bounded probe and safe failure handling. Expected: bound acquisition and query execution, dispose of unusable connections, and demonstrate subsequent probes recover without pool exhaustion. This reproduction uses a controlled pool seam; it does not claim a real network stall was induced.

No additional style-only or baseline code-smell finding is asserted.

## Spec

1. **R01 / P1 — Required live database proof is missing.** T02 says: "Implement meaningful tests for environment validation and database readiness" and requires a disposable PostgreSQL CI service. The live case at `tests/integration/db-readiness.test.ts:41–62` accepts a failed probe and silently returns when unconfigured. Require an explicit successful probe and verified disposable database identity. Separate negative cases must assert failure rather than weakening the positive case.

2. **R02 / P1 — Required database separation is not enforced.** T02 says: "Use a synthetic test database distinct from development/production." `src/lib/env.ts:54–56` and integration-test line 42 permit the operational fallback. Require a test-only target and negative evidence for absent/misrouted configuration. CI currently points both variables at its one disposable database; this alone is not evidence of operational database access. Do not implement a simplistic URL-inequality rule that rejects a genuinely isolated CI database.

3. **R05 / P2 — Missing configuration is validated lazily, outside readiness error handling.** T02 requires missing required variables to fail clearly and startup/missing-variable behavior to be tested. `src/lib/env.ts:99–103` is reached only through a database request; `src/lib/db.ts:57` obtains the pool before the `try`. With configuration missing, the actual readiness handler rejects with `EnvironmentValidationError` instead of returning its documented response. Expected: an explicit, tested runtime-startup validation boundary and sanitized handling of any configuration error reaching readiness. No HTTP process-startup claim is made from the handler-level reproduction.

4. **R03 / P2 — Reusable production connection is partial.** T02 explicitly requests "a reusable server-only database connection." Production calls create separate pools (`src/lib/db.ts:36–38`) and the public shutdown helper does not own those instances. Verify reuse and teardown in production mode, not only development HMR.

5. **R06 / P2 — Deferred E2E returns a successful test exit.** `package.json:13` prints a deferral then exits zero. T02 says: "do not make an empty test suite look like success." Keep E2E explicitly deferred without implying execution or passing coverage. A command convention can return a clearly documented non-success status until coverage exists; implementing future T04/T16 journeys is outside this correction.

No authentication, domain CRUD, or other feature scope creep was found.

## Additional integration gate

**R07 / P2 — Maintained planning output is stale, and its required workflow is red.** [Planning validation run 42930236768](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42930236768), job `130226840759`, fails at "Check maintained text deliverables are current". Regeneration adds the new README local-startup section to `outputs/LawOffice-OS-Master-Plan.md`. The repository requires regenerated deliverables when canonical sources change. Regenerate and commit the maintained output; do not remove or weaken this check.

README lines 39–68 also do not describe starting the isolated test Compose service or supplying test environment variables to Vitest. Copying `.env.example` to `.env.local` is not, by itself, evidence that this test runner loads it. Correct this procedure alongside R01/R02, and verify the documented commands from a clean environment.

## Independent verification

Environment: Windows, Node `v26.13.0`, npm `11.20.0`, Vitest `5.1.0`, PostgreSQL `16.8-alpine` in a Codex-created disposable container with synthetic credentials, tmpfs storage, and a random loopback host port. No office database, documents, or development container was modified.

| Check | Actual result |
|---|---|
| `npm.cmd run lint` | Exit 0 before creating ignored review probes |
| `npm.cmd run typecheck` | Exit 0 |
| `npm.cmd test` | Exit 0; 8 unit tests passed |
| `npm.cmd run test:integration`, both database variables absent | Exit 0; all 3 reported passed, confirming R01 |
| `npx.cmd vitest run tests/integration/db-readiness.test.ts -t 'probes a live database'`, unreachable explicit test URL | Exit 0; 1 passed, 2 skipped, confirming R01 |
| Independent ignored behavioral reproductions | 6 passed with PostgreSQL running: R02, R03, R04, strict real connection/identity, actual health handlers, missing-config handler rejection |
| Same reproductions with only the review container stopped | Exit 0; 6 passed with explicit down expectations; readiness handler 503, liveness handler 200 |
| Recovery after restart | Exit 0; 6 passed; strict live probe and readiness handler 200 after rediscovering Docker's newly assigned host port |
| Actual configured PostgreSQL identity | `current_database()` was `lawoffice_review_test` |
| Hosted application CI at inspected head | [Run 42930236827](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42930236827) succeeded; its permissive live assertion still needs R01 |
| Hosted planning validation | Failed, as R07 describes |
| `npm.cmd run build`, local review checkout | Exit 1 twice, including an unrestricted retry: Turbopack failed writing `/page` while spawning the CSS-processing Node child, which exited before connection. Root cause unconfirmed. Hosted Linux build succeeded; local build is not recorded as passed |

Restricted network execution initially caused two existing negative tests and the strict live reproduction to fail; unrestricted reruns produced the results above. Those initial failures are not attributed to application behavior. The first recovery attempt still used Docker's pre-restart random port and correctly returned unavailable; rediscovering the port established recovery. Neither observation is hidden as a passing run.

Local `npm ci --no-audit --no-fund` was initiated in the isolated checkout, and installed tools were available for the checks above; the completed install exit was not retained, so it is not claimed as independent clean-install success. Hosted CI's clean install did complete. New submission evidence must retain the actual clean-install result.

The six ignored reviewer probes are diagnostic reproductions, not application regression tests or new delivered coverage. The correction must add appropriate permanent tests. Health behavior above invokes the real route handlers against PostgreSQL; full HTTP server startup and browser E2E were **NOT RUN**. No UI change requires a new visual acceptance in T02. Production deployment and real-data use remain outside scope.

## Required resubmission

Address R01–R07 on the existing branch/PR, investigate and report the local build failure, retain meaningful positive and negative assertions, correct the startup/test instructions, and submit fresh exact-head evidence. All listed corrections concern T02's foundation or its required integration checks and block this task's acceptance. Do not mark this report ACCEPTED yourself or begin T03.

Publication adds this review and its correction assignment only; application/configuration/test files remain the implementer's responsibility. The final delivery message records the review-only pushed commit SHA. Any later implementation change requires another review.

Standards: 4 findings, highest severity P1 (real database evidence and test isolation). Spec: 5 findings, highest severity P1 (the same two required behaviors). Additional integration gate: R07. The axes deliberately retain overlapping findings.
