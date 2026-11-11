# T03 — Correction round 1

Implement corrections to [the independent review](T03-review.md), not T04. Decision remains CHANGES_REQUESTED at submitted head `3faedd9c46c9c4dd2a4f5dbfe7e31b98b106b94b`. Read the review in full before editing. Preserve the existing implementation and native history; no reset/rewrite/cleanup of installed assets.

## Baseline and Git delivery

Use `https://github.com/MohamedAlksas/LawyerOS.git`, branch `feature/t03-identity-sessions`, existing draft PR https://github.com/MohamedAlksas/LawyerOS/pull/8. Fetch first, inspect local/remote differences, and safely integrate the Codex documentation-only review checkpoint on this branch. Never force-push, merge main, reimplement T02 or start T04. The T02 integrated base remains `e598c1649b82f34ea94338cda5ef25da32b5299f`. Preserve other agents' changes and use separate worktrees/resources for conflicting tests/builds.

Read AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md, docs/tasks/T03.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md and docs/AGENCY_AGENTS.md. Apply these exact project skills: `.agents/skills/lawoffice-delivery/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, `.agents/skills/lawoffice-testing/SKILL.md`, `.agents/skills/lawoffice-arabic-ui/SKILL.md`. Read the specific Identity/security/screens/dependency references from T03. Auth-only Playwright tooling remains explicitly authorized; T04 product scope remains excluded.

## Native routing and file ownership

The parent coordinates Git, checkpoints and evidence; actual children perform their assigned work. Use the documented bounded native preflight before dependent edits. Reading profiles or repeating their previous PASS results is insufficient. Missing native capability is BLOCKED_NATIVE_AGENTS. Do not fabricate IDs, alter the selected model, launch the whole roster or spawn nested agents.

Use the same three appropriate specialties, with this explicit Codex phase refinement:

| Phase | Implementation owner | Paths/responsibility | Independent support |
|---|---|---|---|
| A: prevent destructive test-target mistakes | `agency-test-automation-engineer` | Test setup/isolation in `tests/integration/auth-integration.test.ts`, `tests/e2e/auth.spec.ts`, `playwright.config.ts`, and minimal shared test setup | Identity engineer verifies shared-validator use; AppSec checks rejection before any connection/write |
| B: correct Identity behavior and usable setup | `agency-identity-access-engineer` | Auth configuration/routes/Module, environment boundary, provisioning, Prisma/config/migrations, login/verification/security UI, focused regression tests and minimal package/CI/docs wiring | AppSec audits bypasses/concurrency/secrets; testing specialist reviews and executes behavioral evidence |

Phase A freezes before Phase B; one named writer owns a file at a time. Explicitly hand off overlapping test files. Supports perform final read-only review on the frozen corrected checkpoint. Do not run destructive test setup or competing builds against the same resource concurrently.

Exact profile/native definition pairs:

- `.agents/skills/testing-test-automation-engineer/SKILL.md` / `.agents/agents/agency-test-automation-engineer.md`.
- `.agents/skills/engineering-identity-access-engineer/SKILL.md` / `.agents/agents/agency-identity-access-engineer.md`.
- `.agents/skills/security-appsec-engineer/SKILL.md` / `.agents/agents/agency-application-security-engineer.md`.

Use actual distinct native sessions, whether resumed with a new bounded assignment or newly invoked. Record phase, profile name/path/hash, actual invocation ID, permissions, owned paths and inspected SHA. Prior preflight IDs are historical evidence, not proof that the correction ran.

## Required corrections and acceptance

**R07 — Fix test safety first.** Before creating a Pool, connecting, applying migrations, deleting records or launching the E2E server, validate the original operational/test pair with the shared test-mode validator. Require the explicit isolated test target; no development fallback, overwritten comparison or arbitrary existing server reuse. Use only an owned disposable database. Demonstrate rejection of missing/dev/prod/same/equivalent targets before any connection/write, using connection-free evidence or owned synthetic fixtures. Preserve T02 safeguards. Test-data cleanup must remain scoped to owned data/resources.

**R01 — Repair real authenticator enrollment.** Use the pinned library's supported secret/enrollment/import representation so the issued URI and verifier use identical bytes. The current code Base32-encodes a 20-byte key but the server treats the 32-character text as UTF-8. Prove an independently derived RFC 6238 code from the actual issued URI succeeds through password → challenge → verify-totp → protected access. Do not merely call the same helper on the stored text or insert a session to stand in for verification. Test invalid/replayed codes according to the required policy.

**R02 — Enforce required MFA everywhere.** Direct library routes must not let an owner disable mandatory protection and continue with password-only access. Enforce enrollment/re-enrollment and challenge states server-side. Prove direct disable/bypass attempts cannot yield a fully authorized actor. `twoFactorEnabled=false` is not proof of completed MFA; account setup verification is not per-session verification. Use verified library cookies/session mechanisms rather than stripping signatures or inventing a parallel authentication protocol.

**R03 — Enforce session policy before library handlers refresh it.** All authenticated APIs and Server Actions must reject sessions beyond 30 idle minutes or 12 hours maximum age before updating activity/extending lifetime. Include `/api/auth/get-session`, sensitive library endpoints and protected application calls. Prove the rejected session cannot be revived by first visiting a library endpoint. Do not fake clock evidence through a mocked authorization guard.

**R04 — Force password-change revocation.** Other sessions must be invalidated server-side even when the request omits or sets a false optional revocation flag. Prove the second cookie/browser context loses both library API and protected-page access after password change.

**R05 — Remove the public secret default.** Require explicit runtime Auth secrets with sanitized errors. Production omission/invalid configuration must fail closed. Synthetic test values may be supplied explicitly by isolated test configuration; never restore a default in application validation to make tests pass. Update `.env.example`, documentation, startup tests and CI coherently without real secrets. Keep actual local/test/production behavior attributable.

**R06 — Make bootstrap permanent and race-safe.** Implement one durable, atomic first-owner completion boundary, with transaction/constraint/locking behavior that prevents concurrent distinct-email owners. Removing/demoting an owner must not silently reopen bootstrap. Confirm authenticator possession before treating enrollment as complete. Test concurrency, sequential retry, partial failure rollback and permanent closure on real PostgreSQL. Supply a controlled, secret-safe provisioning command; terminal display must not accidentally echo passwords or leak seeds/recovery codes into routine logs.

**R08 — Deliver reproducible setup and CI.** From `npm ci` in a clean checkout, generate the Prisma client explicitly before dependent checks. Supply the Prisma 7 datasource configuration needed by the documented migration command. Provide and actually test `auth:provision-owner`. Prove fresh migration and upgrade from the accepted T02 state with preserved synthetic sentinel data through migration tooling; do not substitute direct SQL plus swallowed errors or reset the database. Run auth E2E in scoped CI with its own isolated data, build and browser setup. Preserve stack/pins; do not change global install-script policy or apply broad package upgrades.

**R09 — Route recovery changes through the Identity Interface.** Enforce validated input, fresh reauthentication and bounded server-side attempt limits on the actual Server Action/API. Do not rely on throttling a different library endpoint. Prove a stolen session cannot make unbounded password guesses. Rotate/revoke affected credentials and sessions as required by the canonical policy, with appropriate Origin/cookie protection.

**R10 — Complete and report actual T03 behavior.** Provide the promised minimal secure enrollment/verification/recovery/logout/session interface; no T04 shell or business screens. Test actual TOTP, recovery replay, maintenance-role direct requests, security mutations, expiry, revocation, keyboard and 200% text behavior. The current 15 browser passes are five different journeys repeated across three widths, with no TOTP journey. Replace in-memory recovery-code filtering and direct session minting as substitutes for protocol evidence. Preserve original submissions, then add clearly labeled correction evidence with real command output, names/counts/versions, screenshots and NOT RUN limits. Remove unsupported QR, provisioning, migration and emergency-reset claims rather than inventing observations.

## Graphify, verification and publication

Read docs/GRAPHIFY.md and `.agents/skills/graphify/SKILL.md`. Query the committed corrected Identity/auth/test boundary and verify SOURCE.json's full SHA. Rebuild after relevant implementation changes. Keep extraction local/code-only/no-label, with no uploads/providers/hooks/upgrades. Graphify does not prove exhaustive coverage or replace native reviews/source/tests. Record truncation and missing symbols honestly.

Run lint, typecheck, local and explicit-CI unit tests, real isolated PostgreSQL integration/migration checks, real auth E2E with retries not masking failures, and the attributable production build. Preserve existing meaningful tests and record any test-only webpack selection separately from default Turbopack verification. Run both planning validators and prescribed regeneration; keep canonical/generated copies aligned. The Codex review checkpoint regenerates the stale AGENTS master-plan copy but does not fix application issues.

Freeze the implementation, obtain fresh support findings on that exact SHA, reconcile through the phase owner, then rerun affected checks if implementation changes. Save `docs/reviews/T03-submission-round1.md` with exact baseline/implementation/final/pushed SHAs, branch/upstream/PR, native evidence, dispositions for R01–R10, Graphify provenance, commands/exits, migrations/recovery and limitations. Push coherent updates to the same branch/PR. No self-approval, main merge, deployment, real data or T04. Stop for independent Codex review.
