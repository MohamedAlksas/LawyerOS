# T03 — Focused correction round 6

Read [the current review](T03-review-round6.md) and execute this full assignment with [T03](../tasks/T03.md). Decision remains **CHANGES_REQUESTED** at submitted head `a5b84917aa3eca60eece75464ce30e6ad59d88e1`, frozen implementation `1dbd73488b452fdc2cccf5f4104d007a17b6c2f4`.

Continue `feature/t03-identity-sessions`, existing draft [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8), origin `https://github.com/MohamedAlksas/LawyerOS.git`. Fetch and safely synchronize with this Codex publication; record the actual start SHA. **Scope: two remaining safety corrections and the two specifically identified regression gaps.** Preserve working original-header auth policy, closed-setup rejection, canonical test-port behavior, fail-fast SQL transaction, genuine MFA password faults, R01/R05/R09 and green CI. No restart of T03, T04, merge, deployment, real data, visual redesign, new business/SaaS/offline/AI scope, stack/model change, force push, reset/clean of others' work or installed-asset deletion.

## Reads and exact native ownership

Read AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md, docs/tasks/T03.md, docs/REVIEW_PROTOCOL.md, docs/GIT_WORKFLOW.md, docs/AGENCY_AGENTS.md, docs/AGENCY_AGENT_ROUTING.json, current review and relevant pinned provider/driver/migration source.

Load actual `.agents/skills/lawoffice-delivery/SKILL.md`, `.agents/skills/lawoffice-security-operations/SKILL.md`, `.agents/skills/lawoffice-testing/SKILL.md`; retain the task's `.agents/skills/lawoffice-arabic-ui/SKILL.md` for auth UI checks, without a redesign. Read `.agents/skills/graphify/SKILL.md` with docs/GRAPHIFY.md. Record paths and hashes actually read.

Use documented native canonical/registered-alias preflight and distinct real child sessions. Unavailable native execution means **BLOCKED_NATIVE_AGENTS** before dependent edits. No same-session personas, invented IDs, silent role replacement, nested delegation or full-roster launch.

| Slice / reason | Lead profile / native definition | Owned work | Independent support |
|---|---|---|---|
| A — Test-only operational/test comparison and its driver-level regression | `.agents/skills/testing-test-automation-engineer/SKILL.md` (`agency-test-automation-engineer`); `.agents/agents/agency-test-automation-engineer.md` | `tests/helpers/test-db.ts`, unit target-identity checks and focused owned-resource checks | AppSec audits no-connection separation; Identity checks application comparison semantics |
| B — Controlled Identity schema baseline and its canonical procedure | `.agents/skills/engineering-identity-access-engineer/SKILL.md` (`agency-identity-access-engineer`); `.agents/agents/agency-identity-access-engineer.md` | A single executable baseline entry point if needed, docs/DEPENDENCIES.md and necessary Identity migration wiring | Testing executes that actual entry point; AppSec verifies target/failure/history ordering |
| C — Deterministic closure and actual provider-issued trust regressions | Same test-automation profile/definition | Relevant auth/migration integration tests and truthful evidence | Identity/AppSec review exact frozen behavior; author is not their own independent reviewer |

AppSec: `.agents/skills/security-appsec-engineer/SKILL.md` (`agency-application-security-engineer`), native `.agents/agents/agency-application-security-engineer.md`.

If A requires changing **shared production configuration** rather than the test-only helper, first use the explicitly assigned backend refinement: `.agents/skills/engineering-backend-architect/SKILL.md` (`agency-backend-architect`) via `.agents/agents/agency-backend-architect.md`, owning that shared configuration slice with Identity/AppSec support. Do not have the coordinator or test author silently take production configuration ownership. Complete phases sequentially as needed; no full-roster launch is required.

Record actual invocation IDs, profile/definition paths/hashes, ownership, start/frozen/inspected SHAs, concrete findings and reconciliation. Serialize overlapping writers and freeze committed support checkpoints.

## A — Compare actual operational identity as well as actual test identity (R07)

The previous omitted-test-port fix works. The **reversed case** still fails:

```text
DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1/shared_test
TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test
PGPORT=65432
```

The validator assumes operational port 5432. Normal application pg receives the unmodified operational URL and resolves PGPORT 65432, matching the actual test target. Parent proved equality of pinned driver host/database/port without connecting.

Resolve both complete effective identities before separation checks, consistent with how the normal application operational pool and final test pool actually connect. Do not merely canonicalize a comparison copy of the operational URL to 5432 while its actual application connection remains ambient. Either compare the genuine driver-effective operational identity or enforce an explicit canonical operational identity throughout the relevant shared configuration; explain the chosen semantics and scope. Preserve the original operational/test inputs for comparison and fail before any connection/write when they coincide or cannot be resolved safely.

Commit connection-free cases for omitted operational port, omitted test port, both omitted, explicit default/nondefault ports and controlled PG defaults, with matching and distinct database names/hosts. Assert actual pinned driver parameters for both sides, not only pool.options or assumed normalized strings. Preserve explicit undefined/empty rejection, no fallback, bounded identifiers, collision refusal and run-owned cleanup. A leading-zero-port concern was disproved because WHATWG URL canonicalizes it; do not invent a regression for an alleged current bug there.

## B — One executable, target-checked baseline used by docs and tests (R08)

The SQL transaction/conflict rollback fix works. The canonical **PowerShell** snippet still passes `"$DATABASE_URL"`, but only `$env:DATABASE_URL` is documented/configured. Parent verified that the argument becomes empty and actual psql can select controlled PGDATABASE defaults instead. No migration DDL was executed on that unintended fixture.

Use one shared executable baseline procedure and have docs/tests invoke it. A small portable Node entry point using the existing runtime/pg dependency is acceptable; a correctly bound, fail-fast PowerShell entry point is also acceptable. Do not add hosting, services or new frameworks. Require a nonempty explicit target; reject missing/unbound/ambiguous input before any connection or DDL. Verify current_database/current server against the intended target, preserve supported nonempty prior data and use the existing whole-file atomic SQL semantics. Do not fall back to libpq/PG defaults. Keep this synthetic-only during implementation; it does not authorize operational migration.

Check the expected managed Identity tables/columns, constraints/indexes and retained sentinel data **before** recording the migration as applied. Keep unmanaged prior data distinct from managed schema checks. Refuse incompatible/partial state and SQL errors safely, without recording false completion. Migration status/deploy verify history/pending work; correct the claim that they detect schema drift. Provide explicit retry/recovery semantics without dropping owner data or blindly resolving unexecuted DDL.

Execute the **same entry point** in integration tests: normal retained-data upgrade, conflict rollback/no completed history, legitimate retry, missing target, and environment-only target with a different controlled PGDATABASE default. Assert which synthetic target was contacted/mutated, that the other fixture remains unchanged, full managed-schema/history outcomes and actual post-upgrade authentication. Do not test a separate pg.query implementation while publishing an untested psql command. Preserve all passing real password-fault and protocol checks.

## C — Complete two precise evidence gaps without changing working auth

1. Replace the two 60ms delays in the closure regression with observable PostgreSQL waiter/barrier coordination. Confirm that confirmation and resume both reached the locked-state path in the intended order before releasing the blocker. The fixed production code already passes the parent's deterministic reproduction; preserve it. Also cover reversed ordering and concurrent pending-attempt limits/expiry required by prior cards, with meaningful persisted-state assertions.
2. Obtain the historical trust cookie through the pinned prior **30-day provider configuration**: actual password challenge, genuine MFA with trust, sign-out retaining the issued cookie/verification record, then current application sign-in. Require a new challenge and deny protected access until completion under actual HTTP/HTTPS provider configurations. Parent verified this behavior independently; current handcrafted cookies may be correctly encoded, but do not meet the requested committed issuance/lifecycle proof. Do not break the working policy to manufacture a red test.

Keep MutableStdout component tests and its honest physical-TTY NOT RUN limitation; do not turn stream-unit evidence into a physical-terminal PASS. Preserve no secret leakage, R05's explicit secret and R09's database concurrency guarantees.

## Verification and handoff

Observe meaningful failing regressions for A and B, fix incrementally, then verify. Already-correct behavior can receive new passing coverage. Native support reviews must inspect exact frozen checkpoints; reconcile through the responsible writer and rerun affected checks.

Use Graphify only on local committed code snapshots per docs/GRAPHIFY.md. Verify full SOURCE.json SHA, query changed boundaries, state truncation and inspect actual source/tests. No uploads, labeling, provider keys, upgrades or hooks.

Run appropriate lint/typecheck, configured unit/integration/browser checks, actual baseline entry-point negatives/positives and real PostgreSQL concurrency cases, plus an attributable fresh default build. Distinguish local test-only webpack from hosted default evidence. Validate planning/routing with the available correct PowerShell runtime and regenerate derived copies; do not delete installed profiles on validator failure. Remove only verified run-owned resources.

Save `docs/reviews/T03-submission-round6.md` with separate behavior/regression/evidence dispositions, actual commands/exits and observations, NOT RUN limitations, native IDs/ownership/hashes/findings/reconciliation, Graphify source SHA, the canonical executable baseline, and branch/base/frozen/report/independently verified pushed SHA/PR. Preserve historical reports and avoid self-referential SHA amendments. Push to this same branch/PR and stop for Codex review. No self-approval, merge, deployment, real data or T04.
