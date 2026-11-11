# T02 — Codex review of correction round 1

Decision: **CHANGES_REQUESTED**. Keep PR #4 draft; do not merge it or begin T03.

Reviewed on 11 November 2026, Africa/Cairo, in `C:/Users/Alksas/Documents/Codex/LawyerOS-t02-review`. The active `D:/Lawyer` checkout and its reinstalled agent assets were preserved. Application implementation remains Gemini's responsibility.

- PR: https://github.com/MohamedAlksas/LawyerOS/pull/4
- Task branch/upstream: `feature/t02-runtime-ci` / `origin/feature/t02-runtime-ci`.
- Original accepted/integrated T01 base: `d3fd8f8b5e110858605092553d05911c2914ba37`.
- Review fixed point: `628d5e1d44e18fa76caa7a13fb766239f97bb5e7`.
- Correction implementation: `698858e6f92d59b09141302b1627b6ecae6b8c42`.
- Inspected published head: `111c8256692f79fa8d22c243ec1ba2d52ee66264`.
- Implementation-to-head diff changes only `docs/reviews/T02-submission.md`.
- Pinned diff: `git diff 628d5e1d44e18fa76caa7a13fb766239f97bb5e7...111c8256692f79fa8d22c243ec1ba2d52ee66264` (18 files; two commits).
- Current main after the owner's PR #5 merge: `62494bad3eca1480d874e578e3cc5cd4926c6e40`.

Two fresh independent reviewers examined Standards and Spec. Codex separately reran checks and exercised real PostgreSQL behavior. The axes below preserve their distinct findings, with shared IDs for overlaps. The new assignment is [T02 correction round 2](T02-corrections-round2.md).

## Standards

1. **R08 / P1 — Local files override test mode.** `vitest.config.mjs:52–53` spreads `.env.local` after `NODE_ENV: 'test'`. Following README's template-copy procedure sets `NODE_ENV=development`; normal database helpers consequently select operational `DATABASE_URL`. Force test mode after file loading. Violates the foundation skill's disposable-database separation and prior correction R02.

2. **R09 / P1 — Operational target alias is accepted.** `src/lib/env.ts:48,88` compares undecoded pathnames. An operational `/lawoffice_test` and test `/law%6fffice_test` are accepted as distinct, although the installed PostgreSQL driver resolves both to the same database. Compare effective normalized connection identities. The blanket `CI=true` exception also needs a genuinely isolated CI design, not an arbitrary-target bypass. Standard: correction R02 and foundation/testing skills.

3. **R10 / P1 — Integration bypasses isolation validation.** `tests/integration/db-readiness.test.ts:32–38` connects from unchecked `TEST_DATABASE_URL`; `validateEnv` is not called. Operational configuration is contacted before the identity assertion, which can even pass for an operational database named `lawoffice_test`. Validate the explicit target before connection. Standard: R02's rejection-before-connection requirement.

4. **R11 / P2 — Hosted unit failure.** `src/lib/env.ts:69` lets ambient `CI=true` override explicit `source.CI='false'`. The existing operational-target unit test consequently receives a different rejection path, and committed CI fails. Make source precedence deterministic without weakening isolation or merely deleting assertions. Standard: R07's green application CI requirement.

5. **R12/R13 / P2 — Required behavioral evidence remains incomplete.** `tests/unit/db-pool.test.ts:62–80` labels a different healthy mock's first probe as recovery. No repeated timeout/shared-resource recovery or pending-acquisition regression is delivered. `tests/unit/env.test.ts:141` checks only the startup helper's type. Supply permanent lifecycle and actual startup/HTTP evidence. Standards: R04/R05 and meaningful-behavior testing rules. Codex's additional real-pool observations below distinguish this coverage gap from a proven remaining pool defect.

6. **R14 / P2 — Submission overstates evidence.** `docs/reviews/T02-submission.md:10` calls `698858e...` the final published head although the reviewed head is `111c825...`; line 4 also gives an incorrect full SHA for the previous Codex review commit. Lines 88–96 assert an unproven restriction/IPC root cause, and line 206 omits hosted outcomes. Correct the attestation, distinguish hypothesis from demonstrated cause, and report actual workflow results. Standard: the review protocol's exact-version and honest-evidence requirements.

Production pool ownership, acquired-client timeout eviction, controlled readiness errors, and explicit E2E deferral are substantive fixes. No baseline code-smell finding is asserted.

## Spec

1. **R10 / P1 — Integration still bypasses the required isolation boundary.** `tests/integration/db-readiness.test.ts:32–38` creates its pool directly. R02 requires misuse rejection "before a connection/write/reset is attempted". Checking identity after a probe does not meet that requirement. Route connection creation through the validated test-target boundary.

2. **R09 / P1 — Equivalent URLs evade rejection.** `src/lib/env.ts:48,69,88` compares undecoded pathnames and exempts `CI=true`. R02 requires rejection when a target "resolves to the operational database" and forbids "a bypass that accepts an arbitrary operational target". Normalize driver-effective target identity and constrain or remove the CI exception. This does not require pretending that genuinely isolated CI aliases are operational databases.

3. **R08 / P1 — The documented environment copy disables test mode.** `vitest.config.mjs:51–56` allows `.env.local`'s `NODE_ENV=development` to replace test mode. R02 requires configuration to "fail closed". Force the test environment after loaded values and test the documented setup path.

4. **R12 / P2 — Startup accepts malformed PostgreSQL configuration.** `src/lib/env.ts:14–16` accepts the prefix-only `postgresql://`; `src/instrumentation.ts:7` therefore accepts it at the new boundary. R05 requires "missing/invalid required configuration" to fail at startup. Validate the supported connection structure and test actual missing/invalid startup. The submission does not supply actual HTTP startup or 200/503/200 observations.

5. **R13 / P2 — Timeout recovery evidence is incomplete.** `tests/unit/db-pool.test.ts:42–80` uses an independent fresh healthy mock after the stalled mock. R04 requires a "controlled pending-query/acquisition case" and "repeated timeouts to demonstrate bounded resource use". Add meaningful permanent regression coverage on shared resources; a successful unrelated probe does not establish recovery.

R01's strict live assertion, R03's pool ownership, and R06's nonzero deferral are implemented. No application feature scope creep was found. R07's hosted evidence is still absent from the submission.

## Independent verification and practical limits

Windows, Node `v26.13.0`, npm `11.20.0`, Vitest `5.1.0`. PostgreSQL `16.8-alpine` was created specifically for this review with synthetic credentials, tmpfs, a unique ownership label, and a random loopback host port. Only that container was stopped, restarted, and removed. No operational database was accessed.

| Check | Observed result |
|---|---|
| `npm.cmd run lint` | Exit 0 |
| `npm.cmd run typecheck` | Exit 0 |
| `npm.cmd test`, without ambient CI | Exit 0; 17 tests passed |
| Same unit command with `CI=true` | Exit 1; 16 passed, 1 failed, reproducing hosted R11 |
| Required integration with the dedicated review database | Exit 0; 3 passed, including real identity and bad-password checks |
| Integration with no explicit test URL and no local env file | Exit 1 as required; 2 failed, 1 passed |
| Integration with both URLs pointing to the same disposable review target, `CI=false` | Exit 0; all 3 passed, demonstrating that the suite bypasses the isolation guard. The "operational" label existed only in synthetic test configuration |
| Documented `.env.example` copied temporarily to isolated `.env.local` | Independent reproduction passed: actual Vitest settings were `NODE_ENV=development`, and public `getEnv()` selected `/lawoffice_dev` instead of the test URL. No connection was made. The temporary file was removed after an ownership/hash check |
| Encoded equivalent target | Actual `pg.Client` parsing showed the two database identities equal; public `validateEnv()` nevertheless accepted them |
| Startup register with `NEXT_RUNTIME=nodejs`, production mode, `DATABASE_URL=postgresql://` | Actual `register()` resolved successfully, confirming R12. This was a module-boundary call, not a full HTTP process test |
| Repeated query stalls on one real pool | Three controlled `pg_sleep(0.2)` probes timed out at 40 ms; pool clients/waiters returned to zero, then a probe on that same pool succeeded |
| Late acquisition on one real pool | A held sole client caused a 25 ms timeout; after release, the late client was evicted, waiters/clients cleared, and the same pool recovered |
| Real health handlers, database running/stopped/recovered | Readiness 200/503/200; liveness 200. These invoke actual handlers with PostgreSQL, not HTTP/browser clients |
| `npm.cmd run test:e2e` | Exit 1 with explicit NOT RUN notice; browser coverage remains deferred |
| `npm.cmd run build`, no runtime database variables, unrestricted retry environment | Exit 1: Turbopack CSS child process exited before connection. Cause remains unconfirmed; it is not accepted as proof of a particular sandbox/firewall cause |

The five ignored public-behavior reproductions and the separate environment-loader reproduction passed their diagnostic assertions. They intentionally confirm remaining defects as well as successful pool behavior; they are not six delivered application regression tests. R03 is corrected. R04's acquired-client eviction, repeated real-pool recovery, and late-acquisition cleanup worked independently; R13 requests permanent regression evidence rather than claiming those reproduced behaviors remain broken.

Clean local reinstall was not repeated: the dependency lockfile was unchanged by the correction, existing isolated dependencies were reused, and the hosted clean install succeeded. Full application HTTP startup, browser E2E, production deployment, and real-data operation were NOT RUN. Missing HTTP/startup proof is explicitly part of the required R12 correction. No visual UI change was introduced.

### Hosted results at the inspected correction head

- [Planning validation 42935250150](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42935250150): **success** against the then-current base.
- [Application CI 42935250199](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42935250199), job `130243604142`: **failure** at unit tests, same R11 assertion reproduced locally. Clean install, lint, and typecheck passed; integration and production build were **skipped**. An older successful CI/build cannot establish success for this correction head.

## R15 — Integrate current main safely before resubmission

PR #5 has been merged by the owner at `62494bad3eca1480d874e578e3cc5cd4926c6e40`. A non-working-tree merge inspection confirmed conflicts only in:

- `outputs/LawOffice-OS-Planning-Kit.zip`
- `outputs/Planning-Validation.json`

README and master-plan text auto-merge, but all generated outputs must then be rebuilt from the reconciled canonical sources. Do not resolve generated conflicts by discarding the new native-agent policy or the T02 startup instructions. Preserve all owner-installed untracked assets; use an isolated worktree if needed. Native execution is a prospective requirement for the next correction assignment, not a retrospective claim or new failure attributed to the just-completed round.

## Required next submission

Follow [the round-2 correction assignment](T02-corrections-round2.md) for R08–R15. Preserve the fixed R01/R03/R06 behavior, integrate current main without losing files, use actual delegated lead/support sessions, rerun meaningful tests and both hosted workflows, and submit new inspectable version evidence. No self-approval, main merge, or T03 work.

This publication adds review documentation only. The final delivery message records the verified review-only pushed SHA; any subsequent implementation changes require review of their new head.

Standards: 6 findings, highest P1 (test isolation). Spec: 5 findings, highest P1 (test isolation). Integration gate: R15. Shared IDs retain the deliberate overlap between axes.
