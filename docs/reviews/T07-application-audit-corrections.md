# Application audit corrections on T07

The owner assigned Codex to correct the 21 findings from the 22 November 2026 application audit. The work used the existing `feature/t07-search-archiving` branch for [draft PR #15](https://github.com/MohamedAlksas/LawyerOS/pull/15), based on `317a6530e5f695338398b029b34f5305e72b1bd4`. The original PR head was `5cd8b448c55ac8d5125628d32d0c42e5fe4cae14`. Implementation commit `b36283f8b12d056fee4bf1a5b64bc8482bc7a79a` and the follow-up for mobile scrolling form the review candidate.

## Acceptance coverage

| Findings | Behavior and evidence |
| --- | --- |
| A01, A03, A05 | Private screens recheck authorization on resume and after history navigation. Password rotation writes an audit event atomically, and protected routes require the relevant permission. T03 and T04 browser checks exercise revocation and logout, with integration coverage for audit rollback and read-only session checks. |
| A02, C02 | Reference activation and original archive reasons survive audit sanitization. PostgreSQL assertions cover the recorded values after reopening. |
| A04, A06, A07 | The home screen has a neutral status, directory route failures reach retry UI, and Party directory responses use a limited projection. Route and action review plus T04/T05 coverage verify the affected paths. |
| A08, A10, C04 | Pending Party, communication, reference, and lifecycle commands retain their original input and idempotency key. Synthetic lost-response and reauthentication tests verify the original request settles once. |
| A09 | Docket matches use court, number, year, type, and normalized circuit. Integration and T06 checks distinguish exact matches from advisory suggestions and verify that changes invalidate prior confirmation. |
| A11, A13 | The README reflects current workflows and runs test migrations against the guarded test database. Fresh PostgreSQL migration deployment applied all 12 migrations. |
| A12 | The mobile menu exposes its visible Arabic label. Chromium coverage checks six nonoverlapping labels at 200% text scaling and verifies that the last search control remains accessible above the fixed navigation. |
| C01, C06, C07, C08 | Private search terms and selected clients stay in session-bound memory. URL filters, page size, page clamping, and Back/Forward agree with visible data. Client picker actions return IDs and names. Unit, PostgreSQL, and T07 browser checks exercise these boundaries. |
| C03, C05 | Direct edit links for archived records lead back to read-only details. Reopen confirmations describe the actual state transition. T07 and PostgreSQL checks cover both Matters and Proceedings. |

Local verification used synthetic data on isolated PostgreSQL databases and Chromium viewport projects. It included `npm run lint`, `npm run typecheck`, `npm test` (261 tests), the 29 PostgreSQL integration suites (290 tests), the separate startup-process suite, `npm run build`, Playwright configurations T03–T07, and the planning-kit generator. Browser suites included targeted reruns for the assertions changed during review. Use the final PR head and corresponding GitHub Actions runs for hosted verification. This report does not record a merge, deployment, physical-device test, or screen-reader test.
