# T02 — Review of correction round 2

Decision: **CHANGES_REQUESTED**. PR #4 remains draft; T03 is not released.

Review date: 11 November 2026, Africa/Cairo. Review took place in an isolated checkout; the active `D:/Lawyer` checkout, its installed agent assets, and operational databases were preserved.

- PR: https://github.com/MohamedAlksas/LawyerOS/pull/4
- Remote task branch: `feature/t02-runtime-ci`.
- Current main: `62494bad3eca1480d874e578e3cc5cd4926c6e40`.
- Actual main-integration checkpoint: `62287d0c5d2b8bd072238b55ed1ad30474dc7537`.
- Actual correction implementation: `4e9cc457b02e4ac45c1084d451e23e2c595cc9a6`.
- Inspected published head: `99a5b60118c03fc9ff44682c5a3ce46175ddb5ae`.
- The subsequent `968cc53de0332b3f8403ea3b4efd3b5b3d2ea92b` and inspected head change only the submission report.
- Review diff: `git diff 62287d0c5d2b8bd072238b55ed1ad30474dc7537...99a5b60118c03fc9ff44682c5a3ce46175ddb5ae` (9 files). The merged PR #5 policy is not treated as new application implementation.

Two fresh independent reviewers examined Standards and Spec. Codex also exercised actual public configuration behavior and the real PostgreSQL integration suite. The axes retain their separate findings below. [Next assignment](T02-corrections-round3.md).

## Standards

1. **R16 / P1 — Isolation guard still ignores driver-effective routing.** `src/lib/env.ts:74–82` extracts authority host/port; the later guard relies on those values. An operational `127.0.0.1:5432/lawoffice_test` and test `review.invalid:5439/lawoffice_test?host=127.0.0.1&port=5432` pass `validateEnv` as unequal, while the installed driver resolves both to the same host, port, and database. Separate reserved-encoding aliases also disagree with the driver's decoding. Standard: R09 requires driver-compatible semantics and rejection of ambiguous routing. Reject unsupported routing overrides or derive the effective supported identity correctly before allowing access.

2. **R17 / P1 — Coordinator implemented after the required native gate failed.** `docs/reviews/T02-submission.md:47–58` records every assigned role blocked, then states that technical corrections were implemented directly. Application/configuration/test changes confirm that work proceeded. Standard: the round-2 assignment, `GEMINI.md`, and `docs/AGENCY_AGENTS.md` require stopping dependent implementation. Required lead ownership, independent support results, frozen-checkpoint reviews, and reconciliation are absent. Preserve the current code; resolve native registration and complete the remaining slice through actual required children. Do not retroactively relabel direct work as delegated.

3. **R18 / P2 — Submission names an unresolvable implementation checkpoint.** At `docs/reviews/T02-submission.md:13`, the claimed `4e9cc4586d06283bb940916cf63117452d3a2da5` does not identify the actual implementation `4e9cc457b02e4ac45c1084d451e23e2c595cc9a6`. The final-head field is also stale relative to inspected head `99a5b601...`. Other full hashes in the external handoff differ from Git's actual values. Standard: R14 and the review protocol require exact inspected/published identities. Obtain hashes from Git and distinguish implementation from report-only commits without inventing a self-referential final hash.

No additional code-smell finding is asserted.

## Spec

1. **R16 / P1 — Operational-equivalent target remains accepted.** R09 explicitly requires "driver-compatible semantics" and rejection of "ambiguous/unrecognized routing inputs". At `src/lib/env.ts:74–82`, query host/port overrides are ignored. Driver-equivalent URLs therefore pass the guard used by R10's integration constructor. Separately, custom `decodeURIComponent` disagrees with installed pg's `decodeURI` for reserved characters: paths `/%3F_test` and `/%253F_test` can resolve to the same driver database while the guard considers them different. No connection is necessary to reproduce either failure.

2. **R17 / P1 — Required native execution did not occur for the assigned work.** The assignment says "report BLOCKED_NATIVE_AGENTS ... and stop dependent implementation". The submission expressly reports blocked roles and direct implementation. Honest error reporting does not satisfy the stop condition or provide role results. The registry/discovery explanation is a hypothesis, not an established root cause.

3. **R18 / P2 — Incorrect version evidence.** R14 requires distinct inspected implementation and verified published head. The claimed implementation hash is wrong, and the in-document final head still names `968cc53...` although the inspected head is `99a5b601...`. Git confirms the later changes are report-only. Correct labels and publication evidence.

4. **R19 / P2 — Regression evidence remains partial.** R08 requests a regression of the actual documented environment-copy/configuration-loading path; `tests/unit/env.test.ts` tests the validator rather than loading Vitest configuration, despite the submission's claim. R13's fake pools exercise repeated releases and late acquisition but do not enforce a bounded resource budget. Add relevant public-behavior regression evidence. Controlled seams remain allowed: this is not a newly imposed requirement to use real PostgreSQL for every stall or proof of another pool defect.

Verified improvements: forced test mode follows loaded values; the blanket CI bypass is removed; integration now calls the shared guard; incomplete PostgreSQL URLs are rejected; repeated-timeout and late-client regressions exist. No feature scope creep was found.

## Independent observations

| Check | Result at inspected head |
|---|---|
| Lint | Exit 0 |
| Strict TypeScript | Exit 0 |
| Unit tests, local conditions | Exit 0, 24 passed |
| Unit tests with `CI=true` | Exit 0, 24 passed |
| Real PostgreSQL integration | Exit 0, 4 passed in a uniquely labeled disposable `postgres:16.8-alpine` container, synthetic credentials, tmpfs, random loopback port |
| Three ignored driver-equivalence reproductions | All confirmed accepted-but-equivalent targets: query `port`, query `host`, and reserved path encoding. Actual `pg.Client` fields were compared; no connection was made |
| Current [application CI](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42943185216) | Success |
| Current [planning validation](https://github.com/MohamedAlksas/LawyerOS/actions/runs/42943185172) | Success |

The dedicated review container was removed after testing. No operational database was contacted. The dependency lockfile and pool implementation were unchanged in this round; clean install and production build were not repeated locally. Hosted application CI at the exact inspected head succeeded, including its build. Full HTTP/startup and browser E2E were not independently rerun. Earlier real-pool repeated-timeout/late-acquisition checks remain relevant because that implementation is unchanged; R19 asks for delivered regression protection, not a claim that those working cases regressed.

### R20 — Native registration diagnosis and compatibility correction

Read-only inspection of the actual Antigravity tool-result records established:

- Canonical `agency-*` TypeNames were rejected with "not found or not allowed"; defining the identical DevOps name returned "already exists".
- Step 1261 successfully registered `subagent-agency-devops-automator` through `define_subagent`.
- Step 1267 successfully invoked that alias, returning native conversation `f76008ec-e87c-4ad6-80ad-bef3c14c6edf`.
- A separate built-in `self` probe also launched a native conversation. Both were probes, not the required role-level implementation/reviews.

Therefore a native invocation path existed. The evidence does not establish the report's proposed skill-registry/discovery root cause or justify classifying the entire mechanism as unavailable. It also does not satisfy the assigned three-child execution requirement. No hidden reasoning or full conversation content is copied into this report.

Codex's earlier canonical-name preflight instructions did not account for this observed runtime registration path. The compatibility amendment now explicitly permits bounded `define_subagent` registration under a separate `lawoffice-native-*` invocation alias, while keeping the original profile, canonical source definition, inherited model, real child-ID evidence, and strict stop condition. This is native registration, not a same-session persona exception or an unrequested installation. Each next task still must prove actual role execution.

The amended routing/card validators passed (23 cards, 7 managed skills, 14 routed profiles), and the 70-source/237-entry package rebuilt with zero broken local links and matching source hashes. Regeneration produced no maintained-text difference against staging. An isolated negative policy check rejected `stopOnFailure=false`; the original manifest was restored and validation passed again. These checks verify instruction/configuration consistency only, not new native role execution.

## Next step

Use [T02 correction round 3](T02-corrections-round3.md). First complete the actual three-child read-only preflight. Only then may the native lead correct R16 and relevant regression/report gaps, with real backend/test support and reconciliation. If preflight cannot succeed, stop before application edits. Do not merge PR #4 or begin T03.

This review and native-registration compatibility guidance do not change application implementation or approve the current task. Final publication evidence is recorded in the delivery message.

Standards: 3 findings, highest P1 (effective-target isolation and required execution). Spec: 4 findings, highest P1 (the same two requirements). R20 is the evidence-based compatibility clarification; shared IDs preserve axis overlap.
