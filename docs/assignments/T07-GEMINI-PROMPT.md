# LawOffice OS T07 — Search, filters, pagination and safe archiving

You are the Gemini coordinator in Antigravity. Implement T07, verify it against the real application, and submit it for independent Codex review. Use the owner-selected model and pass it to native children as specified by the project. Write implementation notes and the handoff in English. Keep the product UI in Egyptian Arabic RTL.

## Starting point

- Use the worktree `D:/Lawyer/work/t07-gemini` and branch `feature/t07-search-archiving`.
- The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`.
- PR #14 integrated T06 on `origin/main` at `317a6530e5f695338398b029b34f5305e72b1bd4`.
- Local documentation checkpoint `b903430` adds `docs/reviews/T06-review.md` with the `ACCEPTED` decision. Preserve this checkpoint and the review. Final T06 PR head `be34ab5ab536c890f8729e457f914c4d023627a1` and the integrated revision have identical trees.
- Before editing, run `git status --short --branch`, `git worktree list`, `git remote get-url origin`, and `git fetch --no-tags origin`. Verify the actual branch, main SHA and accepted predecessor. If main or the feature branch has moved, inspect and reconcile through `docs/GIT_WORKFLOW.md` while preserving other work. Keep the existing T07 branch and worktree. Use synthetic data on task-owned processes, ports and databases.

## Read before editing

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/tasks/T07.md`, `docs/reviews/T06-review.md`, `docs/GIT_WORKFLOW.md`, `docs/REVIEW_PROTOCOL.md`, and `docs/AGENCY_AGENTS.md`. Read the T07 entry in `docs/ROADMAP.md` and `docs/AGENCY_AGENT_ROUTING.json`. For behavior read PRD `FR-07`, `FR-12` and `NFR-01–05/07`, `docs/DATA_MODEL.md` sections 2–3 and 8, `docs/WORKFLOWS.md` section 11, `docs/SCREENS.md` S03/S04/S12, `docs/ARCHITECTURE.md` sections 3–4 and 6, and `DESIGN.md`. Read the installed Next.js guide in `node_modules/next/dist/docs/` for the routes, Server Actions and navigation APIs you change.

Load these project skills from the current worktree. Record the actual file paths and where they were applied.

| Skill | When to use it |
| --- | --- |
| `.agents/skills/lawoffice-delivery/SKILL.md` | Preflight, phase ownership, checkpoints, Git publication and evidence. |
| `.agents/skills/lawoffice-domain/SKILL.md` | Search normalization, correct Matter/Proceeding distinctions, archive/reopen state, transactions and invariants. |
| `.agents/skills/lawoffice-arabic-ui/SKILL.md` | Search and archive screens, RTL, accessible errors, responsive layout and existing design patterns. |
| `.agents/skills/lawoffice-testing/SKILL.md` | Test design, real PostgreSQL, browser journeys, regression and evidence. |

### Ponytail

Read the entire installed Gemini skill `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail/SKILL.md` before implementation. Use `/ponytail full` where the runtime exposes the command and apply its instructions through the design, implementation and remediation passes. Reuse the existing normalization functions, Module Interfaces, authorization, projections and UI components. Trace callers before changing shared behavior. Deliver the smallest complete diff with its tests. Preserve validation, security, accessibility and all T07 acceptance checks.

Read `C:/Users/Alksas/.gemini/config/plugins/ponytail/skills/ponytail-review/SKILL.md` before the final review pass. Use `/ponytail-review` where available, otherwise apply the file's review procedure and record how it was loaded. The review pass is read-only. Route fixes back to the appropriate writer. Record the actual skill paths and activation method. If the files cannot be read, report the exact missing capability before claiming the requested skill was applied.

## Agency execution and ownership

Use the registered project profiles below. Read each full profile source and its native definition, verify the YAML name and record the actual profile SHA-256, definition path, native type and conversation ID. Follow the documented canonical-name or native-alias preflight with `invoke_subagent`. Complete the required read-only preflight for each distinct child before dependent edits. If the bounded preflight cannot run real children, report `BLOCKED_NATIVE_AGENTS` with observable evidence. The coordinator owns integration and publication. Each phase has one writer per path.

| Phase and native role | Ownership and evidence |
| --- | --- |
| `agency-backend-architect`. Profile `.agents/skills/engineering-backend-architect/SKILL.md`. Definition `.agents/agents/agency-backend-architect.md`. | Lead for existing Party and Matter module queries and actions, validators, DTOs, schema/migration and focused unit/PostgreSQL tests. Read the shared invariants and callers. Commit a checkpoint with the actual routes/action contracts, DTO fields, filters, page parameters and archive errors for the frontend phase. Inspect the later UI integration against the contract. |
| `agency-frontend-developer`. Profile `.agents/skills/engineering-frontend-developer/SKILL.md`. Definition `.agents/agents/agency-frontend-developer.md`. | Bounded frontend write phase after the backend contract checkpoint. Own `/search`, affected protected routes, relevant Matter/Proceeding screens, filter and pagination components, navigation links and their browser regressions. Review the backend contract from the consumer side. Coordinate mismatches with the lead. |
| `agency-test-automation-engineer`. Profile `.agents/skills/testing-test-automation-engineer/SKILL.md`. Definition `.agents/agents/agency-test-automation-engineer.md`. | Design the requirement-to-test matrix and independently inspect the frozen combined checkpoint. Review synthetic isolation, assertions, exact claim/audit evidence, runner discovery, recorded performance and failure coverage. Keep review read-only. Use an isolated worktree when a build, port or database could interfere with another process. |

Pass the actual task scope, required skills, assigned ownership, checkpoint SHA and verification cases to each child. Reconcile the findings and rerun affected reviews and tests on the corrected checkpoint. The frontend and backend authors can review each other's boundaries. The test specialist independently reviews the combined delivery. The coordinator's self-review supplements independent Codex acceptance.

## Implementation scope

### Search and navigation

1. Reuse and extend the existing Party and Matter search code and `src/lib/normalization.ts`. Provide unified authorized search for Party, Matter and Proceeding using the relevant S03/S04/S12 paths. Support party name, matter title/internal file code, and proceeding number/year/court, with result-type filters and bounded queries. Inspect the existing search and similarity callers before changing behavior.
2. Normalize documented Arabic variants and Arabic-Indic/Western digits in derived values. Preserve original spelling, number strings, leading zeros, letters, separators and the court year label for display and persistence. A matching search does not merge similar parties or conflate file codes with court case numbers. Keep Matter, Proceeding, party role and proceeding capacity distinct.
3. Validate filter values, identifiers and page bounds at the server boundary. Apply authorization and filters before row/count selection. Use a deterministic order with a unique tie-breaker. Do not fetch the full matching set into application memory to filter or page it. Use minimal DTOs and keep existing T05/T06 callers compatible.
4. Preserve the query, chosen scope, filters and page when opening a result and returning. Keep history behavior and accessible loading, empty, invalid-filter and retry/error states coherent. Handle out-of-range pages after data changes without hiding valid earlier results. Keep private values out of browser storage, analytics, logs, generated snapshots and public caches. Use canonical protected detail links.
5. Apply the S03 filters backed by current data and the agreed S12 result types. Future hearing-date filters and document metadata search belong to their assigned tasks. Keep the existing T06 draft and frozen-retry handling working.

### Archive and reopen

1. Give Matter and Proceeding explicit, authorized archive and reopen paths. Follow the model and workflow for valid transitions, required reason, audit and optimistic version checks. Keep closing and archiving separate. An archived record keeps its identifiers, party and parent links and history, leaves ordinary active lists and stays accessible through authorized archived-inclusive search and detail.
2. Guard ordinary writes through the Module Interfaces, including child or relationship mutations beneath an archived Matter and mutations to archived Proceeding records. Test these entry points directly. UI buttons and URL visibility are additional controls. Audit and lifecycle writes commit together with the existing retry claim. Reject stale versions, mismatched parent/child IDs and same-key changed intent. Preserve existing Matter activation and proceeding hierarchy rules when reopening.
3. Inspect the real schema and enforce every critical-obligation guard that can operate on current records. Document the exact command/transaction point that T08/T09 must extend for a `SCHEDULED` hearing or an open `CONFIRMED` deadline. Keep unsupported scheduling, finance, documents, export implementation and later tasks outside this slice. Do not create placeholder tables, no-op guards, fabricated fixtures for absent models or fake passing tests.
4. Use forward Prisma migrations when persistence or indexing changes. Preserve legacy rows and identifiers, verify fresh install and upgrade, and record the reason for each index. Keep historical migrations and pinned dependencies intact. All data transitions must keep audit and idempotency records consistent on failure, replay and competing writes.

## Verification matrix

Use the real modules, PostgreSQL and browser with synthetic fixtures. Record each scenario, its test file, observed result and relevant evidence.

| Area | Cases required |
| --- | --- |
| Normalization | Equivalent Arabic-Indic and Western-digit queries locate the same proceeding. Cover documented name variants, leading zeros, nonnumeric docket parts, distinct similar parties, a matter without a docket, exact file-code matching and preservation of originals. |
| Search results | Cover combined filters, active/default versus archived-inclusive results, empty results, malformed and bounded input, stable page boundaries with tied sort values, no duplicate or missing records across pages on a stable dataset, and a return from an authorized detail page. Check scoped totals and recovery after the last displayed page shrinks. |
| Permissions and privacy | Protected pages and real read/write entry points respect signed-out, unfinished MFA, expired/revoked sessions and role permissions wherever applicable. Use otherwise valid requests. Compare safe response fields and scoped row, audit and claim state before and after denials. Cover direct ordinary-write attempts on archived records and children of archived Matters. |
| Lifecycle | Archive and reopen both entity types. Verify default exclusion, authorized read-only details and existing links, required reason, authorized reopen, stale-version and invalid-state rejection, and preservation of IDs, original values and relationship history. Check active invariants after reopening. |
| Atomicity and retries | Inject a material failure inside the lifecycle transaction and check record version/status, audit and claim rows after rollback. Follow with a valid retry and confirm one committed change. Check same-key replay, same-key changed input and a competing transition using the existing test patterns. |
| Migration and load | Run Prisma generation and migration deploy on a fresh isolated database. When schema/backfill changes, verify upgrade from the integrated T06 revision and demonstrate original values/relations retained. Measure representative authorized search queries with roughly 2,000 synthetic Matters per PRD and stated related record counts. Record environment, cold/warm setup, sample size and measured P95. Compare with the under-two-second target. Investigate a miss and report actual evidence. |
| Browser and accessibility | Exercise actual search, filters, paging, result navigation, archive/reopen, cancellation, safe failure and retry. Run at 390, 768 and 1440 pixels, check keyboard/focus, announced feedback, labels, long mixed RTL/LTR text and 200% text scaling, and capture synthetic screenshots. Report any relevant manual assistive-tech or device checks that remain unrun. |

## Final review and publication

1. Before submitting, run a read-only Ponytail review on the entire branch diff against its current base. Read the connected code and grep callers of changed APIs. Trace route → action → session/permission → validation → query/transaction → DTO → browser. Review correctness, security, data integrity, race and retry behavior, pagination edge cases, performance at the agreed scale, missing regressions and avoidable complexity. For each finding record severity, file/line, concrete trigger and impact, suggested fix, disposition and verifying test. Include the native support findings. The coordinator performs this pass even if every test has passed.
2. Reconcile verified findings with the owning writer. Freeze a new checkpoint after fixes, review the updated diff for regressions, and rerun affected checks. Repeat until required evidence exists, all required checks pass and no unresolved actionable in-scope defects remain. Keep the delivery in progress when a check fails. For a concrete external blocker, report the affected behavior, attempted recovery and exact missing evidence. Never use `READY_FOR_CODEX_REVIEW` to mean that an unrun required check passed.
3. On the final candidate run `git diff --check`, pinned lockfile install if needed, Prisma generation/migration verification, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:integration` and `npm.cmd run test:e2e` on Windows. Ensure new T07 browser tests are discovered by the repo's normal command and CI, and that the existing T03–T06 suites still run. Use task-owned test ports and test databases. Record the actual command, exit code, test counts, retries/skips and evidence path. Avoid rebuilding the same `.next` directory while a browser suite against that build is running. Diagnose any CI failure and rerun the final candidate after fixes.
4. Follow `docs/GIT_WORKFLOW.md`. Commit coherent changes on `feature/t07-search-archiving` and push that branch to the canonical origin. Open or update one draft PR to `main`. Verify the remote head SHA matches the reviewed implementation and record the hosted checks for that SHA. Keep owner-installed assets and unrelated work intact. Use task-owned resources and synthetic data.
5. Write `docs/reviews/T07-submission.md` using `docs/REVIEW_PROTOCOL.md`. Include the verified predecessor/base, branch/upstream, inspected and pushed SHA, PR URL, exact skills and native child evidence, file ownership, requirement-to-test matrix, migration/upgrade and recovery notes, performance data, screenshots, review findings and dispositions, and honest limitations. A later evidence-only commit should record the implementation SHA it covers. Report `READY_FOR_CODEX_REVIEW` only when the final criteria above are met. Stop at T07 for Codex review. Leave T08 and any merge into `main` to the separate approval step.
