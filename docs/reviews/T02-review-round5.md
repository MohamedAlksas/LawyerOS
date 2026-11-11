# T02 — Independent review of correction round 4

Decision: **CHANGES_REQUESTED**. Keep [PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4) draft; no T03 or main merge. Review date: 11 November 2026, Africa/Cairo.

- Inspected published head: `867b312c8dcec847dc18df7784dc382b5e0c911d`, independently fetched from `origin/feature/t02-runtime-ci`.
- Application checkpoint: `712c3b43ad4d9879dbddb2f1302eb604c9982ccc`.
- Correction diff: `git diff d37d84e1e86c4631ca44fe8ebcaa82aa29f6c22d...867b312c8dcec847dc18df7784dc382b5e0c911d`.
- Main integration `d37d84e1e86c4631ca44fe8ebcaa82aa29f6c22d` contains owner-integrated main `66d314f0c6c01d5522098a70329de6b3190c0c28`; ancestry verified. Existing accepted Graphify tooling is not new application scope.
- `867b312...` changes only the submission over `712c3b4...`.

Two fresh reviewers independently examined Standards and Spec. Codex separately exercised actual driver/public-boundary behavior and runtime checks. [Next correction](T02-corrections-round5.md).

## Standards

**R22 / P2 — Committed verification provenance remains incomplete.** `docs/reviews/T02-submission.md:223–224` replaces concrete PostgreSQL execution evidence with “Verified via hosted CI runner”; `:239–242` leaves workflow URLs/statuses to later delivery metadata. `docs/REVIEW_PROTOCOL.md` requires actual commands/exits/evidence/limits. Historical HTTP responses at `:162–201` retain timestamps without the original checkpoint label; the previous assignment explicitly required historical attribution and current-policy startup evidence. The external handoff provides valid hosted links, independently confirmed below, so this is an inspectable-report gap rather than a claim that CI failed. Update the committed report with actual run/head references, command/results, historical labels, and any NOT RUN limits; do not relabel prior observations as current execution.

**R21 is resolved.** The actual singleton-options assertion remains at `tests/unit/db-pool.test.ts:151`. The concurrent test at `:161` now checks readiness/client release without implementing its own budget queue. The submission explicitly marks actual pool saturation NOT RUN at `:287`. No additional actionable code smell or scope expansion is asserted.

## Spec

**R16 / P1 remains open — Accepted URLs can trigger a different driver preprocessing path.** The assignment requires a clearly bounded supported grammar matching driver semantics, rather than exception handling only for examples. `validatePostgresUrlStructure` passes the original string directly to `new URL` at `src/lib/env.ts:10`, as does normalization at `:95`. Installed `pg-connection-string/index.js:20–22` first repairs the entire original string when it contains a raw ASCII space or certain malformed percent escapes. This can change an otherwise valid encoded database name, so the application and driver compare different identities.

Use public `validateEnv({ NODE_ENV: 'test', CI: 'false', DATABASE_URL, TEST_DATABASE_URL })` with:

- Operational base: `postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test`
- Test URL: `postgresql://synthetic:synthetic@127.0.0.1:5432/law%256fffice_test`

Append either `?application_name=synthetic name` or `?application_name=%zz` to the operational base. **Both cases are accepted**, while constructing installed `new pg.Client({ connectionString }).connectionParameters`, without connecting, gives the same target for both URLs: host `127.0.0.1`, port `5432`, database `law%6fffice_test`. Independent follow-up also reproduced the same mechanism with `?application_name=%0z`, a `#%zz` fragment, and raw spaces in credentials. No database access was needed.

The boundary must reject raw unsupported syntax on both original strings before URL normalization hides it, or implement a supported grammar whose semantics actually match. The next assignment supplies a small lexical policy and a matrix covering the driver repair branch together; do not add more isolated exceptions.

The five previous driver-alias reproductions now reject correctly. Ordinary distinct targets, documented query options, IPv6, and existing database-path cases remain supported in inspected checks. R21's evidence is adequately narrowed. No additional material Spec finding or scope creep is asserted.

## Native evidence

Actual native reuse for this correction is verified, not inferred from the submission:

- DevOps lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`: fresh read-only preflight referencing `d37d84e...`, current profile/project-skill hash commands, actual edits to `env.ts`, environment regressions and the requested pool test, executed checks, and returned reconciliation referencing `712c3b4...`.
- Backend support `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`: current-head/profile checks and returned frozen-checkpoint audit; no application writes observed.
- Test support `db5fe921-b956-41a0-8960-044838a849d9`: current-head/profile checks, actual lint/typecheck/local and CI unit commands, and returned `712c3b4...` audit; no application writes observed.

These are the previously verified distinct sessions with their earlier profile reads, reused through actual parent messages at records 1874/1876/1878. Phase B authorization appears at 1890; frozen support assignments at 1906/1908; reconciliation request at 1914. Bounded tool/public-result inspection excludes transcript dumps from this report. Native execution succeeds, but its zero-finding audits do not establish application correctness.

## Independent checks and derived-artifact reconciliation

- Lint and typecheck: exit 0.
- Unit tests: **35/35** locally and **35/35** with explicit `CI=true`, exits 0.
- Five prior aliases: rejected. Two new repair-branch cases: accepted despite equal actual driver targets, reproduced through `node work/round5-driver-extended.cjs`. Its exit 0 confirms reproduction, not a passing isolation boundary.
- Real PostgreSQL integration: **4/4**, exit 0, against a new review-owned `postgres:16.8-alpine` instance using tmpfs, synthetic data and private loopback port 10690. Container ID/label were checked before stopping/removing it; no operational instance was used.
- Local `npm.cmd run build`: **exit 1**, same Turbopack CSS-worker process/connection failure signature seen in earlier isolated reviews. No change to CSS or its pipeline was submitted; the root cause remains unconfirmed. Do not report a local build pass or infer an environment cause as proven. No additional local HTTP startup drill is claimed from a partially built artifact.
- Exact inspected-head hosted application [run 43050622492](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43050622492): **success**, including clean install, integration tests and build. Exact-head planning [run 43050622427](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43050622427): **success**. Results independently fetched by `867b312...`.
- Both local planning validators: exit 0. PowerShell 7 planning regeneration: exit 0, **71 sources / 253 ZIP entries / zero broken links / matching source hashes**.
- **R23 / P2, repaired by Codex in this review publication:** the submitted ZIP retained older main-branch copies after merge resolution. An independent entry comparison found **29 text-content differences** against current canonical sources (README, native registration policy, all 23 task cards and related routing/generation files). There were 33 byte-level differences, four of which disappeared after line-ending normalization. The ZIP has now been regenerated from canonical sources and rechecked. No application edits were needed. A successful planning workflow alone did not prove that the previously committed ZIP matched its sources.

Review publication contains review/assignment and regenerated derived outputs only. Codex did not alter application code or the active `D:/Lawyer` checkout. Owner-installed assets remain preserved. Browser E2E, auth, domain features and actual-pool saturation remain outside the claimed evidence.

Standards: 1 remaining finding, highest P2 (report provenance). Spec: 1 remaining finding, highest P1 (driver repair branch). R23 is the additional artifact check repaired by Codex, not a new application implementation assignment.
