# T03 — Correction round 5

Execute this entire assignment with [the current review](T03-review-round5.md) and [T03](../tasks/T03.md). Decision remains **CHANGES_REQUESTED** at submitted head `352030df52cc4828cee66d2312428234141d91f0`, frozen application `03108fd62d33fe04bb460c73fafb7af7283d15d4`. Continue `feature/t03-identity-sessions`, existing draft [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8), origin `https://github.com/MohamedAlksas/LawyerOS.git`. Fetch and safely synchronize with this Codex review publication first; record the actual starting SHA.

Scope is the four concrete cases below plus their missing regression evidence. Preserve universal pending reservations, raw-token shortcut removal, empty-override/malformed-name rejection, real TOTP/recovery proofs, PostgreSQL password-fault safety, nonempty baseline success, R05/R09 and green CI. No fixture-specific production exemptions, test-mode authentication bypasses, main push/merge, deployment, real data, T04, visual redesign, new business/SaaS/offline/AI work, stack/model change, force push, destructive reset/clean or deletion of installed assets.

## Reads, skills and actual native ownership

Read AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md, docs/tasks/T03.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md, docs/AGENCY_AGENTS.md and docs/AGENCY_AGENT_ROUTING.json; then the Identity/security/S01/S14 references and pinned provider/pg/migration source needed for these cases.

Load and record the actual project-local `.agents/skills/lawoffice-delivery/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, `.agents/skills/lawoffice-testing/SKILL.md`, and the task's `.agents/skills/lawoffice-arabic-ui/SKILL.md` for functional auth UI verification. Read `.agents/skills/graphify/SKILL.md` with docs/GRAPHIFY.md. Record paths actually read and hashes.

Run the documented canonical/registered-alias preflight and invoke distinct real native children through the installed definitions. If execution remains unavailable, report **BLOCKED_NATIVE_AGENTS** before dependent implementation. No personas, invented IDs, silent specialty substitution, nested delegation or full-roster launches.

| Bounded slice / reason | Lead profile and native definition | Owned paths / responsibility | Required support |
|---|---|---|---|
| A — Final driver destination and database ownership are test-infrastructure behavior | `.agents/skills/testing-test-automation-engineer/SKILL.md` (`agency-test-automation-engineer`); `.agents/agents/agency-test-automation-engineer.md` | `tests/helpers/test-db.ts`, focused driver/ownership regressions | AppSec checks separation before connection; Identity checks test/application boundary |
| B — Provider-selected auth policy and atomic setup closure are Identity behavior | `.agents/skills/engineering-identity-access-engineer/SKILL.md` (`agency-identity-access-engineer`); `.agents/agents/agency-identity-access-engineer.md` | Auth route/requireActor and narrowly necessary shared policy; provisioning Module/CLI and focused tests | AppSec independently checks cookie selection and closure races; testing verifies actual interleaving |
| C — Actual protocol/failure/baseline proofs require test ownership and technical reconciliation | Same test-automation profile/definition; Identity owns any resulting application or migration procedure correction | Relevant integration tests and canonical technical setup documentation, such as an Identity migration section in docs/DEPENDENCIES.md | AppSec checks failure refusal and accurate evidence; Identity verifies schema/provider semantics |

AppSec: `.agents/skills/security-appsec-engineer/SKILL.md` (`agency-application-security-engineer`), `.agents/agents/agency-application-security-engineer.md`. The coordinator coordinates and publishes; authors do not provide their own independent approval. Give each child exact ownership, allowed actions, source SHA and required checks. Record actual invocation IDs/profile/definition paths/hashes, checkpoint SHAs, concrete findings and reconciliation. Serialize overlapping writers. Keep UI unchanged unless a verified functional T03 defect requires a separately routed frontend phase under the previous assignment.

## A — Normalize the complete driver destination before validation (R07)

The remaining reproduction uses **no empty override**: `DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test`, `TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1/shared_test`, and `PGPORT=65432`. The guard assumes test port 5432; actual pg selects 65432. No socket is needed to expose this mismatch.

Resolve/canonicalize the effective routing parameters according to the pinned driver before separation checks and pass exactly that validated identity to the driver. An omitted URL port must not later be filled from ambient PGPORT. Choose explicit canonical defaults or reject ambiguity; preserve legitimate existing explicit-port usage. Apply the same destination rule to dedicated database/admin/cleanup connections so helper paths cannot diverge. Keep the original operational/test pair, explicit test URL, no fallback, collision refusal and owned-resource cleanup.

Add connection-free checks of actual `Client.connectionParameters` for omitted/default/explicit ports with controlled PG defaults, same-target rejection, and malformed inputs. Do not use pool.options alone or connect to an operational service to prove safety. Preserve the fixed undefined/empty connectionString and malformed-identifier cases. Describe any allowed identifier length truthfully, including PostgreSQL truncation behavior if the helper accepts arbitrary supplied names.

## B1 — Check the same configured session that will be delegated (R02/R03)

Remove guard-only secure-to-both-cookie-name rewriting. Use the same configured provider cookie selection and original request context for authoritative non-refreshing validation, application policy and actual handler execution. Provider cookie selection follows its configuration, including baseURL/cookie settings; a request URL or forwarded header cannot independently redefine it. Do not reintroduce custom signing, signature stripping, raw candidate queries, caller raw tokens or a preference for every `__Secure-` cookie regardless of configuration.

Required failing regression: configure the real provider for HTTP/plain cookies, create an actual MFA session, age it consistently to 40 minutes old/31 minutes idle with credentials predating login and matching remaining 12-hour expiry, add an invalid secure-cookie decoy, then request get-session. It must reject before refresh and subsequent requireActor must reject. The current code returns authenticated data, refreshes activity and accepts the actor.

Cover both cookie orders under actual HTTP and HTTPS provider configurations, active and idle selected sessions, invalid and unrelated idle decoys, and configured cookie names where supported. A valid selected session must not be rejected/deleted because of a different raw candidate. Assert persisted activity/existence and subsequent protected/provider access. Preserve absolute expiry, mandatory MFA, pending/maintenance rejection, transient-error rejection and closed registration.

## B2 — Recheck setup completion under the lock (R06)

The completed reproduction queues real confirmOwnerProvisioning first and password-authenticated provisionOwner resume second behind an external PostgreSQL row lock. Both prechecks see pending state; confirmation closes bootstrap; queued resume then returns the TOTP seed and recovery codes because it ignores the freshly locked verified value.

Recheck authoritative enrollment/bootstrap completion inside the shared concurrency boundary before returning setup material or mutating pending state. Coordinate fresh reservation, confirmation and resumption sufficiently to enforce one owner and durable setup closure. Correct credentials do not authorize reopening a completed setup path. Do not delete/reset the owner, reopen bootstrap, or add an administrative bypass.

Commit a deterministic real-PostgreSQL regression for that exact ordering, using observable lock/barrier coordination rather than arbitrary sleeps or mocked persistence. After confirmation commits, resume must reject without returning material, and bootstrap stays closed. Also cover resume preceding confirmation, fresh concurrent reservation, bounded concurrent failed pending attempts, lock expiry and legitimate interrupted CLI continuation. Preserve the actual row-locked attempt counters and secret-safe setup delivery. Report only booleans/counts/statuses, never seeds or recovery values.

## C1 — Make baseline application stop on failure and verify before history (R08)

Credit the working normal upgrade: full committed SQL on a nonempty sentinel fixture, then actual resolve/status/deploy, now works without data loss. Fix the failure path rather than replacing this with another reset. Current published `psql -f` continues on SQL errors and can exit 0; marking history afterward makes status/deploy report success although required columns are absent.

Publish one canonical technical procedure with explicit supported predecessor/preflight conditions, fail-fast SQL execution and suitable transaction/retry semantics. Verify the actual expected schema, constraints/indexes and retained data **before** marking the auth migration applied. Stop safely on conflicts, SQL errors, incompatible old draft schemas or partial state; never mark an unexecuted/incomplete migration applied. Migration status checks history and is not a schema-drift check. Use the pinned migration/tooling capabilities accurately.

Make tests execute that exact procedure (including whole-file SQL behavior), rather than a separately maintained semicolon splitter plus redundant ALTERs. Exercise an ordinary retained-data fixture, a deliberately conflicting synthetic table/error path and retry/recovery: failure must not record a completed auth migration or claim a usable schema; success must retain sentinel records, match expected schema/history and permit actual auth. A sentinel is retention data, not a claim that T02 shipped an audit module. Do not invent business tables or run any procedure against owner/operational data.

## C2 — Finish the specific remaining regression claims (R02/R04/R10)

Replace the still-invalid historical-trust test. The existing fabricated `device-trust:<user>` record and unsigned `dont_remember_device` cookie never represent a trusted device. Issue a real signed historical trust_device cookie and its verification record through the pinned provider's prior supported 30-day configuration, complete genuine MFA with trust, sign out retaining it, then test the **current application route**. Require a fresh challenge and reject protected access before completion. Preserve the working production trust policy; do not deliberately break it to manufacture a red test.

Retain the new real PostgreSQL DELETE trigger and unchanged-password safety. Complete its requested coverage with two genuine MFA-completed cookie contexts, both protected/provider entry points before/after fault, omitted and explicit false client revocation preferences, and successful retry after fault removal. Distinguish an unchanged-password abort with valid prior sessions from an applied credential change requiring old sessions to fail. Direct session fixtures may remain for unrelated state tests with accurate labels.

Keep the real issued-URI TOTP and recovery consumption/replay improvements, R05 explicit secret and R09 atomic recovery limits. Correct report details to match actual source and executed commands. Identify any real MutableStdout/TTY test by path and result; otherwise record source inspection/NOT RUN instead of claiming a mock-stream test absent from the tree. No blanket “all fixed” while cases are partial.

## Verification and handoff

Add one meaningful failing test for each remaining defect, apply the minimum fix, then verify incrementally. Already-working behavior may receive a passing regression; do not break it to fabricate test history. Freeze committed checkpoints for independent support review and reconcile through the responsible writer.

Use local committed code-only Graphify snapshots per docs/GRAPHIFY.md. Verify full SOURCE.json SHAs, query changed relationships, state truncation/coverage limitations, and inspect real source/tests. No uploads, external labeling, provider keys, upgrades or hooks.

Run relevant lint/typecheck, configured units, real PostgreSQL concurrency/fault/baseline cases and integration/browser suites, with a fresh attributable default build. Distinguish local test-only webpack from hosted default evidence. Validate routing/planning with the correct available PowerShell runtime, preserve installed assets on failure, and regenerate derived copies. Clean up only verified run-owned resources.

Save `docs/reviews/T03-submission-round5.md` with separate behavior/regression/evidence dispositions for R01–R10, exact commands/exits, positive and negative observations, NOT RUN limitations, native ownership/IDs/hashes/findings/reconciliation, Graphify provenance, canonical safe baseline, and branch/base/frozen/report/independently verified pushed SHA/PR. Keep prior submissions historical; avoid self-referential report-SHA amendments. Push coherent updates to this existing branch/PR and stop for independent Codex review. No merge, self-approval, deployment, real data or T04.
