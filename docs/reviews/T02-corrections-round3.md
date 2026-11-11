# Antigravity — T02 correction round 3

Status: **CHANGES_REQUESTED**. Same task branch `feature/t02-runtime-ci`, same draft [PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). No T03 or merge.

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md`, the T02 task, and `docs/reviews/T02-review-round3.md`. Preserve owner-installed assets, including untracked `.codex`, `.opencode`, and `.agents` content. Do not clean/delete files to satisfy validation. Inspect/fetch remote state; preserve Codex's incoming review and the integrated main policy. Use an isolated worktree if necessary; publish coherent changes to the existing remote task branch/PR without force or direct-main pushes.

Actual Git checkpoints, obtained independently:

- Main baseline: `62494bad3eca1480d874e578e3cc5cd4926c6e40`.
- Main integration: `62287d0c5d2b8bd072238b55ed1ad30474dc7537`.
- Inspected implementation: `4e9cc457b02e4ac45c1084d451e23e2c595cc9a6`.
- Inspected published head: `99a5b60118c03fc9ff44682c5a3ce46175ddb5ae`.

## Phase A — Actual native preflight, before application edits

The previous round reported BLOCKED_NATIVE_AGENTS but continued directly. That is not authorized. Preserve its code, report that history honestly, and do not repeat the bypass.

Codex inspected actual tool results: `define_subagent` successfully registered `subagent-agency-devops-automator`, then `invoke_subagent` returned real conversation ID `f76008ec-e87c-4ad6-80ad-bef3c14c6edf`. An echo probe is not task completion, but the mechanism was available. Do not assume all native execution is unavailable merely because a canonical `agency-*` name fails.

Use the bounded registration procedure now documented in `docs/AGENCY_AGENTS.md`. Required mappings:

| Assigned role/profile | Canonical source definition | Runtime alias if canonical type is rejected | Profile to read in the child |
|---|---|---|---|
| Lead: `agency-devops-automator` | `.agents/agents/agency-devops-automator.md` | `lawoffice-native-devops-automator` | `.agents/skills/engineering-devops-automator/SKILL.md` |
| Backend support: `agency-backend-architect` | `.agents/agents/agency-backend-architect.md` | `lawoffice-native-backend-architect` | `.agents/skills/engineering-backend-architect/SKILL.md` |
| Test support: `agency-test-automation-engineer` | `.agents/agents/agency-test-automation-engineer.md` | `lawoffice-native-test-automation-engineer` | `.agents/skills/testing-test-automation-engineer/SKILL.md` |

For each role:

1. Load the canonical definition and profile, verifying actual name/hash. If the canonical native type is invokable, use it. Otherwise inspect the live `define_subagent` schema and register the mapped runtime alias using those instructions. Do not redefine an unrelated existing customization. Reuse an existing alias only after verifying its definition/ownership.
2. The observed successful registration used `Name`, `Description`, `SystemPrompt`, `EnableWriteTools`, `EnableMCPTools`, and `EnableSubagentTools`. Use the actual runtime schema rather than inventing parameters or copying incompatible IDE tool names. Keep nested-agent creation disabled and permissions task-scoped. Supply the canonical Markdown instruction body after YAML frontmatter, plus the requirement to read the real profile and applicable project skills. YAML tool names are not runtime capability claims.
3. Actually invoke with the live schema. The observed fields were `TypeName`, `Role`, `Prompt`, `Model`, and `Workspace`. Set the actual registered type, inherited model, and a task-owned workspace. Give a **read-only preflight assignment**: read the profile and `.agents/skills/lawoffice-delivery/SKILL.md`, `.agents/skills/lawoffice-foundation/SKILL.md`, and `.agents/skills/lawoffice-testing/SKILL.md` as applicable; report exact paths/names/hashes, current code SHA, assigned ownership, and intended checks. No application edits yet.
4. Obtain the actual conversation ID and returned preflight result for each distinct required child. Report canonical source path, runtime type/definition path, profile mapping, and real native IDs. A defined name, an echo, a killed child, or the coordinator reading a profile is insufficient.

One canonical attempt and one owned registration/invocation attempt per required role is enough. If any required child cannot return the preflight result, **stop dependent application implementation**. Report only the blocker, observed error, missing role, and last successful step; do not continue directly. Do not change models, install/upgrade tools, delete definitions, launch unrelated probes, or fabricate IDs. No policy exception is granted.

## Phase B — Native lead fixes the remaining T02 slice

Proceed only after all required preflights succeeded. The coordinator handles Git/publication; the actual native DevOps lead owns the remaining application correction. Backend and test children inspect the committed frozen checkpoint, with no application-source writes. Use separate worktrees for conflicting test/build artifacts. The lead reconciles their concrete findings and reruns affected checks after changes. Keep at most three children active and do not spawn nested children.

### R16 — Make the guard agree with actual supported driver routing

The current structural validation and percent-decoding fix do not account for all inputs accepted by the installed pg driver. Confirm these synthetic, connection-free cases before implementing a fix:

- Operational target `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test`; test URL using authority port `65432` with `?port=5432`.
- Same operational target; test URL using authority host `unused.invalid` with `?host=127.0.0.1`.
- Same host/port, database paths `/%3F_test` versus `/%253F_test`.

The actual driver resolves each pair to identical host/port/database, while current `validateEnv` accepts it. No connection is needed to compare actual driver parameters. Never use real operational data to reproduce this.

Choose a small explicit supported-input policy: either reject routing query overrides/ambiguous encodings before connection, or derive and compare the actual driver-effective supported identity correctly. Document unsupported forms and retain normal documented URLs such as `?schema=public`. Do not claim full driver compatibility from raw authority fields or a different decoder. Account for duplicate/routing parameters if accepting them. Avoid introducing unrelated parsing/file-access behavior merely to inspect a URL.

Keep the validated boundary before every live test-pool construction. Add regressions proving these equivalent-target forms are rejected before connection and valid explicit disposable targets still work. Preserve strict real PostgreSQL success, malformed-config rejection, forced test mode, deterministic CI behavior, pool ownership/cleanup, and nonzero E2E deferral.

### R18/R19 — Accurate evidence and focused regression protection

Obtain full checkpoint hashes from Git rather than typing them from memory. Distinguish inspected implementation and later report-only commits. Do not invent a self-referential final hash; record actual publication evidence in the final handoff/PR metadata with honest in-document labels.

Add a regression that actually exercises the documented `.env.example` to local-test-configuration path, rather than asserting only the validator's behavior. Temporary synthetic files must be confined to an owned isolated test workspace and cleaned without touching owner configuration. For shared-pool budgets, add focused observable evidence where missing; controlled seams remain permitted. Do not rewrite the already working pool implementation merely to change tests.

Run appropriate lint, typecheck, local and `CI=true` unit tests, real PostgreSQL integration, build, and planning generation/validation. Mark browser E2E deferred. Preserve exact commands/exits and required synthetic startup/HTTP evidence. Both hosted workflows must pass at the new implementation head. Do not relabel successful CI at `99a5b601...` as execution of the required native roles.

## Submission

Update `docs/reviews/T02-submission.md` with: actual lead/support native IDs and returned-result references; canonical definition/runtime alias mappings; profile paths/names/hashes; ownership and inspected code SHAs; support findings and lead reconciliation; R16/R18/R19 resolutions; all actual checks and limits; branch/base/upstream/implementation and independently verified published-head evidence; hosted workflow URLs.

Explicitly acknowledge that the previous round was implemented directly after a failed preflight. The new child execution verifies and owns only its actual work; do not invent retrospective execution. If native preflight fails, submit the blocker without Phase B code changes. Keep PR #4 draft and stop for Codex review. No main merge, self-approval, T03, deployment, or real client data.
