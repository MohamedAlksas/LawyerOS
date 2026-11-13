# T03 — Independent Codex review, round 3

Decision: **CHANGES_REQUESTED**. Review date: 13 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. Execute [correction round 3](T03-corrections-round3.md) on the existing feature branch. No merge, T04, deployment or real client data.

## Checkpoints and method

- Origin: `https://github.com/MohamedAlksas/LawyerOS.git`; branch: `feature/t03-identity-sessions`.
- Accepted integrated predecessor/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Previous review publication/fixed point: `9ec5fd4c5ac0104b5757b4347031cece3c345bf4`.
- Test slice: `e9fe5157caf5d539a036295b036aa2a5fc3b1172`; frozen application: `b4d2c7c0e6636f0f5e23da61767ddb86778d26d6`.
- Independently verified submitted local/remote head: `cd60a6a0f66bcdf6554c9b986c5e058921ab8412`. Its final commit changes the submission report only.
- Fixed comparison: `git diff 9ec5fd4c5ac0104b5757b4347031cece3c345bf4...cd60a6a0f66bcdf6554c9b986c5e058921ab8412` — 12 files, 944 insertions, 193 deletions. Commits inspected: e9fe515, b4d2c7c, cd60a6a.
- Execution checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, local review branch `codex/t03-review`. The implementation checkout and owner-installed assets were preserved.

Two fresh independent contexts inspected the actual fixed diff and relevant source/library/specification. Their axes are retained separately below. Parent verification used actual auth route handlers, the pinned library, real PostgreSQL and the submitted browser suite. Passing tests do not negate independently reproduced failures.

## Standards

Reviewer `/root/t03_r2_standards` (`Code Reviewer`), read-only source review, no builds or runtime tests. Lightly normalized findings, with no additional heuristic-only smells:

1. **P1 / R02 — Custom authentication protocol remains.** `src/modules/identity/require-actor.ts:17–44,76–104` reimplements HMAC/cookie verification and retains a raw `sessionToken` path. The previous correction explicitly requires the pinned library's verified, non-refreshing session boundary. Use one supported verification path before application policy checks.
2. **P1 / R06 — Bootstrap verification depends on input labels.** `src/modules/identity/provisioning.ts:133–136,187` treats ordinary calls as verified and infers pending status from `pending`/Arabic name text. Possession must determine verification; fixture naming cannot determine production security state.
3. **P1 / R06 — Interrupted CLI setup cannot resume.** `src/cli/provision-owner.ts:64–88` refuses any existing owner before completing the pending reservation. The round-2 correction requires controlled retry after interruption.
4. **P1 / R04 — Returning 500 does not invalidate the other session.** `src/app/api/auth/[...all]/route.ts:92–114` commits the library password change before a separate revocation operation. Required invalidation can fail while an old session remains usable, contrary to the mandatory failure-state requirement.
5. **P1 / R07 — Fixture names still substitute for ownership.** `tests/helpers/test-db.ts:123–125,155` force-drops a requested name before proving ownership. `tests/e2e/auth.spec.ts:27–52,65–71` adopts and later deletes an existing fixed-email identity. Neither an `_test` suffix nor an email proves the run created a resource.
6. **P1 / R07 — Pool overrides replace the validated destination.** `tests/helpers/test-db.ts:40–43` spreads `poolConfig` after the validated connection string. Round 2 requires validation after final target composition, before any connection or write.
7. **P1 / R02 — Historical trusted-device credentials still bypass the required challenge.** `src/lib/auth.ts:86` sets new trust lifetime to zero; the pinned two-factor plugin still accepts already-issued signed cookies with unexpired verification records. The previous assignment explicitly includes existing trust cookies.
8. **P2 / R08 — Migration verification still bypasses migration tooling.** Integration setup splits SQL, ignores errors and adds columns manually (`tests/integration/auth-integration.test.ts:73–98,832–837`). These operations do not prove the required supported, preserved-data upgrade/baseline.

## Spec

Reviewer `/root/t03_r2_spec` (`Application Security Engineer`), independent read-only source/spec review, no runtime tests:

1. **P1 / R02/R03 — Guard and provider select/validate cookies differently.** The route's plain-cookie-first parser (`src/app/api/auth/[...all]/route.ts:7–12,34–64`) does not establish the library-verified session required by correction round 2. Under HTTPS the provider can select a valid secure cookie while the guard inspects a decoy plain cookie, allowing stale-session refresh.
2. **P1 / R02 — Zero new trust lifetime does not reject old device trust.** The required fresh challenge for every owner login is still bypassable with an existing valid trusted-device credential. The specification explicitly covers this case.
3. **P1 / R04 — Password failure path leaves security state open.** The previous requirement says a failure must not leave a previously valid second session usable after credentials change. A sanitized 500 alone satisfies only the response requirement.
4. **P1 / R06 — Enrollment is neither universally proof-gated nor recoverable.** Default provisioning closes setup without proof, while the explicit pending CLI path cannot resume. The pending settings banner does not complete setup: pending users are rejected before reaching that protected page.
5. **P1 / R07 — Destructive test setup has no resource-ownership proof.** Predictable database replacement and post-validation pool overrides violate the isolated, owned-fixture requirement. A dedicated-name label is insufficient.
6. **P1 / R08/R10 — Evidence and functional coverage remain partial.** Actual URI/challenge/recovery replay, supported migration upgrade and interrupted-enrollment completion are not all demonstrated by the claimed passing checks. Direct session inserts and in-memory code filtering must not be reported as protocol proofs. Logout and measured 200% root-font scaling are real improvements.

Standards: **8 findings, highest P1**. Spec: **6 findings, highest P1**. Shared IDs express overlapping requirements; the two axes are not merged or ranked against one another.

## Parent reproductions and impact

Sanitized observations are committed in [round-3 evidence](evidence/T03-round3-observations.json). All runtime data was synthetic in a separately owned disposable PostgreSQL container. The policy probes exercise the actual route/Module and pinned provider. They are independent observations, not newly committed application regressions.

| Trigger / expected behavior | Observed result at cd60a6a | Consequence |
|---|---|---|
| Ordinary owner provisioning, no authenticator proof; expected pending/unclosed | `verified=true`, `bootstrapClosed=true` | R06 remains open. The magic-name workaround masks ordinary behavior |
| Derive RFC 6238 independently from the actual issued URI; expected successful challenge | HTTP 200; protected actor accepted | R01 remains fixed |
| HTTPS, legitimate secure session idle 31 minutes plus an invalid plain-cookie decoy; expected rejection before any refresh | `/get-session` HTTP 200; protected actor accepted afterward | R03 still has a cookie-selection bypass. This is an existing valid idle session, not a guessed-token attack |
| Issue a real trusted-device cookie using the pinned provider's previous 30-day configuration, sign out, then sign in through current configuration; expected fresh challenge | Current `trustDeviceMaxAge=0`; HTTP 200 with no new challenge; actor accepted | R02 remains open. The historical cookie is provider-issued with an unexpired real database record, not a fabricated bypass |
| Two sessions, inject PostgreSQL DELETE failure for the other session during real password change; expected safe credential/invalidation state | HTTP 500, but second session still accepted | R04 response handling improved; security state remains incorrect |
| Eight concurrent incorrect recovery reauthentication attempts; expected bounded attempts and lock | Five recorded failures, lock set, four RATE_LIMITED responses | R09 is fixed in this reproduction; preserve the atomic design |
| Pre-create an unrelated synthetic `_test` database with a sentinel, then request that same name from the helper; expected refusal without mutation | Helper returns a fresh database; sentinel is gone | R07 still destroys resources it did not create. Only the review container's disposable sentinel database was affected |
| Supply an operational-name `connectionString` through optional pool configuration; expected rejection before connection | Pool selects the unchecked destination | R07 validation order remains wrong. No connection was attempted in this probe |
| Run actual CLI without proof, then retry with the correct current OTP for that pending reservation; expected controlled completion | First exit 1, retry exit 1 with existing-owner rejection; pending remains unverified/open | R06 interruption dead end confirmed. Neither run prints seeds/recovery material in captured noninteractive output |

The normal guard-exception path now returns an error; the previous catch-and-continue seam is fixed. The remaining HTTPS case selects a different provider cookie and therefore requires a different regression. New unsigned/corrupt-cookie checks reject their tested inputs, but custom HMAC verification does not satisfy the requested provider boundary. The old-device test cannot be replaced by a test that only supplies `trustDevice:true` to a current sign-in.

## Disposition of prior findings

| ID | Status | Required remaining work |
|---|---|---|
| R01 | Fixed, retained | Keep actual issued-URI compatible TOTP behavior; commit protocol coverage rather than only helper comparisons |
| R02 | Partial/open | One pinned-library verification boundary; reject historical and newly requested device-trust bypasses |
| R03 | Partial/open | Preserve error rejection; close secure/plain cookie-selection bypass across provider and protected entry points |
| R04 | Partial/open | Preserve ordinary revocation and non-success errors; enforce safe credential/session state under revocation failure |
| R05 | Fixed, retained | Keep explicit secret validation; no public/default signing key |
| R06 | Partial/open | Remove default verification, caller flag and name/email magic; provide proof-gated controlled resume and reachable setup flow |
| R07 | Partial/open | Unique owned databases/records, collision refusal, final pool-target validation and non-adoption of fixed-email users |
| R08 | Partial/open | CI now passes; fresh migration works. Supported nonempty T02 upgrade/baseline still lacks actual tooling evidence |
| R09 | Fixed | Parent concurrent reproduction now enforces five failures and locks |
| R10 | Partial/open | Logout and measured text scaling added; actual enrollment/retry/recovery replay and truthful migration/protocol evidence still required |

CLI TTY masking has a more credible non-echoing implementation; this parent review did **not** perform a real interactive terminal echo-capture check. Noninteractive secret suppression was actually tested. Do not convert source inspection into a claimed interactive PASS. Likewise the prior nonempty migration failure is carried forward with unchanged migration/config source; it was not rerun in this round. Raw migration SQL in tests does not fix or prove that upgrade path. Consolidating unmerged draft migrations remains allowed under the previous explicit baseline rule.

## Independent verification

| Check | Result / boundary |
|---|---|
| Clean `npm.cmd ci` | Exit 0; postinstall generated Prisma 7.10.1 client |
| Actual `prisma migrate deploy` on new empty owned database | Exit 0 |
| `npm.cmd test`, configured local and explicit CI mode | Exit 0; 53/53 in each mode |
| `npm.cmd run test:integration` on owned PostgreSQL | Exit 0; 35/35 |
| Lint / typecheck | Exit 0 each |
| Submitted Playwright journeys on independent validated review server, no reuse or retries | 30/30 across desktop/tablet/mobile; last-run status `passed` |
| Native routing / Antigravity kit validators | Exit 0 each; static validation does not prove runtime delegation |
| Additional actual-route/fault/concurrency/ownership and CLI probes | Completed; observations above, including failures not covered by green suite |

The local browser server used a fresh **test-only webpack** build. This is not represented as a local default Turbopack build. Separately, actual [hosted application CI 43346080400](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43346080400), job `131625658846`, passed install, migration, lint, typecheck, 53 unit, 35 integration, 30 browser cases and the default production build. Logs identify PR merge candidate `36aaa4f9e0886b6fa147197700b4988266f9c0b2` merging submitted head cd60a6a into base e598c16; default build ID `Dx7yw3iHWWqKKAuXEcIms`. [Planning CI 43346080329](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43346080329) also passed. This corrects the previous round's red CI status.

The owned temporary container was verified by full ID and ownership label before removal. The pre-existing owner test container at port 5433 was left running and unchanged. The review browser server is stopped. No operational database was contacted.

## Native agents, Graphify and evidence accuracy

The submission contains actual distinct native lead/support sessions and checkpoint ownership; native execution is not the blocker. However, recorded Identity profile hash `632D43A65091A136E0D4A7C062C9C7F668CB0FE81A8BBA1D8EA8F358661603BA` differs from the inspected installed/committed `.agents/skills/engineering-identity-access-engineer/SKILL.md`: `34163D05151805A8F320BF89C4A25CE2743CB96090592EA0D6D34DA6533EF618`. Correct or explain the actual loaded-file provenance. Do not alter installed assets to make a report match. The report also retains a different claimed report-commit SHA/remote placeholder; use actual published values in the next handoff. Prior reports remain historical.

Submission Graphify `work/graphify/b4d2c7c0e663-38d3a200/SOURCE.json` identifies frozen application SHA b4d2c7c. Codex independently generated/query-inspected `work/graphify/cd60a6a0f66b-8fc0a546/` with full source SHA cd60a6a, 225 nodes, 499 edges, 10 communities, local code-only/no labels. Query `confirmOwnerProvisioning` found 46 nodes but displayed 39 at the 1100-token budget; that truncated result was not treated as exhaustive. Source and runtime inspection establish the findings independently.

This review publication changes documentation, derived handoff copies and their packaging only. The planning archive now includes canonical review Markdown and sanitized JSON evidence so its task cards can resolve the correction references. No application implementation changed. Acceptance remains with Codex after the bounded corrections and independent verification.
