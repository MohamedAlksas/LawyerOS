# Planning, implementation, and review protocol

## Responsibilities

| Participant | Responsibility | Decisions requiring the project owner |
|---|---|---|
| Codex | Planning, domain-rule definition, Gemini assignments, diff/test/behavior review, prioritizing fixes | Material product changes, real-data operation, an unresolved external service or cost decision |
| Gemini 3.8 Flash | Implement the defined assignment, run tests, explain results, fix review findings | Blockers or contradictions preventing compliance; do not invent answers or expand scope |
| Project owner | Operate the tools, provide necessary local access, transfer submissions when needed | Permissions, hosting location, budget, and data approval |
| Project owner's father | Validate professional reality, legal deadlines, data accuracy, and usability | Any legal rule or financial decision specific to a real agreement |

The Gemini name is used as requested. The plan does not verify a particular model's availability, context capacity, or automatic access to project files. If it cannot read the project directly, transfer the task and only its required references, retaining the same submission format. Do not paste client documents or secrets into implementation chats.

## One-task cycle

1. Codex identifies the task ID, current state, base commit if Git exists, owned files, exclusions, and proposed test Interfaces.
2. Gemini reads the specified references, briefly summarizes its understanding, then implements the same task in small increments. Split a large task in coordination with Codex.
3. Submit inspectable changes, actual commands/results, and a manual scenario. Do not say tests passed without running them; use `NOT RUN` with a reason.
4. Codex reviews the diff and business rules and reruns appropriate checks in the available environment. Another model's report alone is insufficient evidence.
5. Return specific findings as fixes within the same task. After success, record `ACCEPTED` with evidence. The accepted task becomes the basis for dependent work.

## Required submission format

```text
Task ID:
Base commit / snapshot:
Branch / upstream / PR URL:
Local HEAD / independently verified remote pushed SHA:
Changed files:
Skills loaded (exact SKILL.md paths and task-specific application):
Agency Agent evidence (distinct native invocation/conversation IDs, definition paths, lead/support, profile names/paths/hashes, ownership, inspected SHAs, findings/actions, lead reconciliation, test exits and evidence references):
Slice routing decision (why the specialty fits, retained defaults or explicit Codex refinement, phase/file ownership and independent reviewers):
Behavior delivered:
Requirements and acceptance IDs covered:
Commands actually run + exit status + short output:
Manual demo steps and observations:
Screenshots / sample PDF paths (when relevant):
Schema/data migrations and how to apply safely:
Known limitations / NOT RUN checks:
Security/privacy effects:
Rollback / recovery notes:
Unresolved decisions:
```

During implementation, save submissions as `docs/reviews/Txx-submission.md`. Codex saves its review as `docs/reviews/Txx-review.md`, stating `ACCEPTED`, `CHANGES_REQUESTED`, or `BLOCKED` and an inspectable reason. Never copy credentials or real data into evidence.

For assignments under the native-agent policy, follow [AGENCY_AGENTS](AGENCY_AGENTS.md). Every routed lead/support needs a distinct observable native invocation and result. Same-session persona passes do not meet this requirement; missing capability is `BLOCKED_NATIVE_AGENTS` before dependent implementation. Portable validation cannot prove runtime execution. This policy is prospective: do not rewrite earlier submission evidence or withdraw an earlier acceptance solely because the policy changed. Native support reviews supplement Codex's independent acceptance rather than replacing it.

## Finding severity

- `P0`: risk of data loss/disclosure or corrupted money/deadlines. Immediately blocks operation or merge.
- `P1`: broken core journey, missing authorization, failed transaction or restore. Must be fixed before milestone acceptance.
- `P2`: meaningful issue with a clear workaround. Record it; Codex and the project owner decide whether it blocks the milestone based on impact.
- `P3`: limited non-blocking improvement. Add to the backlog without blocking acceptance without a reason.

Each finding includes a trigger/reproduction steps, expected/actual behavior, file and diff line at review time, and practical impact. Changing the specification to justify a defect requires an explicit decision. Do not weaken tests to conceal a failure.

## Proposed test plan

These are proposed test Interfaces in a planning document. No application tests have been written or run. Confirm the Interfaces in the implementation assignment before writing tests. Exercise a Module's public behavior or browser journey, rather than private helpers or internal call order.

Apply each AC to the task owning its behavior, not to every task in its milestone. T05 tests Party data/search; T06 adds party-link and court-instance tests. T08 tests atomic writes/retries; T10 adds worker behavior. A check depending on a future task is recorded as future work, not a failure of the current task or a claimed success.

| AC | Behavior | Test type and evidence | Milestone/task |
|---|---|---|---|
| AC-01 | Direct unauthenticated or maintenance-role requests cannot access matters, documents, or finance | HTTP integration + E2E | M1/M4 |
| AC-02 | TOTP, recovery, session revocation, no public registration, and password-change invalidation of prior-credential unfinished MFA challenges | Auth integration + two devices + controlled rotation/completion races | M1 |
| AC-03 | Same party has different roles; first instance and appeal are independent | Module integration with PostgreSQL | T06 |
| AC-04 | Retrying a hearing-result request returns the same result without duplicating the next hearing | Scheduling Interface + browser retry | M3 |
| AC-05 | Task creation failure inside the transaction leaves no partial result | Integration with controlled failure at an appropriate Seam | M3 |
| AC-06 | Conflicting versions reject silent overwrite | Integration + two devices | M2/M3 |
| AC-07 | Date-only values do not shift across timezone/DST, and unknown hearing time remains unknown | Vitest edge cases + Cairo browser timezone | M3 |
| AC-08 | Legal deadlines are not calculated or confirmed automatically | Draft/confirm E2E + audit | M3 |
| AC-09 | Worker restart/lease/date changes neither duplicate reminders nor retain old ones | Real PostgreSQL integration + fake clock | T10 |
| AC-10 | Oversized/fake-MIME/path-traversal uploads remain unavailable; initial ADR 0003 permits validated unscanned files with truthful NOT_SCANNED_POLICY evidence. If scanning is later enabled, failure/timeout/stale definitions block publication | Storage integration + HTTP; scanner-specific tests deferred until activation | M4 |
| AC-11 | Failed DB finalization does not produce a ready document; prior versions remain | Documents Interface + file manifest | M4 |
| AC-12 | 15,000 fees, 5,000 collection, and 1,200 expense yield 10,000 fees due and 1,200 expenses due | Finance Interface with literal expected values | M5 |
| AC-13 | Advance receipt/spending/partial return, allocation, excess, reversal, and concurrent operations | Real PostgreSQL transactions + statement output | M5 |
| AC-14 | Every posted transaction balances; no edit/delete; documented reversal | Public Finance behavior + migration constraint verification | M5 |
| AC-15 | Correct Arabic PDF matches statement totals; CSV cannot execute formulas | Visual artifact check + integration | M6 |
| AC-16 | Import preview stops ambiguous dates and duplicates; batch retry is safe | Import Interface integration | M6 |
| AC-17 | Restore database/files/keys, detect loss/corruption, log in with MFA, revoke old sessions, and dispatch no jobs | Restore drill + checksums + counts + statements + decryption test | M7 |
| AC-18 | The lawyer completes today's agenda, hearing result, upload, payment, and printing | Observed hands-on use without continual coaching | M8 |

For financial rules and sensitive transitions, start with one failing behavioral test and implement the minimum to pass it, one behavior at a time. Do not write every test against imagined behavior and then all implementation. Relationship/transaction tests use real PostgreSQL: SQLite or mocks do not establish equivalent constraint/concurrency behavior. Avoid superficial tests for every CSS declaration or constant.

## Checks required for code submissions

After M0, expose consistent commands: `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, and `build`. Run checks appropriate to the change; CI runs the agreed set. A `NOT RUN` check prevents acceptance of the part lacking evidence, but does not invalidate independent parts actually reviewed.

For publication, follow [GIT_WORKFLOW](GIT_WORKFLOW.md). A submission identifies the exact pushed implementation SHA and its PR. A later review-only attestation commit records both inspected implementation SHA and final published HEAD, with its documentation-only diff verified. Any implementation/configuration/test changes after the inspected SHA need new review. Acceptance does not grant merge authorization; dependent tasks normally start only after accepted work is integrated into `origin/main`.

For UI changes, inspect the rendered result in a real browser at the required sizes and error states, rather than relying on source code or one screenshot. For migrations, provide readable SQL and test both an empty database and the prior schema with synthetic data. `db push` and database reset are not production migration paths. Never use real secrets in tests.

## Milestone definition of done

Required behavior works; important negative cases are covered; TypeScript and build checks are clean; audit behavior and migrations are understandable; no TODO conceals core logic. Operational documents are current and new product decisions are recorded. Codex states what it did and did not test. Production has a separate recovery-and-lawyer-pilot gate; code approval alone is insufficient.
