# Gemini implementation prompt — T04-A and final integration

You are the Gemini/Antigravity coordinator for LawOffice OS T04. Implement the approved Arabic shell/PWA and integrate OpenCode's separately owned tests. The owner authorizes this assignment and parallel execution. Codex owns independent acceptance. Do the work; do not stop at a proposal or claim success from another model's summary.

## 1. Authority, scope and starting point

Before editing, read these files from the ORIGINAL checkout at D:/Lawyer:

- AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, DESIGN.md.
- docs/PRD.md; docs/tasks/T04.md; docs/assignments/T04-parallel-assignment.md.
- docs/design/STITCH-T04-REVIEW.md and docs/design/stitch/10964447413466098333/README.md; inspect the exported screenshots and relevant HTML.
- docs/SCREENS.md, docs/ARCHITECTURE.md, docs/SECURITY_OPERATIONS.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md, docs/AGENCY_AGENTS.md and T04's entry in docs/AGENCY_AGENT_ROUTING.json.
- docs/reviews/T03-review-round18.md for predecessor acceptance. T03 PR #8 was observed merged as ca2819421d78a385841618505c8f8165f0b69b9e, accepting published HEAD 041c50a7413867d46e04beedfbf2e91c89a24ca9. Verify integration against fetched origin/main. This Codex decision supersedes T04's stale pointer to an earlier T03 review.

These paired prompts refine the parallel assignment: Gemini owns application implementation/integration, OpenCode owns new T04 browser tests. Keep all unchanged project requirements. Documents/reports are English; UI is simple Egyptian Arabic RTL. Default visual direction is the owner-selected Stitch project 10964447413466098333 adapted to canonical DESIGN.md. Do not create a second visual direction or reopen settled product facts unless the owner explicitly requests an A/B experiment.

In scope: shared shell/navigation, responsive layout, presentation primitives, genuine empty/loading/error/disconnected/session-expiry feedback, manifest/local icons/local licensed Arabic font, installability evidence and strictly public-asset offline handling. No Party/Matter CRUD, hearing calendar implementation, document/finance workflows, schema changes, SaaS, AI, confidential offline sync, deployment or real data.

Before writing Next.js code, read the relevant installed guides under node_modules/next/dist/docs/ in your worktree. Use the pinned version's actual conventions; do not assume older middleware, metadata, caching or routing APIs. Cite which guides informed changed behavior in the submission.

## 2. Safe workspaces and single-writer ownership

You are not alone in the repository. Preserve all existing changes, worktrees and installed assets. Do not switch/reset/clean/stash the original checkout, delete agent assets, force-push or push main. Inspect status, worktrees, branch, origin and fetched main first; origin must be https://github.com/MohamedAlksas/LawyerOS.git.

You alone coordinate creating/reusing:

- Gemini: D:/Lawyer/work/t04-gemini, branch feature/t04-arabic-pwa-shell.
- OpenCode: D:/Lawyer/work/t04-opencode, branch feature/t04-browser-verification.

Both start at the same verified origin/main SHA. Existing paths/branches must be inspected, not overwritten. Copy only the exact new planning inputs/reference exports and predecessor acceptance report from the original checkout into your worktree; inspect their content and preserve attribution. Untracked inputs do not automatically appear in new worktrees. Include these inputs in a documentation-only handoff commit. Do not copy environment secrets, another working tree's edits, node_modules or .next. Install from the pinned lockfile within each worktree without changing dependencies.

Owned application paths: T04 changes in src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, presentation-only components under src/components/, necessary T04 loading/error/offline boundaries, manifest/icons/font assets and optional public-only service-worker registration/implementation. Preserve secure server entry points and T03 behavior. Auth page presentation may change only for required consistency; no auth semantics changes or broad route restructuring. Own docs/assignments/T04-interface-contract.md, docs/reviews/T04-submission.md and relevant design handoff/evidence. Record exact additional presentation paths before editing.

OpenCode exclusively owns new tests/e2e/t04-*.spec.ts, tests/helpers/t04-*, optional playwright.t04.config.ts and docs/reviews/T04-test-submission.md. Do not edit those tests to make your implementation pass. Existing identity/auth source, T03 tests, schema/migrations, package files, shared Playwright config and CI are outside both slices unless Codex issues a bounded extension. Return a concrete scope issue if necessary; do not silently broaden ownership.

## 3. Skills and native agents — when to use them

All relative paths resolve from the chosen worktree. Read each assigned SKILL.md in full and record its actual path/hash. Required project skills throughout:

- .agents/skills/lawoffice-delivery/SKILL.md: startup, preservation, ownership, evidence and final submission.
- .agents/skills/lawoffice-arabic-ui/SKILL.md: design contract, every UI implementation/revision and rendered verification.
- .agents/skills/lawoffice-testing/SKILL.md: acceptance matrix, test design, regression execution and evidence.
- .agents/skills/lawoffice-security-operations/SKILL.md: scoped consultation when designing and verifying confidential browser caching, authentication boundaries and session-expiry behavior; this does not authorize auth rewrites.

Native implementation lead: agency-frontend-developer; skill .agents/skills/engineering-frontend-developer/SKILL.md; definition .agents/agents/agency-frontend-developer.md. Invoke before dependent UI implementation and assign the owned application paths and exact base SHA.

Native independent supports, invoked after a frozen runnable checkpoint:

- agency-accessibility-auditor: .agents/skills/testing-accessibility-auditor/SKILL.md and .agents/agents/agency-accessibility-auditor.md. Read-only rendered RTL, responsive, contrast, keyboard/focus and semantic review.
- agency-test-automation-engineer: .agents/skills/testing-test-automation-engineer/SKILL.md and .agents/agents/agency-test-automation-engineer.md. Read-only review of coverage, negative cases, fixture isolation and final combined results. Must be distinct from OpenCode's test author.

Follow native preflight/registered aliases in docs/AGENCY_AGENTS.md. Reading a role is not invocation. Record actual tool/type/ID, definition/profile hashes, owned paths, inspected SHA, returned report and reconciliation. Max three active children, no nested delegation. If required native execution is unavailable after the documented bounded preflight, report BLOCKED_NATIVE_AGENTS before dependent implementation; never invent IDs or same-session independence.

Use Impeccable as a workflow skill, not a substitute for native specialists. Source: C:/Users/Alksas/.agents/skills/impeccable/SKILL.md. Read it and the relevant references from that directory. Run its context launcher once per relevant execution session, with cwd in the isolated worktree and an actual target. Follow the documented unavailable-launcher fallback if needed. Do not install/upgrade tools or silently change model/settings to bypass a failure.

Impeccable timing:

1. Before UI implementation: apply shape/new-work guidance to document the settled brief and interface contract. Mode is Operate. The brief and canonical design are already supplied; this assignment authorizes proceeding without a ceremonial confirmation or repeated discovery interview. Ask only about an actual unresolved decision affecting scope.
2. Immediately before every UI editing phase: read reference/craft-floor.md. Preserve incumbent product/security truth and approved identity.
3. At the first runnable visual checkpoint: critique is a read-only design review; record concrete findings. Use adapt for responsive problems, clarify for confusing Arabic copy, and harden for missing failure/edge states as needed. The frontend lead owns fixes.
4. At the combined candidate: audit is a read-only technical UI report; reconcile it with native specialist findings. Use polish for the bounded final visual fixes. Do not treat a score as proof, run all commands ceremonially, activate hooks globally, overwrite PRODUCT/DESIGN automatically or run unrelated bolder/animate/overdrive changes.

If Impeccable is unreadable, disclose it and perform the documented/manual equivalent with actual evidence. Do not claim it ran. A workflow helper failure does not justify fake success or skipping required acceptance checks.

## 4. Shared contract and parallel handoffs

Commit docs/assignments/T04-interface-contract.md before dependent implementation. Include routes actually available, navigation roles/names/current state, tablet/mobile behavior, real UI-state triggers, manifest/offline URL, enumerated public assets, fixture/session approach, endpoint boundaries, server ports/config and acceptance IDs below. Use semantics before adding test IDs. Loading/offline tests may use controlled network conditions, but private authorization claims require real endpoints.

Publish OPENCODE_HANDOFF with both paths/branches, common main SHA, planning/interface documentation-only commit SHA/list, routes/labels and any concrete dependency. OpenCode can prepare a test matrix in parallel; browser behavior is only verified after a runnable implementation exists. Relay via the owner; do not assume cross-tool messaging.

After implementation, publish FRONTEND_CHECKPOINT with immutable SHA and exact frontend commit list. OpenCode imports it into its own worktree and returns TEST_FINDINGS with reproduction, expected/actual, evidence and tested SHA. Fix frontend issues in your paths, publish new SHAs and have affected tests rerun. Import only its explicitly identified test commits, not frontend commits already in your history. Resolve conflicts by file ownership; do not overwrite work. Keep one canonical draft T04 PR to main; the supporting test branch does not merge independently to main.

Use separate validated synthetic databases and separate build outputs/worktrees. Gemini uses browser port 3100. OpenCode's optional config uses a dedicated port such as 3204 with matching baseURL/server URL/BETTER_AUTH_URL. Do not run concurrent suites against the same fixture database. Record task-owned process IDs and stop only those processes/verified children; never stop all Node processes. No real client data, credentials or private content in Git/logs/screenshots.

## 5. Mandatory acceptance matrix

Track each ID with implementation paths, test/evidence, inspected SHA, outcome and unresolved findings:

- T04-01: Desktop right navigation, tablet drawer and mobile navigation support available routes, current selection and meaningful labels. Unimplemented modules have no fake working links/screens or totals.
- T04-02: lang=ar-EG, dir=rtl; mixed codes/email/phones isolated with bdi/LTR; local licensed Arabic font loaded; Cairo display for actual timestamps; date-only data preserved; long Arabic content readable.
- T04-03: Actual rendered 390/768/1440 layouts, 200% text scaling/reflow, visible focus, no hidden essential content or unintended page-wide horizontal overflow. Relevant touch targets are at least 44x44; sticky controls do not cover focused fields/actions.
- T04-04: Keyboard access, tab order, drawer/dialog focus containment where applicable, Escape and focus restoration, semantic landmarks/headings, labels and announced errors; measured WCAG AA contrast and reduced-motion behavior. Do not claim full screen-reader certification without actual testing.
- T04-05: Real loading versus empty states, recoverable error/retry, disconnection/reconnection and session expiry. Never show confirmed save/success before server confirmation. Test existing actions only; no fake business-saving workflows.
- T04-06: Valid manifest, actual reachable appropriate icons, coherent scope/start URL/display/identity, local-browser installation capability observed with platform limits recorded. No claim that HTTPS/private-device T18 installation was verified here.
- T04-07: No private content/auth/API responses/tokens/credentials/unsent sensitive input in localStorage, sessionStorage, IndexedDB or service-worker CacheStorage. Provider-managed cookies remain governed by accepted T03 behavior. Unsent input may stay only in page memory. If a worker exists, explicit public allowlist; test after browsing private pages, expiry/logout, reload, offline and reconnect. A successful offline page must not contain leaked prior private data.
- T04-08: Remove mockup account autofill, invented identity/version/security claims, confidential local-save/sync promises and implied automatic legal deadlines. Keep Matter distinct from Proceeding. Stitch HTML/CDN scripts/demo records are not production code/data.
- T04-09: Existing authentication, MFA/recovery, Origin/Host enforcement, session invalidation, authorization and migration/startup regressions remain passing without weakened assertions or altered security limits.
- T04-10: Exact-head integrated tests, actual independent returned support reviews, accurate evidence, coherent PR and no unresolved in-scope defect.

## 6. Verification and correction loop

After integrating all code/tests and visual fixes, freeze a committed checkpoint. Run npm.cmd run lint; npm.cmd run typecheck; npm.cmd test; npm.cmd run build BEFORE npm.cmd run test:integration; npm.cmd run test:e2e; and the new tests through playwright.t04.config.ts if outside the default configuration. All intended T04 tests must execute; skipped tests/retry-only passes require investigation and honest disclosure. Verify names/counts from actual output, never copy prior counts as fresh evidence.

Run appropriate planning validators under available PowerShell 7, including Validate-AntigravityKit.ps1 and Validate-AgencyAgentRouting.ps1 -VerifyInstalled. If canonical planning documents changed, run Build-TaskPromptIndex.ps1 and Build-PlanningKit.ps1, inspect derived diffs, and preserve this explicit slice assignment. Run git diff --check. Do not delete owner assets to repair validator scoping.

Inspect rendered results at required sizes/states; retain sanitized screenshots and test traces. Obtain actual native support results at the checkpoint; reconcile every finding. For a new failure, investigate the cause, implement the smallest owned-path fix and rerun affected checks. Application/config/test changes after the final battery require refreshed relevant evidence and a coherent final combined verification; documentation-only attestation records both SHAs and proves its intervening diff is documentation-only.

Completion requires all T04 acceptance IDs satisfied, required checks passing, support results received/reconciled, and no unresolved in-scope issue. Fix P0/P1/P2 issues and cheap P3 issues within scope. A remaining material issue or required check unavailable means BLOCKED/INCOMPLETE with exact reason and next action, never DONE. Future T18/physical-device/screen-reader limitations are explicitly scoped, not invented passes. Do not promise mathematically zero bugs or hide out-of-scope discoveries; record those separately and disclose any actual safety impact on T04.

## 7. Final submission

Save docs/reviews/T04-submission.md with exact branch/base/implementation/local/pushed HEAD/upstream/PR, owned diff, requirements matrix, loaded skill/profile paths/hashes, actual native invocation and returned reports, commands/exit codes/test counts, rendered/privacy/installability observations, findings-to-fix-to-retest table, screenshots/log paths, real NOT RUN limits and rollback notes. Do not expose secrets.

Push coherent commits to the existing canonical task branch, verify remote SHA and hosted CI/planning results for the final published checkpoint. If CI fails, inspect the real logs, fix the cause within scope, rerun and update the same PR. No weakening tests or masking failures with retries. Do not declare completion while CI/tests/audits are running or based solely on local green checks.

Final status only after gates are met: READY_FOR_CODEX_REVIEW. Report outstanding matters honestly. Do not self-accept, merge, deploy, start T05 or modify the supporting checkout. The owner and Codex handle acceptance/merge separately.
