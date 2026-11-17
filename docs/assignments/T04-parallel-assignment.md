# T04 — Parallel implementation assignment

Design input: first read `docs/design/STITCH-T04-REVIEW.md`. The owner selected Stitch project `10964447413466098333`; its local snapshots are under `docs/design/stitch/10964447413466098333/`. Treat them as visual references under canonical DESIGN.md, not production code. Preserve the original snapshot and include these planning inputs in both worktrees before dependent implementation. Optional A/B design exploration is described in that report; do not run two competing production implementations or assume a candidate has been selected.

Codex assignment, 2026-11-16. This refines T04 ownership and permits the owner's explicitly requested Gemini + OpenCode execution. All product scope, native Agency requirements, synthetic-data rules and independent Codex acceptance remain binding.

## Predecessor and base

T03 is accepted by Codex Round 18 (`docs/reviews/T03-review-round18.md`, initially local/untracked) for published HEAD `041c50a7413867d46e04beedfbf2e91c89a24ca9`. GitHub PR #8 was independently observed merged as `ca2819421d78a385841618505c8f8165f0b69b9e`. This explicit decision supersedes the older T03 review pointer in T04. Preserve earlier reports; do not invent a committed acceptance report.

Fetch origin and verify this merge is integrated into current origin/main. Both worktrees start at the same recorded main SHA. Do not switch or clean the existing D:/Lawyer checkout. Gemini coordinates setup and integration; OpenCode must not race setup.

## Ownership

| Slice | Owner | Branch and worktree | Owned paths |
|---|---|---|---|
| T04-A shell/PWA and final integration | Gemini coordinator, native `agency-frontend-developer` implementation lead | `feature/t04-arabic-pwa-shell`, `D:/Lawyer/work/t04-gemini` | T04 shell/layout/navigation, shared presentation primitives under `src/components/`, root global styles, public manifest/icons/font assets and public-only offline behavior; `docs/assignments/T04-interface-contract.md`; `docs/reviews/T04-submission.md` |
| T04-B behavioral browser tests | OpenCode coordinator, native `agency-test-automation-engineer` implementation lead | `feature/t04-browser-verification`, `D:/Lawyer/work/t04-opencode` | New `tests/e2e/t04-*.spec.ts`, `tests/helpers/t04-*`, optional `playwright.t04.config.ts`, `docs/reviews/T04-test-submission.md` |

Neither writer edits the other's files. Existing T03 auth/security source and tests, identity modules, database schema/migrations, package manifests/lockfile and CI are outside both slices unless Codex issues a bounded extension. Auth page presentation changes are allowed only when needed for shell consistency and must preserve auth semantics. Avoid broad route-group moves. Tests must not require dependency additions. Gemini may add focused tests only outside OpenCode-owned patterns; existing regressions must remain intact.

## References and profiles

Both read AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md, docs/tasks/T04.md, this assignment, DESIGN.md, docs/SCREENS.md, docs/ARCHITECTURE.md, docs/SECURITY_OPERATIONS.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md and docs/AGENCY_AGENTS.md. Both load `.agents/skills/lawoffice-delivery/SKILL.md`, `lawoffice-arabic-ui/SKILL.md`, and `lawoffice-testing/SKILL.md` from the chosen worktree. Resolve the latter two beside `lawoffice-delivery` in `.agents/skills/`.

Gemini's lead uses `.agents/skills/engineering-frontend-developer/SKILL.md` and `.agents/agents/agency-frontend-developer.md`. Gemini invokes distinct native accessibility and test support children using `.agents/skills/testing-accessibility-auditor/SKILL.md`, `.agents/agents/agency-accessibility-auditor.md`, `.agents/skills/testing-test-automation-engineer/SKILL.md`, and `.agents/agents/agency-test-automation-engineer.md`. Supports review the frozen integrated checkpoint; an author is not the independent reviewer of their own tests.

OpenCode's lead uses `.agents/skills/testing-test-automation-engineer/SKILL.md` and `.agents/agents/agency-test-automation-engineer.md`. The owner authorizes OpenCode as the T04-B runner. Use its actual native child mechanism and record tool/type/ID mapping; no fabricated Antigravity tool calls or same-session persona fallback. If required native execution cannot run, report `BLOCKED_NATIVE_AGENTS` before dependent implementation. Each child loads its assigned references and profiles; record actual paths/hashes, ownership, checkpoint, returned findings and reconciliation. Use at most three active children per coordinator and no nested delegation.

## Coordination sequence

1. Gemini alone inspects status/remotes/worktrees, fetches and records the common base, and creates the two worktrees/branches if absent. Existing paths/branches must be inspected and reused safely, never reset or deleted. Install pinned dependencies in each worktree without changing the lockfile. Do not copy confidential environment files or credentials.
2. Gemini commits a brief interface contract before implementation: existing routes actually available, accessible navigation names/roles, real state triggers, manifest URL, public-asset policy, fixture/session setup and test configuration. Publish its SHA to the owner. OpenCode may read references and design a test matrix immediately; dependent browser assertions use this contract after receiving its SHA. Contract changes require notification through the owner.
3. OpenCode imports the contract commit only after checking it is documentation-only. Both implement independently. OpenCode cannot claim unimplemented behavior passed; it reports expected initial failures explicitly.
4. Gemini publishes an immutable runnable frontend checkpoint. OpenCode imports the explicitly identified frontend commits into its own branch, preserving its tests. No copying a live working directory, force pushes or silent conflict resolution. Integration conflicts are resolved by the file owner. OpenCode runs its tests against that implementation and returns findings to Gemini via the owner.
5. Gemini fixes frontend findings and publishes a new checkpoint; OpenCode reruns affected tests. Gemini imports the explicitly listed test commits only (already-imported frontend/contract commits must not be reapplied), freezes the combined checkpoint, and runs final verification. Test/support work integrates into the canonical T04 PR; no separate merge of the supporting branch into main.

The owner relays only contract/checkpoint SHAs, exact commit lists and findings between tools. No automatic cross-tool messaging is assumed. Neither implementer changes the other checkout's branch.

## Runtime isolation

Use separate synthetic databases, validated by the existing test-target guards, separate build outputs through separate worktrees, and task-owned servers. Gemini retains the standard browser port 3100. OpenCode owns optional `playwright.t04.config.ts` for a dedicated port such as 3204, preserving existing projects/fixtures/security env and setting server URL, baseURL and BETTER_AUTH_URL consistently. Do not edit the shared playwright.config.ts or bypass database guards. Never run two browser suites against the same database concurrently. Record exact processes/ports and stop only task-owned processes.

## Acceptance and delivery

Implement only Arabic RTL shell/navigation, real empty/loading/error/disconnected states, manifest/local icons/font, and public-assets-only behavior. No dummy dashboard totals, future CRUD/screens, schema changes, confidential offline queues, or broadened PWA caching. A service worker is optional; if present it uses an explicit public-asset allowlist and never caches auth/API/private responses.

Tests cover actual 390/768/1440 rendered screens, keyboard and focus, 200% text scaling, mixed-direction text and long labels, available loading/error/empty/disconnected states, session expiry, manifest/icons, observed installation capability, and storage/cache/network privacy. Real server/security boundaries must not be replaced by mocks to claim success. HTTPS/device installation remains T18; physical screen-reader tests are NOT RUN unless actually executed.

On the final combined checkpoint, run lint, typecheck, unit, production build before integration, all integration and all browser tests (including the new T04 tests). Run relevant project validators and regenerate maintained planning outputs if canonical planning documents change. Inspect rendered screenshots and reconcile actual native support returns. Preserve meaningful assertions and existing T03 regressions; new failures require fixes and affected reruns. Repeat the full final battery when integration/config changes invalidate it, not on an unchanged checkpoint merely for ceremony.

Each slice reports its exact base/implementation/pushed SHA, owned changed files, actual checks and results, evidence paths, native returns and NOT RUN limits. Gemini consolidates into `docs/reviews/T04-submission.md`, pushes coherent updates to the same canonical branch and draft PR, and reports `READY_FOR_CODEX_REVIEW` only after all required results are received and reconciled. Neither author accepts T04, merges main, deploys, or starts T05.
