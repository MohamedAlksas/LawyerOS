# T03 — Correction round 3

Execute this entire assignment with [the round-3 review](T03-review-round3.md), the canonical [T03 card](../tasks/T03.md), and existing source. Decision remains **CHANGES_REQUESTED** at inspected application/report head `cd60a6a0f66bcdf6554c9b986c5e058921ab8412`. Work on `feature/t03-identity-sessions`, existing draft [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8), canonical origin `https://github.com/MohamedAlksas/LawyerOS.git`. Fetch and safely incorporate this Codex documentation publication first; record the actual starting SHA. Preserve R01, R05, R09 and the now-green CI.

Do not restart T03, implement T04, merge, deploy, use real data, redesign the UI, add SaaS/offline/AI, change the stack/model, force-push, reset/clean/stash others' work, or delete installed agent assets. Stitch styling is deferred. The functional setup/login/security flow remains T03 scope.

## Required reads and actual native children

Read AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md, docs/AGENCY_AGENTS.md and docs/AGENCY_AGENT_ROUTING.json. Read the card's Identity/security/screens/dependency references and the inspected pinned provider source before changing its integration.

Each assigned child must load and record actual project-local paths read:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-security-operations/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`
- `.agents/skills/lawoffice-arabic-ui/SKILL.md` for the auth UI slice and its reviewers
- `.agents/skills/graphify/SKILL.md`, with `docs/GRAPHIFY.md`

Use distinct real native sessions through `.agents/agents/`, not coordinator personas. Perform the documented canonical/registered-alias preflight before dependent edits. If unavailable after that bounded preflight, report **BLOCKED_NATIVE_AGENTS** and stop dependent implementation. No fabricated invocation IDs, silent role substitution, nested delegation or launching the full installed roster.

This Codex-authored refinement assigns work by actual behavior:

| Phase / why this specialist | Lead profile and native definition | Owned paths / responsibility | Required support |
|---|---|---|---|
| A: isolated test lifecycle and accurate regressions need test-infrastructure ownership | `.agents/skills/testing-test-automation-engineer/SKILL.md` (`agency-test-automation-engineer`); `.agents/agents/agency-test-automation-engineer.md` | `tests/helpers/test-db.ts`, relevant integration/E2E fixtures/config, test-only runners; narrowly required CI/migration verification wiring | Identity reviews actual auth semantics; AppSec audits destination/ownership and failure scenarios |
| B: session verification, MFA, bootstrap and credential invalidation are Identity behavior | `.agents/skills/engineering-identity-access-engineer/SKILL.md` (`agency-identity-access-engineer`); `.agents/agents/agency-identity-access-engineer.md` | `src/lib/auth.ts`, Identity Module, auth routes, provisioning CLI, required schema/migrations and minimal functional auth screens | AppSec independently attacks bypass/failure paths; test specialist verifies frozen regressions |
| C: evidence and reconciliation | Coordinator, with the same actual native children for scoped support results | Submission and derived documentation; reconcile each finding through its responsible writer | All required supports inspect the exact final frozen implementation |

AppSec's exact profile is `.agents/skills/security-appsec-engineer/SKILL.md`, name `agency-application-security-engineer`, native definition `.agents/agents/agency-application-security-engineer.md`. Record profile/definition paths and SHA-256 **from files actually loaded**, real invocation/conversation IDs, ownership, allowed actions, start/frozen/inspected SHAs, concrete findings, reconciliation and checks. Explain current Identity hash drift; do not rewrite its installed profile or fabricate historical evidence.

Fix Phase A ownership before destructive test execution. For each security behavior, observe one meaningful failing public-boundary regression, give application ownership to Identity, implement the minimum correct fix, and verify it before advancing. Serialize writers to overlapping files. Freeze committed checkpoints for independent support audits and rerun affected checks after reconciliation. Green counts and native PASS labels alone are insufficient.

## A — Prove ownership before creating, resetting or deleting test resources (R07)

1. Replace predictable-name `DROP DATABASE IF EXISTS ... WITH (FORCE)` setup. Generate a unique per-run disposable database identifier, validate the intended final target before mutation, quote identifiers safely, and refuse a collision without modifying it. Track ownership only after this run successfully creates the database. Teardown may drop only that exact owned creation; a suffix, supplied name or existence check is not ownership. Do not add cleanup that kills arbitrary database sessions.
2. Prevent `poolConfig` or other configuration layers from changing the validated pool/server destination. Validate the effective composed target, including connectionString and host/database/user/port overrides, before opening a socket. Preserve the original operational/test separation guard, explicit TEST_DATABASE_URL, no fallback and no arbitrary server reuse.
3. Give E2E unique run-owned identities and track the exact inserted IDs. Never update/adopt/delete a pre-existing identity by `lawyer.e2e@office.eg` or any recognizable email. Preserve unrelated users and bootstrap markers. Empty singleton-bootstrap suites get their own owned database.
4. Add negative coverage: existing sentinel database survives a name collision, unrelated same-email identity survives setup/teardown, final target override rejects before connection, malformed/operational targets reject before mutation, cleanup preserves resources not created by the run. Prove the destructive-helper reproduction is closed using only owned synthetic infrastructure.

## B1 — One provider-verified, non-refreshing session boundary (R02/R03)

Replace custom `verifyAndExtractCookieToken`, hand-coded signing/HMAC and signature stripping/raw-token actor shortcuts with the pinned library's supported verification/session facilities. Establish the same verified session and cookie-name policy the provider will use, without refreshing activity before the 30-minute idle and 12-hour absolute checks. Inspect its actual API/source; do not invent a library API. Apply policy to protected entry points and authenticated provider endpoints before any refresh or sensitive action. If a documented integration primitive is insufficient, explain and resolve the design with source evidence before claiming completion; do not substitute another custom authentication protocol.

Required committed regressions use actual routes and database state:

- Under HTTPS, a valid `__Secure-better-auth.session_token` idle 31 minutes plus an invalid ordinary cookie must not refresh or reach protected access. Include both cookie orders and configured cookie-name handling where supported.
- Preserve rejection of missing, unsigned/corrupt cookies, inactive/maintenance/pending actors, transient guard-read failures, absolute expiry and ordinary valid sessions. Assert database/session state after rejection, not just status.
- Password-only and incomplete challenge states cannot access owner functionality. Do not infer per-session MFA proof solely from the user's enrollment flag.

## B2 — Reject historical as well as new trusted-device bypasses (R02)

`trustDeviceMaxAge:0` only changes new issuance. Enforce the required fresh challenge even with a retained valid historical trusted-device cookie and its unexpired verification record. Use provider-supported policy/invalidation integration; retain mandatory MFA and closed registration. Do not weaken the requirement to a 30-day exception or remove verification only in the test.

Acceptance must create the historical fixture with the actual pinned provider's prior supported 30-day setting, complete real MFA with trust enabled, sign out, retain the resulting cookie, then exercise the **current** application sign-in. It must demand a fresh challenge and deny protected access until that challenge completes. Also cover a new `trustDevice:true` request. Explain existing-record/cookie invalidation semantics without exposing their material.

## B3 — Safe credential and session state when revocation fails (R04)

The current password update commits before a separate delete. Catching delete failure and returning 500 leaves the other session valid. Implement a transaction or an equivalent enforced invalidation/version design supported by the pinned stack. Define the failure/retry semantics: if credential change takes effect, pre-change other sessions must be unusable through every authenticated entry point even when physical cleanup fails; if the whole operation rolls back, prove both credentials and sessions are consistently unchanged. A response code alone is not acceptance.

Use two real cookie contexts and PostgreSQL failure injection during required revocation. Assert the effective credential state and the second session's protected/provider access after the failure. Cover omitted and explicitly false client revocation flags, ordinary success and retry/recovery. Do not special-case injected tests or add a client opt-out.

## B4 — Proof-gated, resumable one-owner setup (R06/R10)

Every new owner reservation starts pending. Remove the public `verified` input and the `pending`/Arabic-name/email heuristics. Only successful authenticator possession proof transitions verification and durable closure. Normal display labels must have identical security semantics. Preserve the fresh-race one-owner guarantee and closure after owner removal; never reopen public sign-up or create another owner to recover a pending one.

Provide a controlled authenticated continuation of the existing pending reservation after invalid code, missing code, interruption and process restart. Define how it identifies/authenticates the pending setup, delivers enrollment/recovery material through an intentional protected setup channel, limits attempts, and prevents normal actor privileges until completion. A protected settings banner unreachable by a pending actor is not a completion route. Reconcile CLI and functional Arabic UI so the documented journey can actually finish; preserve the existing visual style.

Acceptance includes ordinary name/email with no proof remaining pending/unclosed; explicit caller attempts to force verification failing; valid/invalid proof; interrupted actual CLI followed by correct-code retry; restart; reachable functional setup/login/recovery/logout; fresh concurrent reservations; durable closure after removal. Never solve retry by clearing the singleton, deleting the owner or adding an unauthenticated reset backdoor.

Keep noninteractive output free of passwords/seeds/recovery material. Demonstrate real non-echoing interactive input in a synthetic terminal capture; source inspection is insufficient. Redact the evidence itself and describe deliberate safe enrollment/recovery delivery. Mark unavailable terminal checks NOT RUN.

## C — Evidence that exercises the delivered behavior (R08/R10)

Keep hosted CI green with distinct original operational/test URLs. Use actual pinned migration tooling on an owned empty database and a supported nonempty T02 fixture with retained synthetic sentinel data. Document and execute any supported baseline against its actual prior schema. Do not claim raw split SQL, swallowed errors, manual ALTERs, reset, or blindly resolving an unexecuted authentication migration proves upgrade. Draft T03 migrations may be consolidated before first integration when the supported baseline and treatment of old draft fixtures are explicit.

Commit actual password → challenge → code independently derived from the issued URI → protected-access coverage. Commit actual recovery consumption and rejected replay across fresh challenges. Remove or accurately relabel helper-to-helper, direct-session-insert and in-memory-filter assertions that currently claim these protocol guarantees. Direct fixtures remain suitable for unrelated session-policy setup; do not mistake fixture construction for successful authentication.

Preserve R09's real PostgreSQL atomic attempt reservation: eight concurrent wrong attempts enforce the intended bound and lock, with correct-password/expiry behavior. Preserve R01's key representation, R05's explicit secret, working logout, role denial, ordinary revocation, three viewport widths and measured 200% text scaling. Add coverage for the actual remaining defects rather than inflating counts with repeated helper checks.

Read/use Graphify locally on committed code-only snapshots. Verify each full SOURCE.json SHA, query changed boundaries, record truncation/coverage limitations, and inspect real source/tests. No uploads, provider keys, labeling, tool upgrades or external hooks. Graphify and native reports supplement independent acceptance.

Run clean install/generation, lint, typecheck, configured local and CI units, owned PostgreSQL integrations/migration/failure/concurrency checks, real browser journeys and a fresh attributable default build. Distinguish local test-only webpack evidence from hosted default build evidence. Run planning validators and regenerate derived copies. Remove only verified run-owned temporary resources after checks; preserve owner resources/assets.

Save `docs/reviews/T03-submission-round3.md`. Include separate R01–R10 behavior/committed-test/evidence dispositions, exact commands/exits, failure and successful observations, migration procedure, NOT RUN limitations, native IDs/profile hashes and reconciliation, Graphify provenance, branch/upstream/base/frozen/final independently verified pushed SHAs and existing PR URL. Use actual current values, not a placeholder or a guessed self-referential report SHA. Prior submissions remain historical; correct inaccurate claims in this new report.

Push coherent updates to the same branch/PR and stop for Codex review. No self-approval, automatic merge, deployment, real-data use or T04.
