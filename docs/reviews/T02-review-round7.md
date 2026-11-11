# T02 — Independent review of correction round 6

Decision: **CHANGES_REQUESTED** on [PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). R24's application startup fix is verified; the remaining work is the test harness. Keep the PR draft, with no main merge or T03. Review date: 11 November 2026, Africa/Cairo.

- Inspected published head: `f54d2cd5b92e53c8bec25773dfa753d44c36d3bd`.
- Refined implementation: `812d95e6a00552a3bc8a49653ff6ef43a35bf8f8`; initial runtime/test implementation: `3ddd61522583ed014af435be2c3b9f6db9f329ed`.
- Fixed point: `1aaae2fde015d7dee6a1eb950b8f5e6221e1e4b3`; diff `git diff 1aaae2f...f54d2cd`.
- The final report commit changes only the submission and validation output. The refinement changes process teardown tests; runtime source remains the initial correction.
- Latest fetched main: `edc4118d5e46170661ee4a39862a23fe7be1b7b6`, the owner's merged [PR #7](https://github.com/MohamedAlksas/LawyerOS/pull/7) specialist-routing rule. It is not yet integrated into this task branch. The next Codex assignment explicitly routes the remaining test slice accordingly.

Two fresh independent reviewers inspected Standards and Spec. Their axes and severity judgments are retained separately below; shared IDs identify overlap. [Next assignment](T02-corrections-round7.md).

## Standards

**R27 / P1 — Readiness regression can pass on failure.** `tests/integration/startup-process.test.ts:281–296` gates readiness assertions on HTTP 200 and catches every error, including failed assertions. An HTTP 503, rejected fetch, invalid JSON, incorrect body, or missing no-store therefore cannot fail that startup check. This violates R25's required readiness HTTP 200 observation and the testing/implementer rules against concealed test failures. Require an explicit disposable target, assert status/body/headers unconditionally, and propagate failures.

**R28 / P2 — New startup test bypasses the existing isolation boundary.** At `:234–245`, an unchecked `TEST_DATABASE_URL`, or a fallback `lawoffice_dev` URL, is passed to a production-mode child. That mode does not apply the test-only identity guard. The explicit URL can therefore reach readiness connection code without the parent checking that it is a dedicated non-operational target. Apply the existing shared validator in test mode to the original operational/test pair before spawning; reject missing or unsafe targets.

**R29 / P2 — Cached build has no source attribution.** `:94–102` treats existence of `.next/` as sufficient and skips building. After source changes, the standalone regression can exercise an older artifact while appearing to verify current source. R25 requires an artifact attributable to the frozen checkpoint. Rebuild the current source through an explicit prerequisite or verify recorded provenance before reuse.

No additional material smell is asserted; parameterizing the duplicated invalid-startup cases is optional. The source changes are within the assigned scope.

## Spec

The Spec reviewer independently reported the same three requirement gaps, each at **P2**:

- **R27:** R25 requires observing liveness and readiness HTTP 200. Conditional status checks and a swallowing catch leave readiness unproved.
- **R28:** T02 requires a synthetic database distinct from operational databases, and R25 specifies a valid disposable URL. Production-mode child startup bypasses that boundary unless the parent first validates the original pair.
- **R29:** R25.1 requires an artifact attributable to the frozen source. A directory-existence check establishes no checkpoint provenance.

Invalid-case natural exit and watchdog failure are correctly distinguished in the submitted source. Teardown now targets captured process identities. There is no request to rewrite the resolved URL grammar, pool or startup exit implementation.

## Independent execution

- Lint/typecheck: exit 0. Units: **43/43** locally and **43/43** with explicit CI=true, exits 0.
- Fresh independent `npm.cmd run build -- --webpack`: exit 0, using the inspected checkout; build ID `wYIGIBTksBVwsUk9_x8rd`. This alternate local verification changes no source/configuration and does not claim a local default Turbopack build pass.
- Full submitted integration suite: **7/7**, exit 0, against a new review-owned `postgres:16.8-alpine` instance, tmpfs and private loopback port 8954. The two invalid-startup cases exited naturally with code 1 and closed their ports, establishing **R24 resolved**. The positive suite's green result alone cannot establish readiness because of R27.
- **R27 actually reproduced:** the unmodified valid-startup test was run alone against an explicit synthetic test URL on a known closed private port. A read-only observation wrapper recorded live HTTP **200** and readiness HTTP **503**, while Vitest still reported **1 passed / 2 skipped**, exit 0. The wrapper returned original fetch responses unchanged and altered no assertion/application source. Local trace: ignored `work/round7-observed-http.jsonl`.
- The existing public shared validator independently rejects a `lawoffice_dev` test target. The startup harness does not call it before launching its production child. No real operational database was contacted. An additional live counterexample using a development-named database inside the owned review container was **NOT RUN** because Docker became unavailable before that step; the ownership check stopped the command before mutation.
- Hosted application [run 43068984932 / job 130691461634](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43068984932/job/130691461634): **success**. Planning [run 43068984920 / job 130691450592](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43068984920/job/130691450592): **success**. Job logs independently identify checkout `f54d2cd5b92e53c8bec25773dfa753d44c36d3bd` and application counts 43 units / 7 integrations. The connector's PR-trigger-filtered commit-run list was empty; direct known-job metadata and checkout logs supplied the exact-head verification.
- Published ZIP independently matched canonical source text before review edits, with **zero text-content differences**. Both planning validators and regeneration passed: **71 sources / 253 ZIP entries / matching source hashes / zero broken links**. No application code was edited by Codex.

## Native ownership and remaining limits

Bounded public tool-record inspection confirms actual preflight, DevOps-owned instrumentation/test edits, two frozen support passes (initial `3ddd615...`, then refined `812d95e...`) and final reconciliation. Lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`; backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`; test `db5fe921-b956-41a0-8960-044838a849d9`. Parent records 2243/2245/2247, 2258, 2302/2304, 2310, 2441, 2453/2455 and 2461 establish the sequence. Supports made no application writes. R25's blanket-process cleanup is absent from this correction's inspected execution; exact readiness proof, safe target selection and artifact attribution remain open.

Docker became unavailable before final cleanup confirmation. Review container `lawoffice-codex-t02-r7`, ID `57c3d1ede45a9ab06186a4ea9230bc3a94548a4fc2024503f9f093c45aef16d0`, label `lawoffice.review=t02-r7`, contains synthetic data only and was launched with --rm/tmpfs. **Removal is not confirmed.** When Docker is available, verify that exact identity/label and stop only that owned container. Do not stop unrelated resources. Test server children from completed runs were handled by the captured-PID test harness.

An earlier additional-check attempt was not executed because automatic approval review hit a usage limit, not because it found the action unsafe. After the stated reset time and the owner's continuation request, the negative check and bounded native audit ran successfully through normal approval. This did not change the review findings or grant application acceptance.

Standards: 3 findings, highest P1 (false readiness success). Spec: 3 overlapping findings, each P2. R24 is closed; remaining acceptance work is a narrowly scoped testing correction led by Test Automation.
