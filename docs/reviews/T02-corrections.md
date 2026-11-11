# Antigravity assignment — T02 corrections, round 1

Implement these corrections in English-named code/docs for the existing Arabic RTL LawOffice OS project. Codex owns planning and acceptance; you implement, test, and submit. Task status is **CHANGES_REQUESTED**. Work only on T02, not T03.

## Git and ownership

- Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Existing task branch: `feature/t02-runtime-ci`; existing draft PR: https://github.com/MohamedAlksas/LawyerOS/pull/4; target `main`.
- Original task base: `d3fd8f8b5e110858605092553d05911c2914ba37`. Previous inspected PR head: `017015d92504564278f5027ddce46f0587058404`.
- Inspect branch, status, remote, worktrees, and fetched branch before editing. Codex has published review documentation after that inspected head: preserve it and integrate the current remote branch with an ordinary fast-forward where possible. Do not reset or overwrite local changes. If the checkout is shared/dirty, use an isolated worktree without switching somebody else's checkout.
- Push coherent fixes to this same branch and update PR #4. No new feature branch/PR for this correction, no direct-main push, no force-push, no merge, and no self-approval. Keep the PR draft until Codex's independent follow-up.

## Mandatory skills and roles

Read these actual project files in full before editing, expanding paths from the current checkout:

1. `.agents/skills/lawoffice-delivery/SKILL.md`
2. `.agents/skills/lawoffice-foundation/SKILL.md`
3. `.agents/skills/lawoffice-testing/SKILL.md`

Read `docs/AGENCY_AGENTS.md` and the T02 entry of `docs/AGENCY_AGENT_ROUTING.json`. Use the installed profiles below:

| Role | Required YAML name | Installed file |
|---|---|---|
| Lead implementation | `agency-devops-automator` | `C:/Users/Alksas/.gemini/config/skills/engineering-devops-automator/SKILL.md` |
| Supporting backend pass | `agency-backend-architect` | `C:/Users/Alksas/.gemini/config/skills/engineering-backend-architect/SKILL.md` |
| Supporting test pass | `agency-test-automation-engineer` | `C:/Users/Alksas/.gemini/config/skills/testing-test-automation-engineer/SKILL.md` |

Verify actual YAML names and SHA-256 against the routing registry. If a required file is unreadable, missing, or mismatched, stop dependent work and report the exact path/name; do not silently substitute/install a profile. Apply the lead profile during implementation, backend guidance to environment/pool/probe lifecycle, and test guidance to permanent regressions and CI. Use sequential scoped profile passes unless actual supported delegation is explicitly authorized. Reading a profile does not mean a separate agent was spawned. Report actual paths, names, hashes, applied guidance, and supporting findings/actions.

Read `AGENTS.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `GEMINI.md`, `docs/tasks/T02.md`, `docs/reviews/T01-review.md`, `docs/reviews/T02-review.md`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md`, and T02's named architecture/operations/dependency references. Preserve the accepted stack and synthetic-data-only restriction.

## Owned scope

Environment/database helpers, minimal startup validation wiring, existing health routes, targeted unit/integration tests and test configuration, package commands, existing T02 Compose/CI files if needed, README startup/test instructions, relevant dependency notes if compatibility facts change, derived planning artifacts, and `docs/reviews/T02-submission.md`.

Preserve Codex's review verdict and assignment. Do not implement authentication, business models, domain UI, production deployment, SaaS, offline sync, or AI features. No existing unknown database may be reset or used to prove isolation.

## Required corrections and acceptance evidence

### R01 — The live integration case must fail when the database is unavailable

- Remove the silent normal return for missing test configuration and the branch that treats a failed live probe as passing.
- Require an explicitly configured disposable test target, a successful real PostgreSQL probe, and evidence of the expected test database identity. Do not replace it with mocks, `skip`, `todo`, or a conditional success.
- Keep negative cases separate. Show the integration command returns nonzero when its required test target is absent, unreachable, or configured with wrong credentials, and zero with the intended disposable database running.
- Avoid depending on an arbitrary external "unroutable" IP or an assumed unused fixed port to deterministically produce a timeout. Use a controlled stall for lifecycle assertions, plus real PostgreSQL for positive connectivity and stop/recovery.

### R02 — Test configuration must fail closed

- Remove operational `DATABASE_URL` fallbacks from test database selection, including direct selection in integration tests.
- Require explicit test configuration and verify the disposable target before any stateful test setup. Reject a local test target that resolves to the operational database; comparing raw URL strings alone does not prove isolation.
- CI may use the same explicit disposable target for both variables because it provisions no operational database. Make that context unambiguous without creating a bypass that accepts an arbitrary operational target.
- Add behavior tests for missing test URL and operational-target misuse; verify they fail before a connection/write/reset is attempted. Preserve a valid isolated-CI path. No destructive tests are needed for T02.
- Document a reliable way for Vitest to receive the synthetic test variables. Do not assume `.env.local` is loaded merely because Next.js loads it.

### R03 — Own and reuse the production pool

- Reuse a bounded pool in production as well as development, with appropriate HMR handling, and make `closeDbPool()` close the owned pool.
- Demonstrate repeated production-mode use does not create independent pools/connections and shutdown closes resources. Ensure clean recreation works when intended. Avoid exposing credentials in assertions/logs.

### R04 — Bound the work behind a readiness timeout

- Bound connection acquisition and query execution, not only the promise returned to the HTTP caller. Ensure a timed-out query cannot retain a checked-out client indefinitely or later hand back an unusable connection.
- Add a controlled pending-query/acquisition case that proves cleanup and a subsequent healthy probe. Include repeated timeouts to demonstrate bounded resource use. Real PostgreSQL positive checks remain required.
- Do not release the same client twice, close a healthy shared pool per request, or rely on a race timer alone as proof of cancellation.

### R05 — Validate runtime configuration at an explicit boundary

- Add a supported runtime-startup validation boundary so missing/invalid required configuration produces a clear sanitized failure before a server is presented as correctly configured. Preserve builds that legitimately do not require live runtime secrets; document the boundary.
- Catch/sanitize configuration failures if they can reach readiness. The documented readiness interface must return a controlled unavailable response rather than an unhandled exception/HTTP 500. Liveness remains independent of database availability for a validly configured process.
- Demonstrate missing/invalid-variable startup behavior and absence of secret values in logs and responses. Test actual application behavior, not just a schema helper.

### R06 — Deferred E2E must not return a false pass

- Keep the `test:e2e` command convention, but make its current deferred status explicit and non-successful until actual tests exist. A small cross-platform command that prints NOT RUN and exits nonzero is sufficient.
- Document that this command is intentionally excluded from T02's required executed suites. Do not add future application journeys merely to obtain a green result.

### R07 — Restore maintained output and green planning validation

- Correct README to show separate development and test Compose startup, explicit matching ports/URLs, how test variables are loaded, health waits, and safe teardown limited to the disposable test environment. Do not remove development volumes.
- Run the repository's prompt/package generation and validation scripts, then commit updated maintained deliverables. Review the generated diffs rather than hand-editing derived copies.
- Keep `.github/workflows/planning-validation.yml` and its freshness check effective. Both application CI and planning validation must pass at the final pushed implementation head.

### Local build evidence gap

Codex's local `npm run build` failed twice in the isolated Windows checkout: Turbopack failed writing `/page` while the CSS-processing Node child exited before connection. Linux application CI at the old head passed. Reproduce from a fresh install in your environment, retain exit/log evidence, and investigate if it fails. Do not label the old local review build as passed or change dependencies/build tooling speculatively. If it is platform/environment-specific, explain the demonstrated cause and remaining limitation; Codex decides acceptance.

## Verification and submission

Run and retain actual exit statuses for clean `npm ci`, lint, typecheck, unit tests, required real PostgreSQL integration, and production build. Execute the documented startup sequence using synthetic values and a clearly identified isolated test database. Verify actual health HTTP responses with the database running, stopped, and recovered: readiness 200/503/200 and liveness 200 throughout validly configured operation. Test missing-variable startup separately. Record E2E as NOT RUN/deferred, with its intentional non-success result.

Apply the backend and test supporting passes to the corrected behavior and record findings/actions. Update `docs/reviews/T02-submission.md` with a row for every R01–R07, changed files, tests/negative runs, environment, actual loaded skills/profiles, safe startup/recovery steps, remaining limits, base/branch/upstream, inspected implementation SHA, local HEAD, independently verified pushed SHA, PR URL, and actual hosted workflow results. Do not use a report-only commit to hide intervening implementation changes. Keep secrets, real data, node_modules, `.env` files, and `work/` out of Git.

Stop for Codex review of the new pushed head. A green workflow or your own report does not mark T02 accepted, authorize a merge, or release T03.
