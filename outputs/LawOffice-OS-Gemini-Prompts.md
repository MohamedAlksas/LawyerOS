# Antigravity implementation prompts — one task at a time

Each linked card contains one complete, copyable prompt. Give Antigravity only the currently assigned card. Codex plans and reviews; the selected Gemini model implements. English documentation and Arabic RTL application requirements remain unchanged.

## Start now

Open `D:\Lawyer` in Antigravity and copy the full prompt in [T01](../docs/tasks/T01.md). It explicitly loads `lawoffice-delivery` and `lawoffice-foundation` from their actual `.agents/skills/` files. T01 is the only task without a predecessor acceptance requirement. The generated output `LawOffice-OS-Antigravity-T01.md` contains the same prompt.

It also selects the lead and supports from their installed SKILL.md paths and requires real native invocation through the bundled `.agents/agents/` definitions. Same-session persona passes are not a fallback. The following table maps every task to its profiles. See [Agency usage](../docs/AGENCY_AGENTS.md) and [the routing registry](../docs/AGENCY_AGENT_ROUTING.json) for the capability/evidence contract. Static validation does not claim actual execution in Antigravity.

## Task and skill map

Every task loads `lawoffice-delivery`. Additional skills are listed below; every card includes their exact paths. See [Antigravity setup](../docs/ANTIGRAVITY.md) for the bundled skills. Do not load all skills or execute all cards together. Each predecessor refers to an actual `docs/reviews/<ID>-review.md` decision stating `ACCEPTED`, with delivered files inspected. A submission is not acceptance.

| Task | Exact card | Required predecessor | Agency lead | Agency support | Additional project skills |
|---|---|---|---|---|---|
| T01 | [T01](../docs/tasks/T01.md) | None — first task | `agency-software-architect` | `agency-devops-automator` | `lawoffice-foundation` |
| T02 | [T02](../docs/tasks/T02.md) | T01 | `agency-devops-automator` | `agency-backend-architect`, `agency-test-automation-engineer` | `lawoffice-foundation`, `lawoffice-testing` |
| T03 | [T03](../docs/tasks/T03.md) | T02 | `agency-identity-access-engineer` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing`, `lawoffice-arabic-ui` |
| T04 | [T04](../docs/tasks/T04.md) | T03 | `agency-frontend-developer` | `agency-accessibility-auditor`, `agency-test-automation-engineer` | `lawoffice-arabic-ui`, `lawoffice-testing` |
| T05 | [T05](../docs/tasks/T05.md) | T04 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T06 | [T06](../docs/tasks/T06.md) | T05 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T07 | [T07](../docs/tasks/T07.md) | T06 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T08 | [T08](../docs/tasks/T08.md) | T07 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T09 | [T09](../docs/tasks/T09.md) | T08 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T10 | [T10](../docs/tasks/T10.md) | T09 | `agency-backend-architect` | `agency-devops-automator`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T11 | [T11](../docs/tasks/T11.md) | T10 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T12 | [T12](../docs/tasks/T12.md) | T11 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-security-operations`, `lawoffice-testing` |
| T13 | [T13](../docs/tasks/T13.md) | T12 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T14 | [T14](../docs/tasks/T14.md) | T13 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15a | [T15a](../docs/tasks/T15a.md) | T14 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15b | [T15b](../docs/tasks/T15b.md) | T15a | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15c | [T15c](../docs/tasks/T15c.md) | T15b | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T16 | [T16](../docs/tasks/T16.md) | T15c | `agency-frontend-developer` | `agency-document-generator`, `agency-application-security-engineer` | `lawoffice-security-operations`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T17 | [T17](../docs/tasks/T17.md) | T16 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T18 | [T18](../docs/tasks/T18.md) | T17 | `agency-devops-automator` | `agency-security-architect`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
| T19 | [T19](../docs/tasks/T19.md) | T18 | `agency-database-reliability-engineer` | `agency-devops-automator`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
| T20 | [T20](../docs/tasks/T20.md) | T19 | `agency-reality-checker` | `agency-accessibility-auditor`, `agency-frontend-developer` | `lawoffice-arabic-ui`, `lawoffice-testing` |
| T21 | [T21](../docs/tasks/T21.md) | T20 | `agency-database-reliability-engineer` | `agency-technical-writer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-security-operations`, `lawoffice-testing` |

## What every prompt specifies

- One exact task ID and accepted-predecessor gate.
- Required skill names and actual `SKILL.md` paths to read before editing.
- Relevant plan files/sections, owned code paths, and exclusions.
- Concrete implementation steps, domain invariants, positive and negative checks.
- Exact submission report path, actual command exit statuses, and `NOT RUN` limitations.
- A stop for Codex review, without implementing missing predecessors or the next task.

These cards are specific to the planned architecture. Ordinary file-layout details must be reconciled with the accepted checkout, not an imagined scaffold. If Codex accepts a documented design change, it updates the affected card before dispatch. Do not weaken the plan to fit an incomplete implementation.

## Submission and review

The implementer uses the exact `docs/reviews/Txx-submission.md` path named by its card and the format in [REVIEW_PROTOCOL](../docs/REVIEW_PROTOCOL.md), including loaded skill paths. Codex reviews actual changes and evidence and writes the matching `*-review.md`. On `CHANGES_REQUESTED`, the implementer fixes that same task's findings, reruns affected checks, updates its submission, and stops again. Do not fill in a review decision on Codex's behalf.

Future production/pilot cards do not authorize unknown destinations, credentials, service purchases, or guessed data. Missing actual prerequisites are reported honestly; prepare independent authorized work and mark unexecuted checks `NOT RUN`.

## Corrections to staged dependencies

T05 introduces the shared audit/idempotency foundation for business writes. T08 adds minimal Task and durable outbox structures without a worker. T09 supplies deadline/task screens. T10 supplies dispatch. T12 connects existing POA/hearing/deadline records to documents and adds document metadata to search. T15c supplies the reviewed opening-balance command before T21 can use it. Each card states its own boundary; no later feature is silently claimed complete early.

## GitHub publication for every task

The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`. Every card specifies its exact dedicated feature branch and requires reading [GIT_WORKFLOW](../docs/GIT_WORKFLOW.md). Commit and push coherent updates on that same branch, update its draft PR, and report the verified remote SHA. Do not create a new branch for every save or push feature work directly to main. The initial planning PR and later task prerequisites must normally be reviewed and integrated into origin/main before dependent work; no automatic merge is implied.


---

# T01 — Prove dependency compatibility and create the minimum build

Copy the complete block into Antigravity. This is the first implementation task; it has no predecessor review.

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-software-architect skill/profile. Read .agents/skills/engineering-software-architect/SKILL.md and verify its YAML name is agency-software-architect.
- Supporting specialist: use the agency-devops-automator skill/profile for its scoped pass. Read .agents/skills/engineering-devops-automator/SKILL.md and verify its YAML name is agency-devops-automator.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Prove compatible pinned dependencies and the smallest strict build scaffold; do not redesign the stack or implement business features.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t01-toolchain-foundation. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS Task T01 only in D:\Lawyer. You are the Antigravity implementation agent using the owner's selected Gemini model; Codex is the planner and reviewer. Do not build the application features.

Required skills — read these exact files before editing:
- .agents/skills/lawoffice-delivery/SKILL.md
- .agents/skills/lawoffice-foundation/SKILL.md
Report the files actually loaded. If a required file cannot be read, report its path; do not pretend the skill ran or silently substitute another workflow.

Read GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md sections 1–4 and 7, docs/ARCHITECTURE.md sections 1, 4, and 5, M0 in docs/ROADMAP.md, and the submission format in docs/REVIEW_PROTOCOL.md. No previous task acceptance is required for T01. Inspect the existing folder and installed tools; do not assume the folder is empty or Git is configured.

Allowed edits: docs/DEPENDENCIES.md, package.json, one corresponding lockfile, necessary TypeScript/Next.js/build/lint configuration, .gitignore, a minimal src/app layout/page and styles, and docs/reviews/T01-submission.md. Preserve the canonical plan. Do not add a database, authentication, clients, matters, financial logic, Docker deployment, or a dashboard with fabricated records.

1. Record the actual runtime/package-manager versions and existing file changes. Prefer npm if no package manager is established; preserve an existing compatible choice rather than creating a second lockfile.
2. Verify supported Node LTS and compatible exact Next.js/React, Prisma 7 CLI/client/driver adapter, Better Auth/Prisma adapter, Tailwind, and Playwright versions using official documentation. Recheck the documented Prisma 8 compatibility issue. Record URLs, date, and chosen versions in docs/DEPENDENCIES.md; do not resolve a conflict by switching the agreed stack independently.
3. Pin/install the packages needed for the minimum scaffold. Document compatible later-task dependencies without implementing their features. Configure TypeScript strict, lint, typecheck, and build commands. Render only a clearly labeled Arabic project placeholder with lang=ar-EG and dir=rtl.
4. Run dependency installation, lint, typecheck, and production build. Demonstrate a clean reinstall using the chosen lockfile without deleting existing work or unrelated folders. Record commands, exit codes, and actual output; unavailable checks are NOT RUN.
5. Check there is exactly one lockfile, no embedded credentials, no client records, and no unintended application modules. Do not invent tests for the trivial placeholder or claim database/auth tests ran.

Write docs/reviews/T01-submission.md with loaded skills, actual base commit or recorded snapshot, changed files, dependency evidence, executed checks, limits, and reproduction steps. Submit T01 and stop. Do not start T02 or approve your own work.
```


---

# T02 — Local runtime, database foundation, and CI

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-devops-automator skill/profile. Read .agents/skills/engineering-devops-automator/SKILL.md and verify its YAML name is agency-devops-automator.
- Supporting specialist: use the agency-backend-architect skill/profile for its scoped pass. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Local PostgreSQL/environment/readiness/CI foundation and isolated failure checks; no authentication or business CRUD.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t02-runtime-ci. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS T02 only in D:\Lawyer through Antigravity. Codex reviews; you implement and provide evidence.

Load .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-foundation/SKILL.md, and .agents/skills/lawoffice-testing/SKILL.md. List actual loaded paths in the report. Read GEMINI.md, docs/DEPENDENCIES.md, ARCHITECTURE sections 1/4/5, SECURITY_OPERATIONS sections 2/3/6, and M0/T02 in ROADMAP.

Prerequisite: inspect docs/reviews/T01-review.md for ACCEPTED and verify T01 files exist. If missing, report the missing prerequisite and stop dependent implementation; do not implement T01 yourself.

Allowed edits: runtime/configuration files established in T01, src/lib environment/database helpers, a minimal non-sensitive health route, local PostgreSQL Compose configuration in ops/, .env.example with synthetic values, targeted tests and CI configuration, startup README instructions, and docs/reviews/T02-submission.md. Only introduce a minimal Prisma migration/schema if required to prove persistence; no Party/Matter/auth/finance models or production deployment.

1. Inspect the accepted versions and current commands. Configure server-only environment validation. Missing required variables fail with actionable sanitized errors and no secret values. Use a synthetic test database distinct from development/production; never reset an existing unknown database.
2. Establish local PostgreSQL with a named persistent volume and an isolated test configuration. Do not publish it on a public interface. Implement a reusable server-only database connection and a minimal read-only connectivity probe without inventing business records.
3. Add liveness and readiness behavior: liveness must not leak credentials, records, or detailed infrastructure; readiness reflects database availability. Exercise a stopped database and recovery so the result cannot report healthy while the required dependency is down.
4. Provide lint, typecheck, build, unit-test, integration-test, and later E2E command conventions. Implement meaningful tests for environment validation and database readiness. Document E2E coverage not yet implemented; do not make an empty test suite look like success.
5. Configure CI clean install, lint, typecheck, build, and the existing tests with a disposable PostgreSQL service. Test startup from the documented environment example, missing-variable behavior, database failure/recovery, and isolation of the test database. Report actual command exit statuses; mark unavailable hosted CI execution NOT RUN rather than claiming a remote run.

Submit docs/reviews/T02-submission.md with loaded skills, changed files, executed commands, readiness observations, test-isolation proof, startup procedure, and remaining limits. Stop for Codex review; no T03 authentication or business UI.
```


---

# T03 — Secure login, sessions, and the security settings section

Current assignment (16 November 2026): [owner-authorized Codex correction round14](../reviews/T03-corrections-round14.md). The owner requested Codex implement all remaining review findings. That scoped assignment supersedes the historical implementation routing/output below for this correction only; native Codex child execution must be reported honestly and not labeled Antigravity execution. Current output: `docs/reviews/T03-submission-round14.md`. No merge, deployment or T04 authorization.

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-identity-access-engineer skill/profile. Read .agents/skills/engineering-identity-access-engineer/SKILL.md and verify its YAML name is agency-identity-access-engineer.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Implement the accepted Better Auth/MFA/session policy; inspect direct-request authorization, secret handling, and recovery/revocation evidence.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t03-identity-sessions. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement T03 only in Antigravity, using the Gemini model selected by the project owner. Codex is the planner and reviewer. Work in D:/Lawyer; no automatic connection to Codex is assumed.

Read GEMINI.md and explicitly apply these project skills:
- D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-security-operations/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md

Current Codex assignment (14 November 2026, round 12): five remaining correction/evidence groups follow inline. Preserve credited OTP/dialog/fixture repairs.

# T03 — Complete remaining-corrections prompt, round 12

Implement only R12-01–R12-05 below. This card includes every remaining repair, reproduction and acceptance check; no review-report lookup is required to discover the work. Preserve credited OTP/dialog/fixture/security repairs. Codex plans and independently accepts; Antigravity coordinates the owner's selected Gemini model and actual native specialists.

## Repository, references and boundaries

Workspace `D:/Lawyer`; canonical origin `https://github.com/MohamedAlksas/LawyerOS.git`; existing branch `feature/t03-identity-sessions`; draft PR `https://github.com/MohamedAlksas/LawyerOS/pull/8`. T02 is ACCEPTED and integrated into origin/main at `e598c1649b82f34ea94338cda5ef25da32b5299f`. Reviewed Round11 implementation `a4a14d9483e84e5bcadac7cd491d22d4f7fd76d8`; independently verified submitted head `fc6d0463c96ba4f11e4ea8bb17e926dc7ab38d6c`. Fetch and safely incorporate the latest Codex documentation publication before dependent writes; verify actual branch/origin/upstream/main/head. Preserve others' changes and all tracked/untracked `.agents/`, `.codex/`, `.opencode/`; no reset/clean/automatic stash/force push or deletion to satisfy validators.

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, authentication sections of `docs/SECURITY_OPERATIONS.md`, `docs/DEPENDENCIES.md`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, `docs/GRAPHIFY.md`. Read relevant installed Next.js guides before application code changes. Load and record exact actual paths: `.agents/skills/lawoffice-delivery/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, `.agents/skills/lawoffice-testing/SKILL.md`, `.agents/skills/lawoffice-arabic-ui/SKILL.md`, `.agents/skills/graphify/SKILL.md`.

English documents/identifiers; Arabic RTL application. No T04, main push/merge, deployment, real data, external service, stack/dependency/tool/model change, visual redesign, business features, SaaS/offline/document AI. Use synthetic owned resources only; verify target names/labels before cleanup. Never publish secrets/cookies/passwords/codes or real client material.

## Explicit Codex specialist routing

Retain five bounded roles because the remaining change is auth-state coordination, schema upgrade/authorization and regression/evidence closure. These refine task defaults under `docs/AGENCY_AGENTS.md`; implementers cannot substitute roles. Do not repeat Frontend implementation for already verified UI behavior.

| Required native role and reason | Exact profile and definition | Owned phase/paths |
|---|---|---|
| DBRE lead `agency-database-reliability-engineer`: retained-data upgrade and conservative migration-history authorization | `.agents/skills/engineering-database-reliability-engineer/SKILL.md`; `.agents/agents/agency-database-reliability-engineer.md` | Phase A: R12-02/R12-03; `prisma/`, `src/cli/baseline-identity.ts`, minimal helpers, `docs/DEPENDENCIES.md`. Coordinate auth-state schema contract with Identity before writes. No infrastructure/HA scope. |
| Identity lead `agency-identity-access-engineer`: proof issuance, rotation, protected access and provider trust | `.agents/skills/engineering-identity-access-engineer/SKILL.md`; `.agents/agents/agency-identity-access-engineer.md` | Phase B: R12-01/R12-04; `src/lib/auth.ts`, `src/app/api/auth/[...all]/route.ts`, required `src/modules/identity/` including `require-actor.ts`. |
| Test lead `agency-test-automation-engineer`: deterministic DB/protocol/browser acceptance | `.agents/skills/testing-test-automation-engineer/SKILL.md`; `.agents/agents/agency-test-automation-engineer.md` | Phase C: affected tests/helpers only; red/green cases for all fixes and R12-05. One writer per test path; coordinate lead-owned regressions. |
| Independent AppSec `agency-application-security-engineer` | `.agents/skills/security-appsec-engineer/SKILL.md`; `.agents/agents/agency-application-security-engineer.md` | Read-only exact frozen implementation audit of proof/rotation/failures/actor/Origin/catalog contracts, with actual returned findings. |
| Independent Accessibility `agency-accessibility-auditor` | `.agents/skills/testing-accessibility-auditor/SKILL.md`; `.agents/agents/agency-accessibility-auditor.md` | Read-only final frozen rendered browser evidence: pending/dismissal/late-response/focus/errors/digits/reflow/200% at390/768/1440. No speculative app rewrite. |

Before dependent implementation, verify actual readable profile/definition paths and YAML names and obtain current native read-only preflight results for all five. Use real `invoke_subagent` sessions. If canonical invocation fails and `define_subagent` exists, follow the bounded registered `lawoffice-native-...` alias procedure in `docs/AGENCY_AGENTS.md`: one canonical and one owned alias attempt per role, inherited model/permissions, source/profile hashes and actual IDs. Unavailable capability is `BLOCKED_NATIVE_AGENTS` before implementation. No same-session persona substitute, invented IDs or model/tool change.

Maximum three active children; no nested delegation. Give each full task/context/SHA/owned paths/checks/report destination. Agree a supported-provider auth-state and migration design first; serialize shared file ownership and implementation/test handoffs. Freeze a committed complete implementation before distinct support audits. Renew affected audits/checks after relevant changes. Publish actual returned findings and reconciliation, not dispatch/awaiting status converted to PASS.

## R12-01 / P1 — Make the entire credential-proof lifecycle fail closed

Mapping: R11-01 / R10-01 / F10. Current `credential-version.ts` returns version1 for failed reads, suppresses stamp/eviction failures and returns no-mismatch for lookup errors. Route accepts an absent challenge companion (`credVerRecord && mismatch`), swallows companion insert and postcheck failures, guesses raw cookie identifiers and backdates `session.createdAt`. Provider changes the password before the later application version/revocation transaction. `requireActor` still ignores version state entirely.

Confirmed real PostgreSQL reproduction: provision/confirm synthetic owner and authenticate A. Install a temporary `BEFORE INSERT ON session` advisory-lock barrier gated only on B's distinctive User-Agent. Install a second temporary `BEFORE INSERT ON verification` fault trigger rejecting only identifiers matching `2fa-cred-ver-%`. Begin B sign-in with old password and observe its database advisory-lock waiter after password verification. Change password through A and commit200. Release B. B sign-in returns200, companion count0, valid TOTP returns200 and the actual issued Cookie passes `requireActor`. This is a controlled persistence fault in the explicitly assigned security-postcondition failure case, not a mocked race.

Separate confirmed failures: a trigger rejecting user-version increment produces password-change500 with unchanged version1, yet the new password is accepted (provider committed already). After genuine login, changing only user version to2 leaves session1 accepted by actual `requireActor`; this deliberately tests mismatched-state enforcement, not a claimed natural race.

Required result: design and implement an authoritative across-process contract linking the credential actually proved, pending MFA, authorized session, credential mutation/revocation and every protected actor check. Missing, unreadable or unpersisted required proof state must deny authorization. Credential mutation and version/revocation must share a demonstrated transaction/locking/failure boundary using supported pinned-provider hooks/configuration; if a partial outcome is unavoidable, explicitly ensure old proof cannot authorize and establish coherent recovery/retry behavior. Returning500 after a committed password change is not rollback. A pre-read, best-effort post-handler stamp/delete, guessed cookie payload, timestamp/backdating or process-local mutex is not the security guarantee. Do not patch dependencies or invent cryptography. DBRE owns any justified minimal state migration. Preserve initiating replacement session and fresh new-password+MFA success.

Acceptance: genuine provider/DB regressions first fail on the reviewed source; then pass. Cover normal pre-challenge issuance race (already repaired), companion creation/read/session stamp/version increment/eviction/postcondition failure, absent/replayed proof, existing-challenge consumption/final issuance barriers, both rotation/completion orderings, TOTP and backup-code, concurrent processes, failed/rolled-back rotation, replacement preservation and new-password fresh MFA. Synchronize through observable DB/request barriers, not guessed sleeps or mocked persistence. Carry actual issued request Cookies into protected calls; `Set-Cookie` response headers alone do not authenticate. Assert stored state and actual protected access as well as status. Fail closed on required-state errors rather than silently assuming schema compatibility.

## R12-02 / P1 — Provide an upgrade from the actual previous canonical schema

Mapping: R11-01 migration compatibility / R11-02 prior-schema requirement. Current patch adds version columns only by editing original `20261111000000_init_auth/migration.sql`; no forward migration exists. Installing that file from `f2b53f9`, retaining an owner and running current `runIdentityBaseline` fails for missing version columns. An already-managed database cannot get new columns by replaying an already-applied migration; this latter omission was source-confirmed.

Required result: readable, non-destructive version-aware upgrade and baseline/recovery contract for fresh, unbaselined prior canonical, managed prior canonical and interrupted/recoverable states. Respect actual prior migration checksums/history. Do not certify altered history to conceal drift, reset data or claim that T02 sentinel-only tests cover a previous T03 identity schema. Coordinate credential invalidation/default/version handling and retained pending proofs/sessions with Identity.

Acceptance: real isolated PostgreSQL using exact prior committed SQL/checksum and retained synthetic owner/credential/MFA/session/sentinel data. Exercise public baseline and actual `prisma migrate deploy` for applicable states; fresh path, prior managed/unmanaged, interrupted retry and unsupported schema failure. Prove expected rows/secrets remain recoverable, stale sessions/proofs cannot authorize, and fresh login plus replacement behavior work. Unsupported variants must fail before false completed history. Update safe apply/recovery notes and docs; no `db push`/reset as upgrade evidence.

## R12-03 / P1 — Validate actual index comparison semantics before history approval

Mapping: R11-02 / F01. Existing checks now reject domains and verify namespace/category/access/readiness/included/null-distinctness (preserve them), but do not validate index collation/operator-class/options. Full indexdef is read but not checked; per-column `pg_get_indexdef` does not establish these semantics.

Confirmed public-entry-point reproduction on real PostgreSQL16 with ICU: install canonical schema and retained owner `review@synthetic.invalid`. `CREATE COLLATION public.review_casefold (provider=icu,locale='und-u-ks-level2',deterministic=false)`. Replace `user_email_key` with `CREATE UNIQUE INDEX user_email_key ON public."user" (email COLLATE public.review_casefold)`. Actual `verifySchemaEquivalence` returns equivalent=true; public baseline succeeds and records one completed history row. Uppercase `REVIEW@SYNTHETIC.INVALID` insert fails23505 under the unapproved index. Canonical text comparison has different uniqueness semantics.

Required result: inspect exact approved catalog operator-class/collation and material key options/order semantics conservatively; reject unsupported variants before any history resolve/create/recovery success. Names alone or stored-but-unused definition text are insufficient. Avoid an unnecessary SQL parser/general schema redesign.

Acceptance: actual public baseline on isolated PostgreSQL for the above false-approval reproduction and alternate operator class/key ordering/material options, approved default controls and supported type/enum namespace controls. Rejected variants preserve rows and create no new completed history or false recovery success. Retain domain, included/partial/composite/expression/wrong-key/index validity/readiness, false defaults/FKs, precision and shifted-time regressions. Add the missing actual ambient PGOPTIONS plus isolated role-default/database-default `search_path` matrix with owned teardown; exercise newly created application/baseline connections, not a previously constructed Prisma singleton. Do not change owner roles/databases.

## R12-04 / P1 — Use complete configured provider Origin validation

Mapping: R11-03 / F06. Current null-Origin branch trusts matching Host plus same-origin metadata without validating complete inferred origin. Parent real route/provider-function probe explicitly enabled provider Origin checks, used genuine owner Cookie and supported JSON media: request URL `https://untrusted.invalid`, Host trusted `127.0.0.1:3100`, Origin `null`, Fetch Metadata `same-origin`. Provider `/two-factor/get-totp-uri` returns403; wrapper `/two-factor/generate-backup-codes` returns400 for wrong password and persists failure1. This was not a fresh HTTP-production-server test and does not assert arbitrary header combinations are possible in every browser/proxy.

Required result: use the pinned provider's supported configured-trust/CSRF behavior as one contract before mutation. Null inference must undergo full trusted-origin validation including scheme/host/port; Host, forwarded headers or destination URL cannot add trust. Do not create more ad hoc exceptions. Any aliases/proxy policy must be explicitly configured and justified, not inferred from the request. Preserve ordinary untrusted/missing-Origin rejection and shared persistent locked reauthentication/authorization. Do not disable Origin/product limiters for diagnostics.

Acceptance: a fresh production-configured HTTP server and genuine provider-control/interception matrix for trusted/untrusted/malformed/missing/null origins, Referer, destination/Host/scheme/forwarded mismatches, Fetch Metadata, supported JSON and simple text, unauthorized/maintenance actors. Provider415 for unsupported media is not Origin403 proof. Rejections preserve failure budget, lock deadline, hashes, sessions and success audit. Trusted-origin wrong passwords still exhaust the same persistent budget across entry points/processes; trusted success works once. Isolate owned fixtures/server runs to avoid IP-limiter contamination; record build/config attribution.

## R12-05 / P2 — Complete genuine committed browser coverage and attributable evidence

Mapping: R11-04 / R10-07 / F09/F11. Existing new E2E suite contributes15 tests; full hosted suite45 passes, but its “committed response held” case never submits/holds/releases anything. OTP case uses only Arabic-Indic; no Persian input, guaranteed leading zero or actual paste. Responsive case only checks login overflow, with no focus/200% assertions. Aggregate PASS summaries/full hashes still omit actual returned specialist artifact/tool/UI references and durable-log limitations.

Required tests: preserve existing137 units/68 integration/45 browser cases. Add genuine pre/post-backend-commit held generation response across dismiss/reopen, late success and late expected error, safe retry/repeated activation, unmount/navigation; distinguish UI dismissal from backend rollback. Assert secret suppression/password reset/new-attempt usability and actual request/commit occurrence. Keep working generation suppression; no frontend rewrite is assigned. If an actual app defect is found, report to Codex for bounded routing before expanding app ownership.

Exercise Latin/Arabic-Indic/Persian OTP with deterministic genuine leading-zero codes, actual paste, long/malformed complete input and protected login/confirmation. Preserve logout503 Arabic failure/stays-page then successful retry/revocation, production expected-action Arabic errors, exact128 enrollment/login/MFA, exact129/invalid-email/closed-bootstrap/no-extra-state tests. Close fault/barrier/backup/process/schema/search-path/Origin matrix coverage from the earlier sections. Test names must describe behavior really exercised; use stored-state/protected-Cookie assertions, not labels or vacuous unauthenticated checks.

Independent Accessibility must inspect exact frozen rendered UI at390/768/1440 with keyboard/focus containment/return, alerts, pending/error/dismissal/late responses and200% text. Physical screen reader/TTY/device checks are NOT RUN unless performed; do not claim global WCAG AA or zero vulnerabilities from narrow evidence. Provide full exact definition/profile SHA-256, paths/YAML names/runtime aliases, native invocation IDs, owned/examined paths, full inspected SHA, actual returned findings, commands/exits and reconciliation for all five children. Cite observable artifact/tool/UI results; if durable logs cannot be exported, explicitly disclose it and provide what can be inspected. Awaiting/dispatched is not PASS; do not fabricate logs or rewrite earlier historical claims. Codex independently accepts.

## Validation, artifacts and publication

Run relevant failing/passing regressions, appropriate complete units/integration/browser suites, lint/typecheck, fresh default and webpack builds and full CI at the final checkpoint. Reuse unchanged passed evidence where justified, without repeated broad runs. Distinguish local/hosted, selected/full, skips/NOT RUN, environment/control failures and actual final results. Current hosted CI43618005197 contains reviewed `fc6d046` and passes137unit/68integration/default build/45E2E; those counts do not close omitted cases. Record test target identity from configuration; local readiness currently hardcodes `lawoffice_test`/`lawoffice_user`.

Use local committed code-only Graphify per `docs/GRAPHIFY.md`, explicit repaired full SHA, matching `SOURCE.json` sourceCommit/hash, actual affected queries and limitations; rebuild after source commits. Working edits excluded. No document/agent scan, upload, labels, keys, hooks or tooling upgrade. Actual source/tests and native children remain required.

Save `docs/reviews/T03-submission-round12.md` with every R12 disposition and R11/F mapping, state/transaction/provider design, readable migration/recovery effects, actual tests/red-green evidence, browser observations, exact current native results/checkpoints/reconciliation, Graphify provenance, limitations/NOT RUN, owned cleanup, branch/base/local/upstream/verified pushed SHA/PR. A final report-only commit may follow the frozen implementation only after verifying its intervening diff is documentation-only. Report its publication SHA externally after commit; no self-referential amendment.

Run `scripts/Validate-AntigravityKit.ps1`, `scripts/Validate-AgencyAgentRouting.ps1 -VerifyInstalled`, `scripts/Build-TaskPromptIndex.ps1`, `scripts/Build-PlanningKit.ps1`, `git diff --check` after canonical document changes; regenerate maintained outputs. Publish coherent updates to this same branch/PR, verify remote head and stop for independent Codex review. No automatic merge or self-acceptance.
```

Historical task-chain metadata: accepted predecessor record `docs/reviews/T02-review.md`; initial submission record `docs/reviews/T03-submission.md`. Current correction output: `docs/reviews/T03-submission-round12.md`. These historical paths add no further correction instructions.


---

# T04 — Arabic navigation shell and installable PWA

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-frontend-developer skill/profile. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-accessibility-auditor skill/profile for its scoped pass. Read .agents/skills/testing-accessibility-auditor/SKILL.md and verify its YAML name is agency-accessibility-auditor.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Implement only the approved Arabic RTL shell/PWA and real state behavior; test keyboard/reflow and prevent confidential caches.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t04-arabic-pwa-shell. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement T04 only in Antigravity with the project owner's selected Gemini model. Codex owns planning and review. Work in D:/Lawyer; submit evidence manually through the documented workflow.

Read GEMINI.md and explicitly apply:
- D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md

Inspect docs/reviews/T03-review.md and its referenced baseline before editing. T03 must actually be ACCEPTED. If missing or unaccepted, report the dependency and stop; do not implement authentication as a workaround.

Read PRODUCT.md, DESIGN.md in full, docs/SCREENS.md page map and shared journey/state requirements, docs/PRD.md NFR-01/NFR-02/NFR-07, docs/ARCHITECTURE.md UI efficiency and offline decision, docs/SECURITY_OPERATIONS.md document/data cache rules, docs/ROADMAP.md M1/T04, and docs/REVIEW_PROTOCOL.md UI checks. Use the pinned dependencies and actual accepted route structure.

Allowed edits: application shell/layout/navigation, shared accessible UI primitives, localized empty/loading/error/offline states, PWA manifest/icons and strictly public asset handling, relevant browser tests, and task evidence. Preserve T03 auth and session security. Exclude matter/party CRUD, calendars, documents, finance, new business schemas, all-15-screen mockups, external notifications, and production hosting.

1. State a small path-scoped plan. Implement right-side desktop navigation and mobile navigation following DESIGN.md, with meaningful empty states for available routes only. Do not create dummy totals, pretend records, or dead feature-complete screens.
2. Implement Arabic lang/RTL direction, Cairo date display, bdi/LTR isolation for mixed codes/phones, local Arabic font, keyboard focus, accessible labels, and readable validation/feedback primitives. English planning documents do not change the application's language.
3. Add a valid manifest and local icons. Verify installability in a supported local browser context; document platform limitations. Actual private HTTPS/device installation is rechecked in T18. Do not promise universal installation.
4. Do not cache auth, matter, document, financial, or sensitive route responses. If a service worker is needed, restrict it to enumerated public assets/offline screen. No confidential localStorage/IndexedDB queue or offline synchronization. Lost connectivity must show unsaved status; an uncertain submission must not display success.
5. Test rendered screens at 390/768/1440 widths, keyboard navigation, 200% text zoom, mixed-direction examples, long labels, empty/loading/error/disconnected states, and session expiry. Inspect browser storage/network behavior and service-worker caches to prove confidential responses are absent. Do not mark future save/idempotency workflows as tested before they exist.

Run actual relevant lint/typecheck/build and browser checks. Save docs/reviews/T04-submission.md with baseline, changed paths, exact commands/exit statuses, screenshots, installation observations, cache evidence, and NOT RUN reasons. Stop for Codex review; do not start T05.
```


---

# T05 — Parties, client profiles, communication, and powers of attorney

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Party/identity/POA metadata and shared audit/idempotency; examine encryption-key handling, version conflicts, and actual isolated tests.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t05-parties. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model. Codex plans and reviews. Work only in D:/Lawyer and implement T05, not its predecessors or successors.

Read GEMINI.md and explicitly apply these project skills by opening their files:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
If a required skill is missing, report it; do not silently substitute an assumed skill.

First inspect the actual checkout, Git status/base commit, commands, and docs/reviews/T04-review.md. Proceed only if that review explicitly says ACCEPTED. Otherwise stop dependent implementation and report the missing acceptance without implementing T04.

Read GLOSSARY.md; docs/ROADMAP.md M2/T05; docs/PRD.md FR-02, NFR-01/02/05/07; docs/DATA_MODEL.md sections 2, 3, 7; docs/ARCHITECTURE.md sections 3–4; docs/SCREENS.md S09; docs/SECURITY_OPERATIONS.md authentication/key handling; docs/DATA_LIFECYCLE.md; DESIGN.md; and docs/REVIEW_PROTOCOL.md.

Own src/modules/parties/, party routes under src/app/, their directly used forms, Party/PartyIdentity/CommunicationNote/PowerOfAttorney schema and migrations, and task-specific tests. Introduce or reuse the minimal shared AuditEvent and scoped IdempotencyRecord schema/helpers needed by these first business writes; T06/T07 reuse them, and T08 adds durable JobRun/outbox. Shared edits otherwise stay limited to necessary route registration, permission checks, and existing primitives. Preserve others' changes. Matter relations and document foreign keys belong to later tasks; do not invent Matter/Document tables, a global client flag, or working tabs for unavailable capabilities.

Implement in small increments: preserve original names/contact information; add server validation and derived normalized search; implement saveParty/searchParties and the available getClientProfile data; add communication and power-of-attorney metadata; then build Arabic RTL forms with genuine empty/error/conflict states. Optional identity numbers require ciphertext, keyId, encryptionVersion, restricted reads, redacted logs, and recoverable deployment keys outside Git/database. Never create a key silently on restart or make identity numbers mandatory.

Verify with real PostgreSQL: create person/organization without phone/identity; retain two similar names while warning; search Arabic/Western digits without altering originals; update with correct version and reject a stale version; repeat a save with the same scoped key without duplication and reject changed-payload reuse; roll back a write when its audit insert fails; reject unauthenticated/maintenance requests; prove plaintext identity is absent from storage/logs and wrong/missing keys fail safely. Defer actual multi-matter role tests to T06. Inspect 390/768/1440 widths, keyboard use, and error announcements.

Run the checkout's lint, typecheck, relevant unit/integration/E2E checks, and build. Record exact commands, exit codes, short outputs, migration/upgrade evidence, screenshots, actual base commit or recorded snapshot, and NOT RUN reasons in docs/reviews/T05-submission.md using the review protocol. Stop for Codex review; do not start T06.
```


---

# T06 — Matters, proceedings, relationships, and office reference lists

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Matter/Proceeding/party relations, reference settings and migrations; preserve same-matter constraints and validate real PostgreSQL behavior.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t06-matters-proceedings. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Work in D:/Lawyer on T06 only.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report any missing required skill rather than proceeding from memory.

Inspect current code, Git status/base commit, and docs/reviews/T05-review.md. Continue only with explicit ACCEPTED status; otherwise stop dependent work and report it. Do not implement the predecessor.

Read GLOSSARY.md; docs/ROADMAP.md M2/T06; docs/PRD.md FR-02/03/12 and NFR-01/02/05; docs/DATA_MODEL.md sections 2–3, 7–8; docs/WORKFLOWS.md sections 1–2; docs/SCREENS.md S03/S04/S05 and S14 reference lists; docs/ARCHITECTURE.md sections 3–5; docs/adr/0001-matter-and-proceeding.md; DESIGN.md; docs/REVIEW_PROTOCOL.md.

Own src/modules/matters/, matter/proceeding routes and their forms, S14 office/court/practice-area/paper-location settings, related schema/migrations, and focused tests. Extend Parties only to expose real matter associations and authorization links. Do not change authentication, implement hearings/documents/finance, or redesign the shell.

Implement openMatter/attachProceeding/getMatter through authorized Module Interfaces. Generate stable unique fileCode values. Keep Matter.kind separate from practiceArea. Permit DRAFT matters without clients, but ACTIVE requires at least one CLIENT MatterParty. Represent each court registration as its own Proceeding; allow explicit DRAFT registrations with incomplete numbers and a known court. Preserve numberText/yearLabel originals. Link parent/child within one matter, with cycle prevention, and separate MatterParty.role from ProceedingParty.legalCapacity. Support multiple clients and opponents without assuming shared financial liability. Add reference-list deactivation, not destructive deletion. Defer QR and unavailable document links.

Verify AC-03 and relevant AC-06 using real PostgreSQL: one party is client/opponent in different matters; two clients share a matter; first instance and appeal retain separate numbers/capacities; a draft can precede a docket number. Reject cross-matter links, parent cycles, ACTIVE without a client, stale-version writes, unauthorized requests, and duplicate fileCode generation under concurrency. Similar docket identities warn without automatic merge. Deactivating a court/location preserves existing records. Exercise empty-database and prior-schema migrations with synthetic records.

Inspect Arabic RTL journeys at 390/768/1440, keyboard and 200% text zoom, original/normalized numbers, and incomplete labels. Run actual lint/typecheck, focused unit/integration/E2E checks, and build. Save commands with exit codes, base commit, migration evidence, screenshots, limitations, and NOT RUN reasons to docs/reviews/T06-submission.md. Stop for Codex review; no T07.
```


---

# T07 — Search, filters, pagination, and safe archiving

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-frontend-developer skill/profile for its scoped pass. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Normalized bounded search and archive behavior using the approved Arabic screens and failure cases; no document-content search.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t07-search-archiving. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model, with Codex as planner/reviewer. Implement only T07 in D:/Lawyer.

Open GEMINI.md and explicitly use:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Missing required skill files are blockers to report, not permission to improvise.

Inspect checkout changes, actual base commit and available commands. Require docs/reviews/T06-review.md to explicitly state ACCEPTED before dependent implementation. If absent or unaccepted, stop and report the dependency; do not complete T06 yourself.

Read GLOSSARY.md; docs/ROADMAP.md M2/T07; docs/PRD.md FR-07/12, NFR-01–05/07; docs/DATA_MODEL.md sections 2–3 and 8; docs/WORKFLOWS.md section 11; docs/SCREENS.md S03/S04/S12; docs/ARCHITECTURE.md sections 3–4 and 6; DESIGN.md; docs/REVIEW_PROTOCOL.md.

Own normalized Party/Matter/Proceeding search queries, search/list routes, filters, pagination, archiveMatter and equivalent proceeding lifecycle behavior, associated indexes/migrations, and their tests. Restrict edits to src/modules/parties/, src/modules/matters/, the relevant routes, and necessary shared search UI. Do not build search indexes or archive dependencies for nonexistent future document/finance/scheduling models. Document the guard-extension points T08/T09 must update; do not hide future records behind a permanent false/no-op check.

Implement server-side authorized queries with stable pagination and preserved filters on return navigation. Retain original names/numbers; normalize Arabic/Western digits and documented name forms only in derived search fields. Results show real authorized records and clear no-results states. Archiving preserves identifiers/history, makes ordinary writes unavailable, and permits deliberate reopening with reason/audit. Enforce every existing critical-obligation guard. Once scheduling models arrive, their owning tasks must add guards preventing SCHEDULED hearings or open CONFIRMED deadlines from being hidden. Noncritical tasks/debts later remain reportable with a reason, never silently cancelled.

Verify an Arabic/Western-number query returns the same proceeding, similar names stay separate, page boundaries have no duplicated/missing records under stable ordering, and filter state survives opening a detail page. Test archived-inclusive search, write refusal on archived records, authorized reopening, stale-version conflict, direct unauthorized requests, and audit rollback. Critical-hearing/deadline checks that require future models must be marked future work rather than fabricated passing tests. Measure search on a stated synthetic dataset/environment against the PRD target; do not claim unmeasured P95 performance.

Run actual lint/typecheck, focused unit/integration/E2E tests, and build; inspect 390/768/1440 Arabic RTL layouts. Submit exact commands/exit codes, base commit, SQL/index changes, measurements, screenshots, limitations and NOT RUN items in docs/reviews/T07-submission.md. Stop for Codex review; do not start T08.
```


---

# T08 — Hearings, results, adjournments, and atomic follow-up creation

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-frontend-developer skill/profile for its scoped pass. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Atomic hearing result/next hearing/tasks/outbox plus usable mobile failure/retry states; no premature reminder worker.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t08-hearing-results. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Work only on T08 in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
If a required skill is unavailable, report it before implementation.

Inspect the actual base commit/worktree and require docs/reviews/T07-review.md with explicit ACCEPTED. Missing acceptance stops dependent work; do not implement a predecessor.

Read docs/ROADMAP.md M3/T08; GLOSSARY.md; docs/PRD.md FR-04/12, NFR-01/02/05; docs/DATA_MODEL.md sections 2, 4, 7–8; docs/WORKFLOWS.md sections 3–5; docs/SCREENS.md S02/S05/S06; docs/ARCHITECTURE.md sections 3–4/7; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-04–07.

Own src/modules/scheduling/ hearing commands, hearing/result routes, directly required Task creation in src/modules/productivity/, relevant hearing/task/idempotency/audit/outbox schema and migrations, archive-guard extensions, and focused tests. Add the smallest documented Task and durable JobRun contracts needed for atomic result/next-hearing/task/outbox persistence. Do not introduce absent Deadline/Document foreign keys, full task/deadline screens, a dispatch worker, or reminder delivery; T09/T10/T12 own those integrations. Expose only working hearing/task branches; deadline and decision-document controls arrive with their owning tasks.

Implement scheduleHearing, recordHearingResult, rescheduleHearing. Preserve date-only Cairo values and optional unknown time. Allow a real appointment on an explicitly incomplete Proceeding. A completed hearing keeps its original day; adjournment creates another hearing and link. Record result, selected next hearing/tasks, audit and durable reminder work together. Corrections require a reason and immutable previous result; rescheduling an unheld hearing is distinct from recording its outcome. Use source/version idempotency and optimistic conflict checks. Extend archive checks so scheduled hearings cannot be hidden, including on archived parent/proceeding mutation attempts.

Write one failing behavior test at a time. With real PostgreSQL verify next hearing/tasks appear once after retry or lost response; changed payload under the same key is rejected; an injected task/audit failure leaves no partial result/outbox; two-device conflict cannot overwrite; correction history remains; cancellation/rescheduling invalidates obsolete scheduled work. Verify date-only values across Cairo DST and non-Cairo browser zones, and no fabricated time. A future worker is NOT RUN/future scope, not claimed operational.

Inspect mobile result entry, summary-before-save, failure/retry, and 390/768/1440 RTL. Run actual lint/typecheck, relevant unit/integration/E2E tests and build. Submit commands/exit codes, base commit, migration upgrades, atomicity evidence, screenshots and staged dependencies to docs/reviews/T08-submission.md. Stop for Codex review; do not start T09.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T08-TC-01 | PG + browser | An incomplete Proceeding and a hearing day near the Cairo DST change. | Schedule with the time blank. Reopen on Cairo and New York browser profiles. | The same calendar day appears on both. Time stays unknown and the Proceeding remains explicitly incomplete.
T08-TC-02 | PG + browser | A scheduled hearing on 2027-01-12. | Record «تأجيل لتقديم مذكرة» with a next hearing on 2027-02-09 and two selected tasks. Inspect the mobile confirmation before saving. | The original is completed on January 12. One linked next hearing, two tasks, an audit event and durable reminder work commit together.
T08-TC-03 | PG + browser | A scheduled hearing and a captured result command. | Let the save commit, suppress its response in the test harness, then retry from the Arabic UI. Resubmit the same key with a changed task title. | The retry returns the original result and IDs with no additional writes. The changed payload is rejected.
T08-TC-04 | PG | A scheduled hearing and fixture counts recorded before the command. | Inject a failure at task creation, then in a separate run at audit persistence. | Status, result, linked hearings, tasks and outbox stay at their pre-command values. Retry after removing the injected failure succeeds.
T08-TC-05 | PG + browser | Two authorized sessions viewing the same hearing version. | Submit different results concurrently. Correct the saved decision with a reason after reloading. | One result wins. The stale session sees the persisted version. Correction preserves the prior decision, the next hearing date and the reason.
T08-TC-06 | PG | Two unheld scheduled hearings with durable work. | Reschedule one and cancel the other with reasons. Separately try archiving a Matter or Proceeding with an upcoming hearing and scheduling on archived parents. | Replacement and reschedule history are linked. Old work is invalidated. No result is created for an unheld hearing. Archive guards reject the prohibited transitions.
T08-TC-07 | Browser | An Arabic UI and a synthetic hearing with an unknown time. | At 390/768/1440px use the keyboard, review the selected follow-up, then disconnect during save. | The summary matches the request, unknown time displays accurately, pending inputs are recoverable in memory and the UI reports uncertainty. Worker delivery remains future scope.
```


---

# T09 — Manually confirmed deadlines, tasks, and the agenda

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-frontend-developer skill/profile for its scoped pass. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Manual deadline confirmation, tasks and Cairo agenda states; never invent legal periods, dates, or completion evidence.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t09-deadlines-tasks. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model. Codex owns planning/review. Implement T09 only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report missing skills instead of inventing their instructions.

Inspect the checkout/base commit and docs/reviews/T08-review.md. Proceed only after explicit ACCEPTED status; otherwise report the missing prerequisite and stop dependent work without implementing T08.

Read GLOSSARY.md; docs/ROADMAP.md M3/T09; docs/PRD.md FR-05/07/12 and NFR-01/02/05; docs/DATA_MODEL.md sections 2, 4, 7–8; docs/WORKFLOWS.md sections 3, 6, 11; docs/SCREENS.md S02/S07/S08; docs/ARCHITECTURE.md sections 3–4/7; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-06–08.

Own src/modules/productivity/, Deadline/agenda additions in src/modules/scheduling/, task/deadline/agenda/today routes, related schema/migrations, critical archive checks, and tests. Reuse T08's existing Task and outbox contracts instead of adding parallel models. Add Deadline relationships now. Optional source-document references cannot target nonexistent Document tables; T12 will wire those references and controls. No legal rules engine, external reminders, or dispatch worker.

Implement createTask/completeTask/listAgenda and confirmDeadline with authorized validation. A task needs a title; its due date is optional and time requires a day. Legal deadlines have a required Matter and explicit DRAFT/CONFIRMED/COMPLETED/CANCELLED lifecycle. Confirmation requires lawyer review, date, source/basis and reviewer timestamp; changing the date clears confirmation and invalidates old reminder work. Completing a task or reading an alert never completes a legal action. Completion requires the documented description/date. Add list-first mobile agenda and day/week/month views with separate hearings/tasks/deadlines and an unknown-time group. Persist changes/audit/outbox atomically without claiming delivery before T10. Extend archive guards to block open confirmed deadlines as well as scheduled hearings.

Verify with real PostgreSQL: draft without date remains unapproved; manual confirmation and completion are audited; date change returns DRAFT; invalid cross-matter links and stale versions fail; no automatic appeal-period calculation; a completed task leaves its legal deadline open; critical obligations prevent archiving. Test Cairo DST, midnight boundaries, date-only stability in another browser timezone, overdue calculation, and undated tasks. Exercise unauthorized direct commands and transactional failure. Test genuine empty/offline/error states and keyboard navigation at 390/768/1440; never cache confidential agenda data in browser storage.

Run actual lint/typecheck, focused unit/integration/E2E checks, and build. Save exact commands/exit codes, base commit, migrations, screenshots, future document/worker dependencies and NOT RUN reasons to docs/reviews/T09-submission.md. Stop for Codex review; no T10.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T09-TC-01 | PG + browser | A Matter and a draft deadline without a date. | Open the draft, attempt confirmation with missing date or basis, then enter date/source/basis and explicitly confirm as the lawyer. | The incomplete draft has no confirmed reminder work. Valid confirmation records reviewer, time and audit and moves it to the confirmed group.
T09-TC-02 | PG | A confirmed deadline with queued reminder work. | Change the date with a reason. Attempt to reuse the stale version and check reminder work before and after explicit reapproval. | The deadline returns to DRAFT, old work is invalidated, the stale request fails, and new confirmed work exists only after reapproval.
T09-TC-03 | PG + browser | A standalone task and a separate confirmed deadline on one Matter. | Create an undated task, reject a task time with no day, and complete the task. Try completing the deadline without its required execution details, then provide them. | The undated task saves, invalid time fails, and completing the task leaves the deadline open. Only the explicit valid deadline action completes it with audit.
T09-TC-04 | Unit + PG + browser | Frozen time around Cairo midnight and the spring DST transition, with timed/untimed hearings, open deadlines and an undated task. | Read day, week and month views from Cairo and a non-Cairo browser. Advance the clock past the deadline. | Calendar days stay aligned to Cairo. Unknown times, overdue deadlines and undated tasks remain distinguishable.
T09-TC-05 | PG | Two Matters, a scheduled hearing and an open confirmed deadline. | Try a cross-Matter link and archiving the Matter with an open obligation. Inject an audit/outbox write failure for a valid change. | Invalid links and archive attempts fail. The injected failure leaves the domain rows, audit and outbox unchanged.
T09-TC-06 | HTTP + browser | An Owner, a Maintainer and an unauthenticated browser, with synthetic agenda entries. | Call direct commands as each actor. As Owner, inspect populated, empty, offline and read-failure states at 390/768/1440px. | Only the authorized actor can read/write. The UI distinguishes states, works by keyboard, and leaves no confidential agenda data in browser storage.
T09-TC-07 | PG | A proceeding result and a draft legal deadline with a manual date entry. | Record or edit the proceeding result and inspect persisted deadline dates and status. | The system derives no appeal date or approval from the court result. The submitted manual date and draft review state stay intact.
```


---

# T10 — Durable reminders, worker leases, and the in-app inbox

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-devops-automator skill/profile for its scoped pass. Read .agents/skills/engineering-devops-automator/SKILL.md and verify its YAML name is agency-devops-automator.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Durable PostgreSQL reminder jobs/leases/retries and worker failure evidence; no Redis, external delivery promises, or extra infrastructure.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t10-reminders. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Implement T10 only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report any missing required skill before dependent implementation.

Inspect actual Git status/base commit, current queue code, and docs/reviews/T09-review.md. Proceed only if it explicitly says ACCEPTED. Otherwise stop and report the missing acceptance; do not implement T09.

Read docs/ROADMAP.md M3/T10; docs/PRD.md FR-10/12 and NFR-05/07; docs/DATA_MODEL.md sections 4 and 7; docs/WORKFLOWS.md sections 4–6; docs/ARCHITECTURE.md sections 3–4/7; docs/SECURITY_OPERATIONS.md jobs/reminders/restore mode; docs/DATA_LIFECYCLE.md; docs/SCREENS.md S02/S08/S14; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-09.

Own src/worker/ reminder processing, scheduling/productivity outbox integration, in-app inbox and relevant health UI, ReminderRule/ReminderDelivery/JobRun migrations, and task-specific tests. Reuse the existing durable JobRun outbox/queue instead of introducing a second event bus or Redis. Shared edits are limited to enqueueing/invalidation at the existing commands and starting the local worker. Do not implement document scanning, cleanup, backup, email, push, or production deployment.

Implement documented day offsets and explicit Cairo reminder instants, atomic claims, expiring leases, bounded retry/backoff, deduplication and failed-state visibility. Source/version changes cancel obsolete work. Recheck source state before delivery so cancelled/completed events do not produce stale notifications. SENT means available in the inbox, not read; readAt is separate and never marks a task or legal action complete. Show last refresh, worker failure, and overdue/missed notifications. Explain in Arabic that closed-app/offline notification delivery is not promised. Honor restore/dispatch-disable mode without starting any job in that mode.

Verify AC-09 with real PostgreSQL and a controlled clock: restart after claim; reclaim expired lease; two workers racing produce one inbox item; crash/retry after commit does not duplicate; date changes invalidate old reminders; cancelled/completed sources suppress delivery; repeated keys cannot change payload; terminal failure is visible and a deliberate retry is safe. Confirm an unknown hearing time stays unknown while reminder policy sets only the alert time. Verify no jobs run in restore mode, unauthorized inbox access fails, and payloads/logs contain no document bytes or secrets.

Inspect real Arabic inbox/error states at 390/768/1440. Run actual lint/typecheck, focused unit/integration/E2E tests, worker restart tests and build. Record commands/exit codes, base commit, migrations, failure evidence, screenshots and NOT RUN limits in docs/reviews/T10-submission.md. Stop for Codex review; do not start T11.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T10-TC-01 | PG + controlled clock | One due reminder and two worker processes. | Race both claims, stop the lease holder, advance beyond expiry and restart a worker. | The lease prevents simultaneous ownership. Expired work is reclaimed and yields exactly one inbox item.
T10-TC-02 | PG + controlled clock | A due job with injectable failure before and after the delivery transaction. | Fail before commit and run retry; then simulate a crash after a successful commit and replay. | Pre-commit failure leaves no item; retry completes once. Post-commit replay leaves the same item and source/version identity.
T10-TC-03 | PG | A pending reminder and a worker holding a claim. | Change the source date, then test source cancellation and completion in separate cases before delivery. | The worker rechecks the source. Obsolete versions produce no inbox item. Only the current eligible source may send.
T10-TC-04 | Unit + PG | An unknown-time hearing and a configured Cairo day offset. | Compute the alert instant across DST and execute the worker twice at the controlled time. | The fired instant follows the configured policy, one item exists and the hearing time remains unset.
T10-TC-05 | PG + browser | A repeatedly failing job and a successful unread reminder. | Advance through bounded retries, inspect terminal failure, retry deliberately, and mark the successful item read. | Backoff stops at the configured limit. Failure/retry is visible. SENT and readAt remain separate, and reading changes no task or deadline status.
T10-TC-06 | PG + HTTP | Due jobs, restore/dispatch disabled, a Maintainer and an unauthenticated caller. | Start the worker in that mode, call inbox endpoints directly, then inspect sanitized logs and payloads. | No job is claimed or delivered in restore mode. Unauthorized reads fail and captured evidence contains no secrets, file bytes or confidential text.
T10-TC-07 | Browser | An inbox with unread, overdue and worker-failed examples. | Review at 390/768/1440px, including loss of connection, and retry a stale refresh. | The Arabic UI identifies worker status and last update, and accurately explains closed-app and offline delivery limits.
```


---

# T11 — Private upload, scanning, and authorized preview

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Private upload/finalization and authorized preview; inspect fail-closed content validation and real negative cases. Owner-approved ADR 0003 defers malware scanning initially.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t11-private-uploads. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS T11 only in D:\Lawyer through Antigravity; Codex owns review.

Read these skills: .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-security-operations/SKILL.md, .agents/skills/lawoffice-arabic-ui/SKILL.md, .agents/skills/lawoffice-testing/SKILL.md. Read GEMINI.md; DATA_MODEL section 5 and shared constraints; WORKFLOWS section 7; SCREENS S10; SECURITY_OPERATIONS sections 2/4; DATA_LIFECYCLE; and ARCHITECTURE Documents Interface.

Require docs/reviews/T10-review.md with ACCEPTED and inspect its actual delivered state. A missing predecessor stops dependent implementation; do not create its acceptance.

Read docs/adr/0003-initial-malware-scan-deferral.md. Its explicit owner decision overrides older scanner-mandatory wording in project skills. Allowed edits: src/modules/documents/, scoped S10 routes/forms and shared UI where necessary, document/upload metadata schema and reviewed migrations, private file-storage configuration, content-validation/finalization worker, affected authorization/tests, and docs/reviews/T11-submission.md. Do not install ClamAV or add scanner dependencies/jobs for the initial release. No OCR, AI, public storage, image-editing suite, version-history feature beyond schema needed for the first immutable version, or production deployment.

1. Implement beginUpload/finalizeUpload/authorizeDownload behind authenticated server Module Interfaces. Generate object keys server-side; keep bytes outside public. Link metadata to an existing matter or party and reject cross-matter proceeding/hearing references.
2. Accept only PDF/JPEG/PNG with the proposed 25 MB per-file limit. Validate content signatures, discovered MIME, size, names/paths and checksum in private quarantine. Under initial ADR 0003 no malware scan is required or executed: record scanStatus NOT_SCANNED_POLICY with the policy/version, never CLEAN. Show truthful unscanned file details. Invalid/incomplete files remain unavailable. If scanning is explicitly enabled later, timeout/failure/inconclusive/stale results must fail closed without silent policy fallback.
3. Finalize only after actual bytes and configured-policy validation evidence exist. Initial policy records NOT_SCANNED_POLICY explicitly. A failed database transaction leaves no ready document reference. Preserve safe cleanup/reconciliation data for unfinished attempts; obey DATA_LIFECYCLE and never delete pinned versions.
4. Build the Arabic S10 basic upload/preview states: uploading, scanning, ready, rejected, incomplete, disconnected. Multiple images are separate documents in V1; no implied PDF merging. Authorize every preview/download, use safe content headers/isolation, and prevent confidential caching.
5. Exercise initial-policy AC-10 and first-version AC-11: valid PDF/photo, oversized/disguised/traversal file, interrupted upload, failed database finalization, duplicate retry, unauthorized URL and MAINTAINER rejection. Prove truthful NOT_SCANNED_POLICY and audit evidence; no scanner execution or fabricated CLEAN status. Scanner failure/timeout/staleness/detection tests are deferred until a separate activation assignment. Use synthetic files; no real client uploads or external scanning sites.

Record actual commands/exit statuses and rendered 390/768/1440 evidence; unavailable checks are NOT RUN. Submit docs/reviews/T11-submission.md with loaded skills, configured validation policy, storage behavior, truthful scanner deferral and remaining limits. Stop; T12 owns version history and later document-link integration.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T11-TC-01 | PG + file + browser | A valid synthetic PDF, JPEG and PNG with independent checksums. | Upload each to a permitted Matter or Party, wait for validation, and preview/download as Owner. | Each READY file matches the uploaded checksum, has a generated private object key and records NOT_SCANNED_POLICY and its version. The Arabic UI states that no antivirus scan was done.
T11-TC-02 | PG + file | A valid file at the configured 25 MB boundary, one just above it, and a benign file with a mismatched extension, MIME or signature. | Submit through the public upload path using the configured size limit. | The boundary file can pass structural checks. The oversized and mismatched fixtures are rejected, never become READY and are unavailable for download.
T11-TC-03 | PG + file | A test filename containing path components and two unrelated Matters. | Attempt to submit unsafe filename/path metadata and inconsistent Proceeding/Hearing references. | The server rejects prohibited inputs. No write occurs outside private storage and no document is attached to the wrong Matter.
T11-TC-04 | PG + file + browser | An upload interrupted partway, plus a separate valid upload with injected database finalization failure. | Inspect both before retry. Retry the valid completed upload with the same attempt/key after removing the failure. | Neither interrupted nor failed-finalization attempt appears as READY. A successful retry exposes one version, with no duplicate ready reference or audit event.
T11-TC-05 | HTTP + file | One READY file, one quarantined file and a copied preview/download URL. | Open the URL as Owner, then try with no session, a revoked session and a Maintainer. | Only the authorized READY download works. MIME/disposition and private no-cache policy are correct. Quarantined content stays unavailable.
T11-TC-06 | Browser | Two valid synthetic photos and one rejected upload. | Use the Arabic UI at 390/768/1440px; watch upload, validating, ready and failure states, including disconnect/retry. | Photos remain separate. The UI identifies errors, offers recovery and never claims partial content was saved. Active scanner failure tests stay deferred under ADR 0003.
T11-TC-07 | PG + file | A valid file already finalized and another intentional upload with the same bytes. | Submit under a new command and review the matching checksum warning before choosing to continue. | The duplicate warning is clear. Any confirmed second record has its own authorized document identity while the original stays intact.
```


---

# T12 — Document versions, paper originals, and existing-record links

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Immutable document versions, authorized metadata search/links and backup-safe cleanup without public exposure.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t12-document-versions. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS T12 only in D:\Lawyer through Antigravity. Codex reviews the result.

Load .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-domain/SKILL.md, .agents/skills/lawoffice-security-operations/SKILL.md, and .agents/skills/lawoffice-testing/SKILL.md. Follow DESIGN for affected visible controls. Read GEMINI.md, DATA_MODEL sections 3–5/7, WORKFLOWS sections 6/7, SCREENS S06/S08/S09/S10, and DATA_LIFECYCLE.

Prerequisite: docs/reviews/T11-review.md is ACCEPTED and its private upload/scan/download behavior exists. Report missing evidence and stop dependent work rather than implementing T11.

Allowed edits: Documents addVersion/history/metadata behavior, scoped existing hearing/deadline/party/POA forms and commands for document links, S12 global-search integration for document titles/metadata, the corresponding schema constraints/migrations, cleanup reconciliation and backup-pin support, relevant tests, and docs/reviews/T12-submission.md. No financial module, OCR, PDF-body search, AI, object-storage migration, advanced image editor, or production backup orchestration.

1. Implement addVersion using T11's configured-policy validation/finalization path (ADR 0003 initially defers malware scanning). Preserve per-version NOT_SCANNED_POLICY and policy/version evidence; never fabricate CLEAN. Each version has a unique object key, version number, checksum and immutable bytes. Switch currentVersionId only after READY; rejected or failed versions cannot replace the previous current version.
2. Display authorized history and retrieve older versions through the same permission checks. Persist the original's paper location and YES/NO/UNKNOWN presence independently of the digital file. Do not equate a scan with possession of an original.
3. Complete previously deferred optional document references for powers of attorney, hearing decisions/results, and legal deadline sources using the existing modules. Enforce ownership/same-matter constraints; general party-owned POA documents must match the principal. Attaching a source does not automatically confirm a legal deadline or validate a power of attorney. Add authorized title/type/date metadata results to the existing S12 global search; do not search PDF image contents, expose storage keys, or return documents the actor cannot download.
4. Implement only the pin records/checks needed to protect document versions during later backups. Cleanup respects current/old approved versions, active uploads, referenced records, and backup pins. T19 still owns coordinated backup execution; do not claim restore success here.
5. Verify AC-11: new version success/failure, old-version retrieval, currentVersion unchanged on validation/DB failure (or enabled-scan failure later), preserved per-version scan-policy evidence, conflicting writes, wrong-party/wrong-matter link rejection, missing-original state, and cleanup refusing a pinned version while expiring eligible temporary files.

Use real PostgreSQL and private synthetic files. Record commands/exit statuses, migrations/upgrades, and actual UI observations where controls changed; mark unavailable checks NOT RUN. Submit docs/reviews/T12-submission.md with loaded skills and explicit T19 integration limits. Stop for review; no T13 finance work.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T12-TC-01 | PG + file + browser | A READY document with version 1 and a different valid file. | Add version 2, verify current selection, then open version 1 from history. | Version 2 becomes current only after READY. Both versions have distinct keys and verified bytes/checksums; each preserves its scan policy evidence.
T12-TC-02 | PG + file | A READY current version; a rejected candidate, an injected finalization error and two writers starting from the same version. | Add rejected/failed candidates separately, then race two valid writes using the same expected current version. | Rejected and failed changes leave the old current pointer and file intact. A version conflict cannot silently overwrite the winning update.
T12-TC-03 | PG + browser | A digital copy with paper-original state UNKNOWN. | Record YES and an independent paper location, then record NO while keeping the scan. | The paper state and location change independently of immutable digital version bytes. UNKNOWN remains an available truthful state.
T12-TC-04 | PG + HTTP | Two Matters, two Party principals and synthetic source documents. | Link a valid hearing decision, deadline source and Party-owned POA copy. Try wrong-Matter or wrong-principal links. | Valid links resolve; invalid lineage is rejected. Attaching evidence approves neither a deadline nor a POA.
T12-TC-05 | PG + browser | Two documents with separate permission scope and text present only inside one PDF. | Search by authorized title and then by the PDF-body-only phrase, and test a direct old-version download without permission. | Metadata search shows only downloadable records, with no storage keys or body-only match; unauthorized historical downloads fail.
T12-TC-06 | PG + file + controlled clock | Current and prior READY versions, a pinned orphan, an active upload and an eligible expired temporary object. | Run reconciliation/cleanup at the configured cutoff and compare the manifest and checksums. | Only the eligible temporary object is removed. Active uploads and pinned or approved versions survive. Coordinated backup/restore is future T19 scope.
T12-TC-07 | Browser | A two-version document and an original-location editor. | At 390/768/1440px navigate versions and links with a keyboard and simulate failed version validation. | Arabic history and original status remain readable, the failed candidate is identified, and the prior version is still accessible.
```


---

# T13 — Balanced ledger, fee agreements, payments, and receipts

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Exact EGP piastres, balanced fee posting/allocation/receipts and transactional concurrency; no tax or legal-revenue claims.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t13-fees-collections. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model, with Codex planning and reviewing. Implement T13 only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-finance: D:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Missing required skill files must be reported before implementation.

Inspect the checkout/base commit and docs/reviews/T12-review.md; proceed only with explicit ACCEPTED. Otherwise stop dependent work and report the missing review without implementing T12.

Read GLOSSARY.md; docs/ROADMAP.md M5/T13; docs/PRD.md FR-08/12 and NFR-01/02/05/07; docs/DATA_MODEL.md sections 2, 6–8; docs/WORKFLOWS.md section 8; docs/SCREENS.md S11 fee/payment forms; docs/ARCHITECTURE.md sections 3–4; docs/adr/0002-financial-subledger.md; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-12/14.

Own src/modules/finance/, fee agreement/payment/receipt UI under existing matter/finance routes, documented fee/ledger/allocation/receipt models and migrations, and financial tests. Reuse identity/authorization/idempotency/audit infrastructure. Do not build expenses/advances, reversals/refunds, multi-client distribution, exports, or a general chart of accounts. Minimal single-client statement data is in scope; consolidated distribution belongs to T15c and PDF/export to T16.

Implement postTransaction and read calculations through the Finance Module. Money is positive bigint EGP piastres, serialized safely; no floats or editable balance columns. A draft agreement changes no balances; approval creates documented balanced charges/installments. Allocate one client's collection to that client's matching fee charges, validate totals, and commit lines/allocations/audit/receipt sequence/idempotency together. Posted entries are immutable. Receipt reprinting preserves its number and never records another payment. Do not silently classify overpayments as advances before T14 exists; reject unsupported excess with an honest explanation. Keep interfaces ready for the documented later kinds without pretending they work.

Use behavioral test-first increments and real PostgreSQL. Prove 15,000 agreement and 5,000 collection leave exactly 10,000 fees due; all postings balance; installments sum correctly; retries/lost responses return the same receipt; same key/different payload is rejected; concurrent collections cannot over-allocate. Reject zero/negative amounts, mismatched debtor/matter, unbalanced/no-line posting, unauthorized calls, and update/delete attempts through supported interfaces. Ensure audit failure rolls back money and receipt creation. Mark the future 1,200 expense portion of AC-12 as T14 scope.

Inspect Arabic confirmation/statements at 390/768/1440. Run actual lint/typecheck, unit/integration/E2E checks and build. Submit exact commands/exit codes, base commit, migration/upgrade evidence, literal expected totals, screenshots and NOT RUN items to docs/reviews/T13-submission.md. Stop for Codex review; no T14.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T13-TC-01 | PG | A Matter and its responsible client with no prior ledger. | Save a 15,000 EGP draft agreement, then approve it as installments of 6,000 and 9,000. | Draft changes no balance. Approved installments total 1,500,000 piastres and all posted entries balance.
T13-TC-02 | PG + browser | The approved 15,000 EGP agreement. | Collect 5,000 EGP toward the matching charge and view the Arabic confirmation and statement. | Fees due are exactly 10,000 EGP. One balanced collection, allocation, receipt number and audit event exist.
T13-TC-03 | PG + browser | A valid payment with a committed but suppressed response. | Retry with the original idempotency key; then change the payment amount under the same key and request the same receipt again. | Replay and reprint return the same transaction/receipt. Changed payload is rejected and no new collection or receipt is numbered.
T13-TC-04 | PG | One charge with 5,000 EGP remaining and two sessions. | Submit two simultaneous 4,000 EGP collections against that charge. | Only one collection succeeds. The remaining fee balance is 1,000 EGP, with no over-allocation or extra receipt.
T13-TC-05 | PG | Two client/Matter scopes and a posted charge. | Separately submit zero or negative amounts, a mismatched debtor/Matter, an unbalanced or empty posting, excess collection and an edit/delete of the original. | Every invalid operation is rejected with no balance change. Excess is not implicitly recorded as an advance; posted history is immutable.
T13-TC-06 | PG + HTTP | A valid collection and an unauthorized actor. | Inject audit failure during valid posting; then try the same direct posting/statement interfaces without finance permission. | Audit failure rolls back ledger, allocation, receipt and idempotency completion. Unauthorized requests return no finance data and post nothing.
T13-TC-07 | Browser | Synthetic fee agreement, collection and receipt. | Review confirmation and reprint at 390/768/1440px with keyboard navigation. | Arabic amounts and remaining fees match the posted values. The receipt remains administrative and keeps its original number. Expense scenarios belong to T14.
```


---

# T14 — Reimbursable matter expenses and client advances

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Separate reimbursable matter expenses and client advances with locked balance checks and independent expected outcomes; office operating expenses are excluded by owner-approved ADR 0004.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t14-expenses-advances. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model. Codex owns planning/review. Implement T14 only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-finance: D:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report a missing required skill rather than silently substituting another.

Inspect actual code/base commit and require docs/reviews/T13-review.md to state ACCEPTED. Otherwise stop dependent implementation and report it; do not finish T13 yourself.

Read GLOSSARY.md; docs/ROADMAP.md M5/T14; docs/PRD.md FR-08/12; docs/DATA_MODEL.md sections 2, 6–8, especially the posting example/formulas; docs/WORKFLOWS.md sections 8–9 and 11; docs/SCREENS.md S11; docs/ARCHITECTURE.md sections 3–4; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-12/13/14.

Own expense/advance/reimbursement commands and reads in src/modules/finance/, corresponding S11 forms and matter summaries, Expense/AdvanceApplication and necessary documented account/line migrations, and financial tests. Reuse T13 posting and authorization rules. Do not add refunds, reversals, automatic allocation across clients, general bookkeeping, or production data. Evidence attachments use existing private Document authorization, not a new public file path.

Read docs/adr/0004-exclude-office-operating-expenses.md. Implement distinct choices for lawyer-funded reimbursable matter expense and spending a client's advance. Office operating expenses (rent, internet, utilities and supplies) are outside V1: no office-expense account, funding enum, command, form, summary or report. Reject unsupported office-expense classifications explicitly. This owner decision supersedes older installed profile/skill references to office expenses; preserve those installed assets. Expense reimbursement settles EXPENSE_RECEIVABLE without becoming fee income. Advance receipt increases CLIENT_ADVANCE; spending reduces that liability without creating a second expense receivable. Enforce same-client/matter lineage and sufficient funds with locks within the posting transaction. Mixed funding is two Expense records sharing expenseGroupId, transaction and evidence, with total exactly matching the confirmed amount. No automatic conversion of client funds into fees. Any documented advance-to-fee operation must be explicit, balanced and separately identified. Keep cash, fees, matter expenses and client money distinct; no editable balances.

Use real PostgreSQL and test-first behavior. Extend the existing example: 15,000 fees, 5,000 collected, lawyer-funded 1,200 => fees due 10,000 and expenses due 1,200; reimbursement => expenses zero, fees unchanged. Advance 2,000 and spending 700 => available advance 1,300 and zero fee income from those actions. Verify unsupported office-expense requests are rejected without rows, split funding is not double-counted, and evidence authorization holds. Reject cross-client use, overspending under concurrent requests, duplicate posting, mismatched split totals, unauthorized calls, and audit failure. Keep original posted entries immutable.

Inspect Arabic funding explanations/confirmations and four separate summary amounts at 390/768/1440. Run actual lint/typecheck, financial unit/integration/E2E checks and build. Save commands/exit codes, base commit, migrations, expected-versus-actual postings, screenshots and NOT RUN limits to docs/reviews/T14-submission.md. Stop for Codex review; no T15a.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T14-TC-01 | PG + browser | Fees of 15,000 EGP with 5,000 collected. | Record a 1,200 EGP lawyer-funded reimbursable Matter expense, then reimburse exactly 1,200. | Fees due remain 10,000 EGP. Expenses due go from 0 to 1,200 to 0. Reimbursement does not increase fee collection.
T14-TC-02 | PG | One client/Matter with no advance. | Receive 2,000 EGP of advance funds, then spend 700 for that Matter. | Available funds are 1,300 EGP. The spend incurs a 700 EGP expense and creates no second expense receivable or fee income.
T14-TC-03 | PG + file | One expense of 900 EGP funded 400 from an advance and 500 by the lawyer, with eligible evidence. | Post the split, inspect both parts, and try one with mismatched sum or unrelated evidence. | Two parts share one expense group, transaction and evidence and total 900. Advance decreases 400 and expense debt increases 500 once. Invalid split/evidence fails.
T14-TC-04 | PG | A client/Matter with 700 EGP of advance; another client/Matter has funds. | Race two 500 EGP spends against the first balance and attempt using funds from the second scope. | Only one spend can commit. The first balance is 200 EGP, the second stays unchanged, and lineage never crosses scopes.
T14-TC-05 | PG + HTTP | Valid expense and advance requests, plus unsupported office rent/internet inputs. | Submit unsupported classifications through the direct interface, try posting without permission, and inspect ledger and report options. | Unsupported/unauthorized operations do not create rows, balances or audit successes. No office operating expense account, option or report is exposed.
T14-TC-06 | PG | One valid split expense with a frozen request key. | Inject audit failure, then retry after removing it. Replay the identical committed command and try altering a part with its key. | The failure leaves no partial parts or postings. Identical replay returns one result; altered replay is rejected.
T14-TC-07 | Browser | One Matter with fees, a reimbursable expense and advance funds. | At 390/768/1440px navigate funding choices, review effects, and inspect the summary after posting. | The UI separates fees due, expense debt, client funds and cash as designed. Client funds only affect fees through a separately approved explicit action.
```


---

# T15a — Full reversal of an erroneous financial record

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Full correction reversals and allocation release; preserve immutable history and prevent duplicate actual cash effects.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t15a-reversals. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Work only on T15a in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-finance: D:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report missing required skill files before implementation.

Inspect the actual checkout/base commit and docs/reviews/T14-review.md. Require explicit ACCEPTED status; otherwise report the missing prerequisite and stop dependent work. Do not implement earlier tasks.

Read docs/ROADMAP.md M5/T15a; GLOSSARY.md Posting/Fees/Client advance; docs/DATA_MODEL.md sections 6–8, especially reversal references and duplicate-cash prevention; docs/WORKFLOWS.md section 10; docs/SCREENS.md S11 reversal form; docs/ARCHITECTURE.md sections 3–4; DESIGN.md; docs/REVIEW_PROTOCOL.md AC-13/14.

Own reverseTransaction and supporting financial reads in src/modules/finance/, the erroneous-record reversal UI, necessary documented reversal/allocation constraints/migrations, and task-specific tests. Shared edits are limited to financial history/receipt cross-references. Do not implement actual refunds, partial reversals, automatic dependency unwinding, new income classification, or change posted originals.

First demonstrate the intended entry effects using existing synthetic transactions, then write failing behavioral tests and implement the minimum. A full reversal requires an original posted transaction, explicit reason, authorization and idempotency. Create exact opposite lines referencing the original; keep original history immutable and release only the applicable allocations in the same transaction with audit. Enforce a single full reversal of an original transaction, including simultaneous attempts. This corrects an erroneous/duplicate record; it does not instruct actual cash disbursement. If an original has later refunds, consumed advances, or unresolved downstream settlements, block with an actionable explanation until its dependencies are separately handled. Do not silently release another client's debt.

Verify with real PostgreSQL: a 5,000 payment recorded twice but actually received once loses only the duplicate ledger effect after reversal; the retained receipt/history remains inspectable. Reversing an eligible settlement reopens the correct debt exactly once. Check balanced opposite lines, preserved identifiers, audit and reference lineage. Reject missing reasons, drafts, already-reversed records, unsupported partial amounts, unauthorized actors, charge reversal with unresolved settlements, and consumed advance reversal. Retry returns the same result; changed payload conflicts; concurrent attempts permit one result. Inject an audit/allocation failure and prove no partial reversal remains. Verify original posted records cannot be edited or deleted through the interface.

Inspect Arabic confirmation and history at 390/768/1440. Run actual lint/typecheck, financial unit/integration/E2E checks and build. Record base commit, exact commands/exit codes, migration evidence, cash-versus-ledger examples, screenshots and NOT RUN reasons in docs/reviews/T15a-submission.md. Stop for Codex review; do not start T15b.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T15a-TC-01 | PG + browser | An agreement for 15,000 EGP and one actual 5,000 EGP receipt entered twice. | Reverse only the duplicate entry with a reason and reopen receipt history. | Fees due are 10,000 EGP and the ledger reflects 5,000 EGP net cash for this receipt history. Both originals remain visible. No actual refund instruction or REFUND is created.
T15a-TC-02 | PG | An eligible payment allocated to a specific fee charge. | Reverse it, compare all original/reversal lines and follow the allocation and audit references. | Amounts and dimensions mirror the original with opposite sides and balance. Only its allocations are released and the correct debt reopens once.
T15a-TC-03 | PG | A single eligible original and two sessions. | Race distinct reversal keys. Replay the winning request, then submit a changed payload under that key. | Exactly one reversal and one set of releases post; stable replay returns that result and altered replay fails.
T15a-TC-04 | PG + HTTP | A draft, an already reversed payment, a charge with unresolved settlements, an advance with spending and a source with a later refund. | Attempt reversal for each, and also test missing reason, partial reversal and a Maintainer request. | Each prohibited request fails without changing balances, cash history, allocations or the original records.
T15a-TC-05 | PG | An eligible posted settlement and recorded before-state. | Inject an allocation-write failure in one run and an audit-write failure in another. | Neither run leaves a reversal, partial release or completed request. The original settlement and its receipt stay unchanged.
T15a-TC-06 | Browser | A correctable synthetic posted record. | At 390/768/1440px inspect the fixed amount, reason field, confirmation and resulting history; try editing/deleting the original. | The amount is read-only and full, Arabic copy explains ledger correction, and no edit/delete or cash-disbursement control is offered from reversal.
```


---

# T15b — Actual refunds and fee adjustments

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Actual partial/full refunds and fee adjustments with capacity/locking tests; do not substitute reversal for disbursement.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t15b-refunds-adjustments. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Implement T15b only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-finance: D:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report any missing required skill before implementing.

Inspect the actual base commit/worktree and docs/reviews/T15a-review.md. Require explicit ACCEPTED; otherwise stop dependent work and report the missing acceptance without implementing T15a.

Read docs/ROADMAP.md M5/T15b; GLOSSARY.md; docs/DATA_MODEL.md sections 6–8; docs/WORKFLOWS.md section 10, including double-deduction prevention; docs/SCREENS.md S11 refund/adjustment forms; docs/ARCHITECTURE.md sections 3–4; docs/REVIEW_PROTOCOL.md AC-13/14; DESIGN.md.

Own refund/fee-adjustment behavior in src/modules/finance/, corresponding S11 forms and immutable receipt/history links, necessary documented originalLineId/refundOfId/allocation migrations, and tests. Reuse T13/T14/T15a posting primitives. Do not add general journal-entry UI, partial reversal, multi-client distribution, or automatic repair of complex dependencies. Any source ambiguity about adjustment allocation must be raised with Codex before posting logic is invented.

Implement partial/full actual refunds with original transaction/line references, reason, payment method/date, locking and remaining-refundable limits. Fee refund reopens the appropriate receivable if its agreement remains in force; expense reimbursement refund reopens its expense debt; advance refund reduces available client liability and cash without fee income. Fee reduction/adjustment is separately identified and balanced, never a second refund movement. For money actually received then returned, post REFUND once; do not combine original REVERSAL and REFUND for the same amount. Reclassifications of received money are noncash adjustments with explicit reviewed account effects. Keep all originals and previous refunds unchanged and visible.

Test one behavior at a time with real PostgreSQL: receipt 5,000 then refund 1,000 gives net cash 4,000 and increases remaining fee debt by 1,000 when the agreement is unchanged; repeat safely with the same key. Verify partial advance return cannot exceed both source availability and current same-client/matter advance balance; reimbursement return does not affect fees; a fee reduction does not create cash. Reject excessive/negative/zero refunds, cross-client allocations, already-reversed source, missing reason, unauthorized access and two concurrent refunds exceeding availability. Failed allocation/audit writes roll everything back. Distinguish ledger reversal from actual refund in the UI and receipt history.

Inspect Arabic effects-before-posting at 390/768/1440. Run actual lint/typecheck, unit/integration/E2E checks and build. Save base commit, exact commands/exit codes, migrations, literal ledger/cash totals, screenshots and NOT RUN limits to docs/reviews/T15b-submission.md. Stop for Codex review; no T15c.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T15b-TC-01 | PG + browser | 15,000 EGP agreed fees with 5,000 collected. | Refund 1,000 EGP with method/date/reason, replay it, and inspect the linked receipt/statement. | Net cash is 4,000 EGP and fees due are 11,000 EGP. One REFUND exists, with no full REVERSAL or altered original.
T15b-TC-02 | PG | An advance of 2,000 EGP with 700 spent. | Return 400 EGP, then attempt a further 901 EGP return. Separately try exceeding the remaining linked source even when other funds exist. | The first result leaves 900 EGP available and lowers cash by 400 without fee income. Both excessive cases fail.
T15b-TC-03 | PG | A lawyer-funded expense reimbursed by 1,200 EGP and a separate fee balance. | Return 300 EGP of the reimbursement. | Expenses due reopen by 300 EGP; fee debt and collection remain unchanged and the original is retained.
T15b-TC-04 | PG + browser | A 2,000 EGP fee receivable and a distinct eligible reclassification fixture. | Approve a 500 EGP fee reduction. Separately apply a reviewed noncash reclassification of received funds. | The reduction leaves 1,500 EGP due. Each adjustment has its own reference, balances, and leaves total cash unchanged.
T15b-TC-05 | PG + HTTP | One source with 1,000 EGP refundable and two authorized sessions. | Race two 600 EGP refunds. Also test invalid sources, zero/negative amounts, absent reason, mismatched clients and unauthorized use. | At most one 600 EGP refund posts and 400 remains available. Invalid calls have no allocations, cash or audit side effects.
T15b-TC-06 | PG | A valid refund with snapshot of postings and allocations. | Inject an allocation or audit error and inspect refund and receipt state before retry. | All writes roll back. Retrying with the original key after removing the failure produces one balanced refund.
T15b-TC-07 | Browser | A fee refund, a ledger reversal and a noncash adjustment. | At 390/768/1440px inspect the effect preview and history before and after posting. | Arabic labels distinguish the money actually returned, debt reopened and noncash changes. Original receipts remain visible and unmodified.
```


---

# T15c — Multi-client distribution, statements, and reconciliation

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Multi-client distribution, reconciled statements and restricted opening positions; no floating balances or fabricated history.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t15c-statements-opening-balances. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex owns planning and review. Implement T15c only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-finance: D:/Lawyer/.agents/skills/lawoffice-finance/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
Report any missing skill instead of guessing its rules.

Inspect the checkout/base commit and require docs/reviews/T15b-review.md to explicitly state ACCEPTED. Otherwise stop dependent implementation and report the dependency; do not implement T15b.

Read docs/ROADMAP.md M5/T15c; GLOSSARY.md; docs/PRD.md FR-08/12; docs/DATA_MODEL.md section 6, including multi-client example and reporting formulas, and section 8; docs/WORKFLOWS.md sections 8–11 and 14; docs/SCREENS.md S09/S11/S13; docs/ARCHITECTURE.md sections 3–4/6; docs/REVIEW_PROTOCOL.md AC-12–14; DESIGN.md.

Own financial payment-distribution/statement queries and commands, the restricted opening-balance command required for T21, client/matter financial summaries and S11/S13 views, necessary related indexes/migrations, and reconciliation tests. Extend payerPartyId and existing line-level debtor dimensions without a second balance source. Do not implement PDF/CSV/ZIP exports, bank integration, tax claims, general bookkeeping, or automatically combine client debts.

Implement explicit distribution of one actual payment among fee charges, reimbursable expenses and advances for selected clients/matters. Default to one client; adding another distribution is deliberate. Payer may differ from each debtor. Allocations must sum to the actual payment, stay within matching debt/source limits, and post atomically with receipt/audit/idempotency. getClientStatement derives balances from posted entries and net allocations; fees due, expenses due and advances available remain separate. Distinguish cash fee collection, fees settled from advances, reimbursements, opening balances, refunds and adjustments. Retain financial debts in reports when professional work closes/archives with a recorded reason; never hide them in active-only totals.

Add postTransaction(kind=OPENING_BALANCE) using the canonical OPENING_BRIDGE account for reviewed synthetic cutover positions: fee debt, reimbursable debt, and client-advance liability remain separate. Record effective cutover date, source/reference, owner confirmation and scoped idempotency. Posted opening receivable MoneyLine IDs must remain valid MoneyAllocation targets; do not fabricate historic fee agreements or treat opening values as current cash collection. The command must reject duplicate source positions or a position already reconstructed through historical transactions. No real migration occurs in T15c.

Verify with real PostgreSQL: one 3,000 receipt splits 2,000 to client A's fees in matter S and 1,000 to client B's advance in matter T; cash moves once and neither debtor gets the other's allocation. Full reference scenario reconciles to fees due 10,000, expenses due zero after 1,200 reimbursement, and advance 1,300 after receiving 2,000/spending 700. Separately test opening positions 10,000 fees, 1,200 expenses and 1,300 advance: statements show these amounts, new cash collections remain zero, a later 2,000 fee payment leaves 8,000 fees due, and repeated opening requests do not duplicate. Include reversals/refunds and reconcile statements. Reject mismatched totals, cross-client settlement, invalid references, concurrent over-allocation and unauthorized statements. Retry does not duplicate payment/receipt and failed audit leaves no partial distribution.

Inspect Arabic statement/confirmation at 390/768/1440. Run actual lint/typecheck, financial unit/integration/E2E tests and build. Submit exact commands/exit codes, base commit, reconciliation fixtures/results, migrations, screenshots and NOT RUN items in docs/reviews/T15c-submission.md. Stop for Codex review; no T16.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T15c-TC-01 | PG + browser | Client A owes fees in Matter S, client B has a separate Matter T and a third person is the payer. | Distribute a 3,000 EGP payment as 2,000 to A fees in S and 1,000 to B advance in T. | Cash increases 3,000 once. A fee debt drops 2,000, B advance rises 1,000, and the payer acquires neither debt. One receipt shows the breakdown.
T15c-TC-02 | PG | Independent opening amounts of 10,000 EGP fees, 1,200 expenses and 1,300 advance. | Post reviewed OPENING_BALANCE entries with source and cutover date. Replay and then collect 2,000 against the opening fee line. | Opening entries balance through OPENING_BRIDGE and create zero new cash collections. They replay once. Payment uses the original receivable line and leaves 8,000 fees due.
T15c-TC-03 | PG + HTTP | An existing opening source, an independently reconstructed historical position and an actor without posting permission. | Try duplicate opening positions, historical overlap, missing review/source and unauthorized opening or statements. | All attempts fail without duplicates, unauthorized disclosure or changes to cash.
T15c-TC-04 | PG | A valid mixed payment with allocation amounts, two overlapping concurrent commands and a separate injectable audit failure. | Submit mismatched totals/cross-client references, race the valid commands, and repeat an identical winning request. Test rollback with audit failure. | No invalid or excess allocation posts. Replay preserves one receipt and the audit failure rolls back every distribution line, allocation and receipt.
T15c-TC-05 | PG + browser | The reference example with fees 15,000/collection 5,000, expense and reimbursement 1,200, advance 2,000 and spending 700. | Read statements, then add a linked refund/reversal in a separate fixture and reconcile against raw balanced lines and net allocations. | Reference balances are 10,000 fees due, zero expense debt and 1,300 advance. Refunds and reversals display separately and reconcile to their independent expected effects.
T15c-TC-06 | PG + browser | A Matter with unpaid fees and no professional obligation blocking archive. | Close and archive it with a reason; inspect consolidated statement and summary filters. | Debt and opening/collection distinctions remain visible. Archiving professional work never hides the amount owed.
T15c-TC-07 | Browser | A single-party default and a multi-client payment fixture. | At 390/768/1440px deliberately add the second allocation and review the confirmation and resulting statement. | UI defaults to one client, identifies payer and each debtor separately, and displays separate fee/expense/advance and cash activity totals.
```


---

# T16 — Arabic printing and authorized private exports

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-frontend-developer skill/profile. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-document-generator skill/profile for its scoped pass. Read .agents/skills/specialized-document-generator/SKILL.md and verify its YAML name is agency-document-generator.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Generate the planned HTML/Playwright Arabic PDFs and private CSV/ZIP exports; inspect layout, totals, authorization and formula injection without changing stacks.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t16-print-export. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement T16 only in Antigravity using the project owner's selected Gemini model. Codex plans and reviews. Use D:/Lawyer and preserve other contributors' changes.

Read GEMINI.md and explicitly apply:
- D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-security-operations/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md

Inspect docs/reviews/T15c-review.md and its baseline: it must genuinely say ACCEPTED before implementation. Missing acceptance is a blocker, not permission to finish finance or start a different task.

Read docs/ROADMAP.md M6/T16, docs/PRD.md FR-09/FR-11, DESIGN.md, docs/SCREENS.md S12/S13 and S11 receipt rules, docs/DATA_MODEL.md finance/document relationships, docs/WORKFLOWS.md export/printing workflows, docs/ARCHITECTURE.md printing and Module Interfaces, docs/SECURITY_OPERATIONS.md permissions/data protection, docs/DATA_LIFECYCLE.md ready-export policy, and docs/REVIEW_PROTOCOL.md AC-15.

Allowed edits: authorized report/export entry points, Operations reporting/export implementation, Arabic HTML print templates, PDF jobs, private staging/download/expiry behavior, report UI, and focused tests. Use existing Finance/Documents Interfaces rather than duplicate their calculations or bypass authorization. Exclude tax certification, importer work, financial-rule changes, public sharing, OCR/AI, and deployment.

1. Inspect accepted data Interfaces and scope the paths. Implement hearing list, matter summary, administrative receipt, and client statement with period/filter selection and preview. Label receipts administrative, never accredited tax invoices.
2. Generate PDFs using the pinned server-side Playwright path and local Arabic font. Include creator, generation time, filters, correct Arabic direction, stable totals, and reasonable multipage breaks. Bound job concurrency and surface failure/retry instead of a false ready state.
3. Implement UTF-8 CSV with formula-injection defenses for dangerous cell prefixes, plus a private matter ZIP containing only authorized records/documents. Do not include secrets or another matter's data. Never let client-supplied paths choose filesystem locations.
4. Authorize request, job execution, and every download, including after permission/session changes. Ready exports expire after 24 hours under DATA_LIFECYCLE; cleanup removes staged outputs, preserves audit references, and cannot delete source documents or backup-pinned versions.
5. Use synthetic multipage Arabic data, long names, date-only hearings, and financial acceptance examples. Open generated PDFs and exported files. Compare balances against the existing Finance Interface. Prove unauthenticated/maintenance/incorrect-scope downloads fail, malicious CSV cells cannot become formulas, expired outputs fail safely, and a failed job never exposes partial content.

Run actual appropriate lint/typecheck/integration/E2E/build checks. Save docs/reviews/T16-submission.md with baseline, exact commands and exit statuses, sample PDF/ZIP/CSV paths, visual observations, security/failure evidence, and NOT RUN reasons. Do not self-accept or begin T17; stop for Codex review.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T16-TC-01 | Browser + artifact | A synthetic day/week of hearings with long Arabic names, mixed-direction docket numbers, unknown times and enough rows to paginate. | Generate the filtered hearing-list PDF. Open and inspect the first, middle and last pages. | Arabic is connected and RTL. Dates, codes, paper locations, unknown-time label, filters, creator and generation time match the source. Page breaks preserve complete rows.
T16-TC-02 | Browser + artifact | A Matter, one posted receipt and a statement with independently expected balances. | Preview and render each document type, then reprint the receipt. | The correct filters and totals match authorized source records, and the same receipt number is reused with an administrative label.
T16-TC-03 | Unit + artifact | Synthetic CSV cells beginning with common spreadsheet formula characters and cells with commas, quotes, newlines and Arabic. | Export and open the CSV in a supported spreadsheet client or inspect parsed cell types. | Potential formulas are treated as text. Arabic survives UTF-8 and ordinary quoted data round-trips.
T16-TC-04 | PG + HTTP + artifact | Two Matters with different documents and a single authorized export scope. | Generate and unpack a ZIP for the first Matter. Inspect every entry, including server-generated filenames and included metadata. | Only authorized records and documents appear. No credentials, storage paths, unrelated files or unsupported financial data are exported.
T16-TC-05 | PG + HTTP | One ready export plus a queued job, with Owner and unauthorized fixtures. | Request/generate/download from permitted and prohibited roles. Revoke permission/session after queueing and after readiness in separate runs. | Request, execution and download each enforce authorization. A copied URL after revocation returns no file.
T16-TC-06 | PG + file + controlled clock | A staged output with injected render failure, a READY export and an independent source file protected by a backup pin. | Observe failure, retry normally, then advance past 24 hours and run cleanup. | Partial bytes never become downloadable. A ready output expires and cleanup retains audit, source bytes and pinned versions.
T16-TC-07 | Browser | Arabic preview with synthetic export jobs queued past the configured concurrency limit. | Observe generating/failure/ready states and retry with keyboard at 390/768/1440px. | The UI reflects the persisted job state, the scheduler obeys its limit, and failed work never shows a false download link.
```


---

# T17 — Limited CSV import, preview, and safe batch replay

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-frontend-developer skill/profile for its scoped pass. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: The accepted limited import template, clear Arabic preview and persistent replay/source-link checks; no universal migration engine.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t17-csv-import. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

You are the Antigravity implementer using the user-selected Gemini model; Codex plans and reviews. Implement T17 only in D:/Lawyer.

Read GEMINI.md and explicitly apply:
- lawoffice-delivery: D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- lawoffice-domain: D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- lawoffice-arabic-ui: D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- lawoffice-testing: D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md
If a required skill is missing, report it before implementation.

Inspect actual code, Git status/base commit, and docs/reviews/T16-review.md. Proceed only with explicit ACCEPTED status. Otherwise stop dependent work and report it; do not implement the predecessor.

Read docs/ROADMAP.md M6/T17; docs/PRD.md FR-11/12 and NFR-05/07; docs/MIGRATION.md migration order/source template/batch steps/opening balances; docs/DATA_MODEL.md sections 2–3 and 7–8; docs/WORKFLOWS.md section 12; docs/SCREENS.md S15; docs/ARCHITECTURE.md sections 3–4; docs/DATA_LIFECYCLE.md import staging; docs/REVIEW_PROTOCOL.md AC-16; DESIGN.md.

Own previewImport/commitImport and private staging in src/modules/operations/, S15 import routes/forms, ImportBatch/ImportRow/ImportSourceLink migrations, one documented V1 template/sample, and import tests. Reuse authorized domain commands/invariants. Do not build a universal importer, linked multi-file migration engine, financial balance-column import, automatic record merging, scanning, or production migration. The documented starting template supports the single-file source fields in MIGRATION; multi-party/proceeding ambiguity must stop for review rather than be flattened into invented relationships.

First document and display the exact limited template and required stable source identity. Parse into private staging without creating live domain records. Preview each transformation, normalized value, missing field, ambiguous date, existing source link and similar party candidate. Require an explicit valid-row-versus-correct-all choice; never merge people solely by name or overwrite existing records on replay. Commit small atomic units with per-row outcomes, stable sourceNamespace/entityType/sourceRowId mapping, idempotency and audit. Preserve missing data as draft/unreviewed instead of fabricated dates/numbers. Report rollback limits: after later linked activity, corrections replace destructive batch deletion. Honor staging expiry and retain redacted mappings/results under the lifecycle policy; no raw PII in logs.

Verify AC-16 using real PostgreSQL and synthetic CSV: valid limited rows create expected records; invalid/ambiguous dates show row-specific errors and are not committed; unknown client/number remains explicit draft; duplicate source rows and repeated batches cannot duplicate; same key with changed payload conflicts. A crash/retry resumes from actual outcomes, not an assumed all-or-nothing batch. Test unauthorized preview/commit, cross-record relation errors, duplicate-name review, rollback refusal after new links, and no domain writes during preview.

Inspect Arabic review/error states at 390/768/1440. Run actual lint/typecheck, focused unit/integration/E2E checks and build. Save commands/exit codes, base commit, migrations, exact template limits, sample row reports, screenshots and NOT RUN reasons to docs/reviews/T17-submission.md. Stop for Codex review; no T18.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T17-TC-01 | PG + browser | A CSV following the documented template with two valid rows and recorded domain counts. | Stage and preview without approval; inspect mappings and normalized values, then approve valid rows. | Preview performs no domain writes. Approval creates exactly the expected records, stable mappings and audit outcomes.
T17-TC-02 | PG + browser | A batch with an ambiguous date, a row missing a client/case number, an invalid relation and a valid row. | Review each row and test correct-all versus valid-only approval in separate runs. | Errors identify the relevant rows. Ambiguous dates are never guessed, missing optional data stays explicit draft, and only approved valid rows commit.
T17-TC-03 | PG | A repeated source row, a replayed batch key and the same row ID in a different valid namespace. | Approve, replay, and send changed data under the original key. | Same source mapping creates one record. An identical replay preserves outcomes. Changed payload fails without overwrite; distinct source namespaces remain distinct.
T17-TC-04 | PG | A batch with at least three valid rows and controlled failure after the first atomic unit. | Interrupt the batch, inspect persisted outcomes, then resume. | Committed rows retain IDs and outcomes. Replay processes only unsettled units and each resulting live record exists once.
T17-TC-05 | PG + HTTP + browser | Two parties with similar normalized names and actors without import permission. | Preview a similar-name row as Owner and explicitly resolve it. Try direct preview and commit as unauthorized actors. | No automatic identity merge occurs. Both unauthorized paths are denied without exposing staged names or writing records.
T17-TC-06 | PG + file + controlled clock | An imported record with later linked activity, closed staging, and an abandoned unapproved batch. | Check correction/rollback behavior, advance past policy expiry, and inspect retained data and logs. | Later links prevent destructive batch deletion. Expired raw staging is removed, no abandoned row is accepted, and only permitted redacted results/mappings remain.
T17-TC-07 | Browser | Valid, draft, duplicate and rejected synthetic rows. | Navigate the Arabic preview/results forms by keyboard at 390/768/1440px and simulate a failed commit. | Review choices and row errors are clear. Retry presents actual persisted outcomes and never implies uncommitted rows were written.
```


---

# T18 — Restricted deployment configuration and operational checks

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-devops-automator skill/profile. Read .agents/skills/engineering-devops-automator/SKILL.md and verify its YAML name is agency-devops-automator.
- Supporting specialist: use the agency-security-architect skill/profile for its scoped pass. Read .agents/skills/security-architect/SKILL.md and verify its YAML name is agency-security-architect.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Pinned private deployment configuration and isolated fault checks; no service purchase or live deployment without the existing explicit operational assignment.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t18-restricted-deployment. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS T18 only in D:\Lawyer through Antigravity. Codex is the reviewer.

Read .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-security-operations/SKILL.md, .agents/skills/lawoffice-testing/SKILL.md, GEMINI.md, ARCHITECTURE, SECURITY_OPERATIONS sections 1–4/6–8, DATA_LIFECYCLE, and the accepted dependency register.

Require docs/reviews/T17-review.md with ACCEPTED and inspect the actual app/schema/config. Missing acceptance stops dependent implementation. This prompt authorizes configuration and isolated synthetic validation, not purchase of services, external deployment, or use of real credentials/data.

Allowed edits: ops/ production Compose and runbooks, app/worker image/build configuration, environment examples, sanitized operational health/monitoring code, S14 operational status display, targeted checks, and docs/reviews/T18-submission.md. No product feature additions or replacement of the approved stack.

1. Prepare pinned versions for app/worker and PostgreSQL. Under owner-approved ADR 0003, omit ClamAV/freshclam and scanner jobs/resources from the initial release; document the disabled policy and truthful per-version scan status. Use least-privilege runtime users, persistent private data volumes, restart/health behavior and bounded concurrency. Distinguish deployment credentials from synthetic examples; never commit secrets.
2. Document and configure the proposed Tailscale Serve HTTPS private-access path. Do not enable Funnel, expose database/scanner ports, or enable public registration. Treat Caddy/public access as an alternative requiring a documented selected target, not a simultaneous default.
3. Configure sanitized external health/worker-heartbeat/backup-status monitoring contracts and disk threshold handling (75% warning, 85% urgent). Include UTC storage/Cairo scheduling, NTP, update procedure, and safe migration/rollback steps. A prior image does not revert a changed schema.
4. Exercise an isolated synthetic deployment: startup, readiness, lost database, stopped worker, restart, private volume persistence, direct unauthorized routes and configured scan deferral. Prove no scanner service is required and files are not falsely marked CLEAN. Scanner-failure tests apply when a separate activation is approved. Verify installation/caching behavior on actual HTTPS when an approved test endpoint exists; confidential content must not enter PWA/public caches.
5. Report the selected real deployment target and its explicit authorization if one exists. If none exists, finish all local configuration/checks and mark external HTTPS/mobile-outside-network, provider monitoring, and real-host tests NOT RUN with the exact missing prerequisites. Do not claim production readiness or manufacture a successful deployment.

Submit docs/reviews/T18-submission.md with loaded skills, commands/exit codes, effective port/access configuration, operational observations, and each untested production gate. Stop for Codex review; T19 owns backup/restore, and real-data operation remains gated.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T18-TC-01 | Local operations | An isolated synthetic Compose environment with fresh private volumes. | Build/start the pinned images, inspect effective configuration/ports/runtime privileges, and record readiness and restart wiring. | App/worker and PostgreSQL use the documented versions and least-privilege roles. No public database or scanner listener, scanner service, Funnel or registration flow is enabled.
T18-TC-02 | Local operations + HTTP | A healthy synthetic deployment with jobs scheduled and a test volume marker. | Stop PostgreSQL and separately stop the worker, then restart services and recheck health and data. | Readiness fails safely on database loss, worker heartbeat exposes the outage, recovery restores service and recorded volume data survives.
T18-TC-03 | Local operations + browser | The active scan-deferral policy and one harmless synthetic PDF. | Upload and inspect the worker services, final file status, private storage and direct access without a valid session. | Validation can produce READY with NOT_SCANNED_POLICY only. No scanner job/status is fabricated and private routes/files require current authorization.
T18-TC-04 | Local operations | A controlled disk-capacity metric and sanitized worker/backup-status fixtures. | Exercise values below 75%, at 75% and at 85%, a stale heartbeat and a failed/stale backup marker. | Severity matches the configured thresholds, operational status reflects stale/failure states, and health/alert evidence omits private data and secrets.
T18-TC-05 | Local operations | A prior-version synthetic database on a disposable installation and the documented update plan. | Read effective NTP/timezone settings, rehearse the update/migration and inspect the rollback decision and configuration. | The application schedules for Cairo while storage preserves agreed timestamp semantics. The rehearsed plan distinguishes app image rollback from schema or data recovery.
T18-TC-06 | Manual + device | An explicitly approved private HTTPS test endpoint and actual mobile/desktop devices. | Verify authorized private access, mobile access outside the home network, installed PWA state and browser cache contents; record missing prerequisites if unavailable. | The approved HTTPS path works and no confidential route/file appears in PWA caches. Unavailable external, host or provider checks are NOT RUN, with reasons.
```


---

# T19 — Consistent backup, key recovery, and restore drill

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-database-reliability-engineer skill/profile. Read .agents/skills/engineering-database-reliability-engineer/SKILL.md and verify its YAML name is agency-database-reliability-engineer.
- Supporting specialist: use the agency-devops-automator skill/profile for its scoped pass. Read .agents/skills/engineering-devops-automator/SKILL.md and verify its YAML name is agency-devops-automator.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Coordinate dump/files/manifest/key backup and clean restore drills with measured evidence; do not add HA, replication or PITR.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t19-backup-restore. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS T19 only in D:\Lawyer through Antigravity. Codex reviews the evidence.

Load .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-security-operations/SKILL.md, and .agents/skills/lawoffice-testing/SKILL.md. Read GEMINI.md, SECURITY_OPERATIONS sections 3/5–8, DATA_LIFECYCLE, DATA_MODEL BackupRun/BackupFilePin/JobRun and encrypted identity fields, and AC-17 in REVIEW_PROTOCOL.

Prerequisite: inspect ACCEPTED in docs/reviews/T18-review.md and verify actual deployment configuration. If absent, report and stop dependent implementation. Use a disposable isolated synthetic environment. This prompt does not authorize accessing real clients, uploading to an unselected service, or overwriting an existing database.

Allowed edits: ops/ backup/restore scripts and runbooks, backup metadata/pin schema and operations commands, RESTORE_MODE/job controls, S14 backup/restore-test status, tests/evidence, and docs/reviews/T19-submission.md. No new business features.

1. Build one coordinated backup operation: exclusive run identity; temporarily gate writes/upload finalization and drain worker transactions with timeout; produce pg_dump and a referenced immutable-file manifest; pin required versions before resuming writes; copy/encrypt the bundle with restic; verify completeness/checksums before marking success or releasing pins. Handle timeout/failure without a permanent write freeze or false successful status.
2. Preserve required application/schema versions and settings. Document separate encrypted recovery-key escrow, current/old key IDs and Auth secrets, retention, offsite/offline rotation, pruning privileges, and externally observable failure/age. A dump alone or a second directory on the production disk is not an offsite backup.
3. Restore into a clean isolated destination with RESTORE_MODE preventing outgoing notifications, jobs, cleanup, and backup scheduling. Verify manifest, counts, sample multipage files, hearing dates, ledger/allocations/statements, synthetic identity decryption, MFA/recovery, and old-session revocation. Review queued jobs before release; never automatically replay old notifications.
4. Run deliberate missing-file/checksum failure, failed backup, interrupted run, and lost-host recovery scenarios. Measure actual data gap and recovery duration against target RPO<=24h/RTO<=4h; label these targets rather than guarantees. Complete AC-17 with concrete evidence.
5. Use independently controlled test destinations where available. If an actual offsite/offline location or external watchdog is not selected, finish local synthetic drills and mark those resilience checks NOT RUN; do not count a same-host test as full 3-2-1 validation. List what must be resolved before production.

Record commands/exit codes, backup/snapshot IDs, manifest reconciliation, restore timing, remaining limits, and loaded skills in docs/reviews/T19-submission.md. Stop for Codex review. Do not start the lawyer pilot or migrate real records.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T19-TC-01 | Operations + PG + file | A disposable source with synthetic files, encrypted identity samples under current and historical key IDs, jobs and ledger data. | Start two backup requests, gate writes, drain in-flight worker/finalization work and record the dump/immutable-file manifest and pin acquisition. | One backup owns the run. A consistent snapshot and complete verified manifest are captured. Writes resume after the protected set is pinned.
T19-TC-02 | Operations + PG + file | An active transaction exceeding the drain limit and a separate interrupted or failed copy. | Run backup in each failure condition and inspect run status, alerting, write gate and pin lifecycle. | Failed work cannot report success or leave a permanent write freeze. Incomplete snapshots and pins follow the documented reconciliation process.
T19-TC-03 | Restore drill | A verified backup artifact and independent clean disposable restore destination with ready and overdue jobs. | Restore with RESTORE_MODE enabled; run checksum and count comparisons, open sample files, and attempt dispatch, cleanup and backup scheduling. | Restored IDs, bytes and counts match the manifest. No jobs or outbound notifications execute, and old jobs are reviewed before release.
T19-TC-04 | Restore drill | Backup data with a date-only hearing, known ledger/allocations, two encrypted identities, a synthetic Owner and an old session. | Compare dates and independently expected balances, test identity recovery and a fresh MFA/recovery path, then check the old session. | Dates and statements match. Authorized decryption works for both key IDs, fresh login works, and pre-restore sessions are rejected.
T19-TC-05 | Restore drill | Independent copies of the backup with one file missing, a separate corrupt file, and a run missing a required key. | Inspect verification and attempt the documented restore acceptance in each run. | Missing data, checksum mismatch or required key failure prevents successful restore acceptance. The isolated destination remains protected and observations identify the missing requirement safely.
T19-TC-06 | Operations + manual | A lost-host rehearsal and a simulated source change after the last snapshot. | Recover to an independent available test destination, record snapshot/incident/new-host-ready/recovery times, and compare against RPO 24h and RTO 4h targets. | The measured data gap and duration are reported independently and any missed target is explicit. Offsite/offline/watchdog checks without approved prerequisites are NOT RUN.
T19-TC-07 | Operations | A restored database with pinned current/old document versions and a backup-status display. | Exercise configured retention/pruning in a synthetic run and inspect S14 and operator alert evidence. | Required versions and recovery material remain protected. Status reflects last verified backup and restore and surfaces failures without sensitive contents.
```


---

# T20 — Observed lawyer pilot and usability evidence

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-reality-checker skill/profile. Read .agents/skills/testing-reality-checker/SKILL.md and verify its YAML name is agency-reality-checker.
- Supporting specialist: use the agency-accessibility-auditor skill/profile for its scoped pass. Read .agents/skills/testing-accessibility-auditor/SKILL.md and verify its YAML name is agency-accessibility-auditor.
- Supporting specialist: use the agency-frontend-developer skill/profile for its scoped pass. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Observe the real lawyer pilot and record actual usability/accessibility findings; do not invent user participation, self-approve, or expand the UI.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t20-lawyer-pilot. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Carry out T20 only in Antigravity with the project owner's selected Gemini model. Codex is the planner/reviewer. Work in D:/Lawyer. This assignment prepares and observes a pilot; it does not authorize invented user observations or an automatic production transfer.

Read GEMINI.md and explicitly apply:
- D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md

First inspect docs/reviews/T19-review.md and its referenced tested release. Require genuine ACCEPTED status and recovery evidence. Missing acceptance blocks the pilot; do not build backup/restore or waive launch gates yourself.

Read PRODUCT.md, docs/ROADMAP.md M8/T20, docs/MIGRATION.md migration order, parallel running, training, and launch gate, docs/SCREENS.md core journeys and pilot acceptance scenario, DESIGN.md verification targets, docs/SECURITY_OPERATIONS.md production gate and outage procedures, and docs/REVIEW_PROTOCOL.md AC-18.

Allowed edits: pilot scripts/checklists, synthetic fixtures in an isolated test environment, observation records, a prioritized findings register, and the submission. Exclude broad product changes, new features, source-code fixes before a separate scoped review assignment, deployment, resetting a database, or importing unapproved real files. Real-data pilot activity requires an identified authorized environment and five near-term matters individually selected and reviewed by the lawyer.

1. Confirm the accepted release and devices. Prepare scenarios with two matters for one client, two clients in one matter, first instance/appeal, unknown hearing time, a long title, a 20-page document, and allocated payment. Use clearly labeled synthetic data unless an approved real-data pilot is explicitly available.
2. Prepare five short training sessions and a 7–14-day observation log, adjusted to actual hearing availability. Record date, environment, scenario, assistance required, errors, recovery, and completion; proposed speed targets remain targets until measured.
3. Have the father actually perform agenda/search/paper-location lookup, hearing result/adjournment/task, image upload/review, separate fee/expense/client-money entry, and printing. Observe rather than continually directing him. Record what genuinely occurred, without copying client content into reports.
4. Exercise disconnection, uncertain save, two-device conflict, correction, and outage fallback safely. Reconcile upcoming dates against paper each day; do not claim digital agenda adoption merely because data loaded. Do not maintain independent financial histories after a cutover.
5. Document comprehension problems and request scoped fixes through Codex. If the lawyer or real pilot window is unavailable, finish the preparation, mark user-observed portions NOT RUN with the reason, and leave acceptance pending. Automated tests cannot substitute for the father's observed use.

Save docs/reviews/T20-submission.md with baseline, actual commands/exit statuses, observation dates, privacy-safe evidence, findings, and every NOT RUN limitation. Never self-approve AC-18, fabricate 7–14 days, or start T21; stop for Codex review.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T20-TC-01 | Manual gate | The T19 review, an exact test release, approved devices and five prepared near-term examples. | Check accepted recovery and confirm the environment before any session. Use labeled synthetic cases unless the lawyer explicitly selects real pilot Matters and the environment is authorized. | The observation log identifies release, environment and allowed dataset. Missing approval blocks real-data work.
T20-TC-02 | Observed pilot | A client with two Matters, a Matter with two clients, first instance and appeal, an unknown-time hearing and paper-location cues. | Ask the lawyer to find today's work and the paper file, then choose the correct Proceeding without step-by-step coaching. | The lawyer finds the correct items and explains the separate Matter/Proceeding and time-unknown labels. Record assistance, errors and time observed.
T20-TC-03 | Observed pilot | One scheduled hearing and a follow-up task request. | Have the lawyer record the result, next date and task on mobile, then correct a decision with a reason. | The intended follow-ups exist once. The lawyer can inspect the correction and recognize the earlier decision without continual help.
T20-TC-04 | Observed pilot | A synthetic image, a 20-page PDF and known fee/expense/advance amounts. | Have the lawyer upload and review documents, record the three money categories, verify balances and print the schedule or statement. | The lawyer distinguishes scanned copy and original, and fee debt, reimbursement and client funds. Printed output agrees with the fixture.
T20-TC-05 | Observed pilot | Two approved devices, an uncertain save scenario and a current printed schedule. | Observe connection loss, a two-device conflict, retry and the paper fallback drill. | The lawyer recognizes uncertainty and conflict, avoids duplicate recording and can follow fallback. The record states help required and how discrepancies were resolved.
T20-TC-06 | Manual observation | Five short training sessions and an actual 7–14-day pilot window aligned to hearing availability. | Record what occurred each day, reconcile near-term dates with paper and create a prioritized findings register. | Dates, scenarios, errors, workarounds and successful actions are documented without client content. Unavailable lawyer or pilot dates are NOT RUN and keep AC-18 pending.
```


---

# T21 — Approved migration, cutover, and office handover

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-database-reliability-engineer skill/profile. Read .agents/skills/engineering-database-reliability-engineer/SKILL.md and verify its YAML name is agency-database-reliability-engineer.
- Supporting specialist: use the agency-technical-writer skill/profile for its scoped pass. Read .agents/skills/engineering-technical-writer/SKILL.md and verify its YAML name is agency-technical-writer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Run the canonical-name or registered-native-alias preflight in docs/AGENCY_AGENTS.md before dependent implementation. If a canonical TypeName is rejected but define_subagent is available, register its canonical instructions under the documented lawoffice-native- alias and actually invoke that alias; record the profile/definition/type/ID mapping. This is native registration, not a persona fallback. If the bounded native preflight fails, report BLOCKED_NATIVE_AGENTS and stop dependent implementation. Do not continue directly, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Use accepted migration/opening commands and approved cutover/recovery gates; prepare the Arabic handover and reconcile actual authorized results.
- Resolve profile and definition paths from the current workspace root. A skill name is its frontmatter name, not its folder name. Read the project-local files in full; do not infer activation from a directory listing. If a required profile is missing/unreadable or has the wrong name, stop dependent implementation and report the exact name/path. Do not delete extra installed profiles, install replacements, or silently substitute one.
- The parent coordinates the task; the delegated lead implements owned paths. Give each child the task ID, role, required references/skills, owned paths, snapshot SHA, allowed actions, and checks. Freeze a committed checkpoint before support review; supports inspect that snapshot in separate contexts and use separate worktrees when commands could conflict. Reconcile findings through the lead and rerun affected checks. Parallelize independent work only; do not write the same files concurrently or spawn nested agents. Preserve the approved LawOffice stack, task scope, project skills, and Codex review ownership.
- Before submission, record actual native invocation/conversation IDs for all assigned roles, definition paths, profile metadata/path/SHA-256, ownership, inspected SHA, concrete findings/actions, lead reconciliation, and test results. Mark missing runtime evidence NOT RUN; a portable validator or a profile-load list does not prove execution. Do not self-approve or merge main.
End Agency Agent assignment.

Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t21-office-handover. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Carry out T21 only in Antigravity using the project owner's selected Gemini model. Codex plans and reviews; the lawyer approves professional data. Work in D:/Lawyer. Use accepted migration tools rather than expanding their scope.

Read GEMINI.md and explicitly apply:
- D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-domain/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-security-operations/SKILL.md
- D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md

Inspect docs/reviews/T20-review.md and its release baseline. Require actual ACCEPTED status, not merely completed pilot preparation. Check its T19 recovery references and the accepted T17 importer limitations. Missing evidence blocks dependent live work; do not implement predecessors or invent acceptance.

Read docs/ROADMAP.md M8/T21, docs/MIGRATION.md in full, docs/DATA_MODEL.md opening-balance rules, docs/WORKFLOWS.md migration/correction workflows, docs/DATA_LIFECYCLE.md staging retention, docs/SECURITY_OPERATIONS.md backup/recovery and production gate, and docs/REVIEW_PROTOCOL.md submission/handover requirements.

Allowed edits: migration/cutover checklists, approved-source mapping records, reconciliation reports, office handover documents, and a one-page Arabic lawyer guide. Execute the existing importer/opening-balance workflows only against sources, environment, and dates explicitly identified and approved by the office owner. Exclude new importer features, unapproved source discovery, guessed records/balances, direct balance writes, destructive resets/cascade rollback, and automatically merging independently modified databases.

1. Prepare a concrete cutover runbook identifying the release, destination, selected source files/batches, stable source keys, responsible people, proposed time, known gaps, and fallback. If these inputs are absent, prepare the documents and report the live-transfer portion NOT RUN; never choose or fabricate an approval.
2. Before live writes, verify authorization and all launch gates, current consistent off-server backup, accessible independent recovery keys, and documented successful full restoration. Take and verify the required pre-cutover backup; failure stops transfer.
3. Follow the approved batch order: five near-term matters, remaining dates within 30 days, remaining active files, then concise closed-file indexing. Preview every transformation. Missing or ambiguous data needs review; repeat batches must not duplicate or overwrite silently.
4. Reconcile 100% of upcoming 30-day dates against paper, relationships/document references, row counts, and source keys. Have the lawyer approve opening financial positions with a fixed cutover date and evidence. Require the accepted T15c postTransaction OPENING_BALANCE command and its tests; if absent, report a dependency gap rather than creating ledger writes here. Never combine opening balances with historical transactions for the same position.
5. Provide the one-page Arabic daily-use/outage guide, printed upcoming schedule with issue time, and named update/backup/review responsibilities. Record unresolved issues and acceptance separately. On failure, preserve a snapshot, stop writes at a known point, export dates/latest transactions, and follow the approved paper fallback without resetting data.

Save docs/reviews/T21-submission.md with baseline, actual commands/exit statuses, approved source references, reconciliation and backup/restore evidence, approvals, and NOT RUN gaps. Do not claim production launch or final acceptance without evidence. Stop for Codex review; do not begin later features.

Planned acceptance test cases
Use synthetic fixtures and record each case ID, actual result and evidence in the task submission. Mark unexecuted cases NOT RUN with a reason. PG means real PostgreSQL in an isolated test database.
ID | Level | Setup | Steps | Expected result
T21-TC-01 | Manual gate | A proposed release, reviewed T20 evidence, a destination and selected source batch identifiers. | Verify explicit authorization, accepted dependencies, recovery-key access, independent successful restoration and the pre-cutover backup before enabling writes. | Any missing gate stops live transfer. Record the approved release/backup identity and responsible people; unavailable live activity remains NOT RUN.
T21-TC-02 | PG + dry run | Synthetic source rows covering the five near-term, next-30-day, other active and closed-file-index groups. | Preview each transformation in the approved order, resolve missing/ambiguous rows manually and replay an accepted batch. | Records keep stable source references. Every transformation is reviewable, unresolved data is not guessed and replay creates no duplicates or overwrites.
T21-TC-03 | Manual reconciliation | Approved source sheets/paper, imported source keys, and related synthetic proceedings and documents. | Compare every upcoming date within 30 days against paper and reconcile row counts, links and source keys. | All dates have recorded checks and any discrepancy stays open for review. Counts, ownership and references reconcile before schedule adoption.
T21-TC-04 | PG + approval | Accepted T15c opening-balance behavior, one proposed cutover date and verified owner/lawyer approvals. | Dry-run separated opening fee, expense and advance amounts. Attempt a historical overlap and repeat the same entry. | The opening positions agree with source evidence, create no current cash collection, post at most once and reject a position already reconstructed from historical postings.
T21-TC-05 | Manual rehearsal | An approved cutover runbook, a synthetic error halfway through, and a copy of the upcoming schedule. | Stop writes at a known point, preserve a snapshot, export dates and latest transactions and rehearse paper fallback and later reconciliation. | Records stay recoverable. Subsequent paper activity is reconciled once. The database is not reset and independent histories are not merged.
T21-TC-06 | Manual handover | One-page Arabic daily-use/outage guide, printed schedule and named office roles. | Have the lawyer locate the current schedule and explain daily reviews, incident contact, and who updates and verifies backups. | The guide and schedule identify current timing and responsibilities; issue list, reconciliation evidence, and explicit approvals are stored before marking handover complete.
```
