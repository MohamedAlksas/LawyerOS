# Antigravity — T02 correction round 4

Status: **CHANGES_REQUESTED**. Continue only T02 on `feature/t02-runtime-ci` / [draft PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). No T03, merge, deployment, or real client data.

## References and exact checkpoints

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/tasks/T02.md`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, and `docs/reviews/T02-review-round4.md`.

Load and record the actual paths read:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-foundation/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`

Latest inspected published head: `3b9a53b69842dbb7a235199d2b50d287d3130329`. Application checkpoint: `e4b2b68cdb87cca44139a04354ea31aad278fe1a`. Current fetched main: `66d314f0c6c01d5522098a70329de6b3190c0c28` (owner-integrated Graphify tooling). Fetch and inspect incoming Codex review changes; preserve them. Integrate the newer main safely at a clean checkpoint before source edits; resolve derived planning outputs through regeneration. If untracked owner-installed Graphify files overlap incoming tracked files, use an isolated integration checkout and preserve the active installation. Do not clean/delete/stash or overwrite someone else's assets to make a merge work. Keep publication on the existing remote task branch without force or direct-main pushes.

## Actual native ownership

The previous three-child execution is now independently verified; do not repeat the earlier blanket blocked diagnosis. Required roles remain:

| Role | Canonical definition | Runtime alias | Required profile |
|---|---|---|---|
| Lead | `.agents/agents/agency-devops-automator.md` | `lawoffice-native-devops-automator` | `.agents/skills/engineering-devops-automator/SKILL.md` |
| Backend support | `.agents/agents/agency-backend-architect.md` | `lawoffice-native-backend-architect` | `.agents/skills/engineering-backend-architect/SKILL.md` |
| Test support | `.agents/agents/agency-test-automation-engineer.md` | `lawoffice-native-test-automation-engineer` | `.agents/skills/testing-test-automation-engineer/SKILL.md` |

Existing actual child IDs were lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`, backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`, and test `db5fe921-b956-41a0-8960-044838a849d9`. Reuse them only if the runtime exposes those real sessions; otherwise launch proper distinct children through the documented bounded registration path. Do not fabricate reuse. Each child reads the updated assignment and actual profile/project skills, verifies current SHA and ownership, and returns a read-only preflight before dependent edits. The native lead alone implements; supports review a new committed frozen checkpoint read-only, then the lead reconciles. Preserve inherited model, no nested children, at most three active children. If required native execution fails, stop with `BLOCKED_NATIVE_AGENTS`; no coordinator implementation bypass.

After main integration, use `docs/GRAPHIFY.md` and `.agents/skills/graphify/SKILL.md` for supplementary local code-only navigation when useful. Record the graph's source commit and limits. It does not replace source/driver inspection, required checks, or native execution.

## R16 — Complete the explicit supported URL policy

Reproduce these two remaining cases through **public `validateEnv`**, without any network connection. Compare only installed `new pg.Client({ connectionString }).connectionParameters` host/port/database; never call `connect` or introduce parser file access.

1. Operational URL `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test`; test URL `postgresql://synthetic:synthetic@127.0.0.%31:5432/lawoffice_test`. The guard accepts both; the actual driver decodes the hostname and routes identically.
2. Operational URL `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test?HOST=unused.invalid`; test URL `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test`. The guard lowercases the operational query key and sees a different host; the driver does not use uppercase HOST for routing. Both actually route identically.

Fix the boundary, rather than adding exceptions for only these strings. Choose the smallest explicit policy: reject unsupported/ambiguous forms consistently on both original inputs **before comparison and before the operational URL is replaced**, or compare a clearly bounded supported grammar with actual driver semantics. Do not claim full pg URL compatibility while partially reimplementing its parser. Do not broadly call a parser that may read SSL certificate/key files just to obtain an identity. Preserve ordinary documented `?schema=public`, explicit disposable targets, localhost/loopback and IPv6 handling, and sanitized failures. Keep existing fixed routing-query and reserved-path regressions.

Add focused connection-free public-boundary tests for both cases and valid distinct targets. Include actual driver-identity comparison in regression evidence, not only assertions against the application's own normalization helpers. If unsupported hostname/query forms are rejected instead, demonstrate rejection on either input. Consider case and duplicate-parameter behavior under the chosen policy; unsupported representations should fail closed.

Allowed source scope: `src/lib/env.ts` and focused `tests/unit/env.test.ts` changes. Change integration tests only if needed to protect the existing before-pool-construction boundary. No pool implementation rewrite, dependencies, auth, domain models, or unrelated URL features.

## R21 — Make the pool-budget evidence accurate

The `boundedPool` test in `tests/unit/db-pool.test.ts` implements and proves its own MAX_BUDGET queue. It is not evidence that the actual delivered singleton enforces that queue. Keep the valid configured-options assertion and useful concurrent readiness/client-release behavior. Either exercise the actual delivered pool's resource bound through a meaningful controlled driver seam, or narrow the test/report claim to the behavior actually observed and explicitly record the missing actual-pool queueing evidence. Do not add another hand-written limiter or change production pool code merely to satisfy an assertion.

The configuration-loader regression is accepted as present for this slice; preserve its isolated synthetic temporary directory and cleanup. No rewrite is requested.

## Validation and handoff

Run lint, typecheck, unit tests locally and with explicit `CI=true`, real PostgreSQL integration against an owned disposable test instance, build, and planning validators/regeneration. Preserve earlier startup/HTTP observations with their true dates/checkpoints; do not imply a historical run occurred on new code. Check current startup validation as affected by the new supported-input policy. Keep E2E explicitly deferred/nonzero. Both hosted workflows must succeed at the new published head.

Update `docs/reviews/T02-submission.md` with exact loaded paths, chosen supported-input policy, actual driver comparison and rejection results, R16/R21 dispositions, native IDs/ownership/profile hashes/checkpoint reviews/reconciliation, executed commands and limitations, and full implementation/publication SHAs obtained from Git. Required runtime definition paths and result references should be recorded if observable. Distinguish report-only publication without a self-referential invented SHA. Keep all owner assets. Stop for independent Codex review on PR #4; no self-approval or main merge.
