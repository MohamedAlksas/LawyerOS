---
status: accepted-owner-decision
date: 2026-11-18
---

# Exclude office operating expenses from V1

The owner explicitly stated that rent, internet and general office operating expenses are not needed. Remove that feature from V1 rather than implementing unused screens, accounts or categories. Reintroduction requires a separately requested scope decision; it is not automatically scheduled for a later task.

Finance retains fees, matter-specific expenses paid by the lawyer and recoverable from a client, reimbursements, and client money supplied for spending. Mixed lawyer/client-advance funding, truthful statements, allocations, refunds, immutable postings, audit and concurrency protections remain required. The familiar 15,000 / 5,000 / 1,200 and advance 2,000 / spend 700 examples do not change.

Do not implement OFFICE_EXPENSE accounts or transaction kinds, OFFICE expense funding, overhead categories, rent/internet entry forms, office-expense dashboard totals or reports. Expense records in this slice have a matter and client; no automatic overhead allocation or profit calculation is introduced. Unsupported office-expense classifications must fail server validation without writes.

This is a planning-scope change before financial implementation. It removes no existing financial data and authorizes no database reset, historical-entry deletion or application deployment. T14's title/scope/checks, routing source, canonical product/schema/workflow/screen documents and generated handoff bundles are updated. T13 and T15 financial integrity requirements remain unchanged.

Installed Agency/project skills may describe a broader ledger including office expenses. This explicit owner decision and current task scope take precedence. Preserve installed assets; do not delete or rewrite them merely to remove that generic wording. No changes are needed to ongoing T06 matter/proceeding implementation.
