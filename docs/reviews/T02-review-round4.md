# T02 — Independent review of correction round 3

Decision: **CHANGES_REQUESTED**. Keep [PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4) draft; T03 is not released. Date: 11 November 2026, Africa/Cairo.

- Task branch/upstream: `feature/t02-runtime-ci` / `origin/feature/t02-runtime-ci`.
- Review fixed point: `1801647be9fce598297c37d161e01831bcab90a3`.
- Frozen implementation: `e4b2b68cdb87cca44139a04354ea31aad278fe1a`.
- Inspected independently verified published head: `3b9a53b69842dbb7a235199d2b50d287d3130329`.
- Diff: `git diff 1801647be9fce598297c37d161e01831bcab90a3...3b9a53b69842dbb7a235199d2b50d287d3130329`.
- The later `3b9a53b...` commit changes only the submission and derived outputs, not application source/configuration/tests.
- Current fetched main: `66d314f0c6c01d5522098a70329de6b3190c0c28`, including the owner's Graphify integration. This task still contains the earlier `62494bad...` main baseline; integrate the newer independent tooling safely before the next correction. Do not classify that separate main change as a T02 implementation defect.

Two fresh independent reviewers examined Standards and Spec. Codex separately reproduced public-boundary behavior, reran checks, and verified actual native tool records. [Next correction](T02-corrections-round4.md).

## Standards

**R21 / P2 — Budget regression tests its own queue.** At `tests/unit/db-pool.test.ts:161–212`, `boundedPool` itself implements the three-connection limit and queue, then is injected into `checkDatabaseReadiness`. Peak-budget assertions establish the fake pool's behavior, not the delivered shared pool's queueing. The separate options test verifies the actual configured values, but the submission's budget-enforcement claim (`docs/reviews/T02-submission.md:123`) overstates this evidence. R19 requires focused observable evidence for shared-pool budgets; `lawoffice-testing/SKILL.md` requires meaningful public behavior. Exercise the delivered pool or narrow the claim and explicitly record the remaining limit. Preserve the useful client-release checks. No additional material smell finding is asserted.

The changed files remain within scope, all three profile hashes match, and checkpoint hashes are valid. Native authenticity was checked separately below.

## Spec

**R16 / P1 remains open — Driver-equivalent operational targets still pass.** The assignment requires rejecting ambiguous forms before connection or comparing actual driver-effective supported identities (`T02-corrections-round3.md`, R16). At `src/lib/env.ts:101`, normalization retains percent-encoded hostname characters; installed `pg-connection-string/index.js:56` decodes them. At `src/lib/env.ts:95–98`, query keys are lowercased although the driver preserves case. Only the test URL is structurally checked before comparison (`:226–244`); the original operational URL is replaced before final schema validation (`:262–266`).

Both independent connection-free reproductions use public `validateEnv({ NODE_ENV: 'test', CI: 'false', DATABASE_URL, TEST_DATABASE_URL })`:

| Case | Operational DATABASE_URL | TEST_DATABASE_URL | Actual result |
|---|---|---|---|
| Encoded hostname | `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test` | `postgresql://synthetic:synthetic@127.0.0.%31:5432/lawoffice_test` | Accepted; installed pg resolves both to the same target |
| Uppercase operational query | `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test?HOST=unused.invalid` | `postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test` | Accepted; installed pg ignores uppercase HOST for routing, while the comparison helper changes its identity |

Constructing `new pg.Client({ connectionString: url }).connectionParameters` for each URL, **without calling connect**, yields host `127.0.0.1`, numeric port `5432`, database `lawoffice_test`. Thus the guard accepts the operational target. No operational server or client data was accessed. Reject unsupported representations consistently on both inputs, or compare actual supported driver semantics; do not merely patch the two examples while claiming general compatibility.

The three previous reproductions (lowercase query port, lowercase query host, reserved database-path decoding) now reject correctly. R19's configuration-loader regression exists and the onboarding scenario passes. No additional material Spec finding is asserted.

## Native execution verification

**R17 execution gap is resolved for this correction slice.** Codex read bounded tool-result records and public returned messages from the actual local Antigravity conversation stores; profile listings or submission assertions alone were not used as proof. No full transcript or reasoning content is published here.

| Role | Verified child ID | Observed execution |
|---|---|---|
| DevOps lead | `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248` | Profile/project-skill reads, read-only preflight at `1801647...`, actual owned source/test edits, executed checks, final reconciliation referencing `e4b2b68...` |
| Backend support | `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413` | Profile/project-skill reads, preflight, read-only source audit and returned review of `e4b2b68...`; no application write tools observed |
| Test support | `db5fe921-b956-41a0-8960-044838a849d9` | Profile/project-skill reads, preflight, checkpoint inspection and actual lint/typecheck/local and CI unit commands; no application writes observed |

The parent registered aliases at tool records 1520/1522/1524, actually invoked them at 1526/1528/1530, authorized Phase B at 1542, sent frozen support assignments at 1565/1567, and requested lead reconciliation at 1575. The lead's actual child edit records include `src/lib/env.ts`, both regression suites, `vitest.config.mjs`, and the new configuration-loader test. This is real native execution. A native support verdict of zero findings does not establish correctness; the independent Spec reproductions above still block acceptance.

## Independent checks and limits

- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: exit 0, **33/33** unit tests in four files.
- `$env:CI='true'; npm.cmd test`: exit 0, **33/33** unit tests.
- `node work/round4-driver-repro.cjs`: exit 0 as a reproduction script, confirming the three previous forms reject and the two remaining forms accept despite equal actual driver targets. Exit 0 means the defect was reproduced, not that isolation passed.
- `npm.cmd run test:integration`: exit 0, **4/4**, against a new review-owned `postgres:16.8-alpine` container, tmpfs storage, synthetic credentials, random private loopback port 5490. Ownership ID/label were verified before stopping it; it was removed through `--rm`. Existing operational databases/containers were preserved.
- Both planning validators: exit 0. Planning bundle regeneration: exit 0, 70 sources / 237 ZIP entries / zero broken links / matching source hashes.
- Exact-head GitHub application [run 43043099068](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43043099068): **success**; exact-head planning [run 43043099306](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43043099306): **success**, independently fetched by inspected SHA.
- Clean install/production build were **not repeated locally this round**: dependencies, pool implementation, and startup hook are unchanged; the exact-head hosted application workflow includes clean install, build, and real PostgreSQL integration. No new local HTTP lifecycle drill or browser E2E is claimed. The earlier HTTP observations remain historical; E2E remains deferred.
- Graphify `explain validateEnv` was used for supplementary navigation against its recorded `e4b2b68...` implementation snapshot; the application diff to the inspected report head is empty. Actual source and installed driver were independently read. Graphify did not establish acceptance or the defect by itself.

No application source was edited by Codex. The active `D:/Lawyer` checkout and installed agent assets were preserved. The next correction remains on the same task branch/PR with actual native ownership. No merge, deployment, real data, or T03 authorization.

Standards: 1 finding, highest P2 (budget evidence). Spec: 1 finding, highest P1 (remaining driver-effective isolation aliases).
