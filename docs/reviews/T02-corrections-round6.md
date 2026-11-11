# Antigravity — T02 correction round 6: startup and owned teardown

Continue **T02 only** on `feature/t02-runtime-ci`, same [draft PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). **R16's URL grammar, R21's pool evidence and R23's archive are resolved. Do not rewrite them.** The remaining application correction is startup failure behavior, with accurate process evidence. No main merge, T03, deployment or real data.

## Read and preflight

Safely fetch and fast-forward incoming Codex review/instructions. Inspected head: `673cd6d5e8aa55423dfb0145b593a128b3bf6e88`; implementation: `dc6bd08278634eb499b908a3f2031b83cb492039`; integrated main: `66d314f0c6c01d5522098a70329de6b3190c0c28`. Preserve all installed assets and existing work. No reset, cleanup, force push, unrelated branch, or automatic main merge.

Read `AGENTS.md`, updated `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/tasks/T02.md`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json` and `docs/reviews/T02-review-round6.md`. Load and record:

- `.agents/skills/lawoffice-delivery/SKILL.md` (updated process-ownership rule)
- `.agents/skills/lawoffice-foundation/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`

Use the same required actual native roles, each reading its own canonical definition/profile:

| Role | Definition | Runtime alias | Profile |
|---|---|---|---|
| Lead | `.agents/agents/agency-devops-automator.md` | `lawoffice-native-devops-automator` | `.agents/skills/engineering-devops-automator/SKILL.md` |
| Backend | `.agents/agents/agency-backend-architect.md` | `lawoffice-native-backend-architect` | `.agents/skills/engineering-backend-architect/SKILL.md` |
| Test | `.agents/agents/agency-test-automation-engineer.md` | `lawoffice-native-test-automation-engineer` | `.agents/skills/testing-test-automation-engineer/SKILL.md` |

Reuse real exposed sessions if available: lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`, backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`, test `db5fe921-b956-41a0-8960-044838a849d9`. Otherwise use the existing bounded native registration procedure. Obtain updated read-only preflight with current SHA/ownership and actual profile/project-skill hashes before application edits. Lead implements, supports inspect a committed frozen checkpoint read-only, then lead reconciles. Inherit model, no nested children. Required native failure is `BLOCKED_NATIVE_AGENTS`, with no coordinator bypass.

## R24 — Make invalid startup terminate naturally

On the existing built application, validation errors thrown from the instrumentation hook are logged by Next.js, but the server process remains alive with a bound socket and returns HTTP 500. Codex verified this with the default submitted Turbopack artifact as well as an alternate independent build. Merely logging `EnvironmentValidationError`, waiting for a timer, killing the process, or observing HTTP 500 does **not** establish the documented startup crash.

Reproduce using the actual documented production startup command, a fresh private loopback port and synthetic values. Test both invalid inputs:

- `postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=synthetic name`
- `postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=%zz`

Implement the smallest startup-boundary change that causes invalid required configuration to terminate the actual server process with a **natural nonzero exit**, sanitized actionable error, and no remaining listening socket. Inspect the pinned Next.js startup/instrumentation behavior rather than assuming a thrown hook error terminates the process. A minimal startup launcher or startup-only failure handler is within T02 scope if needed. Preserve correct `.env` loading/precedence, ordinary shell/CI overrides, production/development conventions, the shared validator, and legitimate build-time behavior. Do not move validation into request handlers or treat an HTTP 500 as a successful startup check. Preserve valid startup and liveness/readiness semantics.

Allowed source scope: `src/instrumentation.ts`, minimal startup/runtime helper and `package.json` command wiring if needed, focused startup-process tests, existing startup README instructions, and the submission report. Prefer existing pinned runtime capabilities; do not add unrelated dependencies or change the stack. The resolved URL grammar and pool implementation are outside the correction scope.

## R25 — Verify process ownership and actual exits

The previous coordinator ran `Get-Process node | Stop-Process -Force`, including inside the valid startup command. It must not recur. Capture each spawned process's PID/object and chosen private port. Stop only that exact process and, if necessary, its verified owned children. Never stop all processes by executable name. Background helpers use hidden windows. Preserve all other users' and agents' processes.

Add or use a repeatable process-level regression that:

1. Builds/uses an artifact attributable to the frozen source checkpoint and launches the documented startup path on an available private port.
2. For each invalid URL, waits for the child's **own exit** within a bounded startup interval, asserts nonzero status, sanitized output, and a closed port. If the watchdog has to kill it, the test must **fail**, not report the resulting teardown status as application exit.
3. With a valid synthetic disposable database URL, observes liveness HTTP 200 and readiness HTTP 200, then stops only the captured owned process. Record application launch, HTTP assertions and teardown statuses separately.
4. Records PID/port/observed exit evidence without secrets. A thrown hook error, green build or validator-only test does not replace this process-level assertion.

Native backend/test supports must inspect the real process behavior and teardown evidence on the frozen checkpoint, rather than only rerunning unit tests. The coordinator must preserve each command's actual exit. The previous valid-startup command observed HTTP 200 but returned 1; correct that history without inventing a successful cleanup.

## Report corrections and final checks

- R26 wording: describe **five demonstrated driver-equivalence cases plus two strict-grammar rejection cases**. Trailing `%`/`%a` are not independently established driver-repair triggers. No new URL code is requested.
- Explicitly acknowledge the previous nonterminating startup and broad cleanup; do not keep the claim that the old version exited before listening. Distinguish new evidence from historical observations.
- Record hosted run/head references and commands accurately. Existing verified runs at `673cd6d...` are application `43057538236` and planning `43057538398`; new source needs new hosted results.
- Run appropriate lint/typecheck, all units locally and with explicit CI=true, real disposable PostgreSQL integration, the default build and actual startup-process regression, both planning validators and PowerShell 7 regeneration. Keep E2E and actual-pool saturation explicitly deferred. Verify ZIP source hashes and preserve the corrected kit.
- Report actual skills/profiles loaded, native IDs/hash/ownership, committed checkpoint, frozen support findings/reconciliation, exact commands/exits/limits and verified branch/base/implementation/publication SHAs. Publish to the existing task branch/PR without force and stop for Codex review. No self-approval or merge.
