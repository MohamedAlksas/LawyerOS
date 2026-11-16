# T03 — Independent Codex review, round 4

Decision: **CHANGES_REQUESTED**. Review date: 13 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. Execute [correction round 4](T03-corrections-round4.md) on the same feature branch; no merge, T04, deployment or real data.

## Checkpoints and method

- Origin: `https://github.com/MohamedAlksas/LawyerOS.git`; branch: `feature/t03-identity-sessions`.
- Accepted T02/main: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed point / previous review publication: `4e7d733215ea71f00030b85cc1630a6cd5c5e315`.
- Phase A: `81bae29c246ab1c81139b27d094345c0691c2910`; frozen application: `f973d5cf2a5c73d11482d6c37dc957b43cbb63f2`.
- Independently verified submitted local/remote HEAD: `1facc21992d105ab1c74a8258dd18ad260339252`. Final commit changes only the submission report.
- Fixed diff: `git diff 4e7d733215ea71f00030b85cc1630a6cd5c5e315...1facc21992d105ab1c74a8258dd18ad260339252`; 9 files, 855 insertions, 227 deletions; all three commits inspected.
- Execution checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, branch `codex/t03-review`. The active implementation checkout and installed assets were preserved.

Two fresh independent source-review contexts inspected the fixed diff and pinned library, without running tests or editing files. Parent runtime verification then distinguished remaining defects from genuine improvements. [Sanitized observations](evidence/T03-round4-observations.json) record those results; the probe assertions deliberately observe both safe and defective behavior and are not acceptance tests.

## Standards

Reviewer `/root/t03_r3_standards` (`Code Reviewer`), lightly cleaned independent report:

1. **P1 / R06 — A production email bypasses enrollment proof.** `src/modules/identity/provisioning.ts:209–212` sets `isVerified` from `email === 'adel.lawyer@office.eg'`; lines 263/272 persist verification and closed bootstrap without TOTP. Round-3 B4 explicitly prohibits email heuristics and fixture exemptions. Every reservation must start pending; tests must complete genuine confirmation.
2. **P1 / R02/R03 — Custom session authentication remains.** `src/modules/identity/require-actor.ts:35–44` signs a supplied raw token. Auth `route.ts:22,76–105` strips signatures and performs policy/deletion against raw candidates before provider verification. B1 requires one provider-verified, non-refreshing boundary. The pinned provider reads and verifies its configured cookie at `better-auth/dist/api/routes/session.mjs:40`.
3. **P1 / R02 evidence — The historical-trust regression supplies no valid historical trust.** Integration lines 380–415 create `device-trust:<user>` and send unsigned `dont_remember_device`. The provider instead verifies signed `trust_device` carrying `token!trustIdentifier` against an identifier record with `value=user.id` (`plugins/two-factor/index.mjs:34–53`). B2 requires generating the fixture through actual prior 30-day configuration. This regression would pass with historical-trust handling absent.
4. **P2 / R07 — Post-creation validation can orphan a database.** `tests/helpers/test-db.ts:168` creates before final URL validation at line 181. A quoted PostgreSQL name such as `bad%_test` passes the suffix check, but its URL subsequently fails validation; the caller receives no cleanup closure. Validate before mutation and clean up owned creations on later failure.

No heuristic-only smell finding is asserted.

## Spec

Reviewer `/root/t03_r3_spec` (`Application Security Engineer`), independent source/spec report:

1. **P1 / B1 — Inconsistent session boundary.** Raw-token signing remains in `require-actor.ts:35–45`; `route.ts:7–29,70–98` queries signature-free supplied tokens rather than the provider-selected verified session. A decoy referencing an idle record can cause deletion/rejection alongside a separately valid selected session. B1 prohibits these shortcuts. This is not a claim that an anonymous caller can guess random session tokens.
2. **P1 / R07 — Destination validation remains bypassable.** `tests/helpers/test-db.ts:41,63–66` validates a fallback URL, then spreads `poolConfig`. An explicitly undefined or empty `connectionString` overwrites that URL; pinned `pg/lib/connection-parameters.js:59–72` then resolves `PG*`/driver defaults, potentially selecting an operational target. Validate and construct the exact effective destination without later overrides.
3. **P1 / B2 evidence — Historical trust acceptance is unproven by the committed test.** The wrong unsigned cookie and fabricated record do not exercise provider-issued historical trust. Actual parent verification below credits the implementation improvement while retaining the missing regression finding.
4. **P1 / B3 evidence — The fault test can pass for an unrelated reason.** Integration lines 443–528 omit the OWNER's two-factor record, mock JavaScript deletion and assert rejection without credential-state assertions. `requireActor` can reject missing MFA independently. No PostgreSQL fault is injected. The Prisma adapter defaults transactions off (`prisma-adapter/dist/index.mjs:464`), contrary to the report's native-transaction claim. Test actual state and both authenticated boundaries.
5. **P1 / C — Protocol and migration evidence remain incomplete.** Integration lines 276–335 compare helpers then insert a session; lines 531–562 filter recovery codes in memory; lines 80–108 and 914–919 split SQL, swallow errors and manually alter schema. These do not prove issued-URI login, recovery replay rejection or preserved-data migration, despite R08/R10 completion claims.
6. **P2 / B4 — Continuation attempts are unbounded.** Pending-setup password and TOTP checks in `provisioning.ts:120–168,303–339` have no persistent throttling. B4 explicitly requires bounded attempts. The committed continuation test calls helpers rather than proving actual CLI interruption/restart/retry.

Standards: **4 findings, highest P1**. Spec: **6 findings, highest P1**. These are separate axes with overlapping requirements, not ten distinct security defects.

## Parent runtime findings and confirmed fixes

All database/CLI probes used synthetic identities in a new ownership-labelled disposable container. Auth probes exercised the actual Next route handlers, pinned provider and real PostgreSQL. The browser server was independent, with no reuse or retries.

| Scenario | Observed behavior at 1facc219 | Disposition |
|---|---|---|
| Ordinary owner reservation without proof | `verified=false`, bootstrap open | Previous default-verification bug fixed for ordinary addresses |
| Same call with `adel.lawyer@office.eg`, no confirmation | `verified=true`, bootstrap closed | **R06 still open:** an explicit new fixture-specific production exception replaces the previous name/email heuristic |
| Confirm ordinary owner with a code independently derived from the actual issued URI, then real password/challenge/TOTP login | HTTP 200; protected actor accepted | R01 remains fixed; ordinary confirmed setup works |
| HTTPS secure session idle 31 minutes plus invalid plain-cookie decoy | HTTP 401; protected actor rejected; idle session removed | Previous concrete R03 refresh bypass fixed. Raw-candidate policy design remains noncompliant |
| Real historical 30-day trusted-device cookie issued by pinned provider, sign out, then current sign-in | Fresh challenge required; no protected actor before verification | Previous concrete R02 trust bypass fixed. The committed wrong-cookie test still does not protect this behavior |
| Two genuinely authenticated MFA contexts; PostgreSQL trigger fails deletion of the second during password change with client `revokeOtherSessions:false` | HTTP 500; credential hash unchanged; second session remains accepted | **Safe failure state in this probe.** Unlike the previous bug, the password did not change. Do not report acceptance of that unchanged-password session as the old credential-invalidation failure |
| Actual CLI: reserve without proof, then retry pending setup with correct current OTP | First exit 1, retry exit 0; pending/open becomes verified/closed; no seed/recovery material in captured stdout | Prior CLI retry dead end fixed for ordinary addresses |
| Pre-existing synthetic same-name database with sentinel | Collision rejected; sentinel retained | Prior destructive collision replacement fixed |
| Optional pool configuration contains `connectionString:undefined` or empty string | Validator accepts `/lawoffice_test`, but driver resolves synthetic `codex_unvalidated_dev:65432` from controlled `PG*` defaults | **R07 still open.** Connection-free observation; no socket or operational database was contacted |
| Dedicated identifier `codex_bad%_test` | Function rejects, but catalog shows the database was already created | **R07 P2 confirmed:** owned resource leaked before returning its cleanup handle; parent manually removed that exact synthetic fixture |
| Actual `prisma migrate deploy` on a new nonempty T02-style fixture with retained sentinel and no auth tables/history | Exit 1, P3005; sentinel retained | **R08 upgrade/baseline remains unresolved.** T02 has no Prisma migration history. Empty-database success is not this upgrade |

The password endpoint now forces provider revocation before credential update. The pinned provider deletes sessions before `updateAccount`; this order explains the safe DELETE-fault result. `prismaAdapter(prisma,{provider:'postgresql'})` still leaves its transaction option disabled. An enforced equivalent invalidation design is allowed by the assignment; real safety evidence and accurate reporting matter more than the word “transaction.” The current `account.updatedAt` checks may contribute to that design, but the false-positive committed fault test does not establish it. No unsupported claim of a new password-change bypass is made here.

The recovery attempt-reservation implementation did not change this round; retain R09's prior independently established concurrency fix. The explicit-secret requirement and its unit coverage remain in place (R05). E2E now creates a run-unique main identity and cleans its inserted IDs, removing the prior fixed-email adoption path. Fresh bootstrap locking and durable closure must remain while removing the fixture exception.

## Required disposition

| ID | Current status |
|---|---|
| R01 | Behavior fixed and independently retained; committed URI-to-route proof still needs accurate coverage |
| R02 | Historical trust behavior now fixed in the parent probe; raw-token escape and committed regression still incomplete |
| R03 | Previously reproduced HTTPS revival fixed; replace raw-candidate guard with provider-selected verified policy |
| R04 | Normal browser revocation passes; actual DELETE-fault state now safe; committed fault evidence and transaction claims need correction |
| R05 | Fixed, retained |
| R06 | Ordinary pending/resume works; explicit email exception and unbounded continuation remain open |
| R07 | Collision refusal/run-unique E2E improved; empty/undefined destination override and pre-creation validation remain open |
| R08 | Empty migration/CI green; supported nonempty upgrade still fails and has no implemented baseline procedure |
| R09 | Fixed, retained from previous independent concurrency evidence; source unchanged this round |
| R10 | Existing browser journeys pass; actual protocol/replay/migration/continuation regressions and accurate claims remain incomplete |

## Checks, provenance and limits

- Clean `npm.cmd ci`: exit 0, pinned client generation included. Lint and typecheck: exit 0 each. Local configured units: **53/53**, exit 0.
- Owned PostgreSQL integration: **40/40**, exit 0. Its startup suite built a fresh **test-only webpack** artifact. Submitted Playwright suite on review port 14692: **30/30**, exit 0 and last-run `passed`, three widths, zero retries. This local build is not a default Turbopack claim.
- Independent observational probes: exit 0 after correcting the review harness to accept the fault endpoint's empty HTTP500 body. An initial harness JSON-parser failure was not an additional application finding. Actual CLI probe: exit 0 for the observer, with child exits 1 then 0 as recorded. Nonempty migration observer: exit 0 while recording actual migration exit 1/P3005.
- [Hosted application CI 43360520345](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43360520345), job `131672649923`, is green, including 53 units, 40 integration, 30 browser cases and default production build. Logs identify merge candidate `e2ce4648e770fcb4bf2d165f9e85d720a3f55114`, merging 1facc219 into e598c164; startup Turbopack build ID `oHHYSywlngB_AN4mvbUp-`. [Planning CI 43360522068](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43360522068) passed.
- Submission Graphify manifest at `D:/Lawyer/work/graphify/f973d5cf2a5c-2407b655/SOURCE.json` has verified source SHA f973d5cf and SHA-256 `5A2FC96DFAA22013E74F31BD4AB6D39CC0835B30C7A7EA8A3CF01652C2C99068`. Parent regenerated committed report-head graph at `work/graphify/1facc21992d1-799e5f0f/`: 225 nodes, 505 edges, 11 communities, code-only/no labels, full SHA verified. `provisionOwner` query displayed 59 of 62 nodes under a 1600-token budget; it was not treated as exhaustive. Actual source/tests remain authoritative.
- The handoff records native implementation/support IDs and checkpoint activity. Real delegation is not the blocker; native PASS reports did not catch the defects above. The Identity profile hash is now correctly `34163D05151805A8F320BF89C4A25CE2743CB96090592EA0D6D34DA6533EF618`, matching the installed file. The committed report still embeds stale report SHA `cfdff577...` and a pushed-SHA placeholder; the independently verified final report head is 1facc219. Preserve historical reports and correct provenance in the next handoff without trying to embed a commit's own final hash into its contents.
- Interactive TTY echo capture was **NOT RUN** by Codex. Noninteractive secret suppression and real interrupted retry were tested. Existing browser tests do not prove every enrollment/recovery requirement.
- The exact labelled review container was verified and stopped/removed. The original owner container on port 5433 remained running and unchanged; no review server listener remains at 14692. No operational data, installed asset or application implementation was changed by this review publication.

This publication contains review/assignment documentation, sanitized observations and regenerated handoff copies. The correction narrows work to the remaining cases and preserves successful behavior.

Standards: 4 findings, highest P1. Spec: 6 findings, highest P1. Acceptance remains with Codex after correction and independent verification.
