# LawOffice OS — Workflows

Document status: implementation plan, version 1.0 dated 10 November 2026. Terminology and references match the [data model](DATA_MODEL.md). Every workflow defines its expected outcome and failure path. Do not display the success message “تم” until the server confirms persistence.

## 1. Open a matter and link it to paper records

1. The father selects the UI action “ملف جديد” (new matter) and enters a title and practice area. He selects an existing client or registers a party by name; phone and national ID are optional.
2. Before creating a new party, the system shows similar names/numbers. The decision remains human; there is no automatic merge.
3. Generate a unique internal code such as `LO-2026-0001`. This is the office's code, not the court case number.
4. Select the physical file location. An incomplete record can be saved as a draft; activation requires at least one client. A written reason does not bypass this requirement. If the client is unknown, the matter remains `DRAFT`.
5. If litigation exists, add `Proceeding`: court, register type, number, year, circuit, and instance. Opponents and parties' legal capacities belong to the proceeding.
6. Printing a code label is possible. Adding a QR code is optional and deferred to `P1`, outside the MVP acceptance requirement. When implemented, the QR code contains a random-identifier link to a page requiring login, with no client name, access entitlement, or permanent token.

**Success:** one page shows the matter, clients, proceedings, and physical location. **Failure:** repeating the save with the same `idempotencyKey` returns the same matter. Incomplete registration details allow a draft labeled “بيانات غير مكتملة” (incomplete data); the system does not invent a number or court.

## 2. Add an appeal or related proceeding

From the matter, select the UI action “إضافة قيد مرتبط” (add a related proceeding), then select the previous proceeding. Parties are copied for selection and review, not as confirmed facts. Enter the new number, court, year, and legal capacities. The earlier proceeding retains its hearings, judgments, and numbers. Documents or debts are not transferred automatically; general documents remain accessible from the matter with proceeding filters.

**Error prevention:** the parent must belong to the same matter, and cyclic links are forbidden. Changing the first-instance number to the appeal number is not a substitute for this workflow. An accidentally duplicated proceeding is archived after transferring its links under owner review and an audit trail.

## 3. Daily agenda before court

- The home screen starts with the UI section “النهارده” (today), followed by overdue work and upcoming hearings, rather than only general metrics. Show the hearing, client, court, registration number, required preparation, and physical file location.
- The UI action “قائمة تجهيز الجلسة” (hearing preparation checklist) shows designated tasks and documents. Opening a matter or downloading a document does not imply task completion.
- Print the daily/weekly agenda in Arabic on A4 with a clear generation timestamp. A hearing without a time displays “الساعة غير محددة” (time unspecified). Conflicts involving two courts produce a warning.
- If connectivity fails, show the offline state. Version one does not confirm local persistence or deferred financial synchronization. The printed daily agenda is a practical fallback until connectivity returns, followed by entering and reviewing changes.

## 4. Record a hearing result and an adjournment

From the hearing, select the UI action “تسجيل النتيجة” (record result). The form displays its date and proceeding as read-only, followed by the court decision, summary, attendance, and options to add a next hearing, tasks, or a draft legal deadline.

**One atomic transaction:**

1. Check authentication, authorization, `expectedVersion`, and that the hearing remains scheduled.
2. Create `HearingResult` and mark the hearing `COMPLETED`.
3. If the lawyer selects a new date, create a new `Hearing` and an `ADJOURNED_TO` link; do not change the completed hearing's date.
4. Create only the tasks actually selected. Any legal deadline starts as `DRAFT` until explicitly reviewed.
5. Write the audit record, cancel obsolete reminders, create new outbox items, and commit.

If a step fails, roll back the entire save. While the form remains open, the UI retains its inputs in memory and offers retry. If connectivity is lost after commit, repeating the same key returns the saved result without duplicate hearings or tasks. A second device attempting to record a conflicting result is shown the persisted version for review.

**Correction:** correct a completed result through the UI action “تصحيح نتيجة” (correct result), requiring a reason and creating a new version. The subsequent date does not change implicitly. If a next hearing exists, show it for review and let the lawyer choose whether to reschedule it. The previous court-decision text remains in version history.

## 5. Reschedule a hearing before it takes place

Select the UI action “تغيير موعد” (change date), then enter the reason, new day, and time if known. The old hearing becomes `RESCHEDULED`, the new one becomes `SCHEDULED`, and their link and reminders are updated in one transaction. Linked tasks display their current dates and proposed replacements; the user selects what moves. Confirmed legal deadlines never move automatically.

A hearing cancelled without a replacement becomes `CANCELLED` with a reason and leaves the upcoming-hearing list. A hearing that took place and was adjourned uses the result-recording workflow, not rescheduling. Multiple upcoming hearings are allowed, with the nearest clearly identified.

## 6. Legal deadline or follow-up task

**Task:** title, optional due day, priority, and links; it can be completed directly. **Legal deadline:** action description, date entered/reviewed by the lawyer, source, basis notes, then the explicit UI confirmation “راجعت الموعد واعتمدته” (I reviewed and approved the deadline). The system does not calculate appeal deadlines from general rules, nor extract a date through OCR and approve it automatically.

A `DRAFT` deadline appears under the UI section “مواعيد تحتاج مراجعة” (deadlines requiring review). Confirmed deadlines produce reminders before their dates and remain marked overdue afterward if open. Acknowledging a reminder is not completing the legal action. Completion requires an execution date and optional note/document. Changing a confirmed deadline records a reason, returns it to `DRAFT`, and cancels old reminders until reapproval; the previous confirmation does not survive a date change.

The reminder worker initially polls the outbox every minute, using a temporary `lease` and progressive retries. Technical retries do not create two notifications for the same event. A terminal failure appears on the system-health page. Required tested behavior: a successfully generated and saved notification appears when the application opens, together with last-update time and worker status. This is not a guarantee during outages or faults. Push or external email delivery is a later phase and requires testing on a real device. There is no promise of a mobile notification while the device is disconnected.

## 7. Upload a document from mobile or desktop

1. Open the matter → UI action “إضافة مستند” (add document); select an image/PDF, title, type, and optional proceeding. Show filename, size, and case before sending.
2. The server issues an upload attempt with limited duration and permission into quarantine, using a random storage name. The UI displays upload progress.
3. After transmission, the server verifies size, content signature, MIME and hash in quarantine. The document displays “جاري التحقق من الملف” (validating file) and cannot yet be downloaded as approved. Under initial ADR 0003 no antivirus service runs.
4. Successful policy validation and atomic finalization activate the version as `READY` and update `currentVersionId`; record `scanStatus = NOT_SCANNED_POLICY` and policy/version, with file detail “لم يُفحص ضد الفيروسات”. Never fabricate a CLEAN result. Failure leaves the document unavailable with a safe reason and reupload option. If scanning is enabled later, its successful result is additionally required and failures remain fail-closed.
5. Download requires a current server-side authorization check, or a short-lived private link issued after that check. Copying the link does not grant permanent access. Preview uses a safe sandbox, or download uses `Content-Disposition` according to file type.

An interrupted upload must not produce an empty document page labeled successful. Cleanup removes expired, unlinked upload attempts after a grace period. Uploading a new version does not replace old bytes. The original filename is for display only. A duplicate hash produces a warning while allowing an intentional copy. The paper original's location is recorded separately from the image's existence.

## 8. Fee agreement and collection

1. From the matter → UI section “الحسابات” (finances) → “اتفاق أتعاب” (fee agreement), select the responsible client, amount, description, and charging method. With multiple clients, do not assume joint liability or split debt automatically; identify the owner of each charge.
2. Saving a draft does not change a balance. Approving the agreement posts a balanced charge or installments as specified in the data model.
3. The UI action “تسجيل دفعة” (record payment) requests payer, date, payment method, amount, and purpose: fees/expenses/funds for spending. One payment may cover multiple items through explicit allocations totaling the amount paid.
4. The confirmation screen may display the UI example “أتعاب 5,000 — باقي الأتعاب بعد العملية 10,000” (showing the fee payment and remaining fees after the transaction). Posting locks the relevant charges, validates amounts, and records entries, allocations, and receipt number in one transaction.
5. Print an Arabic receipt with the matter, payer, allocation, and issue time. Reprinting uses the same number and does not create another payment.

**Common failure:** double-clicking the UI action “حفظ” (save), or repeating a request after a timeout, returns the same transaction under the same key. Two concurrent payments exceeding the debt are forbidden; the second reloads the balance. An amount above the debt requires explicit consent to allocate the excess as an advance, or a reduced amount.

The payer does not have to be the debtor. If someone pays for two clients, allocate each part to its client, matter, and item type, displaying the breakdown in confirmation and the receipt. Selecting a payer alone does not transfer the clients' debts to that person or combine their balances into one account.

## 9. Matter expense and client advance

For the UI action “تسجيل مصروف” (record expense), choose the funding source before posting:

- **Lawyer-funded and recoverable from the client:** an expense linked to a matter and client opens `EXPENSE_RECEIVABLE`. Client reimbursement settles the expense without increasing fee collections.
- **Spending funds supplied by the client:** sufficient advance funds must exist for the same client and matter. Spending reduces `CLIENT_ADVANCE` without creating new expense debt. If the advance is insufficient, explicitly split the expense into an advance-funded part and a lawyer-funded part, or cancel until funding is selected. Implementation records two `Expense` parts sharing one `expenseGroupId` and evidence within one command and transaction. Their total equals the amount on screen, without introducing a general allocation table.
- **V1 scope:** office operating expenses such as rent, internet, utilities and supplies are excluded by ADR 0004. Do not offer them as a transaction choice or automatically allocate them to matters.

Receiving 2,000 for expenses and then spending 700 must show: advance 1,300, expense incurred 700, and zero fee collection from these two transactions. Moving part of an advance to fees is a separate action with explanation and internal approval, not a button that hides the movement inside a balance.

## 10. Reversal, refund, and financial correction

Posted finances are not edited. The UI action “عكس تسجيل خاطئ” (reverse an incorrect record) shows the transaction and expected result, requires a reason, and reverses the full transaction without a partial-amount field. It creates opposing lines and releases allocations while retaining the original. This is a ledger correction of a wrong or duplicate record, not instructions for a cash refund. Reversing debt with settlements is blocked until those settlements are handled, preventing incorrect debtor/creditor balances.

The UI action “رد مبلغ فعلي” (refund money actually paid) is different: refunding an advance reduces both advance liability and cash; refunding fees reopens the corresponding debt if the agreement has not been cancelled. If the agreement is reduced together with the refund, record the charge reduction/reversal as well, under a separate reference. A partial refund cannot exceed the refundable portion after previous refunds. Reversing a full payment after a partial refund requires a correction plan that accounts for that refund.

Double-deduction prevention example: receive 5,000 in fees, then refund 1,000 = a 5,000 receipt and a 1,000 `REFUND`. Net cash is 4,000, and debt increases again by 1,000. Do not reverse the 5,000 and add another refund, or create a second refund entry when printing a receipt. If a 5,000 payment was recorded twice but actually received once, reverse only the duplicate record without disbursing money. Misclassifying money actually received between fees and advance is corrected through a noncash reclassification adjustment using an entry format approved in the financial task.

Every correction appears in the statement with its date and references. The matter summary shows three separate amounts: remaining fees, matter expenses due, and available advance. The father's UI presents transaction meanings rather than debit/credit account names. No office operating-expense total is included in V1.

## 11. Close and archive a matter

The UI action “إغلاق” (close) displays scheduled hearings, tasks, open confirmed deadlines, pending documents, debts, and advances. Nothing is deleted or cancelled automatically. Work can be closed with an outstanding financial receivable if a reason is recorded; it remains in the receivables report. A remaining advance requires settlement or confirmation that it is still owed to the client; it does not become revenue.

Archiving removes a matter from daily lists, makes it read-only by default, and keeps it searchable and exportable. A `SCHEDULED` hearing or an open `CONFIRMED` legal deadline blocks archiving the matter or proceeding until each item is handled explicitly: record a hearing result/cancellation/rescheduling, or complete/cancel the deadline with the correct reason. If rescheduling remains inside the same matter, it stays active. Archiving must not hide an upcoming appointment. Noncritical tasks and debts may remain with a reason and must remain visible in their reports. Reopening records the reason and restores transactions without altering earlier history.

## 12. Move from paper and import data

Priority: matters with imminent hearings, then the remaining active matters, then an index of closed matters. For each paper file record its code, name, clients, proceeding numbers, nearest hearing, physical location, and essential documents. Unconfirmed information receives the UI marker “تحتاج مراجعة” (needs review) instead of guessed values.

CSV import starts with a trial batch: preview columns; check dates, names, and numbers; detect duplicates; and link parties. Do not write the entire batch before showing errors. Commit uses stable source keys and can retry without duplication. Large batches are divided into small atomic units with a success/failure report for every row; do not claim all-or-nothing behavior across large files.

After the father's review, historical amounts become opening balances at the cutover date: remaining fees, reimbursable expenses, and advances separately. Do not enter old money as today's collection or recreate undocumented payment history. Continue comparing with the paper register during the trial. The system becomes the appointment reference only after matching active matters and imminent hearings one by one.

## 13. Export a matter and statement

The lawyer selects the matter and scope: summary, hearings, finances, or documents. Preview shows the contents. Execution gathers data from the same logical read point as far as possible. The private output expires after a short period, and downloads are audited. CSV values are processed to prevent spreadsheet applications from treating them as formulas.

ZIP export preserves understandable display names, stable identifiers, and a version manifest with hashes. Output contains no storage keys or secrets. Export is not a backup: system recovery needs the database, documents, and operating configuration with the correct keys.

## 14. End-to-end acceptance scenario

Without step-by-step help, the father adds a client and paper matter; records first-instance and linked appeal proceedings; adds a hearing without a time, a result, an adjournment, and a task; uploads a document from mobile; approves a manually entered deadline; records an agreement of 15,000, collection of 5,000, and a lawyer-funded expense of 1,200 followed by reimbursement; records an advance of 2,000 and spending of 700; and prints the weekly agenda and statement. Expected: fees due 10,000, reimbursable expenses due zero, available advance 1,300, and every action in its correct place with its audit record.

Repeat parts of the scenario with intermittent connectivity, duplicate saves, two devices, a rejected file, and a changed appointment. Passing the happy path alone does not satisfy milestone acceptance.
