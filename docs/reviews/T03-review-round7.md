# T03 — Independent Codex review, round 7

Decision: **CHANGES_REQUESTED**. Date: 13 November 2026, Africa/Cairo. Keep [PR #8](https://github.com/MohamedAlksas/LawyerOS/pull/8) draft. [Self-contained correction assignment](T03-corrections-round7.md). No merge, T04, deployment or real data.

## Checkpoints and method

- Origin `https://github.com/MohamedAlksas/LawyerOS.git`; branch `feature/t03-identity-sessions`; accepted main/T02 `e598c1649b82f34ea94338cda5ef25da32b5299f`.
- Fixed point: previous Codex publication `1eeabf92d9ddba51fdd97ea92090c3d025de3ec4`.
- Phase A `cd102a51fb3b0acccac28195c24cdb524cbbf4bd`; Phase B `51552ff56ceee8464469f13640519ddbbcc2e1f8`; frozen implementation `fb731dea8ca16a24579ee4c70eb4040dd8d15731`.
- Independently verified submitted local/remote report head `63bdacbb00e5b8cf5e122aaf5b0113290ebcea62`.
- Fixed diff `git diff 1eeabf92d9ddba51fdd97ea92090c3d025de3ec4...63bdacbb00e5b8cf5e122aaf5b0113290ebcea62`: 8 files, 1275 insertions, 171 deletions; all four commits inspected. Final commit changes its submission report only.
- Execution checkout `C:/Users/Alksas/Documents/Codex/LawyerOS-t03-review`, branch `codex/t03-review`; active project checkout/installed assets preserved.

Two fresh independent read-only source contexts inspected the requirements and actual code/pinned dependencies. Parent verification then used connection-free driver inspection, actual baseline execution and real PostgreSQL fault injection. [Sanitized observations](evidence/T03-round7-observations.json) retain actual outcomes without credentials or client data.

## Standards

Reviewer `/root/t03_r6_standards` (`Code Reviewer`), corrected independent report:

1. **P1 / R08 — Port zero can select ambient routing.** `src/cli/baseline-identity.ts:61` accepts `:0`. Pinned pg treats `port:0` as absent and selects PGPORT/default 5432. A server with the expected database name can satisfy the database-name check even though the explicit target endpoint was not honored. Round-6 B requires explicit target safety before DDL.
2. **P1 / R08 — Explicit TLS policy is dropped.** Line 64 maps sslmode=require/verify-full to undefined. With PGSSLMODE absent, the SQL client uses plaintext defaults while Prisma receives the original TLS URL. This contradicts SECURITY_OPERATIONS transport protection and consistent target semantics. Preserve supported TLS configuration or reject unsupported settings before connecting.
3. **P2 / R08 — Post-DDL failure has no verified recovery.** DDL commits at line 159 before catalog checks/history. If resolve fails at line 290, managed schema remains installed without completed history; retry fails on existing UserRole. The assignment requires recovery without deleting data or blindly recording unexecuted DDL.
4. **P2 / R02 evidence — Historical trust does not actually sign out.** Integration lines 526/628 send Bearer authorization to prior providers with only the twoFactor plugin. Pinned sign-out reads the signed session cookie. No session cookie/deletion assertion establishes the claimed lifecycle. Use the issued cookie and assert removal/trust retention.

No additional heuristic-only smell finding. Publication provenance is satisfied by the external full-SHA handoff and independent remote verification; a provisional placeholder criticism was withdrawn. The source-only reviewer did not independently establish native execution artifacts or run tests.

## Spec

Reviewer `/root/t03_r6_spec` (`Application Security Engineer`), independent source/spec report:

1. **P1 / R08 — Requested TLS becomes ambient/default plaintext.** `baseline-identity.ts:64,128` honors only disable. With require/verify-full and no PGSSLMODE, pg selects its default while Prisma receives the original TLS request. This violates transport requirements and consistent connection semantics.
2. **P1 / R08 — Failure after SQL commit strands the procedure.** SQL commits before checks and resolve at lines 278–295. A later history-permission failure leaves installed schema with no completed migration; rerun collides with CREATE TYPE. Documentation describes rolled-back conflict recovery only. Round-6 B explicitly includes partial-failure/retry semantics.
3. **P2 / R02 evidence — Issued trust lifecycle omits real sign-out.** Integration lines 522–528/625–631 pass Bearer tokens to cookie-only prior providers, leaving sessions alive; deletion is never asserted. The current HTTPS request also reuses the existing provider instead of configuring the current provider for HTTPS.
4. **P2 / R06 evidence — Pending-attempt test is still sequential.** Integration lines 2120–2169 await each failed resume. Other simultaneous tests concern already-closed bootstrap or recovery regeneration, not concurrent pending attempts. This does not establish the requested concurrent lockout bound.

Standards: **4 findings, highest P1**. Spec: **4 findings, highest P1**. The axes overlap and retain their own severity ratings. Both reviewers credit the repaired effective operational/test comparison, real waiter barriers and reversed closure ordering.

## Parent runtime verification

| Scenario | Actual observation at 63bdacb | Disposition |
|---|---|---|
| Reversed operational omitted-port/PGPORT case from round 6 | Rejected before connection | R07 behavior fixed in this reproduction |
| Parse target with explicit port 0, PGPORT=65432; inspect actual Client parameters | Parser accepts 0; actual driver selects 65432 | **Port fallback confirmed**, without opening a connection |
| Parse target requesting sslmode=require or verify-full, PGSSLMODE absent; inspect actual Client parameters | Both select ssl=false | **TLS policy loss confirmed**, without a connection or plaintext traffic experiment |
| Run real canonical baseline; a PostgreSQL event trigger revokes the runner's public-schema CREATE permission after the final managed table is created | SQL commits all six managed tables; Prisma history creation fails; zero completed history | Real post-DDL failure state established |
| Remove the fault, restore CREATE permission and rerun the same canonical entry point | Retry fails because the already-created type exists; sentinel retained | **Recovery gap confirmed**; no data deletion was used to get the result |

The post-DDL fault used a synthetic low-privilege role and owned database inside the review container. A SECURITY DEFINER event trigger revoked CREATE after office_bootstrap creation, allowing SQL/catalog verification but preventing the new migration-history table. After the first failure, the trigger was removed and permission restored before retry. The observer confirms committed schema and zero completed history; no mocks of persistence or child-process return values were used. Sentinel retention was verified. The script's normal nonempty baseline/conflict rollback paths continue to pass the submitted integration suite.

Port/TLS probes inspect the exact Client configuration produced by parseTargetUrl. They do not assert that another real server was modified or that real credentials crossed a plaintext network. They establish that the script would not honor explicit endpoint/transport instructions. A rejected input or correctly preserved supported policy must replace the silent fallback.

The prior auth fixes remain in source, and the submitted authentication tests pass. New trust cookies are genuinely issued by the prior provider; the remaining issue is authenticating/confirming sign-out and using matching provider configurations, not a claim that the issued cookie is fake. Pending setup row-lock logic is present, but the new failure-counter test is sequential. These are scoped evidence gaps rather than newly demonstrated production MFA bypasses.

## Disposition

- R07's reversed operational target is fixed; prior malformed-name/empty-override protections remain.
- The canonical baseline entry point and corrected PowerShell binding resolve the previous variable-target issue. **R08 remains open for port validation, explicit TLS handling and recoverable post-DDL failure states.** SQL/Prisma must share one validated connection policy, including accepted routing/schema options.
- R01/R03/R04/R05/R09 behavior and submitted regressions remain intact. R06 waiter ordering is improved; concurrent pending-attempt evidence is still missing. R02 authentic issuance is improved; sign-out/provider-configuration assertions remain incomplete.
- Names-only catalog checks currently verify existence rather than full types/nullability/defaults, enum values or constraint/index definitions. Any recovery path that recognizes already-installed schema must establish actual managed-schema equivalence before recording missing history; do not use those name checks as a blanket resume authorization.

## Checks, provenance and limits

- Clean pinned install/client generation and fresh migrate deploy: exit 0. Units **82/82**; lint/typecheck exit 0. PostgreSQL integration **52/52**, four files, exit 0. Local startup build uses **test-only webpack**.
- Submitted Playwright journeys **30/30**, exit 0, last-run passed, three widths, zero retries, independent/non-reused server at 14722. Targeted observational probes **2/2**, exit 0. Their passing assertions deliberately record the defects above, not acceptance.
- [Application CI 43471121750](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43471121750), job `132042972571`, passes 82 units, 52 integration, 30 browser cases and default production build. Logs identify merge candidate `15586e0f99a7125fd96dcdbebe35617ad43044e8`, merging 63bdacb into e598c164; startup default-build ID `Fatyfuix8Ewf_4B5n1BFk`. [Planning CI 43471120804](https://github.com/MohamedAlksas/LawyerOS/actions/runs/43471120804) passes. Local webpack is not claimed as a local default build.
- Submission graph manifest `D:/Lawyer/work/graphify/fb731dea8ca1-84171846/SOURCE.json` identifies the frozen implementation and matches hash `2F4D615555CEF68F64367AED26D39FC3E558100994937DE63E3752F04A21EBA9`. Parent snapshot `work/graphify/63bdacbb00e5-1090fab7/` identifies full report head: 249 nodes, 575 edges, 11 communities, code-only/no labels. runIdentityBaseline query returned all 36 nodes/63 edges, approximately 3534 tokens despite a requested budget of 1700; output was complete, not treated as truncated.
- Submission records three native specialist IDs and frozen-checkpoint reports. These supplement independent acceptance. External report/pushed SHA was independently verified; no self-referential report amendment is required. Physical TTY capture remains NOT RUN; real component muting tests exist.
- All runtime data was synthetic. The exact labelled review container was verified and removed; browser listener 14722 is absent. No owner asset, existing container, operational database or real client data was modified.

This publication changes planning/review documentation, sanitized evidence and derived copies only. The current task card contains the complete correction specification inline, rather than requiring a review report to discover fixes. Standards: 4 findings, highest P1. Spec: 4 findings, highest P1. Independent acceptance remains pending.
