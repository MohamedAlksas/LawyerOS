---
name: lawoffice-finance
description: Implements LawOffice OS fees, expenses, advances, allocations, reversals, refunds, and statements. Use for financial commands and reporting, excluding tax-compliance advice.
---

# LawOffice financial subledger

Read finance in [DATA_MODEL](../../../docs/DATA_MODEL.md), workflows 8–10 and 14 in [WORKFLOWS](../../../docs/WORKFLOWS.md), and S11 in [SCREENS](../../../docs/SCREENS.md). Keep the limited administrative ledger; do not invent a general accounting system.

- EGP only. Store positive line amounts as `bigint` piastres; transport exact values as strings. No floating-point calculations or UI-writable balance columns.
- Posted transactions balance and remain immutable. Restrict account combinations per command. Statements, reports, and receipts share the financial Interface.
- Separate fee receivables, reimbursable expenses, client-advance liabilities, office expenses, and cash clearing. Advance receipts and reimbursement are not fee collections. Clearing reflects recorded movements, not a verified bank balance.
- Actual payer differs from debtor/allocation owner. Validate allocations by client, matter, account type, remaining payment, and receivable capacity. Lock/check/post/allocate/audit/receipt-number in one transaction.
- Use actor + command + idempotency key + payload hash; reject mismatched reuse. Database transaction checks prevent over-allocation and negative advances under concurrency.
- `REVERSAL` corrects an erroneous recording; `REFUND` records actual money leaving. Do not reverse and refund the same amount as two cash effects. Reject complex dependent reversals until consequences are explicitly handled.
- Partial refunds respect the remaining refundable amount, preserve links, release allocations, and reopen debt or reduce advances according to classification. Fee adjustments are separate from cash movement.
- Advance-funded expenses reduce the liability without creating another receivable. Mixed funding uses grouped expense records in one command, not duplicate disbursements. No implicit advance-to-fee transfer.
- Opening balances are not new collections. Reprinting retains receipt numbers; never reuse numbers or erase history.

Implement only the task's current slice and reject unsupported classifications explicitly. Complete example: fees 15,000; collection 5,000; lawyer-funded expense 1,200; reimbursement 1,200; advance 2,000; spend 700. Expected fees due 10,000, expenses due 0, advance available 1,300. Test stages and concurrency with real PostgreSQL and independent expected values. Do not claim tax compliance or legal revenue recognition.
