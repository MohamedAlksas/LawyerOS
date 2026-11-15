# T03 — Independent Codex review, round 13

15 November 2026, Africa/Cairo. **CHANGES_REQUESTED**. Review only: no application, schema, configuration, or committed test changes; no commit, push, merge, deployment, or real client data. This report does not authorize T04. PR #8 remains draft/open/unmerged.

## Scope and provenance

- Branch/upstream: `feature/t03-identity-sessions` / `origin/feature/t03-identity-sessions`.
- Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Accepted T02/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Assignment: `05f4460fe58d262d03433ce667dc8ff935495783`.
- Frozen implementation reviewed: `d8e950d9afd735fc8fb4dce430681a5afaaafdd6`.
- Submitted local HEAD and independently verified GitHub PR head: `08e3b6e699450fcfbca39ec3bae47b8250407572`. The pasted narrative gives inconsistent full hashes; these are the actual local/GitHub values.
- Fixed diff: `git diff 05f4460fe58d262d03433ce667dc8ff935495783...d8e950d9afd735fc8fb4dce430681a5afaaafdd6`, eleven files. The intervening `d8e950d..08e3b6e` diff contains only `docs/reviews/T03-submission-round12.md`.
- Restricted fetch failed to write FETCH_HEAD and direct remote inspection failed DNS; the connected GitHub PR metadata independently supplied the actual head, base and draft/unmerged state.

Read project/core documents, the round12 correction card and prior review, protocol/workflow, relevant security requirements, installed provider code, and exact project skills `.agents/skills/graphify/SKILL.md`, `.agents/skills/lawoffice-testing/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, `.agents/skills/lawoffice-arabic-ui/SKILL.md`. Two fresh read-only review children examined separate axes below. These are Codex reviews, not substitutes for the implementer's native Antigravity execution evidence. Parent runtime results are identified separately.

## Standards

Reviewer `/root/r12_standards`, Code Reviewer. Source/document/profile inspection; runtime NOT RUN.

1. **P1 — False migration recovery approval.** `src/cli/baseline-identity.ts:1124–1136` accepts an existing 49-column schema without checking the new trigger/functions, then `1219–1221` resolves the forward migration without executing it. The previous round's schema has version columns but no new triggers. R12-02 requires unsupported states to fail before false completed history. This can certify a database missing atomic password/version invalidation.
2. **P2 — Committed-response browser scenario remains untested.** `tests/e2e/auth-round11-browser.spec.ts:269–307` waits before `route.continue()`, delaying the outgoing request. It never observes backend commit/response completion; a fixed600ms sleep can pass without the required event. R12-05 requires actual request/commit assertions, late expected errors and navigation coverage.
3. **P2 — Paste/leading-zero claim exceeds coverage.** Same file `207–243` labels DOM assignment and synthetic input/change events genuine clipboard paste. The fixed leading-zero strings are never authenticated; the successful genuine TOTP has no guaranteed leading zero. R12-05 requires actual paste and genuine leading-zero authentication.
4. **P2 — Search-path matrix changes an unrelated connection.** `tests/integration/auth-integration.test.ts:3233–3273` changes a fresh pg.Client, then queries the existing Prisma singleton. R12-03 requires new application/baseline connections under ambient and isolated role/database defaults.
5. **P2 — Acceptance evidence remains incomplete.** Submission `41–47` supplies IDs/PASS without actual returned artifacts/runtime aliases or a durable-log limitation, contrary to `docs/AGENCY_AGENTS.md`. Required webpack evidence is also absent. Full hashes match installed files, but cannot establish runtime execution.
6. **P2 — Canonical role documentation contradicts implementation.** `docs/DEPENDENCIES.md:212` claims OWNER/LAWYER/STAFF/ACCOUNTANT; approved SQL/verifier retain OWNER/MAINTAINER. Correct the documented contract.

No additional smell finding warrants scope expansion. Original migration restoration and all ten definition/profile hashes are credited. **Standards: six findings, highest P1.**

## Spec

Reviewer `/root/r12_spec`, Application Security Engineer. Source/provider inspection; runtime NOT RUN.

1. **P1 — Required postcheck failures remain swallowed.** R12-01: missing/unreadable/unpersisted proof state must deny authorization. `src/app/api/auth/[...all]/route.ts:661–702` catches post-MFA lookup/stamp failures and returns the successful provider response/cookie. The code still stamps the current version and backdates creation time. An end-to-end observer is needed for the proposed final-issuance race; this reviewer did not execute it.
2. **P1 — Sign-in pre-read failure loses the proved credential version.** R12-01 forbids a pre-read/best-effort post-handler guarantee. Route `260–264` suppresses the version read error; `450–452` substitutes the version after authentication. Holding old-password authentication across rotation can therefore assign the current version to old proof. Parent independently reproduced this below.
3. **P2 — Search-path evidence misses the specified connection boundary.** R12-03 requires ambient PGOPTIONS and isolated role/database defaults with newly created app/baseline connections. Test `3246–3267` changes a separate pg client while querying the existing Prisma singleton; no role/database-default matrix was found.
4. **P2 — Managed-history/retained-MFA upgrade evidence is incomplete.** R12-02 requires actual prior history, retained credential/MFA/session data, public baseline/deploy and successful login. New upgrade coverage `tests/integration/migration-upgrade.test.ts:844–975` covers unmanaged SQL with dummy password/session rows, without the retained MFA/proof and prior-managed-history/login matrix. Current initial SQL does match the historical SQL, which is credited.

The new atomic password-update trigger is credited; the old first-increment rollback defect must not be reported as unchanged. **Spec: four findings, highest P1.**

## Parent-confirmed findings and suggested fixes

### R13-01 / P1 — A failed version pre-read can authorize old-password proof after rotation

Locations: `src/app/api/auth/[...all]/route.ts:257–264,450–452`; related suppressed final checks at `700–702`.

Real PostgreSQL, genuine provision/confirmation/provider login and MFA, no mocked persistence:

1. Authenticate session A. Use a temporary restricted application role and RLS policy to raise a database exception specifically for the initial version-by-email SELECT, while ordinary provider user/password reads remain available. A direct call confirms this required read throws.
2. Start B with the old password. Observe its database advisory-lock waiter at a temporary session-insert barrier after password validation.
3. A changes the password and receives200. Release B.
4. B receives a challenge200, completes genuine TOTP200, and the actual issued session Cookie passes `requireActor`. Stored user and issued session both have version3: the fallback has relabeled old proof as current.

This is a controlled required-state-read failure combined with the assigned concurrency scenario; it is not a claim of ordinary no-fault exploitation. It directly violates R12-01's fail-closed requirement. The later explicit proof-version check cannot help when the earlier version has been replaced with a new one.

Fix: treat a failed required version capture as authentication failure, never reconstruct the proved version after authentication. Bind authoritative proof/version issuance and consumption to a supported pinned-provider/DB contract across processes. Remove best-effort final security checks and test each required read/write failure with actual issued cookies. Preserve normal new-password MFA and replacement sessions. Do not use timestamp backdating or guessed cookie identifiers as the guarantee.

Evidence: ignored `work/t03-r13-review/observer.test.ts`; strengthened selected run `pre-read-final.log`; sanitized `pre-read-observation.json`. Selected rerun: exit0,1 pass/4 explicitly skipped. It verifies the fault, observed barrier, statuses, stored versions and actual protected access.

### R13-02 / P1 — Baseline records completed security migration without its triggers

Locations: `src/cli/baseline-identity.ts:1124–1136,1219–1221`; verifier returns at `951–954` without trigger/function inspection.

In a canonical disposable schema with a retained genuine synthetic owner, remove only the two newly required triggers/functions and call actual `runIdentityBaseline`. Observed success, two completed migration-history rows, zero required security triggers, owner retained. The same physical shape can arise from the prior round's version-column schema or incomplete upgrade. Prisma is told the forward migration is applied and will not install its missing protection.

Fix: verify required trigger identity, enabled state, table/event/timing, function namespace/body and relevant configuration before recording or accepting completed history. Distinguish supported upgrade from recovery and unsupported drift; apply the forward migration only under an explicit safe contract. Add missing/disabled/altered-trigger and false-history tests at the public baseline entry point, including the already-completed path and actual managed-history checksums.

### R13-03 / P1 — Security triggers resolve tables through ambient search_path

Locations: `prisma/migrations/20261114000000_credential_version/migration.sql:7–13,25–49`.

The functions refer to unqualified user/session/verification tables and do not set a safe function search_path. On a fresh actual application pool under `PGOPTIONS=-c search_path=review_decoy,public`, with a decoy user table containing the same ID/version999, Prisma correctly reads public user version1, but inserting a public session stores version999 via the trigger. This is an actual new application connection, not the unrelated client used by the committed matrix.

The password trigger has the same unqualified-resolution design, so its claimed atomic public-state guarantee also depends on ambient namespace. The observer directly executed session stamping; a full password/decoy matrix was not executed. This is a configuration/schema-isolation failure, not evidence of arbitrary remote SQL execution.

Fix: qualify every application table/function reference to the intended schema and set a conservative function search_path. Test the full authentication/rotation contract using new application and baseline connections under PGOPTIONS plus isolated role/database defaults. Correct the current matrix to affect the connection actually exercised.

### R13-04 / P2 — A second transaction can report failure after password mutation commits

Locations: `src/app/api/auth/[...all]/route.ts:591–620` and new password-update trigger.

Fault only user-version increments reaching3: provider/trigger rotation from1 to2 succeeds, then the wrapper's separate increment from2 to3 fails. Observed password-change500, user version2 persisted, new password accepted, original session revoked, and successful replacement cookie omitted from the returned error response. This is distinct from the repaired first-trigger failure, which now rolls back the password statement.

Fix: use one authoritative rotation boundary, or define and expose coherent partial-success/recovery semantics. Do not present a committed password change as a generic failed update while discarding its replacement session. Verify second increment, session stamp, eviction and postcondition failures as well as the first-trigger rollback. Old-proof rejection in this particular partial outcome is credited; this observation does not claim old sessions remained usable.

### R13-05 / P2 — Green regression counts do not establish the assigned browser/schema evidence

Locations: `tests/e2e/auth-round11-browser.spec.ts:207–243,269–307,365–386`; `tests/integration/auth-integration.test.ts:3246–3267`; submission evidence.

Fix the outgoing-request barrier into an observed committed-response barrier; assert backend commit, response completion, dismissal/reopen, late success/error, retry and navigation independently. Use actual clipboard paste and deterministic valid leading-zero TOTP authentication in each numeral system. Test200% text in the affected security dialog/error/success states: the current text-scaling section navigates to login. Complete actual managed-upgrade, namespace/connection and production HTTP provider/interception matrices. Keep exact native returned results/artifact references, or disclose unavailable durable export; missing references do not alone prove fabrication. Correct the role list at `docs/DEPENDENCIES.md:212`.

## Actual verification and credited improvements

| Check | Observed result |
|---|---|
| `npm.cmd test` | Exit0,140/140 unit tests,9 files |
| `npm.cmd run typecheck`; `npm.cmd run lint` | Exit0 each |
| Full integration, isolated PostgreSQL | Exit1:71 passed,3 skipped because startup suite's fresh Turbopack build panicked in CSS/PostCSS subprocess startup. No failing auth/migration/readiness assertion in the final run. Cause not established as a product regression. |
| Five focused PostgreSQL observers/control | Exit0,5/5. They deliberately assert observed defects/one repair and are not acceptance tests. |
| Strengthened selected credential-fault observer | Exit0,1/1 selected;4 skipped explicitly, unchanged observers not repeated |
| Hosted CI43697371811, job132760796246 | Success on merge candidate `55a69658a16d03f44e9202a266dd22e5cf7990d3`, containing submitted08e3b6e into accepted main. Actual logs:140unit/74integration/default build/45E2E pass. |
| Hosted planning43697371809 | Success |
| `git diff --check` before report | Exit0 |

Initial restricted local database runs failed EACCES; subsequent allowed local database access supplied the final results above. Initial connection failures are environment failures, not authentication findings. Hosted browser results belong to CI; no fresh local browser rendering, screen-reader, physical-device, webpack build or production HTTP Origin matrix is claimed.

Credited: exact original initial-migration restoration, additive forward SQL, default index collation/opclass/options checks, missing-companion rejection and genuine companion-insert failure cleanup, protected-actor version mismatch enforcement, first-trigger password rollback, complete inferred Origin comparison in the null-Origin branch, expanded focus/Persian/reflow coverage and all earlier valid repairs. Improvements do not close the remaining identified fault boundaries.

## Graph provenance, resources and review boundary

Verified existing local code-only graph `work/graphify/d8e950d9afd7-ff3bf33f/SOURCE.json`: sourceCommit matches full frozen implementation; SHA-256 `74f0a55b099c99c6cc7c7a0dd7b07b90e041095ab0b71657a7951c89ef28a74e`. Actual `setSessionCredentialVersion` query at budget500 found28 nodes, displayed16 with explicit truncation. Graph has278 nodes; root configuration/migrations and working edits remain outside its coverage. Actual source/provider/tests were inspected. No upload, semantic extraction, tooling upgrade or keys.

Diagnostics/logs/config remain under ignored `work/`; only this review report is added to canonical documentation. No task card, product source, migration, committed test, branch or remote was changed. Owner-installed tracked/untracked agent assets and existing PostgreSQL container2528fb994d14/port5433 are preserved. Tests used dedicated owned fixture databases inside review container `lawoffice-codex-t03-r13`, ID `644d9a52b4ef1d479cc040ced8aaf41985bca52e17ee1de39ac995eb207afde0`, label `lawoffice.review=t03-round13`, port14764. Final catalog inspection found only the base test database and zero dedicated fixture databases. After exact ID/label/port verification, the review container and its disposable volume were stopped/removed; the original owner container remains running.

**Recommendation:** retain CHANGES_REQUESTED. R12-01/R12-02 and search-path safety remain blocking; R12-03/R12-04 contain useful partial repairs, while the full assigned evidence remains incomplete. No acceptance or merge is granted.
