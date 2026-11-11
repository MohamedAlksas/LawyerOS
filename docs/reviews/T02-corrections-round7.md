# Antigravity — T02 correction round 7: reliable startup-test evidence

Continue **T02 only**, branch `feature/t02-runtime-ci`, same [draft PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). **R16's URL grammar, R21's pool evidence and R24's natural startup exit are resolved. Preserve their implementation.** The remaining slice is the startup-process test harness, not production startup behavior. No main merge, T03, deployment or real data.

## Exact scope and role decision

Inspected published head: `f54d2cd5b92e53c8bec25773dfa753d44c36d3bd`; implementation: `812d95e6a00552a3bc8a49653ff6ef43a35bf8f8`. Safely fetch and fast-forward the incoming review. Latest fetched main is `edc4118d5e46170661ee4a39862a23fe7be1b7b6`, the owner's merged specialist-routing policy. Integrate it safely at a clean checkpoint, preserving the existing task branch, native registration compatibility, owner assets and incoming review. Regenerate derived output conflicts from canonical sources. No reset, automatic stash, deletion or force push.

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/tasks/T02.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md` and `docs/reviews/T02-review-round7.md`. Load:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`
- `.agents/skills/lawoffice-foundation/SKILL.md`

**Codex's explicit slice-level routing refinement:** Test Automation leads because the production startup correction works and the remaining defects are assertion quality, test-target validation and build provenance. This overrides T02's generic DevOps lead for this slice under the owner-approved routing policy. It is not a native-preflight exception or an implementer-selected substitution.

| Role for this slice | Canonical definition | Runtime alias | Required installed profile | Ownership/checks |
|---|---|---|---|---|
| **Lead: Test Automation** | `.agents/agents/agency-test-automation-engineer.md` | `lawoffice-native-test-automation-engineer` | `.agents/skills/testing-test-automation-engineer/SKILL.md` | Own `tests/integration/startup-process.test.ts`, minimal test/build command wiring or existing test instructions if needed; implement R27–R29 and reconcile |
| Backend support | `.agents/agents/agency-backend-architect.md` | `lawoffice-native-backend-architect` | `.agents/skills/engineering-backend-architect/SKILL.md` | Read-only frozen audit of original URL-pair validation, disposable-target boundary, and what HTTP assertions establish |
| DevOps support | `.agents/agents/agency-devops-automator.md` | `lawoffice-native-devops-automator` | `.agents/skills/engineering-devops-automator/SKILL.md` | Read-only frozen audit of fresh build attribution, Windows/POSIX owned-process cleanup and CI execution |

Previously verified sessions are Test Automation `db5fe921-b956-41a0-8960-044838a849d9`, backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`, DevOps `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`. Reuse only real exposed sessions, with the new roles/ownership explicitly acknowledged. **Verify that the Test Automation lead actually has the assigned write capability.** If its former support session is read-only, prepare a task-owned native writer session with the same verified profile via the live supported registration mechanism; record its real definition/type/permissions/ID. Do not have the old DevOps lead implement the test slice as a workaround. If required native capability fails, stop as `BLOCKED_NATIVE_AGENTS` with the exact missing capability.

All three complete an updated read-only preflight at the current SHA before source edits. Inherit the selected model; no nested children or unrelated roles. One test-file writer; supports remain read-only. Commit a frozen checkpoint, obtain independent support findings and lead reconciliation, and rerun affected checks after changes.

## R27 — Make readiness failures fail the regression

Codex ran the current valid-startup test against an explicit dedicated-test URL on a closed loopback port. The actual responses were live **200**, ready **503**, and the test still passed. In `startup-process.test.ts:281–296`, status gating skips assertions for non-200 responses and the empty catch swallows network/JSON/assertion failures.

Require a valid explicit disposable test database for the positive process test. Assert readiness status **200**, expected JSON fields and no-store headers without a swallowing catch or status-dependent omission. Fetch/JSON/assertion failures must fail the test. Use bounded request/startup timeouts; preserve natural-exit watchdog failure and exact owned-process cleanup.

Prove a positive run against owned disposable PostgreSQL passes. Then demonstrate that the selected positive test returns nonzero against a known unavailable synthetic test endpoint. Do not commit an intentionally failing default test, accept either HTTP outcome, or weaken the old strict database suite. Preserve assertion failures for wrong JSON/header values as well as status failures.

## R28 — Enforce the shared isolation boundary before spawning

Do not copy arbitrary `TEST_DATABASE_URL` into a production child and do not fall back to a development URL. Before any valid-server child launch, require the explicit test target and call the existing public shared validator in **test mode**, using the original operational/test pair before either value is overwritten. Supply only its validated selected target to the production-mode child. A child legitimately runs in production to test actual startup, but its parent must establish isolation first.

Use connection-free negative evidence for missing test URL, development/production targets, identical operational/test targets, and the already-rejected equivalent URL representations. Each must fail before server launch/connection. Preserve the original operational URL so comparison remains meaningful. Never contact an operational database to demonstrate rejection. Keep real integration on an owned disposable instance and synthetic records only.

## R29 — Attribute the artifact to the tested checkpoint

An existing `.next/` directory is not proof that it was built from the current source. Establish a fresh build as an explicit prerequisite of the repeatable process test, or verify recorded build/source provenance before reuse. Prefer a small explicit fresh-build prerequisite over a new caching/fingerprint framework. Record the frozen source checkpoint and actual build command/result. A stale/partial/unattributed artifact must not be silently accepted. Use isolated workspaces for competing builds; preserve legitimate build-time behavior and bounded ownership/teardown.

Allowed application change scope is the test file and minimal existing test/build command or README wiring necessary for these three requirements. No production URL-parser, pool, instrumentation, auth/domain, new dependency, selected model or stack change is requested. The coordinator owns the submission/report updates and publication.

## Checks, cleanup and handoff

If Docker is unavailable, report it rather than fabricating a live pass or selecting another database. Review container `lawoffice-codex-t02-r7` (ID `57c3d1ede45a9ab06186a4ea9230bc3a94548a4fc2024503f9f093c45aef16d0`, label `lawoffice.review=t02-r7`) had not been confirmed removed when Docker became unavailable. When available, verify that identity/label and stop only that review-owned container if still present; do not treat an absent container as a failure or touch other resources.

Run lint/typecheck, 43 existing units locally and with explicit CI=true, full real PostgreSQL integration and startup tests against a fresh attributable build, the bounded negative-readiness check, test-target rejection evidence, both planning validators and PowerShell 7 regeneration. Keep E2E and pool saturation explicitly deferred. Capture original process exits, HTTP observations and owned teardown separately. Correct report wording to say a port is closed after exit unless transient non-binding was actually measured.

Hosted application run `43068984932` / job `130691461634` and planning run `43068984920` / job `130691450592` are independently verified at old head `f54d2cd...`; new source requires new hosted results. Keep exact full SHAs from Git, native role-refinement rationale/profile paths/hashes/permissions/IDs, file ownership, frozen support findings, lead reconciliation, actual commands/exits/limits, and verified branch/PR publication metadata. Publish to the same PR/branch and stop for Codex review. No self-approval or merge.
