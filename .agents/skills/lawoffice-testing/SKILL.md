---
name: lawoffice-testing
description: Verify an assigned LawOffice OS task through meaningful Module behavior, real PostgreSQL integration, and relevant Arabic RTL browser journeys, with evidence for independent review.
---

# Task-scoped behavioral verification

Test the assigned change against the current implementation, not an imagined finished application. This skill supports implementation or review; it does not authorize unrelated features, production-data access, or acceptance of its own results.

## Select the evidence

Read the assigned ticket in [ROADMAP](../../../docs/ROADMAP.md), its requirements in [PRD](../../../docs/PRD.md), and the relevant acceptance criteria and submission format in [REVIEW_PROTOCOL](../../../docs/REVIEW_PROTOCOL.md). Load only the applicable rules from [DATA_MODEL](../../../docs/DATA_MODEL.md), [WORKFLOWS](../../../docs/WORKFLOWS.md), and, for interface changes, [SCREENS](../../../docs/SCREENS.md) and [DESIGN](../../../DESIGN.md).

Apply an AC when the assigned task owns that behavior and its dependencies exist. For example, Party search can be tested before court-instance links, and hearing transaction behavior can be tested before the worker exists. Record future-dependent checks as future work; do not falsely pass them or fail unrelated current work.

## Verify meaningful behavior

- Exercise the public Module Interface used by callers, or a real browser journey. Avoid assertions about private helper calls, implementation order, wording duplication, or every CSS constant.
- For financial rules and sensitive transitions, first demonstrate one failing behavioral test, then implement the smallest change that passes it. Work one behavior at a time.
- Use real PostgreSQL for relationships, constraints, transactions, locking, and concurrency. SQLite and mocked persistence do not establish equivalent behavior. Use isolated disposable databases and synthetic records; never reset an operational database.
- Choose positive and material negative scenarios for the change. Relevant examples include direct unauthorized requests, retries after uncertain network responses, duplicate requests, optimistic-version conflicts, rollback after a controlled failure at a suitable Seam, immutable posted entries, allocation limits, file-finalization failures, and date-only/Cairo DST behavior.
- Test monetary outcomes with independently stated expected amounts and compare statements with their underlying postings. Do not merely repeat the implementation's own calculation to establish correctness.
- For migrations, inspect readable SQL and verify both a fresh database and an upgrade from the prior schema using synthetic data. `db push` or reset is not a production migration strategy.

## Browser and artifact checks

When UI changes, inspect the actual rendered application at `390`, `768`, and `1440` widths, with keyboard use and `200%` text scaling. Verify Arabic RTL, mixed-direction identifiers, and relevant loading, empty, error, offline, and conflict states. A screenshot alone does not prove an interaction. For changed PDFs, inspect rendered Arabic, pagination, and totals against the same financial source used by the application.

## Report accurately

Run the project's appropriate available checks: `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, and `build` as required by scope. Record actual commands, exit status, observations, and evidence paths. Mark unexecuted checks `NOT RUN` with a reason. Do not weaken assertions, bypass security, or substitute mocks to conceal failure. Submit findings and limits for independent review; another model's report is not proof.
