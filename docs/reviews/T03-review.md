# T03 — Independent Codex review

Latest review, 14 November 2026: **CHANGES_REQUESTED** at submitted head `fc6d0463c96ba4f11e4ea8bb17e926dc7ab38d6c`, frozen implementation `a4a14d9483e84e5bcadac7cd491d22d4f7fd76d8`. [Round12 review](T03-review-round12.md) records separate Standards/Spec findings and six real PostgreSQL/provider observations: failed companion persistence admits old proof after rotation; password mutation can commit despite version-transaction failure; protected actor ignores mismatched versions; prior canonical schema cannot baseline-upgrade; unapproved index collation receives completed history; null-Origin Host-only trust diverges from provider. [Complete round12 assignment](T03-corrections-round12.md) is embedded inline in T03 with five bounded native roles. Hosted CI passes137unit/68integration/default build/45E2E; coverage and attributable native/browser evidence remain incomplete. Keep PR #8 draft; no merge, T04, deployment or real data. Earlier notices/reviews below are historical.

Latest review, 14 November 2026: **CHANGES_REQUESTED** at submitted head `b0770d758dadfbbd409e5164e18b8f0f6c6b26f6`, frozen implementation `8e4a8cbfae69f8e0037ba6b2507cdffc834039f1`. [Round11 review](T03-review-round11.md) retains separate Standards/Spec findings plus genuine PostgreSQL/production-browser evidence. Three P1 gaps remain: old password proof can create a new challenge after rotation; an unsupported constrained domain receives canonical migration history; request Host/missing/null-Origin rules diverge from configured provider trust. OTP validation/controlled Arabic-Persian confirmation, stale-response suppression and configurable-origin fixtures are credited. Hosted CI passes130unit/65integration/30existingE2E/default build, but lacks the new regressions. [Complete round11 assignment](T03-corrections-round11.md) is embedded inline in the T03 card, with five appropriate native roles and no repeated Frontend implementation for completed UI work. Keep PR #8 draft. Earlier notices/reviews and the text below are historical.

Decision: **CHANGES_REQUESTED**. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. No merge, T04, deployment or real-data operation. Review date: 11 November 2026, Africa/Cairo. [Correction assignment](T03-corrections-round1.md).

## Checkpoints and scope

- Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Branch/upstream: `feature/t03-identity-sessions` / `origin/feature/t03-identity-sessions`.
- Accepted integrated T02 base/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Frozen implementation: `32ebac7ea5f0f8c42c3a301a5faf321b0a895359`; reconciled implementation: `729213b2104ceaaec5e770792d0c0a20f627b11d`.
- Published and independently verified submission head: `3faedd9c46c9c4dd2a4f5dbfe7e31b98b106b94b`.
- Fixed diff: `git diff e598c1649b82f34ea94338cda5ef25da32b5299f...3faedd9c46c9c4dd2a4f5dbfe7e31b98b106b94b` (29 files). The last submission commit changes only its report; the preceding refinement changes TypeScript exclusions.
- Review execution checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, local branch `codex/t03-review`. The active `D:/Lawyer` implementation checkout and installed assets were preserved.

The supplied Codex assignment explicitly authorizes the Arabic UI skill and auth-only Playwright tooling in T03. Those additions are within scope. Registration closure, library-backed password/recovery login, role checks and database revocation are useful foundations. Passing counts below do not establish the missing security behavior.

## Standards

Fresh independent reviewer `/root/t03_standards` (`Code Reviewer`) inspected the fixed diff and repository rules, without builds, edits or runtime tests. Its five documented-standard findings are retained separately from the Spec axis:

1. **R05 / P1 — Embedded authentication key.** `src/lib/env.ts:220–223` supplies a committed default `BETTER_AUTH_SECRET`, including production. Missing configuration silently selects the public encryption/signing key, contrary to SECURITY_OPERATIONS section 3. Require an explicit secret and sanitized fail-closed errors.
2. **R03 / P1 — Direct auth APIs bypass inactivity policy.** `src/app/api/auth/[...all]/route.ts:5,16` delegates without the policy in `require-actor.ts`. The pinned library's get-session handler refreshes timestamps before the application's idle check can reject them. Apply idle and absolute-age enforcement before all authenticated entry points, including library APIs.
3. **R04 / P1 — Password change does not force other-session revocation.** `src/lib/auth.ts:46–57` adds no enforcing hook; the exposed library endpoint revokes only if the caller opts in. SECURITY_OPERATIONS section 3 requires revocation after a password change regardless of request-body preference.
4. **R06 / P1 — Concurrent bootstrap can create multiple owners.** `src/modules/identity/provisioning.ts:108–124` uses an ordinary transaction's existence check, without serialization, locking or owner uniqueness. Concurrent different-email calls can both commit, violating FR-01's one-owner bootstrap.
5. **R09 / P2 — Recovery password checks bypass throttling and the Module boundary.** `src/app/settings/security/actions.ts:44–81` verifies passwords and writes Prisma directly, outside the Identity Interface and Better Auth rate limiter. A stolen session can make unbounded reauthentication guesses. Use a validated, throttled Identity command.

No additional heuristic-only code-smell finding is asserted.

## Spec

Fresh independent reviewer `/root/t03_spec` (`Application Security Engineer`) inspected the same checkpoint, task, security policy, UI requirements and pinned library source. It performed no writes/builds/runtime tests. Its original seven findings and subsequently confirmed TOTP addendum are:

1. **R02 / P1 — Mandatory MFA can be disabled.** S01 requires a TOTP or single-use recovery code. The catch-all exposes `/two-factor/disable`; `require-actor.ts:126,145` subsequently accepts the disabled account and reports verification true. Password-only login then reaches the protected surface.
2. **R03 / P1 — Idle/absolute policy does not cover auth APIs.** SECURITY_OPERATIONS requires a 30-minute lock. `/get-session` can refresh an idle session, bypassing the application check; direct library endpoints lack the custom absolute-age guard.
3. **R04 / P1 — Password change leaves other sessions valid.** The library's optional `revokeOtherSessions` flag is not an enforcement policy. The canonical revocation requirement applies even when the caller omits it.
4. **R05 / P1 — Production accepts a public Auth secret.** The unconditional default violates the requirement to keep secrets outside Git and configure them explicitly.
5. **R06 / P1 — Bootstrap closure is not permanent or concurrent-safe.** T03 requires disabling the reusable path. It currently depends only on whether an OWNER row exists, with no durable completion state or race-safe serialization.
6. **R07 / P1 — Auth tests bypass isolation before destructive writes.** `tests/integration/auth-integration.test.ts:24–51` opens a raw target, applies DDL and deletes all auth rows before shared validation. E2E likewise writes through an unchecked raw target/fallback. T03 explicitly requires isolated test data.
7. **R10 / P1 — Claimed evidence and UI are incomplete.** The integration TOTP case generates a code then manually creates a session; the recovery case filters an in-memory array. They do not prove verification or replay rejection. The submission's TOTP E2E names and QR-enrollment instructions are absent from actual tests/UI. The migration test deletes records rather than proving preserved-data upgrades.
8. **R01 / P1 — Issued enrollment URI and verifier use different TOTP keys.** `provisioning.ts:85–97` embeds a Base32-encoded 20-byte key into the URI but stores the same text without the pinned library's encoded-secret marker. Better Auth consequently verifies the 32 UTF-8 bytes. An authenticator decodes the URI to the original 20 bytes. Correct enrollment/import through the pinned library and test an independently derived code from the actual issued URI.

Standards: 5 findings, highest P1. Spec: 8 findings, highest P1. Shared IDs identify overlap; the axes are intentionally separate.

## Parent verification and additional delivery finding

**R08 / P1 — A clean clone cannot reproduce Identity setup.** `npm ci` succeeds, but `npm run typecheck` exits 2 because the generated Prisma client is absent; unit tests pass only the 43 baseline cases and cannot load the auth suite. Hosted CI fails at the same point. A manual, uncommitted `prisma generate` makes typecheck and all 51 units pass, establishing the missing reproducible step. The documented `prisma migrate deploy` exits 1: `The datasource.url property is required in your Prisma config file`; there is no Prisma config supplying it. `npm run auth:provision-owner` exits 1 with `Missing script`, despite the submission and PR claiming it exists. Provide tested generation, migration, provisioning and CI commands without global script-policy changes or destructive resets. Existing CI also has no auth E2E step.

Runtime reproductions use the actual application auth route handlers and a real PostgreSQL database. They demonstrate defects, not passing acceptance tests:

| Observation | Actual result |
|---|---|
| Provision a synthetic owner, derive RFC 6238 with Node HMAC from the actual URI's decoded key, submit `/two-factor/verify-totp` | Authenticator-compatible code returns **401**; control derived from stored UTF-8 text returns **200**. URI key is 20 bytes; server interpretation is 32 bytes. Confirms R01 independently of the library OTP helper |
| Complete real password/recovery login, call `/two-factor/disable`, log out and log in with only the password | Disable returns **200**, login requires no challenge, `requireActor` accepts and reports `twoFactorVerified=true`. Confirms R02 |
| Set a valid synthetic session to 31 minutes idle, then request `/get-session` before the protected surface | API returns **200**, refreshes activity, and `requireActor` accepts. Confirms R03 |
| Log in two independent cookie contexts, change the password without optional revocation flag | Change returns **200**; the second session still exists and is accepted. Confirms R04 |
| Validate production environment without an Auth secret | Validation succeeds using the public committed default. Confirms R05 |
| Concurrent distinct-email provisioning with controlled 500ms PostgreSQL insert latency | Both operations fulfill and **two OWNER rows** commit. This is a real transaction race with a temporary database trigger, not a persistence mock. Confirms R06 |
| Selected auth schema test with operational/test variables identical and pointing at a synthetic `lawoffice_dev` fixture inside the review container | Child exits **0** while its beforeAll deletes the fixture's sentinel user (count **1 → 0**). No actual operational database was contacted. Confirms R07 |

## Executed checks and limitations

Node/npm and locked packages were installed in the isolated checkout. PostgreSQL `16.8-alpine` ran in Codex-owned tmpfs container `lawoffice-codex-t03-review`, ID `ecb828806e4b263894c43961ffd9a0a67b960adeb84f1179b681d94474824cce`, label `lawoffice.review=t03-round1`, bound only to `127.0.0.1:14481`. Only synthetic fixtures were used. The owner's existing port-5433 test container was not modified by Codex. At completion, the exact review container ID/label were verified before stopping it, removal was confirmed, and review server port 14482 had no listening process.

| Check | Result |
|---|---|
| `npm.cmd ci` | Exit 0; no generated Prisma client. Installation also reports 7 moderate audit findings; these were not independently triaged or attributed to this diff, so no separate vulnerability finding is asserted |
| Clean `npm.cmd run typecheck`; `npm.cmd test` | Exit 2 with missing PrismaClient/implicit-any consequences; units exit 1, 43 baseline passed and auth suite cannot load |
| Diagnostic `prisma.cmd generate` | Exit 0; explicitly manual review setup, not a delivered script |
| Lint/typecheck/units after manual generation | Exit 0; 51 units passed |
| Submitted integration suite, explicit owned target and test-only webpack startup build | Exit 0; 16 passed, including 9 auth cases. Their missing assertions remain R10 |
| Submitted browser tests using a review-only config with validated target, unique port 14482, no server reuse and retries disabled | Exit 0; **15 passed**: five actual journeys repeated at three widths. This does not prove TOTP, replay, enrollment, keyboard or 200% zoom |
| Separate policy reproductions; independent URI/TOTP reproduction | Exit 0 observing the defects above; observations contain no tokens/seeds/passwords |
| Documented migration/provision commands | Both exit 1 as described in R08 |
| [Hosted application run 43100039576](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43100039576), job `130788330002` | Failure at typecheck; subsequent unit/integration/build steps skipped. Independently read job logs |
| [Hosted planning run 43100039879](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43100039879), job `130788339423` | Failure because the master-plan copy omits the newly committed AGENTS block. Regeneration reproduces the diff. Codex regenerates the derived outputs with this review; this closes that documentation drift only |
| Both planning validators and PowerShell 7 regeneration | Pass; the generated master plan gains the canonical 10-line AGENTS block. No validator weakened or installed profile removed |

Parent logs/reproductions remain ignored under `work/t03-*`. The sanitized observations are recorded above. No production build claim is inferred from the local webpack startup build; the exact submitted hosted default build was skipped because CI failed. A separate rendered UI/accessibility audit was NOT RUN; source and actual test inspection establish the missing journeys, and existing security blockers already prevent acceptance.

## Native Agency and Graphify evidence

Actual native execution is confirmed, not inferred from the submission: parent/child metadata, transcript tool results and returned reports exist under `C:/Users/Alksas/.gemini/antigravity/brain/` for lead `57627653-7e9f-40c7-84d1-cfa2cbc52dae`, AppSec `5dc5685d-a8d4-4883-8e4a-170a418a6cd8`, and testing `ea21af02-f1ae-43b8-a64b-2bb7b968ec54`. Returned test output includes real 51-unit, 16-integration and 15-browser passes. This confirms execution, not correctness of their security verdict. Supports identify `32ebac7...`; subsequent `729213b...` changes TypeScript exclusions, with lead reconciliation recorded. Do not relabel those support reports as having inspected a newer SHA.

Original baseline/final Graphify manifests record `e598c1649b82f34ea94338cda5ef25da32b5299f` and `729213b2104ceaaec5e770792d0c0a20f627b11d`. Codex independently rebuilt from published `3faedd9...`: `work/graphify/3faedd9c46c9-45150921/`, 199 nodes/415 edges/11 communities, confirmed full source SHA. The bounded `requireActor` query was truncated and used only for navigation; actual source/pinned library inspection and runtime reproductions establish the findings. Graph linkage does not prove exhaustive authorization coverage.

The submitted report must be corrected: its E2E transcript lists tests absent from the file; its Next.js 16.0.7 claim conflicts with the 16.4.6 pin; its provisioning command is absent; its QR-enrollment action is absent. Preserve historical reports and add transparent corrections rather than presenting those descriptions as observed behavior.

The review publication adds documentation and regenerated planning outputs only. It does not implement the application fixes or inherit acceptance from passing baseline tests. Keep the same implementation branch/PR and follow the correction assignment.
