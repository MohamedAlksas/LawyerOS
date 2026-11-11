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
| T03 | [T03](../docs/tasks/T03.md) | T02 | `agency-identity-access-engineer` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-identity-access-engineer skill/profile. Read .agents/skills/engineering-identity-access-engineer/SKILL.md and verify its YAML name is agency-identity-access-engineer.
- Supporting specialist: use the agency-application-security-engineer skill/profile for its scoped pass. Read .agents/skills/security-appsec-engineer/SKILL.md and verify its YAML name is agency-application-security-engineer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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

Before editing, inspect docs/reviews/T02-review.md and its referenced implementation baseline. Continue only if it actually states ACCEPTED for the current predecessor. Missing or conflicting evidence means report the blocker; do not execute T02 yourself.

Read PRODUCT.md, GLOSSARY.md, docs/PRD.md FR-01, docs/ROADMAP.md M1/T03, docs/ARCHITECTURE.md Identity and shared rules, docs/SECURITY_OPERATIONS.md section 3 including key recovery, docs/SCREENS.md S01 and S14, DESIGN.md, docs/DEPENDENCIES.md, and docs/REVIEW_PROTOCOL.md AC-01/AC-02.

Allowed edits: identity configuration and Module, login/verification/session-security routes, their required schema migrations, narrow shared authorization entry points, and relevant tests/documentation. Preserve existing work. Exclude business CRUD, documents, finance, deployment, public registration, and T04's navigation/PWA work.

1. Inspect the accepted scaffold and pinned Better Auth/Prisma adapter documentation. State the exact owned paths and short implementation sequence before editing; do not switch authentication technology independently.
2. Implement controlled first-owner provisioning without embedded/default credentials. Disable its reusable setup path and public sign-up. Add server-derived actor authorization, appropriate cookie/Origin protection, sanitized errors, and rate limits.
3. Implement password login, TOTP enrollment/verification, single-use recovery, logout, server-side session/device revocation, and S14's security section. Enforce reauthentication for MFA/recovery changes and the specified inactivity/maximum lifetime policy.
4. Keep recovery secrets outside logs and browser storage. Use synthetic identities and an isolated test database. Test schema installation and upgrade from T02 without resetting an existing database.
5. Prove login/logout, TOTP and recovery use, replay rejection, expiry, and revocation from a second browser context. Prove direct unauthenticated/maintenance-role requests cannot access protected content or mutations, sign-up stays closed, and invalid requests disclose no account existence or secrets. Future business endpoints are future checks, not fabricated successes.

Run the repository's actual relevant lint, typecheck, auth integration/E2E, and build commands. Save docs/reviews/T03-submission.md with baseline, changed paths, exact commands and exit statuses, observed results, migration/recovery notes, screenshots, and limitations. Mark unavailable checks NOT RUN with reasons. Never self-approve, invent successful tests, or start T04; stop for Codex review.
```


---

# T04 — Arabic navigation shell and installable PWA

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-frontend-developer skill/profile. Read .agents/skills/engineering-frontend-developer/SKILL.md and verify its YAML name is agency-frontend-developer.
- Supporting specialist: use the agency-accessibility-auditor skill/profile for its scoped pass. Read .agents/skills/testing-accessibility-auditor/SKILL.md and verify its YAML name is agency-accessibility-auditor.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Private upload/finalization/scanning and authorized preview; inspect fail-closed validation and real negative cases.
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

Allowed edits: src/modules/documents/, scoped S10 routes/forms and shared UI where necessary, document/upload metadata schema and reviewed migrations, private file-storage configuration, local scanner Compose configuration and worker scan handler, affected authorization/tests, and docs/reviews/T11-submission.md. No OCR, AI, public storage, image-editing suite, version-history feature beyond schema needed for the first immutable version, or production deployment.

1. Implement beginUpload/finalizeUpload/authorizeDownload behind authenticated server Module Interfaces. Generate object keys server-side; keep bytes outside public. Link metadata to an existing matter or party and reject cross-matter proceeding/hearing references.
2. Accept only PDF/JPEG/PNG with the proposed 25 MB per-file limit. Validate content signatures, discovered MIME, size, names/paths, and checksum. Quarantine uploads; run local private ClamAV with updated definitions. Timeout, failure, inconclusive scan, or definitions older than the proposed 72-hour limit must never produce READY. Allow explicit retry without pretending publication succeeded.
3. Finalize only after bytes and scan evidence exist. A failed database transaction leaves no ready document reference. Preserve safe cleanup/reconciliation data for unfinished attempts; obey DATA_LIFECYCLE and never delete pinned versions.
4. Build the Arabic S10 basic upload/preview states: uploading, scanning, ready, rejected, incomplete, disconnected. Multiple images are separate documents in V1; no implied PDF merging. Authorize every preview/download, use safe content headers/isolation, and prevent confidential caching.
5. Exercise AC-10 and the first-version portion of AC-11: valid PDF/photo, oversized file, disguised MIME, traversal attempt, interrupted upload, scanner failure/timeout/staleness, database-finalize failure, duplicate retry, unauthenticated URL, and MAINTAINER download rejection. Use synthetic files and a standard safe scanner test; no real client uploads or external scanning sites.

Record actual commands/exit statuses and rendered 390/768/1440 evidence; unavailable checks are NOT RUN. Submit docs/reviews/T11-submission.md with loaded skills, storage/scanner behavior and remaining limits. Stop; T12 owns version history and later document-link integration.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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

1. Implement addVersion using T11's validated scan path. Each version has a unique object key, version number, checksum, and immutable bytes. Switch currentVersionId only after READY; rejected or failed versions cannot replace the previous current version.
2. Display authorized history and retrieve older versions through the same permission checks. Persist the original's paper location and YES/NO/UNKNOWN presence independently of the digital file. Do not equate a scan with possession of an original.
3. Complete previously deferred optional document references for powers of attorney, hearing decisions/results, and legal deadline sources using the existing modules. Enforce ownership/same-matter constraints; general party-owned POA documents must match the principal. Attaching a source does not automatically confirm a legal deadline or validate a power of attorney. Add authorized title/type/date metadata results to the existing S12 global search; do not search PDF image contents, expose storage keys, or return documents the actor cannot download.
4. Implement only the pin records/checks needed to protect document versions during later backups. Cleanup respects current/old approved versions, active uploads, referenced records, and backup pins. T19 still owns coordinated backup execution; do not claim restore success here.
5. Verify AC-11: new version success/failure, old-version retrieval, currentVersion unchanged on scan/DB failure, conflicting version writes, wrong-party/wrong-matter link rejection, missing-original state, and cleanup refusing a pinned version while expiring eligible temporary files.

Use real PostgreSQL and private synthetic files. Record commands/exit statuses, migrations/upgrades, and actual UI observations where controls changed; mark unavailable checks NOT RUN. Submit docs/reviews/T12-submission.md with loaded skills and explicit T19 integration limits. Stop for review; no T13 finance work.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
```


---

# T14 — Reimbursable expenses, client advances, and office expenses

```text
Agency Agent assignment (required):
- Read docs/AGENCY_AGENTS.md and the task entry in docs/AGENCY_AGENT_ROUTING.json before editing.
- Lead implementer: use the agency-backend-architect skill/profile. Read .agents/skills/engineering-backend-architect/SKILL.md and verify its YAML name is agency-backend-architect.
- Supporting specialist: use the agency-database-optimizer skill/profile for its scoped pass. Read .agents/skills/engineering-database-optimizer/SKILL.md and verify its YAML name is agency-database-optimizer.
- Supporting specialist: use the agency-test-automation-engineer skill/profile for its scoped pass. Read .agents/skills/testing-test-automation-engineer/SKILL.md and verify its YAML name is agency-test-automation-engineer.
- Native execution is required: use invoke_subagent to launch the lead and each assigned support as distinct real sessions using .agents/agents/<profile-name>.md. Read docs/AGENCY_AGENTS.md for the preflight, ownership, snapshot, and evidence contract. Reading profiles or performing same-session role passes does not satisfy this assignment.
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
- Task focus: Separate reimbursable expenses, office costs and advances with locked balance checks and independent expected outcomes.
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

Implement distinct choices for lawyer-funded reimbursable expense, spending a client's advance, and nonrecoverable office expense. Expense reimbursement settles EXPENSE_RECEIVABLE without becoming fee income. Advance receipt increases CLIENT_ADVANCE; spending reduces that liability without creating a second expense receivable. Enforce same-client/matter lineage and sufficient funds with locks within the posting transaction. Mixed funding is two Expense records sharing expenseGroupId, transaction and evidence, with total exactly matching the confirmed amount. No automatic conversion of client funds into fees. Any documented advance-to-fee operation must be explicit, balanced and separately identified. Keep cash, fees, expenses and client money distinct; no editable balances.

Use real PostgreSQL and test-first behavior. Extend the existing example: 15,000 fees, 5,000 collected, lawyer-funded 1,200 => fees due 10,000 and expenses due 1,200; reimbursement => expenses zero, fees unchanged. Advance 2,000 and spending 700 => available advance 1,300 and zero fee income from those actions. Verify office expenses create no client debt, split funding is not double-counted, and evidence authorization holds. Reject cross-client use, overspending under concurrent requests, duplicate posting, mismatched split totals, unauthorized calls, and audit failure. Keep original posted entries immutable.

Inspect Arabic funding explanations/confirmations and four separate summary amounts at 390/768/1440. Run actual lint/typecheck, financial unit/integration/E2E checks and build. Save commands/exit codes, base commit, migrations, expected-versus-actual postings, screenshots and NOT RUN limits to docs/reviews/T14-submission.md. Stop for Codex review; no T15a.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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

1. Prepare pinned versions for app/worker, PostgreSQL, and private ClamAV. Use least-privilege runtime users, persistent private data volumes, restart/health behavior, and bounded resource/job concurrency. Distinguish deployment credentials from synthetic examples; never commit secrets.
2. Document and configure the proposed Tailscale Serve HTTPS private-access path. Do not enable Funnel, expose database/scanner ports, or enable public registration. Treat Caddy/public access as an alternative requiring a documented selected target, not a simultaneous default.
3. Configure sanitized external health/worker-heartbeat/backup-status monitoring contracts and disk threshold handling (75% warning, 85% urgent). Include UTC storage/Cairo scheduling, NTP, update procedure, and safe migration/rollback steps. A prior image does not revert a changed schema.
4. Exercise an isolated synthetic deployment: startup, readiness, lost database, stopped worker, scanner failure, restart, private volume persistence, and direct unauthorized routes. Verify installation/caching behavior on actual HTTPS when an approved test endpoint exists; confidential content must not enter PWA/public caches.
5. Report the selected real deployment target and its explicit authorization if one exists. If none exists, finish all local configuration/checks and mark external HTTPS/mobile-outside-network, provider monitoring, and real-host tests NOT RUN with the exact missing prerequisites. Do not claim production readiness or manufacture a successful deployment.

Submit docs/reviews/T18-submission.md with loaded skills, commands/exit codes, effective port/access configuration, operational observations, and each untested production gate. Stop for Codex review; T19 owns backup/restore, and real-data operation remains gated.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
- Verify that the current session exposes invoke_subagent and discovers the definitions before dependent implementation. If unavailable or invocation fails, report BLOCKED_NATIVE_AGENTS with the observed capability/error and stop dependent implementation. Do not silently fall back, install/upgrade tools, change the model, or invent an agent ID.
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
```
