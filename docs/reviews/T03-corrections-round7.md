# T03 — Self-contained correction round 7

Implement only the corrections below. All defects, expected behavior and acceptance cases are included here; no review report or task-card lookup is needed to discover the work.

## Repository and boundaries

Workspace D:/Lawyer; origin https://github.com/MohamedAlksas/LawyerOS.git; branch feature/t03-identity-sessions; existing draft PR https://github.com/MohamedAlksas/LawyerOS/pull/8. Reviewed submission: 63bdacbb00e5b8cf5e122aaf5b0113290ebcea62; frozen application: fb731dea8ca16a24579ee4c70eb4040dd8d15731. T02 is ACCEPTED and integrated into origin/main at e598c1649b82f34ea94338cda5ef25da32b5299f. Fetch and safely incorporate the latest Codex documentation publication before editing; preserve local/other-agent work.

Codex plans and independently accepts; Gemini implements using the owner's selected model. Follow AGENTS.md, GEMINI.md, PRODUCT.md, GLOSSARY.md and docs/PRD.md. Documentation stays English; application stays Arabic RTL. Keep dependency pins and scope. No main push/merge, force push, reset/clean, automatic stash, deployment, real data, T04, UI redesign, business modules, SaaS/offline/AI additions or installed-agent deletion.

## Actual native agents and skills

Load and record actual paths/hashes: .agents/skills/lawoffice-delivery/SKILL.md, .agents/skills/lawoffice-security-operations/SKILL.md, .agents/skills/lawoffice-testing/SKILL.md and .agents/skills/graphify/SKILL.md. Retain .agents/skills/lawoffice-arabic-ui/SKILL.md for existing auth UI verification. Project rules govern generic profiles.

Use distinct real native sessions; no coordinator personas, invented IDs, silent substitutions, nested delegation or full-roster launches. Run the supported canonical/registered-alias preflight. If native execution remains unavailable, report BLOCKED_NATIVE_AGENTS before dependent edits.

- Identity implementation lead: .agents/skills/engineering-identity-access-engineer/SKILL.md, name agency-identity-access-engineer, definition .agents/agents/agency-identity-access-engineer.md. Owns src/cli/baseline-identity.ts, necessary baseline state/verification logic and docs/DEPENDENCIES.md.
- Test implementation lead: .agents/skills/testing-test-automation-engineer/SKILL.md, name agency-test-automation-engineer, definition .agents/agents/agency-test-automation-engineer.md. Owns baseline unit/integration and auth lifecycle/concurrency regressions.
- Independent AppSec support: .agents/skills/security-appsec-engineer/SKILL.md, name agency-application-security-engineer, definition .agents/agents/agency-application-security-engineer.md. Audits explicit endpoint/TLS, post-failure recovery and exact frozen test behavior.

The coordinator assigns, freezes checkpoints and reconciles; authors do not independently approve their own work. Serialize overlapping writers. Record real invocation IDs, profile/definition hashes, ownership, start/inspected SHAs, findings and reconciliation. No shared production configuration rewrite is requested; obtain an explicit bounded specialty assignment before expanding into one.

## 1. Reject invalid explicit ports before a client exists

Current parseTargetUrl accepts a PostgreSQL URL with explicit port 0. The pinned pg driver treats numeric port:0 as missing and uses PGPORT or default 5432. Parent proof: requested port 0 with PGPORT=65432 produces driver port 65432 without opening a socket.

Validate an explicitly supplied port as an integer in 1..65535 before constructing a Client or touching a database. Keep the omitted-port policy explicit and stable; it must not become ambient fallback. Use one canonical accepted endpoint for SQL and Prisma subprocesses. Do not pass the original unvalidated URL to one phase while another uses different parsed parameters. Reject ambiguous/unsupported routing or schema options rather than silently ignoring them.

Tests: explicit 0, invalid ranges/syntax, omitted port under controlled PGPORT, legitimate default/nondefault ports, and accepted/rejected routing options. Assert actual connection parameters for accepted inputs and no connection/DDL/history for rejected inputs. Preserve the now-working operational/test separation checks, explicit test URL requirement, identifier bounds and owned-resource protections.

## 2. Preserve or reject explicitly requested TLS

Current parseTargetUrl recognizes only sslmode=disable. sslmode=require and verify-full become undefined; with PGSSLMODE absent, actual pg selects ssl=false while Prisma receives the original TLS URL.

For every accepted connection/TLS option, preserve its supported security meaning consistently through SQL, verification and Prisma history. If a mode or certificate configuration is unsupported, reject it before connecting; never silently downgrade requested encryption or verification. Ambient PGSSLMODE must not weaken an explicit target policy. Do not add a new hosting service or change the stack.

Tests: require, verify-full, explicit disable where allowed, unknown modes, contradictory/unsupported options and controlled ambient SSL settings. Inspect the resulting driver policy; use a controlled TLS fixture or prove rejection occurs before connection. A success response from a plaintext fixture cannot count as satisfying require/verify-full. Do not expose credentials in errors or evidence.

## 3. Recover after SQL succeeds but history recording fails

Current runIdentityBaseline commits all six managed tables before catalog checks and Prisma migrate resolve. Parent injected a real PostgreSQL permission fault: CREATE permission was revoked after office_bootstrap creation. SQL committed, catalog checks passed, history recording failed with zero completed migration history. After restoring permission, rerunning failed on the existing UserRole type. Sentinel data survived, but the procedure could not recover.

Implement explicit safe recovery for this partial state. Do not delete/recreate owner tables or blindly mark a migration applied. Move verification into the SQL transaction where appropriate, and handle failures after that commit separately. A verified matching managed schema with missing history needs a controlled resume path tied to the approved migration/schema; incompatible or partial state must refuse safely. Define already-completed behavior and retry after history succeeds but later status verification fails.

Before recording/resuming history, verify actual managed-schema equivalence: columns and relevant types/nullability/defaults, enum values, primary/foreign-key definitions and targets/actions, required indexes/uniqueness. Names alone are insufficient authorization for recovery. Preserve unrelated tables and data. Do not implement fixture-specific production exceptions or an unrestricted migration-history bypass.

Tests must invoke the same canonical entry point documented for operators: normal nonempty retained-data baseline; SQL conflict rollback; controlled post-DDL history failure; corrected permission/connectivity and successful retry; already-completed invocation; incompatible partial/mismatched managed schema; no completed history on rejection; retained sentinel data before/after recovery; actual post-upgrade authentication. Use real PostgreSQL faults and observable state. Keep SQL and Prisma on the same validated target/transport policy.

## 4. Complete actual historical-trust sign-out

Cookie issuance now uses the genuine prior provider and is an improvement. However, the test signs out with Authorization: Bearer against providers configured with only twoFactor. The pinned sign-out endpoint reads the signed session cookie, so those requests do not delete the issued sessions.

For HTTP and HTTPS provider configurations: complete actual prior-provider password/MFA with 30-day trust; capture the issued session cookie, trust cookie and matching database state; sign out using the issued session cookie and required request context; assert successful response and persisted old-session removal while trust remains valid. Retain the trust cookie, then call the current application configured for the corresponding protocol. Assert a fresh challenge, no new authenticated session before MFA, and denied protected access. Changing only the request URL is not a provider HTTPS configuration change. Preserve the working production trust restrictions.

## 5. Prove concurrent pending-attempt limits

The new pending-failure test still awaits attempts sequentially. Add genuinely simultaneous failed attempts against one pending reservation using real PostgreSQL, asserting persisted failure bounds, lock state, rejected excess attempts and lock-expiry/legitimate recovery. Do not substitute already-closed bootstrap races or recovery-code-regeneration tests. Keep the real waiter barriers, both closure orderings and the fixed no-secret-return-after-closure behavior.

## Verification and handoff

Preserve working R01/R03/R04/R05/R07/R09 behavior, all prior secret-handling protections and current CI. For each new defect, observe a meaningful failing behavioral test, implement the minimum fix and verify incrementally. Already-correct cases may receive passing coverage. Use synthetic isolated resources only; remove only verified run-owned resources.

Freeze committed implementation checkpoints for independent support audits. Run relevant configured unit tests, real PostgreSQL integration/fault/recovery/concurrency tests, browser journeys, lint/typecheck and an attributable fresh default build. Distinguish local test-only webpack from hosted default evidence. Keep physical TTY capture NOT RUN unless actually performed; stream-unit tests do not establish physical-terminal behavior.

Use local committed code-only Graphify snapshots, verify full SOURCE.json SHAs, query changed boundaries and inspect source/tests. State coverage/output limits. No uploads, external labeling, provider keys, upgrades or hooks. Validate planning/Agency routing and regenerate derived copies; validator errors do not authorize deleting installed assets.

Save docs/reviews/T03-submission-round7.md with behavior/regression/evidence dispositions, actual commands/exits and positive/negative observations, recovery semantics, NOT RUN limits, native ownership/IDs/hashes/findings/reconciliation, Graphify provenance, branch/base/frozen/report/independently verified pushed SHA/PR. Report publication SHA externally after committing; avoid self-referential amendments. Push coherent updates to the same branch/PR and stop for independent Codex review. No self-approval, merge, deployment, real data or T04.
