# Antigravity — T02 correction round 2

Status: **CHANGES_REQUESTED**. Implement only the remaining T02 foundation corrections. Codex reviews; you implement and submit. Do not begin T03.

## Starting state and ownership

- Origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Existing remote task branch: `feature/t02-runtime-ci`; same draft PR: https://github.com/MohamedAlksas/LawyerOS/pull/4.
- Last inspected correction implementation: `698858e6f92d59b09141302b1627b6ecae6b8c42`; inspected PR head: `111c8256692f79fa8d22c243ec1ba2d52ee66264`.
- Current main includes owner-merged PR #5, integration commit `62494bad3eca1480d874e578e3cc5cd4926c6e40`, with actual native-agent execution requirements and 155 local profile copies.
- Codex's subsequent review-only commit adds `T02-review-round2.md`, this assignment, and a latest-review notice in `T02-review.md`. Fetch and preserve it.

Inspect actual status, branch/upstream, remote, worktrees, and heads. Preserve all owner work, including untracked `.agents`, `.codex`, and `.opencode` assets. Do not run `git clean` or delete/move those assets to satisfy a validator or make a merge convenient. The owner already had to reinstall them after the previous cleanup.

Integrate current main safely before dependent application edits. Use an isolated worktree if the active checkout has owner-installed untracked files or is shared. An ephemeral local integration branch/worktree may be used to preserve that checkout; publish the final coherent updates to the existing remote feature branch and PR, reporting the actual local state honestly. Do not create another published task branch/PR, force-push, reset, automatically stash, or switch someone else's checkout. The coordinator owns Git integration/publication.

A merge inspection found generated conflicts in `outputs/LawOffice-OS-Planning-Kit.zip` and `outputs/Planning-Validation.json`. Reconcile canonical sources first, retain T02 startup documentation and PR #5's native policy/catalogue/profiles, then regenerate outputs with the current main scripts. README/master text auto-merged in inspection; still review their resulting content. Do not use the old exactly-seven-total-skills validator or remove extra profiles.

## Required actual agents

Read the integrated `AGENTS.md`, `GEMINI.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/tasks/T02.md`, the latest review, and the relevant architecture/operations/dependency/review/Git references.

Load these project skills in the coordinator and in each child as applicable to its owned slice:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-foundation/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`

The coordinator must actually invoke these native definitions in distinct sessions:

| Role | Native definition | Profile read in that child |
|---|---|---|
| Lead implementation: `agency-devops-automator` | `.agents/agents/agency-devops-automator.md` | `.agents/skills/engineering-devops-automator/SKILL.md` |
| Backend support: `agency-backend-architect` | `.agents/agents/agency-backend-architect.md` | `.agents/skills/engineering-backend-architect/SKILL.md` |
| Test support: `agency-test-automation-engineer` | `.agents/agents/agency-test-automation-engineer.md` | `.agents/skills/testing-test-automation-engineer/SKILL.md` |

Verify the running session exposes `invoke_subagent`, discovers the definitions, supports their declared tools/model inheritance, and can actually launch the required children. If unavailable or invocation fails, report **BLOCKED_NATIVE_AGENTS** with the observed capability/error and stop dependent implementation. Do not replace this with same-session personas, fabricated IDs, a model switch, or an unrequested installation/upgrade. Reading SKILL.md is not spawning an agent.

Give each child the task ID, scope, role, exact skills/references, owned/examined paths, workspace, reviewed SHA, allowed actions, acceptance checks, and return format. The lead owns the application correction slice. Supports inspect a committed frozen checkpoint, without editing application source; use isolated test/build workspaces when necessary. The lead reconciles findings and affected checks run again against any changed checkpoint. The coordinator handles commits/pushes; children do not publish, merge, self-approve, or spawn nested agents. At most three children are needed; do not launch the entire roster.

## Owned implementation scope

Environment and database helpers, existing health/startup wiring, Vitest configuration and targeted tests, existing CI/Compose/package commands where needed, README/dependency notes, planning generation/validation only as required by integration, derived outputs, and `docs/reviews/T02-submission.md`. Preserve fixed R01/R03/R06 behavior and Codex review reports. No auth, domain CRUD, new business UI, deployment, real data, SaaS, offline sync, or document AI.

## Required fixes and evidence

### R08 — Force test mode after loading configuration

The current `vitest.config.mjs` spreads `.env.local` over `NODE_ENV: 'test'`. A normal copy of `.env.example` sets development mode and lets ordinary consumers choose the operational URL.

Enforce test mode after loaded values. Give explicit shell/CI configuration intentional, documented precedence without allowing `.env.local` to silently replace an explicitly selected operational comparison target. Do not use development mode as a workaround for failing isolation checks. Add a regression for the documented environment-copy path proving the effective test mode and selected test target. The negative case must reject missing test configuration before any pool connection.

### R09 — Validate the effective database identity

Current undecoded path comparison accepts `/lawoffice_test` versus `/law%6fffice_test`; the installed driver treats them as the same database. Normalize the supported connection fields using driver-compatible semantics, including decoding of the database name, before comparing targets. Reject ambiguous/unrecognized routing inputs rather than guessing. A suffix or raw string inequality alone is not isolation proof.

Remove the blanket ambient `CI=true` bypass or replace it with an explicit genuinely disposable CI arrangement. Prefer a test-only CI configuration that does not need to pretend that an operational variable is a separate database. Do not introduce a flag that simply accepts any operational target. Keep supported isolated CI operation working and document the target/identity evidence. Never test this against an unknown or real database.

### R10 — Apply isolation before every real test connection

The live integration test constructs `new Pool(TEST_DATABASE_URL)` without passing the shared guard. Codex ran all three integration cases successfully with both variables set to the same disposable review target and `CI=false`, demonstrating bypass.

Use one validated test-target boundary before constructing/connecting integration pools or doing setup. Keep separate controlled invalid-credential/offline probes within explicitly synthetic scope. Prove operational-target misuse, including the encoded equivalent, is rejected before connection, query, reset, or write. Retain strict real PostgreSQL success and verified test identity; do not weaken R01 assertions, skip cases, or return success when prerequisites are absent.

### R11 — Correct CI precedence and obtain real green workflows

`validateEnv(source)` currently reads ambient `process.env.CI` even when the caller explicitly supplies `CI:'false'`. The committed unit test fails on GitHub and locally with `CI=true` (16 pass, 1 fail). Make explicit-source behavior deterministic and keep environment-derived validation separate where appropriate. Do not fix this by deleting the negative assertion or hiding `CI=true` while leaving the policy bypass.

Run unit tests under both local and CI conditions, then required real integration and build. Both application CI and planning validation must complete successfully at the final pushed implementation head after main integration. A prior successful run or a skipped build is not evidence for the new head.

### R12 — Validate supported URL structure and actual startup behavior

`DATABASE_URL=postgresql://` currently passes the actual `register()` boundary. Validate the supported PostgreSQL connection structure, rather than prefixes alone, with sanitized errors for missing/invalid required fields. Preserve builds that legitimately do not need live runtime secrets.

Provide actual process-level startup observations for missing/invalid configuration, and actual HTTP readiness/liveness observations with the synthetic database running, stopped, and recovered (200/503/200 readiness; liveness 200 during validly configured operation). Verify secret sentinels do not appear in responses/logs. Test fallback handling if configuration errors reach readiness. A helper's `typeof` assertion or a mocked route result is insufficient.

### R13 — Deliver meaningful pool-lifecycle regressions

Codex independently confirmed three real query timeouts, client cleanup, late-acquisition cleanup, and recovery on the same real pool. Preserve those fixes. The delivered test called "subsequent probe" instead probes an unrelated fresh mock, and no repeated timeout or pending-acquisition regression exists.

Add permanent behavioral tests for repeated query timeouts and pending acquisition, bounded shared resources, cleanup, and a later healthy probe on the same owned pool. Avoid private-call-order-only assertions or tests that prove recovery merely by switching to a new mock. Controlled stalls can be synthetic seams, with real PostgreSQL integration retained for actual connectivity and identity.

### R14 — Correct the submission and qualify unproven claims

Correct the previous review SHA to `628d5e1d44e18fa76caa7a13fb766239f97bb5e7`. Distinguish inspected implementation, later documentation-only commits, and the independently verified published head. Do not fabricate a self-referential final commit hash: use honest field labels and record publication evidence in the final handoff/PR metadata.

The unrestricted local Codex build still fails with the Turbopack CSS child-process error. A successful build elsewhere does not establish its cause. Label the sandbox/IPC explanation as a hypothesis unless demonstrated by a controlled comparison. At inspected head `111c825...`, application CI failed at unit tests; integration/build were skipped. Record exact new workflow URLs/outcomes and local commands/exits, including failures and NOT RUN limits. Do not claim complete isolation/redaction/coverage from assertions that do not test it.

### R15 — Preserve the merged policy and regenerated artifacts

Complete safe current-main integration described above. Keep all 155 project-local profiles, the 14 native definitions, the scoped seven-LawOffice-skills validation, and the actual-agent requirement. Regenerate/validate the maintained package and inspect source/ZIP agreement. Do not hide generated conflicts by taking an old ZIP or by weakening the freshness check. Do not delete owner-installed Codex/OpenCode assets.

## Submission and stop

Update `docs/reviews/T02-submission.md` with an R08–R15 matrix; actual child invocation/conversation IDs and definition paths; each child's loaded profile name/path/hash, ownership, inspected SHA, findings/result references; lead reconciliation; checks actually run and exit statuses; startup/HTTP/isolation observations; workflow links; actual local branch/base/head/upstream and independently verified pushed SHA; migration/recovery notes; remaining limits.

Push coherent corrections to the same task branch/PR. Keep PR #4 draft. Stop for Codex's independent review of the new implementation head. Do not merge or begin T03.
