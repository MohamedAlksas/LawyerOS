# T03 — Codex review, round 8

Decision: **CHANGES_REQUESTED**. Date: 14 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. No merge, T04, deployment or real data. [Complete correction assignment](T03-corrections-round8.md).

## Inspected checkpoints

- Canonical origin: https://github.com/MohamedAlksas/LawyerOS.git; feature branch `feature/t03-identity-sessions`.
- Fixed point: Codex publication `55fa7276a8dca353de00083e4c08e7919cbf1585`.
- Frozen implementation: `4a8d17848b16ebaab17f86e3ae9ac9c495e74ab2`.
- Independently verified local/remote submission: `fec77f58c72ef6918d8241862655ac1954a3024a`.
- Accepted main/T02 remains `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed diff: `git diff 55fa7276a8dca353de00083e4c08e7919cbf1585...fec77f58c72ef6918d8241862655ac1954a3024a`: six files, 1042 insertions, 187 deletions. Both commits inspected; the final commit changes only the submission report.
- Runtime verification used isolated checkout `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, branch `codex/t03-review`. Tracked application source/tests were not modified for this review. Scratch probes stayed under ignored `work/`.

## Standards

The fresh independent Standards child `/root/t03_r7_standards` failed with a usage-limit error and supplied no substantive report. This axis is **NOT RUN** independently. No findings count or pass is attributed to that child. Parent source/runtime findings below are Codex's own review, not a substitute claimed to be independent.

## Spec

The fresh independent Spec child `/root/t03_r7_spec` failed with a usage-limit error and supplied no substantive report. This axis is **NOT RUN** independently. The implementer's three reported specialist PASS verdicts do not replace Codex acceptance.

## Parent findings

1. **P1 — Recovery records history for incompatible managed schema.** `src/cli/baseline-identity.ts:359–374,406–417,445–486` does not read column defaults, discards primary-key columns and foreign-key source/target definitions, and compares index names without uniqueness/definition. Enum membership also does not establish exact namespace/value equivalence. The recovery branch at lines 594–610 treats this incomplete result as authorization for `migrate resolve`.

   Round-7 correction 3 requires: “Before recording/resuming history, verify actual managed-schema equivalence: columns and relevant types/nullability/defaults, enum values, primary/foreign-key definitions and targets/actions, required indexes/uniqueness. Names alone are insufficient authorization for recovery.” `docs/DEPENDENCIES.md` now claims these checks are implemented, but source and actual behavior contradict that claim.

   Three independent synthetic PostgreSQL databases started from the approved SQL without migration history. In each, one definition was changed: (a) replace `user_email_key` with a nonunique same-name index; (b) change `twoFactor.verified` default from true to false; (c) retarget `session_userId_fkey` to an unrelated table while preserving name/cascade actions. In all three, `verifySchemaEquivalence` returned true with no errors, the canonical baseline returned success/recovered, and one completed history record was written. After case (a), two users with identical email persisted. Sentinel data survived all cases. This is a demonstrated unsafe recovery authorization, not merely missing test coverage.

2. **P2 — Accepted ambiguous TLS parameters still lose explicit policy.** `baseline-identity.ts:155–171` checks keys case-insensitively but retrieves `sslmode` case-sensitively and reads only the first occurrence. Connection-free probes show `SSLMODE=verify-full` is accepted, becomes `ssl=false`, and loses the parameter in the canonical URL; `sslmode=disable&sslmode=verify-full` is accepted and canonicalized to disable. Round-7 corrections 1/2 require rejecting ambiguous/unsupported options before connection and preserving every accepted explicit policy. Reject unsupported casing/duplicates or normalize supported forms consistently; do not accept and discard a TLS instruction. These probes did not open sockets or claim actual plaintext disclosure. Normal single lowercase require/verify-full now produce nonfalse driver TLS settings and are credited as repaired.

3. **P2 — Historical-trust HTTPS evidence still uses the HTTP current provider.** `tests/integration/auth-integration.test.ts:687–710` changes the request URL but does not reconfigure/reload the current application's auth provider, despite round-7 correction 4: “Changing only the request URL is not a provider HTTPS configuration change.” An ignored copy of the submitted test retained real prior-provider issuance and cookie sign-out, then added an assertion immediately before the current HTTPS request. It observed `getAuth().options.baseURL === 'http://127.0.0.1:3000'`; expecting the HTTPS base failed. The prerequisite provisioning test passed; 37 unrelated cases were intentionally deselected. This establishes an evidence gap, not a production MFA bypass. The real session-cookie sign-out and persisted session deletion assertions now pass and must be preserved.

## Verified improvements

- Explicit port zero now rejects, and the omitted port remains canonical 5432 rather than ambient PGPORT.
- Ordinary lowercase require/verify-full now retain pg TLS configuration; unsupported routing parameters are rejected and Prisma receives a reconstructed URL.
- Actual server-side migration-history insertion failure, fault removal and successful retry now pass the submitted integration test. Already-completed and visibly incomplete schema cases also pass. The remaining recovery defect is insufficient verification before authorizing that resume.
- Real signed-session cookie sign-out replaces Bearer calls; prior HTTP/HTTPS issued sessions are removed in PostgreSQL.
- Eight pending owner attempts now launch together; failure count/lock state/excess rejection/expiry recovery assertions pass. Existing waiter-barrier and closure-order tests remain.

## Actual verification and limits

- `npm.cmd ci`: exit 0, pinned client generated. An early unit invocation before installation finished exited 1 because vitest was not yet available; the completed-install rerun passed **96/96**. No dependency files were changed.
- Fresh migration on the owned review database: exit 0. Lint and typecheck: exit 0.
- Initial submitted integration suite: **54 pass / 1 fail**, exit 1. The failing pre-existing readiness assertion requires literal database/user `lawoffice_test` / `lawoffice_user`, whereas the initial owned fixture used different synthetic names. The other three files, including all changed migration/auth tests and the fresh test-only webpack startup build, passed. Created the expected names inside the same owned container and reran readiness: **4/4**, exit 0. Thus all 55 unique submitted integration cases passed across these executions; do not describe the initial full command as exit 0.
- Parent observational probes: **4/4**, exit 0, deliberately asserting the reproduced defects and credited repairs. Passing observational assertions are not acceptance.
- Added HTTPS-provider assertion: **1 prerequisite pass / 1 expected regression failure / 37 deselected**, exit 1; actual prior-provider signed-cookie sign-out checks were reached before failure. [Sanitized observations](evidence/T03-round8-observations.json).
- [Application CI 43484656513](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43484656513), job `132089781490`, verified logs: merge of fec77f58 into accepted e598c164; **96 unit / 55 integration / 30 browser** pass; fresh startup default Turbopack build ID `E9OdRPlUZ8q5M0S0wtU34`; separate default production build passes. [Planning CI 43484656559](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43484656559) passes. Local browser/default-build reruns were **NOT RUN** this round; no UI/source outside the baseline CLI changed. Local webpack evidence is not called a local default build.
- Physical TTY capture remains **NOT RUN**. No production transport deployment or real client data was exercised.
- Planning-kit validation and installed Agency routing validation passed: 23 task cards, seven project skills and 14 required native definitions. Prompt index and planning package regenerated; staged whitespace check passed. No agent assets were removed.
- Submission Graphify manifest `D:/Lawyer/work/graphify/4a8d17848b16-f1f46c43/SOURCE.json` full source SHA matches the frozen implementation; SHA-256 `37C44294A6A08C5C3EE5B916B2AF0F1B142F2D425633CECDA1D5EE3F1973FC3A`. Query `verifySchemaEquivalence` returned complete 17 nodes/28 edges (~1575 tokens despite budget 1400), on the 253-node graph. Actual source/tests at the same checkpoint were inspected; the later report-only commit adds no code-graph difference. No external corpus upload or labeling.
- Exact owned container `3e5a5a81db45ff394330637945be37b527c73725e815d1ff17b3a962404d7f0c`, label `lawoffice.review=t03-round8`, was stopped/removed after verification. Existing `lawoffice-postgres-test` at port 5433 was preserved. Owner-installed assets and untracked work were preserved.

This publication changes review/planning documents, sanitized observations and derived handoff artifacts only. It does not implement application corrections or change the implementation model/workflow. Parent: **3 findings, highest P1**. Independent Standards/Spec axes unavailable; no independent approval claimed.
