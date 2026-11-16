# T03 — Independent Codex review, round 11

Date: 14 November 2026, Africa/Cairo. Decision: **CHANGES_REQUESTED**. Continue on `feature/t03-identity-sessions` and keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. No merge, T04, deployment or real client data. This reviews the round10 implementation and gives credit to completed repairs; it does not assign them again as open defects.

## Checkpoints and review scope

| Item | Verified checkpoint |
|---|---|
| Canonical origin | `https://github.com/MohamedAlksas/LawyerOS.git` |
| Accepted T02/main | `e598c1649b82f34ea94338cda5ef25da32b5299f` |
| Fixed assignment point | `b965c4356fa584d02179c61e11fc56ea75300ee7` |
| Frozen implementation | `8e4a8cbfae69f8e0037ba6b2507cdffc834039f1` |
| Independently verified submitted remote HEAD | `b0770d758dadfbbd409e5164e18b8f0f6c6b26f6` |
| Diff | `git diff b965c4356fa584d02179c61e11fc56ea75300ee7...b0770d758dadfbbd409e5164e18b8f0f6c6b26f6` |

Two commits change 13 files, with 1,138 insertions and 270 deletions. The final commit changes only `docs/reviews/T03-submission-round10.md`; the frozen application and submitted source/tests/configuration agree. The assignment is the complete round10 prompt and then-current T03 card, plus the product, security, dependency and review rules. Source, tests, pinned provider code, hosted CI and actual PostgreSQL/production-browser behavior were inspected in an isolated review checkout. No application source was changed by Codex.

Two fresh read-only independent reviewers examined this same fixed diff. Their separate axes follow, lightly cleaned without merging or reranking their findings. Parent experiments are documented afterward; they are not attributed to those reviewers as runtime work.

## Standards

Reviewer `t03_r10_standards`, Code Reviewer. Runtime **NOT RUN**; source, diff, provider and documented standards only.

1. **P1 — Credential proof is still inferred from challenge creation time.** `src/app/api/auth/[...all]/route.ts:410–427` treats `challengeCreatedAt` as password-proof age. Pinned provider `sign-in.mjs:317–352` verifies the credential before its two-factor hook creates the challenge. A sign-in using the old password can pause, resume after rotation/cleanup, and create a newer challenge that passes both checks. This violates `docs/SECURITY_OPERATIONS.md:44`. Coordinate proof generation with authoritative credential state; timestamps cannot establish this invariant.
2. **P1 — Intercepted recovery weakens the provider Origin contract.** `route.ts:151–152` invents an origin for missing Origin/Referer, and `175–180` trusts request Host/forwarded protocol. The pinned provider rejects cookie-bearing missing-Origin requests and evaluates configured trusted origins. This violates the supported-provider requirement in the round10 T03 card and `SECURITY_OPERATIONS.md:46`. Check production parity for missing/null origins and arbitrary Host values.
3. **P2 — Required rendered UI evidence is missing.** `docs/reviews/T03-submission-round10.md:123–156` contains no browser/E2E execution, screenshots, viewport/keyboard/200% observations or matching NOT RUN disclosure. The unit/integration statement at line154 does not prove rendered focus behavior. This breaches `GEMINI.md:52`, `REVIEW_PROTOCOL.md:89,93`, and the project testing skill.
4. **P2 — Native support results lack inspectable references.** Submission lines48–49 provide IDs and PASS summaries without returned-result artifact/tool/UI references or a durable-log limitation. The required execution-evidence contract in `docs/AGENCY_AGENTS.md` requires them. This is missing evidence, not proof that execution was fabricated.

Credits: shared OTP parsing preserves malformed input and digit semantics; catalog verification now checks exact index shape and timestamp precision; dialog generation tracking addresses dismissed-request state restoration. No additional consequential smell refactor was identified.

Standards: **4 findings; highest P1**.

## Spec

Reviewer `t03_r10_spec`, Application Security Engineer. Runtime **NOT RUN**; independent source/spec inspection only.

1. **P1 — R10-01 remains non-atomic.** `route.ts:407–434` checks credential age after provider session issuance and backdates `createdAt`, swallowing failures. A postcheck failure during rotation can return a newly issued session unchanged. Password cleanup also happens after provider commit (`309–368`); returning500 does not roll back the credential update. Round10 spec line36 explicitly forbids a precheck, session timestamp, raw-cookie guess, best-effort deletion or swallowed exception as a substitute. The integration test at line2642 is sequential; barrier/both-ordering/backup/failure regressions are absent.
2. **P1 — R10-03 invents inconsistent trust.** `route.ts:151–180` substitutes request origin for missing headers and trusts Host/forwarded protocol. The pinned provider checks missing and inferred null origins against configured trust. Spec line56 requires the supported trusted-origin/CSRF contract and forbids a second inconsistent trust configuration. The new test covers one untrusted JSON Origin without the required production control/matrix.
3. **P1 — R10-02 equivalence is partial.** `baseline-identity.ts:663–676` omits index readiness/access method/null-distinctness semantics; column inspection omits `udt_schema` (`408–429`). Spec line46 requires schema-qualified types/enums and index validity/readiness plus relevant properties. Only three new PostgreSQL reproductions were added; broader catalog and role/database search-path cases remain unproved.
4. **P2 — R10-07 browser acceptance is missing.** No E2E files changed. Spec line86 requires focused logout503/retry, production action errors, digit and modal-race regressions. PASS summaries contain no held-response browser proof; generation lifecycle cleanup on unmount/navigation is also absent from source. The latter needs actual behavior evidence rather than an assumption of failure.

Credits: shared complete-input parsing, leading-zero preservation, dialog generations, exact index columns, precision/anchored defaults and configurable HTTP-origin repair.

Spec: **4 findings; highest P1**.

## Parent-confirmed remaining defects

### R11-01 / P1 — Old credential proof can create a new challenge after rotation

Location: `src/app/api/auth/[...all]/route.ts:264,410–433`; pinned provider credential read/verification occurs before session and MFA challenge creation.

A real PostgreSQL `BEFORE INSERT` trigger gates only sessions with the synthetic old-sign-in User-Agent. After genuine owner provisioning, MFA confirmation and authenticated session A, submit sign-in B using the old password. Observe B waiting on the trigger's advisory lock: its password has already been verified, but the provider has not created its later MFA challenge. Change the password through A and wait for its200/cleanup to commit. Release B. Its sign-in returns200 and creates a challenge newer than `account.updatedAt`; valid TOTP returns200 and `requireActor` accepts B.

This reproduction uses genuine protocol requests and an observed database barrier; no mocked persistence, guessed timing or postcheck failure injection is required. The new code repairs some existing-challenge handling but still mistakes challenge creation time for credential-proof version. Session backdating does not repair this ordering. Coordinate the entire proof lifecycle, including password verification/challenge issuance, MFA completion, rotation and protected authorization, against authoritative credential state. Also close the source-visible swallowed-failure path and provide the required rollback/fail-closed guarantees.

### R11-02 / P1 — Baseline approves an unapproved constrained domain as plain text

Location: `src/cli/baseline-identity.ts:408–454,663–676`.

Start a disposable database with the actual canonical migration and a retained sentinel. Create `public.codex_image AS text CHECK (VALUE <> '')`; alter `public.user.image` to that domain. The verifier's coarse `data_type`/base `udt_name` still match text. The actual baseline entry point reports equivalent=true, succeeds with recovery and records one completed history entry. Inserting an empty image then fails the unapproved domain constraint; retained data is preserved.

Expected: unsupported domain/type identity differences must fail before history approval. Actual: a schema with different write semantics is certified canonical. Add exact namespace-qualified type/domain identity and supported type modifiers, alongside the already requested index readiness/relevant semantic checks. Preserve the new rejection of partial/composite indexes and timestamp/default deviations. The parent did not reproduce every omitted index/enum property; those remain source/spec coverage concerns, not fabricated runtime findings.

### R11-03 / P1 — Request Host/missing/null Origin still changes protected state

Location: `src/app/api/auth/[...all]/route.ts:151–180`.

Production server, fresh default Turbopack artifact, genuine authenticated owner cookies. A straightforward untrusted Origin with the configured Host now receives403 and is credited. Three variants still pass the interception:

| Variant | Provider control | Intercepted recovery generation |
|---|---|---|
| Untrusted Origin plus matching request `Host`/forwarded protocol and `sec-fetch-site: same-site` | 403 | 400; wrong-password counter advances |
| Cookie-bearing request without Origin, Referer or Fetch Metadata | 403 | 400; counter advances |
| `Origin: null`, `sec-fetch-site: same-origin`, untrusted Host | 403 | 400; counter advances |

The provider control uses its supported JSON media type; the intercepted requests use simple `text/plain` JSON. Three stored failures confirm real mutation. These are server request-boundary/contract proofs; no claim is made that every browser permits every manually supplied Host/header combination or that every hosting configuration is exploitable. Request-controlled destination headers must not expand configured trust; null-Origin inference must still undergo the pinned provider's trust validation. Retain the shared persistent budget and the repaired ordinary untrusted-Origin rejection.

### R11-04 / P2 — Complete committed regressions and attributable review evidence

No browser tests changed, despite the round10 assignment. Existing CI browser tests still pass, but do not establish the newly requested states. The submitted claim that unit/integration tests verified rendered focus/event handling is unsupported by the changed tests. Six native conversation IDs and final checkpoint names are reported, but full profile hashes are abbreviated and actual returned audit artifacts/tool-result references are missing. The pasted timeline ends with AppSec still awaited before the report is assembled; it does not independently establish the final AppSec result. Do not infer fabrication; require observable, current, checkpoint-specific evidence and truthful limits.

Complete the required genuine race, request-boundary, schema and browser regressions; exact credential boundaries now have useful tests, but the full 128-character login/MFA and role/database search-path matrix still needs closure. Missing evidence does not turn the parent-confirmed UI repairs below into unimplemented features. Do not claim global WCAG AA or zero vulnerabilities from a limited pass.

## Repairs independently credited

- **R10-04/F11:** real committed regeneration response was held, dialog dismissed and reopened, then the old response delivered. Prior codes stayed suppressed, password stayed empty and a new attempt remained enabled, at390/768/1440. Idle focus containment, Escape and trigger focus return also worked. Further pending/error/unmount/200% coverage is still required for full requested evidence.
- **R10-05/F09:** browser retains a seven-digit input and displays Arabic long/malformed feedback; genuine Arabic OTP signs in. Separate controlled owner-confirmation fixtures succeed with Latin, Arabic-Indic and Persian TOTP. Helper is outside the page; fresh webpack validates. Leading-zero/helper behavior is covered by unit tests.
- **R10-06/F03:** configured current HTTP origin repair is present; local auth/migration integration passes with port3100, and complete hosted CI passes. Preserve actual HTTPS lifecycle checks.
- **R10-02/F01:** new exact index-key/predicate/expression checks, timestamp precision and anchored defaults close the three previous repro cases in the committed integration suite. The domain/type-identity gap is the remaining demonstrated false approval.
- **R10-07:** exact128/129 fixture lengths and enrollment boundary checks are improved. Prior TLS casing/duplicates, schema pinning, shared persistent lockout, retryable logout and typed Arabic expected errors remain credited. No dependency/stack change was required.

## Actual validation and diagnostic limits

| Check | Observed result |
|---|---|
| `npm test` | Exit0; 130/130, nine files |
| `vitest run` selecting auth and migration integration | Exit0; 58/58, two files, configured HTTP3100 |
| `vitest run tests/integration/db-readiness.test.ts` | Exit0; 4/4. Local integration total62; local startup integration not rerun |
| `npm run typecheck`; `npm run lint` | Exit0 each after the fresh production artifact |
| Fresh webpack build | Exit0 after local permission correction; unsupported page-export defect is closed |
| Fresh default build | Exit0 on direct Next CLI retry; artifact used by production-browser probes |
| Real PostgreSQL observer suite | Exit0; two observations reproduce the proof-generation race and domain false approval. Passing defect observers are not product acceptance |
| Controlled owner-confirmation probes | Exit0; three separate genuine-OTP fixtures pass |
| New production browser UI observers | Six pass: two behavior cases at three viewports; long/malformed input, Arabic login, focus and held-response dismissal |
| Production Origin observer | Isolated corrected desktop run exit0; one matrix case confirms the three request-boundary gaps |

[Hosted CI43603119851](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43603119851), job132471929123, checks merge candidate `58f783c` containing submitted `b0770d7` into accepted main: clean install/generation/migrations/lint/typecheck, **130 unit,65 integration, default build and30 existing E2E all pass**. Planning run43603119855 also passes. Unlike the previous submission's CI, these build/E2E steps are not skipped. Green CI does not cover the newly reproduced defects.

Diagnostic setup errors are retained honestly: restricted local database connections failed with EACCES; approved rerun passed. The initial selected file list used nonexistent `readiness.test.ts`; actual `db-readiness.test.ts` was then run separately, without repeating the already-passing58. Restricted webpack prerender failed EPERM; subsequent webpack passed. A local Turbopack CSS worker exited before connecting; direct default CLI retry passed without application/config changes. The initial nine-case browser observer run passed six UI cases and failed three controls because the provider rejects `text/plain` with415 before Origin checking. JSON provider controls corrected that diagnostic. The corrected all-project Origin run passed desktop, then hit provider IP rate limiting in the other projects; an isolated fresh-server desktop run passed. These setup/control failures are not relabeled all-green suites, bypassed product limiters or product defects.

The existing pinned dependency installation was reused; no new local `npm ci` is claimed. Physical TTY, screen reader, real devices, new-modal200% exercise, deployment and real data are **NOT RUN** locally. Sanitized results are in [the observation record](evidence/T03-round11-observations.json); diagnostic source/config/logs remain ignored in `work/`.

## Graph and cleanup provenance

Manifest `D:/Lawyer/work/graphify/8e4a8cbfae69-b79237fc/SOURCE.json` was checked against full implementation SHA; actual SHA-256 `B91DF14970FC13E363EA548E1C61427066CBDB0CF14F5703C6B09C8B0CE95D21`. Graph has266 nodes/623 edges/13 communities. Parent query `handleAuthSecurityGuards` returns a complete32-node/121-edge answer, approximately5,660 tokens despite requested1,000. Actual source/provider/tests were inspected. Coverage excludes Prisma/root configs; no upload, labels, secrets, keys, hooks or upgrades.

Owned synthetic container `lawoffice-codex-t03-r11`, ID `7e5fead52ecb37367fbd19f940953bb568653f68e194b00b6426d6cefe157edd`, label `lawoffice.review=t03-round11`, was verified and stopped after tests. Root browser fixture counts were zero users/zero sessions before removal; ports14753/14754 were released. Existing owner container `2528fb994d14`/port5433 and all installed/untracked agent assets were preserved.

## Next step

The [complete round11 assignment](T03-corrections-round11.md), also embedded in the T03 card, narrows implementation to the remaining credential, schema and request-boundary work plus required regression/evidence closure. Native DBRE/Identity/Test leads and independent AppSec/Accessibility supports have bounded ownership. No Frontend application rewrite is assigned for the verified completed UI repairs. Acceptance remains with Codex after actual implementation review.
