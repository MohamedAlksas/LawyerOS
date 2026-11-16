# T03 — Independent Codex review, round 10

Date: 14 November 2026, Africa/Cairo. Decision: **CHANGES_REQUESTED**. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. No merge, T04, deployment, or real-data operation. This reviews the round9/version9.1 submission; it does not withdraw credit for working repairs.

## Reviewed checkpoints

| Item | Verified value |
|---|---|
| Origin | `https://github.com/MohamedAlksas/LawyerOS.git` |
| Task branch / upstream | `feature/t03-identity-sessions` / `origin/feature/t03-identity-sessions` |
| Accepted integrated T02/main | `e598c1649b82f34ea94338cda5ef25da32b5299f` |
| Fixed assignment point | `453c54c20559d08bbd9f9c86c99bffad390e7dde` |
| Frozen application implementation | `22a8546f64570314437ae77ea47cf56bc98911e3` |
| Independently verified submitted remote HEAD | `aa086e582a0a7baebbf6ef0d42297affe2cdc01b` |
| Review diff | `git diff 453c54c20559d08bbd9f9c86c99bffad390e7dde...aa086e582a0a7baebbf6ef0d42297affe2cdc01b` |

The diff contains two commits, 12 files, 2,309 insertions and 389 deletions. The final commit changes only `docs/reviews/T03-submission-round9.md`; source/tests/configuration at the frozen implementation and submitted HEAD agree. The pasted handoff's different full SHA beginning `aa086e58` is a reporting typo, not the verified remote object. Report future publication SHAs externally after committing rather than creating self-referential amendments.

Specification: complete version9.1 assignment in `docs/reviews/T03-corrections-round9.md` and the then-current T03 card; source requirements in `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/SECURITY_OPERATIONS.md`, `docs/REVIEW_PROTOCOL.md`, `docs/DEPENDENCIES.md` and the Git/native-agent contracts. Codex inspected actual source, pinned-provider behavior, tests, CI results and rendered production behavior. Two fresh independent review contexts examined the same fixed diff. Their axes are retained separately below; their source findings are supplemented by the parent experiments, not presented as independent runtime execution.

## Standards axis — five findings

Reviewer: `t03_r9_standards`, independent Code Reviewer; read-only source review, no runtime checks. Original red/yellow labels are preserved.

1. **Red — Credential rotation remains race-prone.** `src/app/api/auth/[...all]/route.ts:235,307,320`: reading the original cookie after the provider replaces its session can skip challenge deletion. Comparing the newly created session timestamp with account update time does not bind it to the credential proof. Best-effort exception handling cannot establish the credential-rotation rule in `SECURITY_OPERATIONS`.
2. **Red — Intercepted recovery generation bypasses Origin protection.** `route.ts:179–192`: returning before `auth.handler` skips the provider's trusted-origin middleware. Persistent password lockout does not replace request-origin protection.
3. **Red — Schema equivalence remains superficial.** `src/cli/baseline-identity.ts:404,727`: coarse type names, default substrings and column-token matching do not prove the documented baseline's actual schema semantics.
4. **Yellow — Dismissed requests can repopulate secrets.** `src/app/settings/security/security-client.tsx:61,211`: clearing local state on dismissal does not prevent an older request's completion from filling a reopened dialog.
5. **Red — Evidence does not establish final behavior.** `docs/reviews/T03-submission-round9.md:48,119,132`: the recorded accessibility checkpoint predates the changed UI and the committed E2E file contains no new failure/race/digit/dialog regressions. The required rendered and checkpoint-specific evidence is incomplete.

The reviewer credited typed action results, TLS duplicate handling, Arabic digit normalization and basic dialog semantics. The reviewer could not authenticate native runtime execution from a table alone. Five findings, three core implementation risks plus dialog and evidence concerns; no generic smell refactor is assigned.

## Spec axis — five findings

Reviewer: `t03_r9_spec`, independent Application Security Engineer; read-only source review, no runtime checks. Original P1/P2 labels are preserved.

1. **P1 / F10 — Prior-password pending MFA can complete after rotation.** `route.ts:80,235,307`: pre/post timestamps are not the required atomic coordination. The assignment explicitly rejects a timestamp precheck as a race-prone substitute. The added integration sequence at `auth-integration.test.ts:2548` is not the required controlled concurrency proof and does not cover the backup-code ordering.
2. **P1 / F01 — Baseline authorization accepts materially different schemas.** `baseline-identity.ts:326–331,404,721–737`: exact type precision, enum namespace, index key shape, predicates and expressions remain unproved.
3. **P1 / F06 — The alternate provider path loses Origin/CSRF protection.** `route.ts:179–192`: the new interception reaches the command before provider middleware.
4. **P2 / F09 — Input handling is only partially closed.** `src/app/verify/page.tsx:19,190` and `src/modules/identity/provisioning.ts:416`: UI truncation/filtering defeats meaningful malformed/long feedback, and controlled owner confirmation still accepts ASCII-only OTP input.
5. **P2 / F11 — Pending dismissal lacks request ownership.** `security-client.tsx:200–211`: late results can populate a new dialog instance after the initiating dialog was dismissed.

The reviewer credited source repairs for F02/F03/F04/F05/F07/F08. It separately noted missing new production-browser regressions, the purported 129-character fixture actually containing 131 characters, and missing role/database-level `search_path` fixtures. These are coverage limitations, not proof that every corresponding implementation repair failed.

## Parent disposition and reproduced behavior

### R10-01 / P1 — F10 credential proof and rotation still race

Locations: `src/app/api/auth/[...all]/route.ts:80,235,256,307,320`.

With a genuinely provisioned/MFA-confirmed synthetic owner: authenticate session A; start password-authenticated unfinished challenge B with the old password; hold an advisory lock used by a temporary PostgreSQL trigger on deletion of B's verification row; submit B's valid TOTP and observe its real `pg_locks` waiter after the timestamp precheck; commit password change through A; then release B's challenge-consumption barrier. Both HTTP operations return 200. B's new session is created after the credential update and passes `requireActor`.

Expected: when rotation commits first, old credential proof cannot yield authorized access. Actual: comparing *session creation* time accepts the newly minted session from *old password proof*. Post-change lookup with the original, now-replaced cookie can return no session and skip invalidation; swallowed cleanup failures are another unsupported guarantee. No mocked persistence or sleep-based synchronization was used. Fix atomic proof/rotation coordination, both orderings, TOTP and recovery completion, rollback and replacement-session preservation.

### R10-02 / P1 — F01 still records history for non-equivalent schemas

Locations: `src/cli/baseline-identity.ts:326–331,401–436,641–665,721–737`.

Three separate real PostgreSQL databases were initialized from the actual canonical baseline, then each was altered before the real baseline/recovery entry point ran:

| Deliberate deviation | Actual result |
|---|---|
| Same-name unique email index with `WHERE false` | Equivalent=true; recovery succeeds and records completed history; duplicate emails remain possible |
| Same-name unique composite `(email, name)` index | Equivalent=true; recovery succeeds and records completed history; same email with different names remains possible |
| `user.createdAt` changed to `timestamp(0)` with `CURRENT_TIMESTAMP + interval '1 day'` | Equivalent=true; recovery succeeds and records completed history |

All retained-data sentinels survived. This is unauthorized history approval, rather than a data-deletion finding. Existing repair tests correctly reject the original non-unique index, false boolean default and redirected FK, but token inclusion and substring defaults still accept the variants above. Require structured catalog semantics for type precision/namespace, defaults, exact index keys/expressions/predicates/uniqueness/validity and constraints, before any history or recovery mutation. Equivalent approved schemas must still succeed without losing retained data.

### R10-03 / P1 — F06 introduces an Origin bypass with persistent lockout impact

Location: `src/app/api/auth/[...all]/route.ts:179–192`.

Against the fresh production build with a genuine authenticated cookie, a request with an untrusted Origin to provider-controlled `/two-factor/get-totp-uri` is rejected 403. The intercepted `/two-factor/generate-backup-codes` with the same cookie and `text/plain` JSON wrong-password body instead returns 400 four times, then 429. The database records five failures and an active lock; a subsequent trusted-origin request with the correct password also returns 429. The attacker does not need the password to cause this protected-state mutation/lockout. This evidence establishes the server request boundary; it does not claim a cross-site exploit under every browser's cookie policy.

Keep the repaired shared persistent budget and authorization checks, but apply pinned-provider-compatible Origin/CSRF protection before body handling/commands/mutations on the interception. The first Node diagnostic used `NODE_ENV=test`; pinned Better Auth defaults to skipping Origin checks there, so its provider-control 200 was an incorrect diagnostic expectation. The production-browser 403/control versus intercepted mutation is the decisive result. Do not use test-mode Origin skipping as production evidence.

### R10-04 / P2 — F11 late completion leaks into a reopened dialog

Locations: `src/app/settings/security/security-client.tsx:61,86,200–211,321`.

The production-browser probe submits genuine regeneration, holds its actual Server Action response after the backend has committed, dismisses with Escape, and reopens the now-empty dialog before releasing the held response. The earlier request's recovery codes populate the new dialog. Dismissal itself is currently allowed while processing; reopening is also allowed, and the success callback unconditionally sets `newCodes`.

Define and implement a consistent pending-dismissal policy and tie each completion/error to its owning dialog/request generation. A response from a dismissed generation must not restore codes/password/error state in a later generation. Closing UI does not roll back an already committed backend operation. Preserve the working idle focus behavior and verify both pre-commit and post-commit response barriers.

### R10-05 / P2 — F09 controlled CLI and invalid-input handling remain incomplete

Locations: `src/modules/identity/provisioning.ts:416`, `src/app/verify/page.tsx:19,190`.

A real pending owner with a valid TOTP fails controlled confirmation with Arabic-Indic and Persian digit representations (`INVALID_CREDENTIALS`), while the identical ASCII code succeeds and closes bootstrap. In the UI, character stripping and `.slice(0, 6)`/`maxLength=6` silently discard malformed/long input, making the added long-length feedback unreachable. Genuine Arabic-digit browser MFA does succeed and is credited.

Additionally, exporting `normalizeOtpDigits` from the App Router page causes a fresh webpack build to fail TypeScript route validation (`TS2344`, invalid page export). A fresh default Turbopack build succeeds. This is a fallback/build-validation gap, **not a default production-build failure**. Place reusable pure input logic in a normal shared module, use it at both boundaries, and preserve complete input long enough to reject it explicitly instead of silently authenticating a truncated prefix.

### R10-06 / P2 — F03 fixture breaks actual CI configuration

Location: `tests/integration/auth-integration.test.ts:466`.

[Hosted run 43578334853](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43578334853), job 132397452124, checks the PR merge candidate containing submitted HEAD against accepted main. Unit tests pass (115); integration has 61 passes and one failure: the fixture asserts `http://127.0.0.1:3000` while the actual correctly configured CI provider is at port 3100. Later top-level production-build and browser steps are **SKIPPED**, not passed. The startup integration's own default build succeeds. Planning validation run 43578334774 passes.

Configure and restore the fixture's actual HTTP/HTTPS providers explicitly or assert the deliberately configured current origin. Test both local 3000 and CI 3100 without loosening trust/cookie assertions or changing CI merely to hide the mismatch. Retain the genuine HTTPS-provider repair.

### R10-07 / P2 — Close regression and checkpoint evidence gaps

The committed E2E file is unchanged in the reviewed diff: its 30 existing journeys pass but do not prove the newly requested logout failure, production typed errors, alternate digits, async dialog or controlled concurrency cases. Commit meaningful regressions for repaired behavior. The F04 fixture named 129 characters is `'A'.repeat(129) + '!1'`, actually 131; cover exact 128/129 and closed-bootstrap/no-write outcomes. Complete the assigned F05 role/database-level `search_path` cases as well as the working ambient `PGOPTIONS` case.

Six native IDs/profile hashes are reported. This is more substantive than a persona-only claim, but the report alone cannot authenticate the runtime. In particular the accessibility reviewer records checkpoint `453c54c`, before the submitted UI changes; that does not establish final-frozen rendered acceptance. Require actual native AppSec and accessibility findings at the final committed implementation, relevant browser observations, reconciliation and truthful NOT RUN limits. No allegation of fabricated execution is made merely from this evidence mismatch.

## Repairs retained

- **F02:** uppercase TLS mode is preserved and duplicate case variants fail before connection; direct TLS-client probe confirms behavior.
- **F04:** provider-compatible password/email validation now precedes provisioning mutation. Source and existing negative integration evidence support the repair; exact boundary/state evidence still needs completion.
- **F05:** public-schema pinning, explicit namespace checks and in-transaction verification are present; the original ambient `PGOPTIONS` regression passes.
- **F06:** alternate recovery generation now reaches the persistent locked command; the former missing shared budget is repaired. R10-03 is the new request-boundary gap.
- **F03:** actual HTTP/HTTPS provider lifecycle and signed-cookie sign-out tests exist; retain them while fixing the configurable-origin fixture.
- **F07:** actual production-browser logout 503 leaves the page in place with Arabic feedback and an enabled retry; successful retry removes protected access.
- **F08:** actual production wrong-password action displays Arabic guidance without a minified React error.
- **F09/F11:** real Arabic-OTP protected login succeeds; idle named modal, background inertness, keyboard containment, Escape close and focus return are observed. Pending-response ownership is the remaining dialog gap.

## Checks and limits

| Check actually executed by Codex | Result |
|---|---|
| `npm test` | Exit 0; 115/115, nine files |
| `npx vitest run tests/integration/auth-integration.test.ts tests/integration/migration-upgrade.test.ts tests/integration/readiness.test.ts` | Exit 0; 59/59 selected tests, three files, local provider port 3000 |
| `npm run typecheck`; `npm run lint` | Exit 0 each after fresh default build; final exit records retained in ignored work |
| Fresh `npm run build` (default Turbopack) | Exit 0; used for browser checks |
| Fresh `npx next build --webpack` | Exit 1; invalid `normalizeOtpDigits` page export; distinguished from default build |
| Existing E2E via isolated `work/t03-r10-browser.config.ts` | 30/30; fresh production artifact, configured three viewports, retries 0; log and last-run status confirm passed |
| PostgreSQL observational probes via `work/t03-r10-probes.config.mjs` | Exit 1: five observational cases pass; one provider-control expectation fails because test mode skips Origin. The passing cases reproduce TLS repair, credential race and three schema false acceptances |
| Controlled CLI confirmation probe | Exit 0; one observational case proves Arabic/Persian rejection and equivalent ASCII success |
| Production browser observer suite | First execution: three pass/two fail due to diagnostic selector and timestamp interpretation; corrected targeted rerun: exit 0, two pass. Five distinct observations established across the runs, not five product acceptance passes |

The first database setup used an incorrect synthetic operational database URL and failed before schema application; corrected isolated setup/migrations succeeded. The initial logout selector also matched Next's announcer; the corrected probe targets the actual Arabic failure. A raw timezone-less PostgreSQL timestamp was initially interpreted as local time; the corrected check uses a database UTC boolean and verifies the real subsequent 429. These are diagnostic corrections, not concealed product findings. Local startup integration was not rerun this round; hosted startup evidence and selected-local integration counts are kept distinct. Dependencies were unchanged; the existing pinned installation was used, not a newly claimed `npm ci`.

Physical TTY, screen readers, real devices, deployment and real data: **NOT RUN**. The unchanged E2E reflow checks do not establish full accessibility acceptance. Diagnostic programs/configuration and raw outputs stay ignored in `work/`; sanitized observations are in [the evidence record](evidence/T03-round10-observations.json). They test observed behavior, including vulnerabilities, and are not a committed green regression suite.

## Graphify and resource provenance

Supplementary local code-only manifest: `D:/Lawyer/work/graphify/22a8546f6457-320347cf/SOURCE.json`; full source SHA `22a8546f64570314437ae77ea47cf56bc98911e3`; manifest SHA-256 `9506FD8DBAC46866FAB6EE48B496A92E517A9D30F4BB212F27967E639F219FF7`; 262 nodes, 609 edges, 11 communities. Parent queried `handleAuthSecurityGuards`: complete 30-node/102-edge result, approximately 4,919 tokens despite requested 1,600-token budget. Actual source/tests were inspected. Graph coverage excludes Prisma/root configuration and does not prove authorization or concurrency. No upload, labeling, keys, tool upgrade or hook installation.

Review ran in isolated `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`. Synthetic PostgreSQL container `lawoffice-codex-t03-r10`, full ID `53681a4d965f44694d978e9e31113770bf6b1c8facf98de4e5ca8b08d3fc46c0`, was verified by ID and label `lawoffice.review=t03-round10`, then stopped after tests. Its temporary port 14751 and managed browser port 14752 were released. Existing owner container `2528fb994d14` at port 5433 was preserved; no installed agent assets were removed.

## Next assignment

The complete, self-contained correction instructions are [round 10](T03-corrections-round10.md) and embedded in `docs/tasks/T03.md`. They assign bounded DBRE, Identity, Frontend and Test work, followed by final-frozen independent AppSec/accessibility review. No implementer needs to open this review to discover the defects or required tests. Acceptance remains with Codex after actual code and evidence review.
