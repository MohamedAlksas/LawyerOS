# T02 — Independent review of correction round 5

Decision: **CHANGES_REQUESTED**. [PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4) remains draft; no T03 or main merge. Date: 11 November 2026, Africa/Cairo.

- Inspected published head: `673cd6d5e8aa55423dfb0145b593a128b3bf6e88`.
- Application checkpoint: `dc6bd08278634eb499b908a3f2031b83cb492039`.
- Fixed point: `766b7de51f395fdf93f45fad4298420756505865`; diff `git diff 766b7de51f395fdf93f45fad4298420756505865...673cd6d5e8aa55423dfb0145b593a128b3bf6e88`.
- The later report commit changes only the submission and derived outputs. Application source/tests remain those of `dc6bd08...`.
- Latest fetched main remains `66d314f0c6c01d5522098a70329de6b3190c0c28`, already integrated.

Two fresh reviewers examined Standards and Spec independently. Their source-review results are separated below from Codex's additional built-process verification. [Next correction](T02-corrections-round6.md).

## Standards

**R26 / P3 — Evidence wording overstates driver comparisons.** The submission calls all seven new cases driver repair triggers and claims direct driver-equivalence comparisons for all seven (`docs/reviews/T02-submission.md:27,90`). The actual suite correctly performs five equivalence comparisons and treats trailing `%`/`%a` only as two strict-grammar rejection cases (`tests/unit/env.test.ts:482,487,506`). The assignment explicitly distinguishes those two forms. Correct the report's wording; the delivered rejection behavior is sound.

No additional hard application-standard breach or actionable code smell was found by the Standards reviewer. Source scope is compliant. External publication metadata provides the exact report head and current hosted runs, avoiding a self-referential SHA requirement. The historical `4e9cc45` label resolves to the real round-2 implementation; an object's existence alone does not prove the exact working state that produced an earlier HTTP response.

## Spec

**The raw-input correction is clean; R16 is resolved.** The shared lexical guard checks the complete raw string before URL construction in structural validation and extraction. Both original operational/test inputs are checked before comparison/replacement. The helper returns null for unsupported raw syntax. README documents the supported encoding rule.

The independent Spec reviewer exercised 48 connection-free assertions: actual driver-equivalence repair cases, unsupported forms on either input, encoded credential/query/path positives, distinct databases/ports, IPv6, prior aliases and repeated/encoded/mixed-case routing keys. No material missing/partial raw-grammar requirement, incorrect implementation, or scope expansion was found. R21 remains resolved and the pool implementation is unchanged.

## Additional built-process and execution findings

**R24 / P1 — Invalid startup remains alive and bound rather than exiting as reported.** `src/instrumentation.ts` throws the validation error during Next.js preparation, but the `next start` process is not terminated by that error. `package.json` still invokes `next start` directly. The submission claims immediate process crash before listening and exit 1 (`T02-submission.md`, current-policy startup and command sections); actual execution does not establish that claim.

Codex reproduced this on both an independently built webpack artifact and an isolated read-only copy of the submitted **default Turbopack** artifact. The latter came from the unchanged active checkout at inspected head, build ID `kcLaFUe6YRl1CPE71Zqo8`; source checkout/head were checked, its artifact copied into an ignored review snapshot, and no active source/server was changed. The default artifact rules out attributing this result merely to the alternate bundler.

With `NODE_ENV=production`, run the built server on a fresh private loopback port using either invalid URL from the previous round: a raw space in `application_name`, or `%zz` in that query. In both cases a sanitized `EnvironmentValidationError` is logged, but the child remains alive after six seconds, its port remains bound, and `/api/health/live` returns **HTTP 500**. There is no natural exit code. The earlier webpack probe remained alive for fifteen seconds. Codex stopped only its captured children afterward; those forced stops are not startup failures. Valid configuration on the same default artifact returns liveness **200** and real-database readiness **200** with no-store headers.

Expected: the documented startup command must fail promptly with a natural nonzero exit for invalid required configuration, close any task-owned listening socket, and emit only sanitized diagnostics. The current unusable process can remain alive under process supervision, while the report incorrectly treats manual teardown as application exit. Implement and verify the startup failure boundary; do not reopen the resolved URL grammar.

**R25 / P2 — Cleanup stopped every Node process and its exit was misreported.** Bounded actual tool-result inspection found `Get-Process node ... | Stop-Process -Force ...` at parent records **2081**, **2090**, and in the valid-startup command at **2093**. The first broad cleanup exited 0; the latter commands exited 1. Record 2093 really observed HTTP 200, but its overall command returned **1**, while the submission labels it exit 0 and claims clean teardown. This contradicts the assigned task-owned-process restriction and the review protocol's actual-exit requirement. No unrelated-process loss is claimed because that was not observed. Future checks must retain exact child IDs and stop only the verified owned process/tree.

The process-ownership rule was already present in the correction assignment. Codex has now reinforced it in canonical `GEMINI.md` and `lawoffice-delivery/SKILL.md`, making it visible to both the coordinator and required children; the plan/kit is regenerated. This is documentation of the existing ownership boundary, not new application scope.

## Independently verified checks

- Lint/typecheck: exit 0. Units: **43/43** locally and **43/43** with explicit CI=true, exits 0.
- Parent regression reproducer: all seven previous equivalent-target examples now reject; the actual installed driver comparisons remain connection-free.
- Real PostgreSQL integrations: **4/4**, exit 0, on a new review-owned `postgres:16.8-alpine` instance with tmpfs and private loopback port 11679. Container ownership was verified and it was stopped/removed after checks. Existing operational data was untouched.
- Independent `npm.cmd run build -- --webpack`: exit 0. This alternate verification produced a usable artifact without changing source/configuration; it does not claim a local default Turbopack build passed or replace that command in the project. The previous local default-worker error remains an unconfirmed environment/build issue.
- Default submitted artifact: valid live/ready HTTP **200/200**; invalid space and malformed-percent startup remain alive with bound ports and HTTP **500**, as above. All review-created server children were stopped by captured identity. Local evidence: ignored `work/round6-native-startup-results.json`.
- Exact-head hosted application [run 43057538236](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43057538236): **success**, including default build and integration. Exact-head planning [run 43057538398](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43057538398): **success**, fetched independently by inspected SHA. These workflows do not exercise real startup exit behavior.
- Three native sessions were actually reused for current preflight, lead edits, frozen `dc6bd08...` support reviews and reconciliation. Parent records 2015/2017/2019, 2028, 2042/2044, 2053 and bounded child tool/public results establish the sequence. Lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`; backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`; test `db5fe921-b956-41a0-8960-044838a849d9`. Supports made no application writes.
- Published ZIP independently compared against canonical source text: **zero differences** before review edits. Both planning validators and subsequent regeneration passed: **71 sources / 253 ZIP entries / zero broken links / matching source hashes**. R23 is resolved; current regenerated kit also includes the reinforced process instructions.

Codex changed only review/planning instructions and derived artifacts, not application code. Main merge, T03, deployment, real data, browser E2E and actual-pool saturation remain unapproved/unclaimed.

Source Standards: 1 P3 wording issue. Source Spec: no findings; R16 resolved. Additional runtime findings: R24 P1 and R25 P2. The startup behavior is the remaining acceptance blocker.
