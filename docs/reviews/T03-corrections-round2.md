# T03 — Correction round 2

Read [the current review](T03-review-round2.md) in full. T03 remains CHANGES_REQUESTED at published head `eb2199eef2fd5175072e13ecc1e6b50d4d0df6ac`. Fix the remaining behavior on the same branch/PR; retain R01's key alignment and R05's explicit-secret requirement. Preserve the successful ordinary-path fixes rather than rewriting the project.

## Baseline, skills and native execution

Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`. Branch: `feature/t03-identity-sessions`. Existing draft PR: https://github.com/MohamedAlksas/LawyerOS/pull/8. Fetch and safely synchronize with the Codex review publication first. No force push, automatic stash, reset/clean, main push/merge, deployment, real data, T04 or application visual redesign. Stitch work is separate; functional enrollment/logout cannot be replaced by a future cosmetic design.

Read PRODUCT.md, GLOSSARY.md, docs/PRD.md, AGENTS.md, GEMINI.md, docs/tasks/T03.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md and docs/AGENCY_AGENTS.md, then the T03 Identity/security/screens references. Required project-local skills:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-security-operations/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`
- `.agents/skills/lawoffice-arabic-ui/SKILL.md`

Use actual distinct native sessions with bounded assignments, source SHAs and file ownership. Prior Phase A/B PASS reports are historical; new work needs observable native execution and new results. Run the documented canonical/registered-alias preflight; if it remains unavailable, report BLOCKED_NATIVE_AGENTS before dependent implementation. No persona fallback, fabricated IDs, changed model, nested agents or full-roster launches.

### Codex specialty refinement

| Slice | Implementation specialty and exact profile | Owned work | Independent support |
|---|---|---|---|
| Test safety, actual behavioral regressions, migration verification and test-CI wiring | `agency-test-automation-engineer`: `.agents/skills/testing-test-automation-engineer/SKILL.md`; native `.agents/agents/agency-test-automation-engineer.md` | `tests/helpers/test-db.ts`, integration/E2E tests, Playwright config and the narrowly required CI/test setup | Identity checks runtime/config semantics; AppSec checks negative scenarios and ownership boundaries |
| Verified sessions, MFA policy, failure handling, concurrency-safe recovery and incomplete setup | `agency-identity-access-engineer`: `.agents/skills/engineering-identity-access-engineer/SKILL.md`; native `.agents/agents/agency-identity-access-engineer.md` | Auth routes/config/Identity Module, required Prisma/schema changes, CLI and minimal enrollment/logout UI | AppSec audits bypasses/faults/concurrency; testing specialist verifies the frozen behavior |

AppSec profile: `.agents/skills/security-appsec-engineer/SKILL.md`; native `.agents/agents/agency-application-security-engineer.md`.

The parent coordinates and publishes. Fix unsafe fixture ownership first. For each security behavior, add one meaningful failing public-boundary regression, hand application ownership to Identity for the minimum fix, then verify before advancing. Do not have multiple writers edit the same file, and do not batch imaginary test cases as a substitute for observing a failure. Freeze checkpoints for read-only support audits; rerun affected support checks after changes. Normally at most these three children are active.

## Required outcomes

### R02 — One verified authentication boundary and required fresh challenge

Replace signature stripping/manual token authentication with the pinned library's supported cookie/session verification. Apply the application policy to that verified session without allowing verification itself to refresh an otherwise stale session. Account-level enrollment flags are not proof of a particular session's challenge.

Acceptance:
- Missing, unsigned and corrupted-signature cookies cannot obtain an actor or protected response. Do not claim an anonymous attacker can guess a random token; test the actual contract with controlled synthetic cookies.
- Password-only and incomplete-enrollment states cannot access owner functionality or sensitive library operations.
- Client-supplied `trustDevice:true` or an existing trust-device cookie cannot bypass the required challenge on a new owner login. Preserve the per-login policy instead of silently changing it to a 30-day exception.
- The normal login/MFA/recovery/logout sequence still works; direct disable and public registration stay closed.

### R03/R04 — Mandatory policy remains effective during failures

Remove catch-and-continue handling around session-policy validation and required revocation. An unexpected policy/database error produces a sanitized non-success result and cannot allow the library to refresh an idle session.

For password change, do not report success while required invalidation failed. The failure path must not leave a previously valid second session usable after credentials changed. Use a transaction or an equivalent enforced invalidation design supported by the pinned stack; explain the actual failure/retry semantics rather than inventing a successful cleanup.

Acceptance includes one transient guard-read exception followed by real database recovery, a PostgreSQL failure during other-session revocation, direct library APIs, protected entry points, 30-minute idle expiry and 12-hour absolute age. Exercise both default and explicitly false/omitted client revocation flags. A swallowed exception or log-only warning does not pass.

### R09 — Reserve recovery attempts atomically

Enforce the intended bound across concurrent requests/processes before expensive password verification, using real PostgreSQL concurrency control. Avoid stale read/verify/write counters and cross-request successful resets that allow additional guesses. Keep fresh reauthentication and authorization inside the Identity Interface.

Acceptance: eight simultaneous wrong attempts cannot all enter verification while recording only one failure. Show the enforced limit, lock behavior, expiry/recovery and correct-password behavior through the real command/Server Action. Do not substitute a sequential loop, an in-memory limiter or only an atomic increment after every guess already ran.

### R06 — Finish enrollment only after possession; handle secrets safely

Keep race-safe single-owner reservation and durable closure. Distinguish incomplete setup from completed enrollment; only successful authenticator proof makes it verified/complete. A pending setup must not grant a normal owner actor or reopen a path to creating another owner.

Provide a usable controlled completion/retry path and explicit logout within T03's existing visual style. Test valid/invalid setup proof, interrupted setup, retry, fresh concurrent provisioning and closure after owner removal. Existing tests racing an already-closed state do not establish the fresh race. Codex has independently verified the current lock's fresh-race behavior; preserve it.

Use a genuinely non-echoing TTY input mechanism and demonstrate it with synthetic data. Asterisks added alongside normal readline output are insufficient evidence. Enrollment/recovery material may be deliberately presented through a controlled setup channel, but must not spill into routine noninteractive stdout/log capture. Test interactive/noninteractive behavior and the documented safe way to deliver recovery material. Do not log seeds, passwords or recovery codes in evidence.

### R07 — Own the data you reset

Remove broad domain/substring cleanup and unconditional bootstrap-marker deletion. Track records created by the run, including verification/bootstrap state, or create and own a fresh disposable database for the suite that needs whole-database reset. Neither an `_test` suffix nor a recognizable email proves fixture ownership.

Pre-existing users, bootstrap markers and unrelated sentinel data must survive shared-database setup/teardown. If a suite requires an empty singleton bootstrap, give it its own verified disposable database instead of deleting another fixture's marker. Check the eventual pool/server target after configuration composition so optional overrides cannot replace the validated target. Preserve original operational/test comparison, explicit test URL, rejection before connection/write, no fallback and no arbitrary server reuse.

### R08 — Green CI and a tested supported migration path

Keep the original operational/test pair distinct for application test validation. Scope the disposable DATABASE_URL only to the migration command that requires it; do not weaken validation or overwrite the original pair globally. The current workflow gives both variables the same URL and therefore fails before the required build/E2E steps.

Demonstrate clean install, generation, fresh migration and a documented non-destructive upgrade/baseline from the supported T02 state with retained synthetic data. A nonempty fixture currently fails P3005. If a baseline is needed, document and verify it against the actual prior schema; never mark an unexecuted authentication migration applied merely to obtain “0 pending”.

T03 is unmerged, so its draft migrations may be consolidated before first integration if the supported baseline is explicit. Reused old T03 fixtures need a truthful migration/recreation procedure. Raw split SQL, ignored duplicate errors, ad hoc ALTERs, resets or a blind migrate resolve are not upgrade proof. Keep pins, stack and global install-script policy unchanged.

### R10 — Commit actual journey evidence and finish the functional UI

Replace helper-to-helper comparisons/direct session inserts as proof of password→challenge→issued-URI TOTP→protected access. Direct fixture creation remains legitimate for unrelated session-state tests when labeled accurately. Replace in-memory recovery filtering as proof of consumption with real use and rejected replay across new challenges.

Provide and test the required enrollment/verification/recovery/logout flow; retain maintenance-role denial, second-context revocation and ordinary keyboard behavior. Perform actual 200% text scaling and inspect its computed/rendered result; relabel viewport-only tests as reflow checks. Preserve three-width verification without claiming that thirty passes prove every requirement.

Correct the submission's blanket “all addressed” claims. Record separate statuses for fixed behavior, committed regression coverage and remaining limits. Do not rewrite prior execution history or fabricate a default build, TTY check, migration upgrade, zoom result or fresh native review.

## Verification and handoff

Read docs/GRAPHIFY.md and `.agents/skills/graphify/SKILL.md`; build/query local code-only committed snapshots for the new auth/test boundaries and record the full SOURCE.json SHA. Record truncation/missing coverage and inspect source/tests. No uploads, LLM labeling, provider keys, hooks or tooling upgrades.

Run the relevant clean install/generation, lint, typecheck, local/explicit-CI units, owned PostgreSQL integration/migration/concurrency checks, real auth E2E and fresh attributable default build. Keep any local test-only webpack limitation separate from hosted default results. Planning validators/regeneration must stay current. Failure injection and resource ownership are part of the acceptance evidence, not optional manual notes.

Obtain concrete AppSec/testing findings on the exact frozen implementation, reconcile through the writer, and rerun affected checks after changes. Save `docs/reviews/T03-submission-round2.md` with dispositions for R01–R10, actual native IDs/profile paths/hashes/permissions/ownership/SHAs, failure and positive observations, Graphify provenance, real commands/exits/limits, migrations, branch/upstream/base/frozen/final/pushed SHAs and existing PR URL. Push coherent updates to the same branch/PR and stop for independent Codex review. No self-approval, merge, deployment, real data or T04.
