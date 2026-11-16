# T03 — Independent Codex review, round 12

14 November 2026, Africa/Cairo. **CHANGES_REQUESTED**. Review of the Round 11 submission. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft; no merge, T04, deployment or real data. Codex changed review/planning documentation and ignored diagnostic files only.

## Checkpoints and scope

- Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`; branch/upstream: `feature/t03-identity-sessions` / `origin/feature/t03-identity-sessions`.
- Accepted T02/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed assignment: `f2b53f9256a1d04b7d18c8b2e0699128b14b5f85`.
- Frozen implementation: `a4a14d9483e84e5bcadac7cd491d22d4f7fd76d8`.
- Submitted local and independently verified GitHub head: `fc6d0463c96ba4f11e4ea8bb17e926dc7ab38d6c`. GitHub connector confirms draft/open/unmerged, same base/head. Initial restricted `git ls-remote` failed DNS; connector metadata provided independent remote verification.
- Fixed implementation diff: `git diff f2b53f9256a1d04b7d18c8b2e0699128b14b5f85...a4a14d9483e84e5bcadac7cd491d22d4f7fd76d8`, twelve files. `a4a14d9..fc6d046` changes only `docs/reviews/T03-submission-round11.md`.

Two distinct fresh read-only Codex reviewers inspected the fixed diff. These are independent review sessions, not replacements for the implementer's required Antigravity children. Runtime results below belong to the parent unless explicitly attributed.

## Standards

Reviewer `/root/r11_standards`, Code Reviewer. Runtime NOT RUN. Actual source, tests, standards and Graphify provenance inspected.

1. **P1 — Prior canonical identity schema has no non-destructive upgrade.** The change adds `credentialVersion` by rewriting the original migration (`prisma/migrations/20261111000000_init_auth/migration.sql:15,30`), without a forward migration. Baseline now requires both columns (`src/cli/baseline-identity.ts:358,370`). An already-applied migration will not be replayed by deploy; the prior canonical schema is rejected by baseline. This violates the round11 requirement that approved prior schemas remain supported and the migration verification rule in `docs/REVIEW_PROTOCOL.md`.
2. **P2 — Required real PostgreSQL coverage is partial.** New integration coverage tests the domain reproduction and ambient PGOPTIONS, while mocked catalog rows cover additional properties. There are no actual role/database default search-path cases or complete real index/type-namespace controls. Complete-resolution claims exceed that evidence.

No additional actionable Fowler smell finding; conservative explicit catalog specification is reasonable. **Standards: two findings, highest P1.**

## Spec

Reviewer `/root/r11_spec`, Application Security Engineer. Runtime NOT RUN. Source and pinned-provider inspection only.

1. **P1 — R11-01 still suppresses authoritative-state failures.** `credential-version.ts:16–17,32–33` converts read failure to version1, `69–70` suppresses session stamping failure, and `132–133` treats verification failure as no mismatch. `route.ts:306–309` accepts missing companion state; `404–415,451–453,616–618` suppress persistence/postcondition failures. `606–611` retains expressly forbidden session backdating. The spec forbids swallowed checks and guessed raw-cookie identifiers.
2. **P1 — Credential rotation and protected authorization remain incomplete.** Provider mutation completes at `route.ts:368`; the application version/revocation transaction is later at `507–528`. A returned500 cannot roll back the provider's committed password mutation. `require-actor.ts:124–138` still checks only timestamps, with no credential-version validation, contrary to the requirement to coordinate rotation and protected actor checks.
3. **P1 — Null-Origin behavior still diverges.** `route.ts:170–180` compares Host only; the pinned provider validates the full inferred origin. Matching Host with an untrusted request scheme/destination can pass the wrapper while failing configured provider trust. The spec requires configured-trust validation after null inference.
4. **P2 — Browser and regression claims remain incomplete.** The test named “committed generation response held” (`auth-round11-browser.spec.ts:217–241`) never submits or holds a request. The OTP journey exercises Arabic-Indic only, without Persian, deterministic leading zero or actual paste. Login overflow checks contain no focus/200% assertions. The new integration race covers only pre-challenge TOTP; its protected-access assertion passes response headers rather than an authenticated Cookie. Search-path coverage uses an existing Prisma singleton and does not configure role/database defaults.

No unrelated feature expansion found. **Spec: four findings, highest P1.** The two axes remain distinct; parent findings below add runtime evidence rather than rewriting their reports.

## Parent-confirmed findings

### R12-01 / P1 — Credential-proof failures can still authorize stale proof

Locations: `src/modules/identity/credential-version.ts:7–135`; `src/app/api/auth/[...all]/route.ts:306–309,404–415,507–537,578–618`; `src/modules/identity/require-actor.ts:124–138`.

Real PostgreSQL, genuine provisioning/confirmation and provider sign-in/MFA, no mocked persistence:

1. Authenticate synthetic session A. Install a temporary session-insert advisory-lock barrier gated only on B's distinctive User-Agent. Install a temporary verification-insert trigger that rejects only companion `2fa-cred-ver-%` records, modeling postcondition persistence failure.
2. Start B with the old password; observe its real advisory-lock waiter after password verification. Change the password through A; rotation commits200. Release B.
3. B returns200 despite failed companion persistence. Stored companion count is zero. B's valid TOTP returns200 and its actual issued Cookie passes `requireActor`.

This closes the evidentiary distinction from the prior round: the ordinary pre-challenge race now rejects stale proof when metadata persistence succeeds (credited by the committed integration test), but a failed security-state write is swallowed and missing state is accepted. The required failure case remains exploitable.

Two separate real-database observations confirm related boundaries:

- A trigger rejecting the user version increment causes change-password500, but the version remains1 and the **new** password is accepted. Provider password mutation already committed. Returning500 is not credential rollback or coherent revocation evidence.
- After a genuine login, change only `user.credentialVersion` to2, leaving session1. Calling actual `requireActor` with its Cookie still succeeds. This deliberately creates the mismatched state to test the protected interface; it is not claimed as a separate natural race reproduction.

Expected: authoritative proof state must be required, errors must deny access, credential mutation and revocation need a coordinated failure contract, and every protected entry point must enforce that state. Preserve replacement-session and fresh-login behavior. No raw-cookie guessing, best-effort stamps or backdating as the security guarantee.

### R12-02 / P1 — Retained prior-T03 schema cannot upgrade

Locations: `prisma/migrations/20261111000000_init_auth/migration.sql:15,30`; `src/cli/baseline-identity.ts:358,370`.

Install the actual migration SQL from assignment commit `f2b53f9` into a disposable database and retain a synthetic owner row. Run the **current public** `runIdentityBaseline`. It rejects the missing `credentialVersion` columns and retains the row. No forward migration exists in the submitted tree. The parent ran this unbaselined prior-schema path; the already-managed deploy omission is source-confirmed, not separately executed here. Rewriting a previously applied initial migration is insufficient for either supported prior-state contract. Provide a readable additive migration/version-aware baseline with retained-data tests, without resets or history falsification.

### R12-03 / P1 — Baseline approves an index with different uniqueness semantics

Location: `src/cli/baseline-identity.ts:709–781,800–890`.

In an actual canonical disposable schema with a retained owner, create ICU collation `public.review_casefold` (`provider=icu`, `locale='und-u-ks-level2'`, `deterministic=false`), replace `user_email_key` with a unique index on `email COLLATE public.review_casefold`, then run the actual verifier and public baseline.

Observed: `equivalent=true`, baseline success, one completed migration-history row, retained owner still present. Inserting its uppercase email variant fails with PostgreSQL23505 under the unapproved case-insensitive index. Canonical text uniqueness has different comparison semantics. No type/column changed. The verifier queries the full index definition but does not validate its operator class/collation; the per-column `pg_get_indexdef` result does not establish these properties. An earlier diagnostic using explicit `COLLATE "C"` also returned equivalent=true; its expected-rejection assertion failed, revealing the gap. The stronger ICU reproduction confirms a material write-semantic difference and actual false history approval.

Expected: reject unsupported catalog collation/operator-class/options before history creation or recovery. Test actual public baseline outcomes and retained data. Do not infer exact semantics from column labels alone.

### R12-04 / P1 — Null-Origin uses Host-only trust

Location: `src/app/api/auth/[...all]/route.ts:170–180`; pinned provider `node_modules/better-auth/dist/api/middlewares/origin-check.mjs:109–119` and `utils/url.mjs:75–101`.

Genuine owner cookies, JSON provider control, explicitly enabled provider Origin checks (`advanced.disableOriginCheck=false`; test-default skipping is not used for this probe): request URL `https://untrusted.invalid`, Origin `null`, Fetch Metadata `same-origin`, Host equal to the configured trusted `127.0.0.1:3100`.

Observed: provider `/two-factor/get-totp-uri` returns403; intercepted `/two-factor/generate-backup-codes` returns400 for the same wrong password and persists one reauthentication failure. The wrapper grants trust based on Host without validating the full inferred origin. The parent exercised actual route/provider functions with production Origin enforcement, **not a fresh production HTTP server**, and does not claim every contradictory header/URL combination is browser-generatable. Final repair still needs the production-server parity matrix required by the assignment.

Expected: one supported configured provider contract; request headers must not create trust or bypass full origin validation. Ordinary untrusted/missing-Origin rejections are credited and must remain.

### R12-05 / P2 — Required browser, matrix and native-result evidence remains missing

Locations: `tests/e2e/auth-round11-browser.spec.ts:199–262`; `tests/integration/auth-integration.test.ts:3024,3075–3136`; `docs/reviews/T03-submission-round11.md:18–26,40–45,92–112`.

The committed modal test opens, fills, dismisses and reopens without submitting; it cannot prove a late committed response is suppressed. The OTP test does not enter Persian digits or force leading zeroes, and the responsive test checks login overflow without keyboard/focus/200% text. This is missing committed evidence, not a newly demonstrated frontend defect; prior parent-confirmed UI repairs remain credited. The new race's `requireActor({headers: finishBRes.headers})` assertion has no request Cookie, so rejection does not establish the absence of a usable issued session.

Full hashes are now supplied, but the submission still gives aggregate PASS statements without actual returned audit artifact/tool/UI references or an explicit durable-log limitation. The pasted timeline ends with AppSec still awaited; it does not independently establish its eventual result. Missing references do not prove fabrication. Require attributable current returned results, and disclose unavailable evidence honestly. Broad WCAG/zero-vulnerability claims are not justified by the committed tests or a narrow pass.

## Actual checks and credited repairs

| Check | Actual result |
|---|---|
| `npm test` | Exit0,137/137 units, nine files |
| `npm run typecheck`; `npm run lint` | Exit0 each |
| `npm run test:integration`, isolated PostgreSQL | Exit1:67 passed/1 failed solely because readiness hardcodes `lawoffice_test`/`lawoffice_user`, while the isolated target initially used different synthetic names |
| Readiness-only rerun with expected names inside owned container | Exit0,4/4. Other67 unchanged tests were not rerun; full auth/migration/startup suites in the first run passed |
| Six focused parent defect observers | Final first batch exit0,6/6; passing observers assert defects and are not product acceptance |
| Stronger ICU/public-baseline observer | Exit0,1 selected pass/5 explicitly skipped; confirms false history approval and23505. No unchanged broad suite repeated |
| Hosted CI43618005197, job132517199456 | Success on merge candidate `34b9f3d0db7161ea5a7807576bc173d7d30828c0`, containing submitted `fc6d046` into accepted main: clean install/generation/migrations/lint/typecheck,137unit/68integration/default build/45E2E pass |
| Hosted planning43618005158 | Success |

The actual existing plus new hosted browser suite is45 tests; the new file contributes15 (five cases across three projects). These green counts do not prove omitted journeys or fault cases. The original pre-challenge race, constrained-domain rejection, added index access/readiness/included/null-distinctness checks, ordinary untrusted/missing Origin rejection and exact128-character login/MFA are useful repairs. Preserve previous OTP/parser/page-export/dialog/fixture/TLS/shared-lockout work.

No fresh local build, browser execution, screen reader, physical device, TTY, deployment or real-data trial is claimed in this review. Hosted build/browser results are attributed to CI, not parent rendering. Diagnostic source/config/logs stay under ignored `work/t03-r12-review/`; sanitized observations are committed in `docs/reviews/evidence/T03-round12-observations.json`. Initial docker access was denied in the restricted environment; approved container access succeeded. No product test assertion or limiter was weakened.

## Graph, assets and cleanup

Verified `work/graphify/a4a14d9483e8-22c1f056/SOURCE.json` sourceCommit against full frozen SHA and SHA-256 `7dc2625066cb3e701e3b93298b53200024c995e1b26e0c8631baff96ca2bafcb`. Parent queried `isSessionCredentialVersionMismatched` at budget500:41 nodes found,16 shown, explicitly truncated; actual source/provider/tests inspected. Graph has277 nodes/661 edges and excludes migrations/root configuration and working edits. No upload, keys, labels, hook or upgrade.

All probes use disposable databases created through the project-owned fixture helper inside container `lawoffice-codex-t03-r12`, ID `42c9b1eba8dd71ea831e7a6b81660705edd2d730321e168c127ca399c91c75f7`, label `lawoffice.review=t03-round12`, port14763. Dedicated fixtures are dropped by owned teardown. Final verification found zero dedicated fixture databases; the verified review container and its anonymous volume were stopped/removed; pre-existing owner container `2528fb994d14`/port5433 and tracked/untracked agent assets are preserved. Review publication state is reported externally after committing to avoid self-referential SHA amendments.

## Planning validation

Final task-kit validation, installed Agency routing validation, prompt-index generation, planning-kit regeneration and `git diff --check` all pass. The first task-kit pass caught a missing literal ACCEPTED predecessor gate in the new card; the card now explicitly states the existing T02 acceptance. The unavailable WindowsApps Python launcher was replaced by Node for documentation assembly; no application source changed.

## Next assignment

[Complete round12 correction card](T03-corrections-round12.md), also embedded in `docs/tasks/T03.md`, contains all remaining repairs and acceptance checks. No application implementation was performed by Codex and no task is accepted by this review.
