# T03 — Independent Codex review, round 5

Decision: **CHANGES_REQUESTED**. Date: 13 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. Execute [correction round 5](T03-corrections-round5.md) on the same branch. No merge, T04, deployment or real data.

## Checkpoints and method

- Origin: `https://github.com/MohamedAlksas/LawyerOS.git`; branch: `feature/t03-identity-sessions`.
- Accepted main/T02: `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed point: previous Codex publication `404015361d139c39a9e4a3bf3e18c2ca3bf04885`.
- Phase A `c75532121fd778e4db170975f0870e643b2be02c`; Phase B `0489777735a134d7d09e9729fb091d6965b3a695`; frozen application/Phase C `03108fd62d33fe04bb460c73fafb7af7283d15d4`.
- Independently verified submitted local/remote report head: `352030df52cc4828cee66d2312428234141d91f0`.
- Fixed diff: `git diff 404015361d139c39a9e4a3bf3e18c2ca3bf04885...352030df52cc4828cee66d2312428234141d91f0`; 10 files, 1388 insertions, 303 deletions. All four commits inspected; the final commit changes only its report.
- Isolated execution checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, local branch `codex/t03-review`. Owner-installed assets and the active implementation checkout were preserved.

Two fresh independent source-review contexts inspected the fixed diff, requirements and pinned dependencies without application execution or edits. Parent verification then ran the checks and targeted reproductions below. [Sanitized observations](evidence/T03-round5-observations.json) distinguish actual runtime results from source findings and prior evidence.

## Standards

Reviewer `/root/t03_r4_standards` (`Code Reviewer`), lightly cleaned independent report; four documented-standard findings:

1. **P1 / R03 — Guard and provider select different sessions.** Auth `route.ts:58–75` copies the secure cookie into both names for guard verification, then delegates original headers at lines 138/161. The pinned provider selects its configured cookie name from `baseURL`. An HTTP-configured provider can therefore refresh an idle plain-cookie session hidden from the guard by a secure decoy. Round-4 B2 requires policy on the same provider-selected verified session.
2. **P1 / R07 — Effective test routing remains ambient.** `tests/helpers/test-db.ts:84–87` passes the validated URL unchanged. Validation assumes omitted port 5432; pinned pg instead resolves an empty port using `PGPORT`. An operational/test pair separated only by explicit versus omitted ports can validate as different and connect to the same database. Round-4 A requires complete effective-target validation. Check driver parameters, not only `pool.options`.
3. **P1 / R06 — Pending resumption can return setup material after closure.** `provisioning.ts:149–155` reads the locked row but ignores `verified`; completion/closure checks precede that transaction. A confirmation can commit while resume waits, after which resume still returns seed/recovery material at lines 214–225. SECURITY_OPERATIONS section 3 requires disabling the reusable setup path. Recheck authoritative state under the shared lock.
4. **P1 / R08 evidence — Migration verification does not match the assigned safe procedure.** `migration-upgrade.test.ts:131–144` splits SQL and manually adds columns; it resolves history before schema assertions. The retained audit-table fixture is not a reconstruction of a shipped T02 schema. The submission nevertheless claims complete supported upgrade verification. Execute the documented procedure against the supported predecessor and verify schema/history/data outcomes before completion claims.

No additional heuristic-only smell is asserted; no CODING_STANDARDS.md or CONTRIBUTING.md was found.

## Spec

Reviewer `/root/t03_r4_spec` (`Application Security Engineer`), independent source/spec report:

1. **P1 / B2 — Session selection differs before and after delegation.** The guard-only secure-to-both-name rewrite at `route.ts:56–75` does not modify the request passed at lines 138/161. With an HTTP-configured provider, invalid secure decoy plus idle valid plain cookie gives no verified guard session, followed by provider authentication/refresh of the plain session. An idle secure decoy can also reject/delete independently of an active plain session. Provider selection is configured, not determined by the request URL.
2. **P2 / B1 — A queued resume can disclose setup material after closure.** `provisioning.ts:91–109` checks before locking, while lines 141–157 never recheck the newly locked `verified` value. Confirmation can close bootstrap before queued resume returns the seed/recovery codes. New attempt tests at integration lines 1254–1351 are sequential and omit this interleaving.
3. **P1 / B2 evidence — Authentic historical-trust regression remains absent.** Integration lines 430–451 still fabricate `device-trust:<user>` and an unsigned `dont_remember_device` cookie. The provider requires signed `trust_device`, `token!trustIdentifier` and a record containing the user ID (`two-factor/index.mjs:34–53`). This is the wrong credential and cannot prove the required historical case.
4. **P1 / C1 evidence — Password-fault proof is incomplete.** The real PostgreSQL trigger is an improvement, but integration lines 543–566 insert sessions directly; lines 568–572 verify requireActor only, and lines 603–606 omit the revocation preference. C1 requests two actual MFA-completed contexts, protected/provider boundaries, and omitted/false preference cases.
5. **P1 / C2 — Baselining can mark an unverified schema applied.** Integration lines 131–153 split SQL/manual ALTER and resolve before schema assertions. The published `psql -f` procedure does not stop on SQL errors or verify schema before marking history. Migration status alone does not prove schema equivalence.

Standards: **4 findings, highest P1**. Spec: **5 findings, highest P1**. Shared IDs overlap; severity ratings are retained within each independent axis.

## Parent reproductions

All database state was synthetic in a new owned disposable container. The omitted-port proof instantiated the pinned driver's connection parameters without opening a socket. The concurrency proof used actual PostgreSQL row-lock ordering, not a mocked transaction.

| Trigger / expected result | Actual observation at 352030d | Conclusion |
|---|---|---|
| Previously exempt email, no possession proof; expect pending/open | `verified=false`, bootstrap open | Email-specific production exception is removed |
| HTTP-configured provider, actual MFA login, a consistently aged 40-minute session idle 31 minutes, plus an invalid `__Secure-` decoy; expect rejection before refresh | `/get-session` HTTP 200 returns a session, refreshes activity, and requireActor subsequently accepts | **R03 confirmed:** guard-only cookie rewriting selects different state from the real handler |
| Test URL omits port, operational URL uses port 65432 for the same synthetic `shared_test` name, `PGPORT=65432`; expect rejection or a fixed validated destination | Validation accepts assumed test port 5432, but pg selects port 65432 | **R07 confirmed:** effective operational/test identity can coincide. No connection attempted |
| Confirmation queued first and resume second behind an external row lock; both initially observe pending setup; expect resume to reject after confirmation closes it | Confirmation succeeds; queued resume also succeeds and returns seed and recovery material after bootstrap is closed | **R06 confirmed:** setup closure is not rechecked under the lock. This requires valid pending-setup credentials and the controlled concurrent interleaving; it is not an anonymous remote disclosure claim |
| Explicit undefined/empty pool connectionString | Both rejected before connection | Previous exact override bug fixed |
| Malformed `codex_bad%_test` identifier | Rejected; catalog confirms no database created | Previous catalog leak reproduction fixed |
| Full migration SQL on a nonempty retained-sentinel database, then actual resolve/status/deploy | All commands exit 0; expected user email column exists; sentinel retained | Happy-path retained-data baseline now demonstrated independently |
| Same published baseline sequence with a synthetic pre-existing `user` table conflict, to exercise failure handling | psql reports SQL errors but exits 0; resolve/status/deploy all exit 0; required email column remains absent; sentinel retained | **R08 error path confirmed:** the recipe can report completion with an incomplete schema |

The HTTP session fixture ages creation, activity and remaining expiry consistently; credentials predate login. An initial probe aged only `updatedAt`, so the provider returned authenticated data but did not yet refresh its otherwise-new expiry. That initial fixture did not demonstrate revival. The completed reproduction uses the consistent aged state above and confirms both refresh and subsequent protected access. The observer exits successfully because it asserts the observed defect, not task acceptance.

For the setup race, an external transaction first holds the twoFactor row; the real confirmation is queued before the real password-authenticated resume, with both waiters verified in pg_stat_activity. Releasing the blocker lets confirmation complete first. The resumed transaction sees the newly verified row but fails to reject it. No seed or recovery-code values are retained in evidence.

T02 has no Identity tables or Prisma migration history; a retained sentinel models pre-existing data. The new baseline's successful resolve/deploy/authentication coverage is meaningful progress. The remaining migration blocker is its fail-open SQL recipe and verification ordering, rather than a claim that all nonempty upgrades still fail P3005. Parent failure injection used an intentionally conflicting synthetic schema solely to test safe refusal; it is not presented as an ordinary T02 schema.

## Dispositions and evidence quality

| ID | Current disposition |
|---|---|
| R01 | Fixed, retained; committed test now uses the issued URI through actual auth routes |
| R02 | Production raw-token self-signing removed; prior historical-trust policy retained in source, but its committed historical fixture is still invalid; R03 selection inconsistency remains |
| R03 | Open: concrete HTTP configured-cookie refresh bypass reproduced despite passing HTTPS-oriented regression |
| R04 | Real PostgreSQL trigger, unchanged-credential assertion and retry now added; normal browser revocation passes. Genuine MFA-context/provider/false-preference coverage still partial; no new password-change behavior defect is asserted here |
| R05 | Explicit-secret rule retained, unit coverage passes |
| R06 | All reservations now pending; persistent sequential attempt limits added. Closure/resume race remains; concurrent setup attempts and expiry also need meaningful evidence |
| R07 | Empty override and malformed identifier cases fixed; omitted-port driver fallback remains |
| R08 | Nonempty happy path demonstrated; SQL-error handling/schema verification before history remains unsafe |
| R09 | Prior atomic recovery design retained; submitted integration suite includes its concurrent regression |
| R10 | Real TOTP/recovery consumption/replay evidence improves; remaining historical/fault/concurrency/baseline claims must match executed cases |

The report accurately leaves physical interactive TTY capture unavailable, but additionally claims mock-stream unit verification of MutableStdout. No matching terminal/MutableStdout test was found in the committed tests. Report this as source-inspected/NOT RUN unless such a test is actually executed and identified. This is an evidence correction, not a newly invented terminal vulnerability. Likewise the submission describes a bounded 63-character identifier regex and RATE_LIMITED result, whereas source uses the suffix regex without that length bound and ACCOUNT_LOCKED. Record actual behavior rather than idealized descriptions.

## Independent checks and provenance

- Clean `npm.cmd ci`: exit 0, generated pinned client. Configured units **56/56**; lint/typecheck exit 0 each.
- Real PostgreSQL integration **45/45**, exit 0, four files; fresh local startup build used **test-only webpack**. Submitted browser journeys **30/30**, exit 0, last-run passed, three widths, zero retries, independent non-reused server at 14702. These counts do not cover the reproduced defects.
- Actual fresh migration exit 0. Targeted observational probes **2/2**, exit 0 with the consistent aging fixture. Full-file baseline observer exit 0 while recording both the successful normal sequence and the unsafe conflict sequence above.
- [Hosted application CI 43426217348](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43426217348), job `131888160066`, passes install, migration, lint/typecheck, 56 units, 45 integration, 30 browser cases and default production build. Logs identify merge candidate `21f7b7f3bf40f16a0020f0aa47932beeec484d75`, merging 352030d into e598c164; startup default-build ID `EcBJ3oizgTi1_6FwrUc12`. [Planning run 43426217424](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43426217424) passes. Local webpack is not represented as a local default build.
- Submission Graphify manifest `D:/Lawyer/work/graphify/03108fd62d33-8411098d/SOURCE.json` source SHA and hash `76B1B2E263BB6E55E796DB90F889D211C697CEF106C9DF4B088A584FA480CB4F` were corroborated. Parent snapshot `work/graphify/352030df52cc-0c2a2b3d/` identifies full report-head SHA, 235 nodes, 540 edges, 11 communities, code-only/no labels. `provisionOwner` query displayed 60 of 72 nodes at budget 1700; source/tests were inspected independently.
- The submission records native specialist IDs and phase/support checkpoints. Those reports supplement review; their PASS labels do not resolve the reproduced failures. Native delegation is not the correction requested by these source findings.
- Docker Desktop's engine was initially stopped and was started for verification. Only the newly created container, verified by exact ID/ownership label, was stopped/removed afterward. No pre-existing container or operational database was started, reset or modified. The review browser listener is absent. Docker's engine itself remains available.

This publication changes review/assignment documentation, sanitized observations and derived copies only. Standards: 4 findings, highest P1. Spec: 5 findings, highest P1. Independent acceptance remains pending the bounded corrections.
