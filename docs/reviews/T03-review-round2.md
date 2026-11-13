# T03 — Independent review of correction round 1

Decision: **CHANGES_REQUESTED**. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. No main merge, T04, deployment or real data. Review completed 13 November 2026, Africa/Cairo; evidence spans the original and resumed review sessions. [Next correction assignment](T03-corrections-round2.md).

## Identity and review scope

- Branch/upstream: `feature/t03-identity-sessions` / `origin/feature/t03-identity-sessions`.
- Accepted integrated T02/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed review baseline: `b75aabeaffadd490ff40af5fc9c96873d824b2d2`.
- Phase A: `629195f6b4e0dc04c849549e958ea60f04777c8f`; Phase B implementation: `3504ffc009f369db3dfcf263ea61aa3030142b89`.
- Inspected and independently verified published head: `eb2199eef2fd5175072e13ecc1e6b50d4d0df6ac`.
- Fixed diff: `git diff b75aabeaffadd490ff40af5fc9c96873d824b2d2...eb2199eef2fd5175072e13ecc1e6b50d4d0df6ac` (25 files). The final submission commit adds only its report.
- Isolated review checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, branch `codex/t03-review`. Actual source/tests were inspected; the submission and native PASS verdicts were not treated as acceptance.

## Progress against the previous findings

| ID | Current conclusion |
|---|---|
| R01 — TOTP key representation | **Functional defect fixed.** An independently generated RFC 6238 code from the actual issued URI now receives 200 and grants the intended verified access. Persisting that complete regression remains part of R10 |
| R02 — Mandatory MFA/verified sessions | **Partial.** Disable returns 403 and an OWNER with disabled MFA is rejected. Cookie signatures are still stripped, and accepting `trustDevice:true` permits a later password-only login |
| R03 — Session expiry | **Partial.** Normal 31-minute-idle access is rejected with 401. A transient pre-handler read failure is swallowed and allows the library to revive the session |
| R04 — Password-change revocation | **Partial.** Normal-path second-device eviction works. A revocation database failure is swallowed while password change returns 200 and the second session remains usable |
| R05 — Public Auth-secret default | **Fixed.** The application requires the explicit secret; configured unit tests pass and the prior default is removed |
| R06 — Bootstrap | **Partial.** A fresh two-request race now creates one owner; durable closure survives owner removal. Setup still marks MFA verified and permanently closes before proof of authenticator possession; unattended CLI output exposes enrollment/recovery material |
| R07 — Test isolation/ownership | **Partial.** Validation precedes pool/server creation and fallback targets are removed. Cleanup still deletes unrelated matching users and every bootstrap marker |
| R08 — Reproducible setup/CI/migrations | **Partial.** Clean install generates Prisma, empty-database deployment works and the real CLI completes/rejects repetition. CI config is rejected by its own isolation guard; nonempty T02-fixture deployment fails P3005 without a supported baseline path |
| R09 — Recovery reauthentication | **Partial.** The operation moved behind the Identity Module and sequential lockout exists. Concurrent failed attempts lose increments and bypass its intended bound |
| R10 — Behavior/UI/evidence | **Open.** Browser coverage improved to ten journeys at three widths, but enrollment/logout UI and several actual negative workflows remain absent; viewport resizing is labeled as text zoom, and integration tests still substitute helper comparison/direct sessions/in-memory filtering for protocol proof |

## Standards

Fresh independent reviewer `/root/t03_r1_standards` (`Code Reviewer`) inspected the frozen diff and repository standards, with no edits/builds/servers/runtime tests. Its eight documented-standard findings are retained separately from Spec:

1. **P1 / R02 — Signature verification remains bypassed.** `src/modules/identity/require-actor.ts:24,60,77` strips signatures and authenticates the raw database token. R02 explicitly requires verified library sessions/cookies. Test unsigned and corrupted signatures against the public boundary.
2. **P1 / R03–R04 — Enforcement fails open.** `src/app/api/auth/[...all]/route.ts:67,105` swallows policy-query and forced-revocation errors. The documented inactivity/revocation requirements must hold on error paths, with observable sanitized failure.
3. **P1 / R09 — Throttling races.** `recovery-codes.ts:23,36,63–70` reads a count, verifies a password and overwrites a derived value. Concurrent requests can all pass the check and lose increments. Reserve bounded attempts atomically before verification.
4. **P1 / R08 — CI rejects its own URLs.** `.github/workflows/ci.yml:37–38` supplies identical operational/test targets, rejected at `env.ts:303–307`. Scope the migration target separately while preserving the original comparison pair.
5. **P2 / R07 — Cleanup exceeds ownership.** `tests/helpers/test-db.ts:58–75` matches broad email patterns; integration/E2E setup deletes all bootstrap rows. R07 requires owned fixture IDs/resources.
6. **P1 / R06 — Enrollment is declared complete before possession.** `provisioning.ts:180` writes `verified:true`, with no authenticator proof in the CLI. R06 requires confirmation before completion.
7. **P2 / R08 — Migration evidence bypasses migration tooling.** `auth-integration.test.ts:56–83` splits SQL, suppresses errors and performs ad hoc alterations. The testing requirements call for actual fresh/upgrade verification with preserved data.
8. **P1 / R06 — Secret-safe terminal input is not established.** The CLI retains normal readline output while printing asterisks (`provision-owner.ts:6–8,41`). This source-level concern requires a real TTY check; the parent did not observe typed-password disclosure and does not claim that asterisks alone establish safe masking.

No additional heuristic-only smell is asserted. The repository rules override generic heuristics.

## Spec

Fresh independent reviewer `/root/t03_r1_spec` (`Application Security Engineer`) inspected the same checkpoint and pinned library source, without edits/runtime tests. Its seven findings, with parent confirmation where noted, are:

1. **P1 / R02 — The required authentication boundary is incomplete.** `require-actor.ts:24,28,60` still strips signatures and derives session verification from account setup. This contradicts “Use verified library cookies/session mechanisms rather than stripping signatures.” The reviewer identified trusted-device reuse; the parent reproduced later password-only access below.
2. **P1 / R03–R04 — Errors bypass mandatory policy.** The route catches allow execution after validation failure and report success despite failed forced revocation, contrary to enforcement before refresh and password-change revocation.
3. **P1 / R06 — Setup closes without authenticator proof.** `provisioning.ts:180,185` verifies/closes immediately, contrary to “Confirm authenticator possession before treating enrollment as complete.” CLI output also sends enrollment/recovery material to ordinary stdout.
4. **P1 / R07 — Destructive cleanup is still not scoped.** Broad email matching and unconditional bootstrap deletion contradict “cleanup must remain scoped to owned data/resources.”
5. **P1 / R08 — Migration and CI acceptance remain incomplete.** The initial draft migration is edited while local fixtures have applied history; raw-SQL/error-suppression tests do not establish the supported migration path. Identical CI URLs are rejected. T03 is unmerged, so consolidating its draft migration is not itself forbidden; the concrete delivery gap is unproven preserved-data upgrade and red CI, not a blanket ban on editing an unaccepted draft.
6. **P2 / R09 — Parallel guesses escape the counter.** Read/verify/write lacks locking or equivalent atomic reservation. Sequential tests do not establish the required bound.
7. **P1 / R10 — Claimed behavior exceeds actual tests/UI.** `auth-integration.test.ts:267–327` compares helpers then creates a session directly; `:332–361` filters codes in memory. The submitted bootstrap race starts after closure. E2E uses a constant seed and resizes the viewport as “200% zoom”; enrollment/logout controls remain absent. R01's implementation now works, but these committed tests do not prove all claimed journeys.

Standards: 8 findings, highest P1. Spec: 7 findings, highest P1. Shared IDs express overlap; severity judgments are kept separate rather than merged into one ranking.

## Independent runtime observations

Actual auth route handlers received NextRequest objects and used real PostgreSQL. Policy failures were not inferred solely from source. [Sanitized observations](evidence/T03-round2-observations.json) contain no credentials, tokens, seeds or recovery codes.

| Scenario | Observed result |
|---|---|
| Actual issued URI → independently computed Node HMAC RFC 6238 → verify-totp | **200**, correct protected actor; 20-byte authenticator key. Confirms R01's implementation fix |
| Direct two-factor disable; normal 31-minute-idle request | **403** and **401** respectively. These ordinary paths are fixed |
| Corrupt the signature of a valid synthetic session cookie | Better Auth returns no session, but `requireActor` accepts the same request header. This is disagreement with the library's trust boundary, not a claim that an anonymous attacker can guess an unknown token |
| Complete MFA with `trustDevice:true`, sign out, then submit the password again with the retained device cookie | **200**, no new challenge, protected actor accepted. Conflicts with the required per-login verification and the screen's own promise |
| Inject one transient exception at the guard's Prisma read seam, keeping subsequent auth/persistence real; request get-session after 31 idle minutes | **200**, library refreshes, protected actor accepted. This is a controlled single-query fault, not a simulated successful authentication |
| Raise a real PostgreSQL trigger error when the revocation statement deletes the second session | Password change returns **200**; second session remains accepted. Trigger is removed after the owned test |
| Eight concurrent wrong recovery passwords | Eight rejected attempts, counter **1**, no lock. The intended bound is not enforced under concurrency |
| Run cleanup against an unrelated sentinel user with `@example.com` | Sentinel count **1 → 0**. No operational database was involved |
| Run the submitted browser suite with an unrelated review owner's bootstrap marker present | Marker count becomes **0**, while that owner's record remains. Confirms global bootstrap cleanup exceeds fixture ownership |
| Fresh two-owner competition under controlled 500ms insert latency | **One** owner succeeds; after owner removal the marker stays closed and subsequent provisioning rejects. The earlier transaction race/permanent-closure behavior is fixed |
| Run actual `auth:provision-owner` without supplying any OTP proof | First invocation exits **0**, repetition exits **1**; MFA is already verified and bootstrap closed. Noninteractive stdout includes the TOTP seed and recovery codes, but not the supplied password. No interactive TTY masking result is claimed |
| Run migrate deploy on an empty owned database | **Exit 0**, initial migration applied |
| Run migrate deploy on a nonempty T02-shaped fixture with a synthetic sentinel and no Prisma migration history | **P3005**, sentinel retained. No destructive reset or blind migration resolve was used to hide the failure. A documented non-destructive baseline path is still needed for that supported scenario |

## Checks, provenance and limits

| Check | Actual result |
|---|---|
| `npm.cmd ci` | Exit 0; root postinstall generates Prisma successfully. No manual generation was needed this round |
| Typecheck and lint | Exit 0 |
| Units with explicit synthetic Auth secret, locally and `CI=true` | Both exit 0; **53/53** each. An earlier unconfigured run had 50 passes/3 failures because the now-required secret was absent; it is not counted as a configured pass or as evidence against removing the default |
| Submitted integration suite with explicit isolated target and test-only fresh webpack startup build | Exit 0; **29/29** |
| Submitted browser suite, validated review-only target/server on port 14582, no reuse and no retries | Exit 0; **30/30** (ten journeys × three widths). The tests' “200% zoom” name describes viewport simulation, not measured text scaling |
| Policy/fault, CLI/migration and fresh bootstrap reproductions | Recorded above. A reproduction exiting 0 means it observed its declared outcome; it does not approve defective behavior |
| Both planning validators and regeneration | Pass; no material maintained-source drift reproduced locally |
| [Hosted application CI 43115429167](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43115429167), job `130842065780` | **Failure** at integration. Install, browser install, generation, deployment, lint, typecheck and units pass. Identical URLs trigger the guard; 11 tests pass, 1 fails, 17 skip across three failed files. Production build and E2E are skipped |
| [Hosted planning validation 43115429119](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43115429119) | Success |

The earlier standalone default production-build claim was not independently rerun as part of this review. Local HTTP/browser verification uses the fresh webpack build created by the startup suite and test-mode settings; it is not labeled a default Turbopack/production-cookie verification. Actual 200% text scaling, a separate rendered accessibility audit and real TTY password masking are NOT RUN. These limits are not converted into passes.

The owned tmpfs PostgreSQL container was `lawoffice-codex-t03-r1`, full ID `281f21f2eb4c233c8b2fffeb1dc6658f57b926264423569ee1df97f31a52ce1e`, label `lawoffice.review=t03-round2`, bound only to loopback port 14581. Its additional test databases were created inside that same resource. All fixtures/secrets were synthetic. The owner's existing port-5433 container was not touched. Before cleanup, the exact ID/label were reverified; only that container was stopped, automatic removal was confirmed, and review server port 14582 had no listener.

Native execution is corroborated through the existing distinct lead/AppSec/testing conversations (`57627653-7e9f-40c7-84d1-cfa2cbc52dae`, `5dc5685d-a8d4-4883-8e4a-170a418a6cd8`, `ea21af02-f1ae-43b8-a64b-2bb7b968ec54`), returned Phase A/B reports and command-result records. Their support reports identify `3504ffc...`; they are not relabeled as reviewing the later report commit. Actual execution does not make their PASS judgments independent acceptance.

Original Graphify manifest records `3504ffc009f369db3dfcf263ea61aa3030142b89`. Codex rebuilt a local code-only/no-label snapshot from full published `eb2199e...` at `work/graphify/eb2199eef2fd-57d4a1b4/`, verified SOURCE.json, and queried `regenerateRecoveryCodes`. Metrics: 215 nodes, 473 edges, 10 communities. The bounded query was truncated and used only for navigation. Real source, pinned library and runtime checks establish the findings.

Local logs and scripts are ignored under `work/t03-r1-*`; sanitized observations are committed with this report. The previously deferred fresh-race check was initially prevented by an automatic approval usage-limit error; after the owner resumed and approval review became available, it actually ran and passed. No blocked action was silently treated as executed.

This review publication changes planning/review documentation and derived copies only. Application implementation remains Gemini's assignment. T03 stays CHANGES_REQUESTED until the new correction is independently reviewed; T04 stays unreleased.
