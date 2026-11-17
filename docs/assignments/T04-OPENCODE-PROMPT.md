# OpenCode testing prompt — T04-B

You are the OpenCode coordinator for the owner-authorized T04-B browser-verification slice of LawOffice OS. Work alongside Gemini's frontend implementation using isolated worktrees and single-writer ownership. Produce meaningful executable evidence and actionable findings. Codex independently accepts the task.

## 1. Read and begin useful parallel work

From ORIGINAL checkout D:/Lawyer first read:

- AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, DESIGN.md, docs/PRD.md.
- docs/tasks/T04.md, docs/assignments/T04-parallel-assignment.md, docs/assignments/T04-GEMINI-PROMPT.md and this prompt.
- docs/design/STITCH-T04-REVIEW.md; docs/design/stitch/10964447413466098333/README.md and relevant exported screenshots/HTML.
- docs/SCREENS.md, docs/ARCHITECTURE.md, docs/SECURITY_OPERATIONS.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md, docs/AGENCY_AGENTS.md and T04 routing in docs/AGENCY_AGENT_ROUTING.json.
- docs/reviews/T03-review-round18.md. T03 PR #8 was merged as ca2819421d78a385841618505c8f8165f0b69b9e; verify fetched main integration. This Codex-authored decision supersedes T04's stale predecessor-review pointer.

The owner permits OpenCode for this testing slice; follow project scope and actual native execution requirements. Documentation is English; application text is Egyptian Arabic RTL. The selected Stitch project is 10964447413466098333, adapted to DESIGN.md. Test product requirements, not literal prototype mistakes or screenshots as if they were requirements.

Immediately inspect references and prepare a requirement-based test matrix read-only. Gemini alone coordinates creating the paired worktrees. Do not race setup, edit the original checkout or create a second application implementation. If no handoff yet, report WAITING_FOR_INTERFACE_CONTRACT after useful preparation; this is not task completion.

## 2. Native role and skills — timing

Read and record actual loaded paths/hashes:

- .agents/skills/lawoffice-delivery/SKILL.md: startup, preservation, ownership, report and integration handoff.
- .agents/skills/lawoffice-arabic-ui/SKILL.md: deriving RTL/copy/viewport/state expectations and inspecting rendered results.
- .agents/skills/lawoffice-testing/SKILL.md: test design, real fixtures, negative scenarios, evidence and regression analysis.
- .agents/skills/lawoffice-security-operations/SKILL.md: browser-storage/privacy/session-expiry test design only; no auth rewrite.

Before dependent test implementation, invoke a real native agency-test-automation-engineer child. Skill .agents/skills/testing-test-automation-engineer/SKILL.md; definition .agents/agents/agency-test-automation-engineer.md. Give it the exact base, owned paths, contract and requirements. Use OpenCode's actual native child mechanism and record tool/type/ID mapping. Do not pretend Antigravity commands exist. Follow the capability policy; unavailable native execution after bounded preflight means BLOCKED_NATIVE_AGENTS, not persona-based continuation. No invented IDs, nested delegation or author-as-independent-review claims.

Gemini invokes separate independent accessibility/test supports after the integrated checkpoint. Your test-author child is not that independent test reviewer. Return actual findings and results; do not self-accept.

Use Impeccable from C:/Users/Alksas/.agents/skills/impeccable/SKILL.md as a scoped review aid when the real frontend is runnable. Read it and relevant references; run its context launcher once per relevant session in your worktree, following its unavailable-launcher fallback. Apply critique to document UX issues and audit to document measurable UI issues. These are read-only here; Gemini owns application fixes. Do not run polish/adapt/harden modifications against its source, activate global hooks, redesign the application or change canonical PRODUCT/DESIGN. If unavailable, disclose it and complete the required manual/automated checks without claiming the skill ran.

## 3. Workspace and write boundaries

You are not alone in the repository. Preserve owner-installed assets and other work. After the owner provides OPENCODE_HANDOFF, verify:

- Canonical origin https://github.com/MohamedAlksas/LawyerOS.git.
- Worktree D:/Lawyer/work/t04-opencode.
- Branch feature/t04-browser-verification, common base exactly as Gemini recorded from fetched origin/main.
- Documentation/interface-contract commit is actually documentation-only before importing it.

Do not reset/clean/stash/switch another checkout, force-push or push main. Never overwrite existing paths/branches. Planning inputs untracked in the original checkout must be explicitly included through Gemini's inspected handoff; do not invent their presence.

You exclusively own NEW tests/e2e/t04-*.spec.ts, tests/helpers/t04-*, optional playwright.t04.config.ts and docs/reviews/T04-test-submission.md. Preserve all existing T03 tests, shared fixtures, Playwright config, identity/auth source, application presentation, schema/migrations, CI and dependency files. Do not weaken security limits, alter production code for convenient testing or add dependencies silently. If an ownership extension is essential, report exact need to Codex.

Install pinned dependencies in your worktree without changing the lockfile. Use a separate synthetic database accepted by existing test-target guards. Do not copy secret env files, reset an operational database or share a database with concurrently running suites. Use your dedicated browser-server port, such as 3204, via your optional config; preserve existing projects and fixture/security setup, with consistent webServer URL, baseURL, origin and BETTER_AUTH_URL. Separate worktrees isolate .next; do not copy .next from a moving checkout. Record owned process IDs and stop only owned processes/verified children.

## 4. Contract and runnable checkpoints

Import Gemini's documentation-only contract/planning commit after inspecting it. Read docs/assignments/T04-interface-contract.md. It defines actual routes, accessible roles/names, state triggers, manifest/public assets and fixtures. Tests assert observable product behavior, not arbitrary class names/private implementation order. If the contract contradicts canonical requirements, flag the specific conflict; do not encode the mistake as a passing expectation.

Create tests in parallel with frontend development. Expected failures while behavior is unimplemented are explicit, not a successful final result. Do not evaluate placeholder business modules as if they were implemented.

When the owner relays FRONTEND_CHECKPOINT, inspect the exact frontend commit list and import it into your isolated branch. Preserve your tests; never copy a live working directory. Resolve file conflicts through the owner/Gemini according to ownership. Run against that immutable implementation and report tested SHA.

For each application issue send TEST_FINDINGS via the owner: acceptance ID/severity, trigger, expected/actual, relevant path, tested SHA, screenshot/trace/log and suggested bounded fix. Gemini fixes frontend code; you fix only defective tests in your own paths while preserving meaningful requirements. Import its next explicitly identified checkpoint and rerun affected cases. Do not repeatedly cherry-pick commits already present.

## 5. Required test coverage

Use the T04-01 through T04-10 matrix in Gemini's prompt, with explicit test-to-requirement mapping. At minimum:

1. Desktop right navigation, tablet drawer and mobile navigation at 1440/768/390. Assert accessible names, current state, opening/closing and only actually available destinations. No dead fake business routes or synthetic counters presented as real.
2. Arabic document language/direction, mixed-direction identifiers/email, long labels/content, local font loading and meaningful text. Actual dates respect Cairo; do not require future date workflows.
3. Keyboard-only journeys, visible focus, drawer/dialog focus/Escape/restoration where applicable, semantic labels/headings, error announcements and touch geometry. Measure relevant contrast; inspect actual rendered output, not source declarations alone.
4. 200% text scaling/reflow at required widths: essential content readable/reachable, no page-wide blowout, no sticky controls covering focused fields/buttons. Retain sanitized matched screenshots.
5. Real initial loading versus genuine empty state, controlled error and retry, network loss/reconnect, and actual expired/revoked-session handling. Assert no premature save/success when the server has not confirmed. Do not invent business writes just to exercise a save state.
6. Manifest valid/reachable, icon assets/type/dimensions, scope/start URL/display and installation capability where the local browser supports it. Separate automated manifest assertions from actual installation observations; physical HTTPS/device testing remains T18.
7. Browser privacy after private navigation, logout/expiry, reload, offline and reconnect: inspect actual CacheStorage, localStorage, sessionStorage and IndexedDB for private content/tokens/credentials/unsent confidential text. Accepted HttpOnly session cookies are not a forbidden localStorage persistence mechanism. No confidential note saving or offline sync promise. Test worker scope/registration and public allowlist if implemented; offline response must not expose a prior private page. Absence of a worker does not excuse inspecting other browser storage.
8. Preserve accepted real-server authentication and authorization boundaries. Use synthetic authenticated fixtures following the existing secure setup. Negative security assertions must use actual server responses, not mocks that merely return the status under test.
9. Remove false production certification claims, demo account/autofill, invented identities and prototype demo data; respect manual legal-deadline review and Matter/Proceeding distinction.

Mocks/route interception are allowed for controlled presentation/network scenarios when clearly labeled; they cannot prove backend authorization or real cache behavior. Avoid fixed sleeps, empty selectors, assertions that pass when nothing happened, unjustified skip/fixme, swallowed errors or retries masking reproducible failures. Synchronize meaningful events/completion where needed. Tests must fail for the behavior they claim to catch.

## 6. Execution, findings and stopping rules

Build the current implementation in your worktree before next start. Run the new T04 browser suite across all required projects with your dedicated config/port/database; run relevant existing regressions in your isolated environment. Typecheck and lint new tests. Record exact commands, exit codes, counts, skips/retries and inspected SHA. Keep logs/traces/screenshots free of real data/secrets.

Use the pinned installed Next.js/Playwright behavior. Consult relevant node_modules/next/dist/docs/ guides before relying on framework routing, metadata or cache assumptions. Do not weaken assertions to reproduce an outdated API assumption.

Do not accept a passing screenshot as interaction evidence or claim physical screen-reader/full WCAG certification from automated semantics alone. Mark actual limits accurately. If a required local check cannot run, report its blocking reason; future physical-device/production gates are scoped separately.

Continue the implementation/check/finding/retest loop until your required tests actually execute successfully against the current frontend and every in-scope finding is fixed or specifically resolved with Codex. Do not label known failures as completion, delete an assertion to make a result green, or stop while commands are running. Do not promise zero unknown bugs. A real dependency/tool/ownership blocker produces BLOCKED/INCOMPLETE with precise next action; waiting for Gemini is WAITING_FOR_FRONTEND, not DONE.

## 7. Integration handoff and final evidence

Commit your coherent test-only changes on the same supporting branch, inspect staged paths, push normally and verify remote SHA. No independent merge of this branch into main; Gemini integrates the exact listed test commits into the canonical T04 branch/PR. Keep your imported frontend/contract commits out of the test-only handoff list.

Save docs/reviews/T04-test-submission.md containing:

- Common base, frontend checkpoint, test implementation SHA, branch/upstream/local/verified remote HEAD and exact ordered test-only commits.
- Acceptance-ID/test mapping and explanation of material negative scenarios.
- Actual loaded skills/profiles/hashes, native tool/type/ID, returned findings and execution evidence.
- Commands/exit statuses/counts/skips/retries, screenshots/traces, privacy/installation observations, findings/fixes/retests and NOT RUN limits.
- Ownership/conflict notes and exact reproduction instructions for the combined suite.

Return OPENCODE_TEST_HANDOFF with the above commit list and tested frontend SHA. Status is READY_FOR_INTEGRATION only when your slice gates pass; this is not T04 acceptance. Gemini must still run the full combined battery, obtain independent returned support results and verify hosted CI on the final task PR. If integrated verification surfaces a test defect, correct your owned files and return an updated test commit for reconciliation. Do not self-approve, merge, deploy or start T05.
