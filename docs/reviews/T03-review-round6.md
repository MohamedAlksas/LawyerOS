# T03 — Independent Codex review, round 6

Decision: **CHANGES_REQUESTED**. Date: 13 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. Execute [correction round 6](T03-corrections-round6.md). No merge, T04, deployment or real data.

## Checkpoints and method

- Origin `https://github.com/MohamedAlksas/LawyerOS.git`, branch `feature/t03-identity-sessions`; accepted main/T02 `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed point / previous review publication `6558180a9eb72b6d53f697625e125874a796ef9a`.
- Phase A `fc0f70d` and `2d1a1047685cb2146e760397befb67efcd3375b7`; Phase B `0740acde19f31bb84a396ff8e6b157b179e4e3b2`; frozen Phase C `1dbd73488b452fdc2cccf5f4104d007a17b6c2f4`.
- Independently verified submitted local/remote report HEAD `a5b84917aa3eca60eece75464ce30e6ad59d88e1`.
- Fixed comparison `git diff 6558180a9eb72b6d53f697625e125874a796ef9a...a5b84917aa3eca60eece75464ce30e6ad59d88e1`: 10 files, 1157 insertions, 151 deletions; all five commits inspected. Final commit changes its report only.
- Execution checkout `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, local branch `codex/t03-review`; installed assets and the active implementation checkout were preserved.

Two fresh independent source-review contexts inspected the actual diff and pinned dependencies. Parent verification reran submitted checks and used actual route handlers, real PostgreSQL lock ordering, driver-parameter inspection and a query-only migration-target demonstration. [Sanitized observations](evidence/T03-round6-observations.json) distinguish confirmed fixes from remaining cases. Passing observer assertions intentionally record both good and defective outcomes; they do not constitute acceptance.

## Standards

Reviewer `/root/t03_r5_standards` (`Code Reviewer`), corrected independent report, read-only:

1. **P1 / R07 — Operational destination still ignores ambient driver port.** `tests/helpers/test-db.ts:48–55` canonicalizes only TEST_DATABASE_URL. With operational URL `postgresql://synthetic:synthetic@127.0.0.1/shared_test`, PGPORT 65432 and test URL with explicit port 65432, `env.ts:141/307` assumes the operational port is 5432 while real pg uses 65432. Both actual destinations coincide, yet isolation passes. Round-5 A requires both effective identities to be resolved before comparison.
2. **P1 / R08 — Canonical PowerShell procedure has an unbound target and partial verification.** `docs/DEPENDENCIES.md:132` uses `"$DATABASE_URL"` without assigning it; an environment variable requires `$env:DATABASE_URL`. With only the environment configured, psql can select defaults. Table/two-column checks omit full managed-schema constraints/indexes, and status/deploy are incorrectly described as drift verification. The test uses pg SQL, not the canonical command, so misses target selection. C1 requires one executable, tested procedure.
3. **P2 / R06 evidence — The deterministic-race claim relies on sleeps.** Integration lines 1798–1816 use two 60ms delays without observing queued waiters. Resume can start after confirmation and pass at the old precheck without exercising the repaired locked-state check. B2 explicitly asks for observable coordination.
4. **P2 / R02 evidence — Historical-trust regression bypasses provider issuance.** Integration lines 427–449 manually sign cookies and insert records. The prior 30-day provider, actual trusted MFA and retained-cookie sign-out are absent; its HTTPS request retains HTTP provider configuration. C2 explicitly requires that lifecycle.

No heuristic-only smell finding; no CODING_STANDARDS.md or CONTRIBUTING.md found. A provisional leading-zero-port concern was withdrawn after actual Node URL normalization showed `:05432` becomes `:5432`; it is not an accepted finding.

## Spec

Reviewer `/root/t03_r5_spec` (`Application Security Engineer`), independent source/spec report, read-only:

1. **P1 / R07 — Reversed omitted-port case violates isolation.** The helper canonicalizes only the test URL; `src/lib/env.ts:145` assumes omitted operational port 5432, while `src/lib/db.ts:26` sends the raw operational URL to pg, which resolves PGPORT. The explicit-test/omitted-operational example above violates correction A's complete effective-identity requirement.
2. **P1 / R02 evidence — Historical credential is manufactured rather than provider-issued.** Integration lines 433–450 manually generate the cookie/record instead of the required prior-provider MFA/trust/sign-out lifecycle. Its outer HMAC/base64 matches pinned better-call; no encoding defect is alleged. The missing requirement is the actual issuance/lifecycle proof.
3. **P1 / R06 evidence — Race regression is nondeterministic.** Lines 1799/1816 use arbitrary 60ms sleeps without observing either waiter; the test can avoid the critical interleaving. Correction B2 requires real barriers. Fresh reservation races, reversed ordering and concurrent pending failures also lack the requested evidence.
4. **P1 / R08 — Published PowerShell command can select the wrong database.** `docs/DEPENDENCIES.md:132` references an unbound script variable, not the environment variable. Integration uses pg.query, so does not test the canonical command required by C1.
5. **P1 / R08 evidence — Before-history verification is partial.** Dependencies lines 139–147 and integration lines 141–164 verify table names and two columns, with retained data asserted after history; required managed-schema constraints/indexes are omitted. Line 157 incorrectly calls migration status/deploy drift verification. C1 requires these outcomes before recording completion.

Standards: **4 findings, highest P1**. Spec: **5 findings, highest P1**. These overlapping axes retain their own ratings; they are not nine distinct application defects. Both reviewers credit original-header session policy, the locked completion recheck and genuine two-context password-fault improvements.

## Parent verified behavior

| Scenario | Actual result at a5b8491 | Disposition |
|---|---|---|
| Same real PostgreSQL lock ordering as round 5: confirmation queued first, pending resume second | Confirmation succeeds; resume rejects BOOTSTRAP_ALREADY_CLOSED; no material returned; closure remains true | Previous production closure race fixed |
| HTTP plain-cookie provider, actual MFA session aged consistently 40 minutes/31 minutes idle, invalid secure decoy | HTTP 401, no authenticated session returned, no refresh, protected actor denied | Previous HTTP revival fixed |
| Test URL omits port with PGPORT 65432 | Actual driver selects canonical 5432 | Previous omitted-test-port case fixed |
| **Operational** URL omits port, test URL explicitly uses 65432, PGPORT 65432; same synthetic shared_test name | Validator accepts assumed operational 5432 versus test 65432; actual driver host/database/port match at 65432 | **Remaining R07 confirmed**, without opening any socket |
| Prior 30-day pinned provider actually issues a trusted credential after real MFA; sign-out retains it; current route sign-in | Fresh challenge required, no protected actor before completion | Historical-trust production behavior passes independent real-issuance proof; committed fixture still does not exercise this lifecycle |
| Empty/undefined connectionString and malformed dedicated identifier | Rejected before connection / no database created | Retained fixes |
| PowerShell has only environment DATABASE_URL set; execute the published script-variable expansion | Database argument is empty | Canonical recipe target is not bound to the configured environment |
| Pass that empty argument to actual psql with PGDATABASE naming a second owned synthetic fixture; run current_database only | Exit 0, selects ambient fixture rather than intended fixture | **Remaining R08 target-selection risk confirmed**; no canonical migration DDL was executed against the unintended fixture |

The reversed-port proof compares the pinned driver's actual connection parameters for the raw operational URL with the constructed test pool. `src/lib/db.ts` passes that raw operational URL in normal application mode. Both identities resolve to the same controlled host/database/port although validation reports separation. No operational service was contacted.

The migration-target probe intentionally clears the PowerShell script variable while retaining the environment variable, matching the documented environment-only setup. It creates two synthetic databases in the owned container and executes only SELECT current_database on the ambient target. It does not claim that a real owner's database was altered. The normal new fail-fast SQL transaction, conflict rollback, baseline recovery and real authentication tests pass; the remaining problem is ensuring the **published executable procedure** targets and verifies the intended database.

The committed race regression's sleeps are a coverage weakness, not evidence that the repaired application still returns secrets. Parent observed two genuine PostgreSQL waiters before releasing the blocker and confirmed correct rejection. Similarly, the handcrafted historical cookie appears correctly encoded, and the parent actual-issued-cookie test passes. Its requested committed lifecycle/positive-control coverage is still absent. These distinctions prevent turning evidence gaps into invented production bypasses.

## Disposition

R01, R03, R04, R05 and R09 have their previous behavior fixes retained with stronger committed checks. R02 production policy passes actual prior-provider credential testing; its lifecycle regression remains incomplete. R06's production closure race is fixed; deterministic/concurrent regression evidence needs improvement. **R07 remains open for the reversed operational-port case. R08 remains open for canonical command targeting and before-history verification.** R10 now includes real MutableStdout component tests and honest physical-TTY NOT RUN reporting. None of these results authorizes real-data use or deployment.

## Verification, provenance and limits

- Clean pinned `npm.cmd ci` and fresh migrate deploy: exit 0. Configured units **63/63**, lint/typecheck exit 0 each. Real PostgreSQL integration **48/48**, four files, exit 0. Local startup/browser build uses **test-only webpack**.
- Submitted Playwright journeys: **30/30**, exit 0, three widths, zero retries, independent non-reused review server at 14712; last-run passed. Targeted actual-route/row-lock/driver observer **2/2**, exit 0; environment/psql target observer exit 0.
- [Application CI 43451072829](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43451072829), job `131973055035`, passes 63 units, 48 integration, 30 browser cases and the default production build. Logs identify PR candidate `4155c70` merging submitted a5b8491 into e598c164; startup default build ID `uyoxBwReKutmGfwTZn5Z1`. [Planning CI 43451073242](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43451073242) passes. Local webpack is not claimed as a local default build.
- Submitted Graphify SOURCE.json for `work/graphify/1dbd73488b45-d949c71b/` identifies the frozen implementation and matches SHA-256 `AEBB767A8E55F425C872B21AFD5ED79666A1D626E6A5348BE89BE1B038625AEF`. Parent generated report-head snapshot `work/graphify/a5b84917aa3e-e7030c2d/`, full source SHA verified: 239 nodes, 553 edges, 11 communities, local code-only/no labels. provisionOwner query displayed 61 of 73 nodes at budget 1700; actual source/tests were inspected independently.
- The submission records native leads/supports and checkpoint results. Those PASS reports supplement independent review. MutableStdout's committed stream tests are now real; they are not physical TTY capture. The handoff accurately leaves physical capture NOT RUN.
- All runtime data was synthetic. The exact labelled review container was verified and removed; review listener 14712 is absent. Existing containers, installed assets and operational data were untouched.

This publication changes review/assignment documentation, sanitized observations and handoff packaging only. The planning bundle now includes canonical docs/DEPENDENCIES.md, which contains the reviewed baseline procedure referenced by T03. No application implementation changed. Standards: 4 findings, highest P1. Spec: 5 findings, highest P1. Independent acceptance remains pending the focused corrections.
