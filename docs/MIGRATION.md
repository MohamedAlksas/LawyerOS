# Paper Migration and Pilot Operation

## Migration order

1. Start with five files that have hearings within the next two weeks. Give each a clear code and a location label, and review its data against the paper records with your father.
2. Migrate the remaining hearings occurring within 30 days, then the remaining active files in small batches he can review.
3. Closed files initially enter a concise index: client, subject, case numbers, an explicitly marked approximate date, and paper location. Perform full scanning on request or in later batches.
4. Keep paper records and originals. Never discard a document solely because an image exists. Your father determines any retention or destruction policy according to his obligations.

## Source file and entry template

For each row, capture `source_row_id`, `paper_file_code`, file title, client name, contact information if available, work type, court/number/year if known, next hearing date in `YYYY-MM-DD` format, optional time, paper location, review status, reviewer, and review date. Files involving multiple parties or proceedings use separate relationship templates instead of ambiguous lists within one cell.

Add related CSV files as needed: `parties.csv`, `matters.csv`, `matter_parties.csv`, `proceedings.csv`, and `hearings.csv`, using stable source keys. The V1 importer begins with the limited template in T17; extending it to linked batches requires review before implementation. Enter opening financial figures through a dedicated financial workflow, not a balance column that directly changes the balance.

Missing data remains missing with a reason. Do not invent case numbers or dates to complete a form. Similar personal names require review and never trigger an automatic merge. Preview every transformation, especially dates and numbers, before Commit.

## Batch steps

Upload source data → validate formats, relationships, and duplicates → Preview errors and transformations → make an explicit choice between accepting valid rows with a report and correcting the entire batch → Commit using a stable batch key → reconcile row counts and references → obtain human approval of upcoming dates.

Reusing `source_row_id` within the same source type does not create a second copy. Updating existing data is a separate workflow that displays the differences; re-importing is not permission to overwrite. A batch may be canceled under the rules before subsequent work is linked to it. Once new hearings, money movements, or documents exist, use documented corrections rather than Cascade delete.

## Document-scanning priorities

Prioritize the power of attorney and necessary information, the latest decision or judgment, documents required for the next hearing, and current memoranda. Review page order, legibility, image orientation, and completeness before marking a scan as reviewed. Use a practical title such as “First-instance judgment — 2026-10-20” instead of an unclear camera filename. Mark the upload as a copy; the paper original's location and status remain separate.

## Opening balances

Your father reviews, for every client: agreed fees, amounts collected, expenses due, remaining client money held for spending, and any payments whose classification is unresolved. Record a fixed cutover date and source references, and enter balanced opening transactions reflecting the current position. Do not reconstruct an unknown historical collection record.

If the fee and collection history is complete and evidenced, it may be entered as historical transactions instead of an opening balance, but never combine both methods for the same balance. Mark disputed balances as needing review; do not show them as confirmed amounts without distinction. After approval, make corrections through documented adjustments.

## Parallel-running period

Use an initial trial period of 7–14 days, extending it if needed according to the actual number of hearings. The paper hearing diary is the reference for daily reconciliation during migration; compare the system with it each morning and after recording results. Do not maintain two independent financial records after the cutover date. Enter any temporary paper note and mark it as transferred.

Do not rely solely on the digital agenda merely because import is complete. Before adopting it, reconcile 100% of dates within the next thirty days, review a sample of the remaining files, and record who reviewed them and when. Keep a printed list of upcoming hearings as an outage fallback, showing its issue date and time.

## Training your father — short sessions

- Session 1: Open the agenda, search, and find the paper file's location.
- Session 2: Record a result, an adjournment, and a task; correct an error.
- Session 3: Photograph, upload, and review a document; distinguish a copy from an original.
- Session 4: Record fees, an expense, and money held for spending; print a statement showing the differences.
- Session 5: Handle internet loss, an uncertain save, account recovery, and who to contact during a failure.

Use synthetic data or cases he personally reviews for every training session. Success means he performs the actions himself, rather than merely watching an explanation.

## Launch gate

No production data before MFA, download protection, and successful backup/restore. No adoption of the digital schedule before reconciling upcoming dates, and no adoption of the financial figures before reviewing balances. At the end of the pilot, record the number of migrated files, missing information, the latest recovery test, open issues, and the people responsible for updates, backups, and daily review.

If the trial fails, preserve a data snapshot, export upcoming dates and the latest transactions, stop digital writes at a known point, and temporarily continue using the paper reference. On returning, enter subsequent activity once after reconciliation. Never reset the database or automatically merge two databases that have been modified independently.
