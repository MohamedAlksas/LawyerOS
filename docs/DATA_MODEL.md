# LawOffice OS — Data Model

Document status: implementation plan, version 1.0 dated 10 November 2026. The English names are the domain names the implementation must follow. These details support management of the father's office; they are not rules for calculating legal deadlines or a tax-accounting system.

## 1. The model's organizing principle

`Matter` is the internal work file, whether for litigation, a consultation, or a contract. `Proceeding` is a specific court registration within that file, with its own number, year, court, and instance. An appeal is a new registration linked to the earlier one, not an edit to its number. A hearing belongs to `Proceeding`; documents and finances belong to `Matter` and may also be linked to a particular registration.

A person or organization is recorded once in `Party`. Being a client or opponent is a role within a matter or proceeding, not a permanent attribute of the person. The same person may be a client in one matter and an opponent in another. Client user accounts and a client portal are outside version one.

## 2. Rules shared by all tables

- Identifiers are `UUID`. Operational records carry `createdAt`, `updatedAt`, `createdById`, `updatedById`, and an integer `version` that increases on updates. Posted financial entries and audit records are immutable rather than edited.
- Actual timestamps use `timestamptz`, stored as absolute instants and displayed in `Africa/Cairo`. Hearing days and legal deadlines use `date`; an optional `time` is separate so UTC conversion cannot shift the day. A calculated reminder instant uses `timestamptz`.
- The court year, `yearLabel`, is a short string; do not assume it is always a Gregorian year. The case number, `numberText`, is text preserving leading zeros, letters, and hyphens. Additional normalized search values do not alter the original value.
- Arabic and Western digits are normalized for search. Name search normalizes spaces and some forms of Arabic alef and ya while retaining the name as entered. Similarity produces a warning, not an automatic merge.
- Amounts are Egyptian pounds only: `amountPiastres` is a positive integer `bigint`, and `currency = EGP`. The API transmits an amount as a numeric string. Arithmetic uses `BigInt` or a precisely configured decimal type; floating point is forbidden for balances.
- Conditional updates use `id + expectedVersion`. A conflict returns `CONFLICT` and requires reloading; silently overwriting another device's changes is forbidden.
- Ordinary deletion means archiving. Accounting identifiers, posted financial records, and hearing results are not erased. Actual data removal is a separate owner action after reviewing obligations and retained backups.
- One office only: no `tenantId` or SaaS multitenancy in version one. Authorization must still distinguish people's permissions on every read and write.

## 3. Identity, matters, and parties

| Entity | Main fields | Relationships and constraints |
|---|---|---|
| `OfficeSettings` | Office name, phone, address, `timezone`, reminder settings, print header | One record; changing the time zone does not reinterpret historical dates |
| `User` and related records | Login details, user status, role, devices, sessions, and additional authentication factors | Identity and session tables belong to the selected Auth solution; do not reinvent password storage |
| `Party` | `kind: PERSON/ORGANIZATION`, name, search name, primary and optional additional phone, email, address, notes, `archivedAt` | Name required; phone optional; neither name nor phone is unique because both may be shared |
| `PartyIdentity` | `partyId`, identification type, `ciphertext`, `keyId`, `encryptionVersion`, final digits for display | Optional, with a specific read permission; a national ID is not required to register a client; the encryption key is a deployment secret outside the database and repository, with a separately encrypted recovery copy under the operations procedure; historical keys needed to decrypt retained copies must remain recoverable |
| `Matter` | `fileCode`, title, `kind: LITIGATION/CONSULTATION/CONTRACT/OTHER`, practice area, summary, `status`, opening and closing dates, `storageLocationId`, notes, `archivedAt` | `fileCode` is unique and never reused; title and matter type required; a court registration is not required to create a draft |
| `MatterParty` | `matterId`, `partyId`, `role: CLIENT/OPPONENT/OTHER`, description, `billingEnabled`, `isPrimaryContact` | Unique on `(matterId, partyId, role)`; at most one optional primary contact per matter; a financial debtor must be an active CLIENT link; changing the link does not transfer debts automatically |
| `StorageLocation` | Cabinet, shelf, box, description/code | Physical location optional; warn if an active matter has no known location |
| `Court` | Name, type, governorate, address, access directions, active/inactive | Manageable lookup; deactivation prevents new selections while preserving historical ones |
| `Proceeding` | `matterId`, `courtId`, `numberText`, `yearLabel`, `registerType`, circuit, `instance`, `parentProceedingId`, `status`, `archivedAt?` | A complete registration requires number/year/court/register type; the parent belongs to the same `Matter`; appeal cycles forbidden; archiving unavailable while a linked SCHEDULED hearing or open CONFIRMED deadline exists |
| `ProceedingParty` | `proceedingId`, `matterPartyId`, `legalCapacity`, notes | Both links belong to the same matter; legal capacity, such as plaintiff or appellant, uses text/an extensible list |
| `PowerOfAttorney` | `partyId`, authorization number, year, notarization office, type, issue date, validity/review, `documentId` | Dates and notes optional; validity is reviewed by a person, not inferred automatically |
| `MatterAuthorization` | `matterId`, `powerOfAttorneyId`, scope of use, notes | One authorization may serve multiple matters, provided its holder is linked to each matter as a client |
| `CommunicationNote` | `partyId`, `matterId?`, communication time, channel, summary, follow-up | Concise and structured; no automatic copying of calls or personal conversations |

`Matter` statuses: `DRAFT`, `ACTIVE`, `ON_HOLD`, `CLOSED`, `ARCHIVED`. `Proceeding` statuses: `DRAFT`, `ACTIVE`, `AWAITING_JUDGMENT`, `DECIDED`, `CLOSED`. A draft registration may lack a number, year, or register type; the court is required to identify where hearings take place. Activating a registration requires number/year/court/register type. A draft may have a known hearing date and must always display the UI label “الرقم غير مستكمل” (registration number incomplete); this allows a real paper-record appointment to be transferred without inventing a number. Changing either status does not close the other automatically. The composite court identity `(courtId, registerType, numberNormalized, yearLabel, circuitNormalized)` produces a duplicate warning for review, not an absolute prohibition, because registration details may be incomplete or similar.

`Matter.kind` classifies the form of work, while `practiceArea` identifies the specialty (civil/criminal/family, etc.); they are not one field with two different lists. `PracticeArea` is a small lookup: code, Arabic name, active/inactive. In V1, circuit and register type are length-limited strings with suggestions; a separate lookup table is not required for every label. Migrated records carry `verificationStatus: UNREVIEWED/VERIFIED/DISPUTED` and `verifiedById/verifiedAt` as appropriate to the imported entity. This data-verification status is separate from matter activity.

`Matter.ACTIVE` must have at least one CLIENT link; an unknown client leaves it DRAFT. Archiving `Matter` is forbidden while any child proceeding has a SCHEDULED hearing or an open CONFIRMED Deadline. Obligations must be handled explicitly before removing the matter from the agenda. Noncritical tasks and debts may remain with a recorded reason and must remain visible in their reports.

## 4. Hearings and follow-up

| Entity | Fields | Important rules |
|---|---|---|
| `Hearing` | `proceedingId`, `hearingDate`, `hearingTime?`, `timeConfirmed`, location/room, `rollNumber?` as text, hearing purpose, `status`, `supersedesHearingId?` | Status `SCHEDULED/COMPLETED/CANCELLED/RESCHEDULED`; an empty time displays the UI label “الساعة غير محددة” (time unspecified) |
| `HearingResult` | `hearingId`, court decision as entered by the lawyer, summary, attendance, notes, `nextDateDisposition: KNOWN/NONE/UNDETERMINED`, `decisionDocumentId?`, `recordedAt`, `revision`, `supersedesResultId?` | One current version per hearing; a correction is a new version with a reason, not an edit to the previous decision; KNOWN requires a linked next hearing, and the document belongs to the same matter |
| `HearingLink` | `fromHearingId`, `toHearingId`, `relation: ADJOURNED_TO/RESCHEDULED_TO` | Cross-matter links and cycles forbidden; adjourning a completed hearing creates a new hearing without changing the previous day |
| `Task` | `matterId?`, `proceedingId?`, `hearingId?`, `deadlineId?`, title, details, `dueDate?`, `dueTime?`, priority, status, `assignedUserId` | `OPEN/IN_PROGRESS/DONE/CANCELLED`; date optional; a time cannot be entered without a day; links, when present, belong to the same matter; a title is enough to create a general task |
| `TaskChecklistItem` | `taskId`, title, order, `completedAt?` | Simple optional items; they do not create independent tasks/deadlines |
| `Deadline` | `matterId`, `proceedingId?`, action description, `dueDate?`, `dueTime?`, deadline source, `sourceDocumentId?`, reason/manual-calculation notes, `status`, reviewer and review date, completion description and date | `DRAFT/CONFIRMED/COMPLETED/CANCELLED`; confirmation requires a date, source, and owner review; changing the date returns it to DRAFT; a reminder does not turn a draft into an approved deadline |
| `ReminderRule` | Event type, day offset, reminder time, channel, enabled | Proposed defaults: 7, 3, and 1 days, configurable; an appointment without a known time is not assigned a default hearing time |
| `ReminderDelivery` | `sourceType`, `sourceId`, `sourceVersion`, `ruleId`, `scheduledAt`, `channel`, `recipientUserId`, `status`, `deliveredAt?`, `readAt?`, `jobRunId?` | Unique on source, version, rule, channel, and recipient; `PENDING/PROCESSING/SENT/FAILED/CANCELLED`; SENT for in-app delivery means visible in the notification inbox, not read by the user |

`nextHearing` is read from the nearest `SCHEDULED` hearing; it is not user-editable. Overdue status is calculated in the query from the current day rather than stored where it can become stale. Two hearings on the same day are allowed and produce a conflict warning, including when one time is unknown.

## 5. Documents

| Entity | Fields | Rules |
|---|---|---|
| `Document` | `matterId` or `partyId`, `proceedingId?`, `hearingId?`, title, type, document date, description, tags, original location, `originalPresent: YES/NO/UNKNOWN`, `sensitivity: CONFIDENTIAL/RESTRICTED`, `currentVersionId`, `archivedAt` | One clear owner: a matter or a party's general document; optional hearing and proceeding belong to the same matter; if both are present their proceeding must match; default sensitivity CONFIDENTIAL; no public URL |
| `DocumentVersion` | `documentId`, `versionNumber`, `objectKey`, original filename, detected MIME, size, `sha256`, `uploadStatus`, `scanStatus`, `createdById` | Unique document/version number and unique `objectKey`; version contents immutable; `UPLOADING/QUARANTINED/READY/REJECTED/FAILED` |
| `UploadAttempt` | `uploadId`, `documentId?`, `idempotencyRecordId`, expected size, status, expiry | A retry resumes an identified attempt or explicitly starts another; an incomplete upload never appears as a ready document |

`currentVersionId` advances only after upload completion, scanning, and metadata approval. Earlier versions remain available subject to authorization. File compatibility is checked from contents, not the extension alone. The proposed starting limit is 25 MB per version with a clear message. Start with PDF, JPEG, and PNG; DOCX follows later after a safe download/scanning path. Future OCR is derived data with review and confidence, not a replacement for the original.

## 6. Finances: a limited, balanced management subledger

These finances support internal management. The meaning is agreed/collected fees, not a tax revenue declaration or statutory financial statement. A client may pay fees, reimburse an expense funded on their behalf, or provide funds for future spending; these are three different transactions.

| Entity | Fields | Rules |
|---|---|---|
| `FeeAgreement` | `matterId`, `clientMatterPartyId`, description, amount in piastres, date, charging method, agreement copy, status | One debt charge or `FeeCharge` installments; changing an agreement does not rewrite posted-entry history |
| `FeeCharge` | `feeAgreementId`, installment description, due day, amount, `receivableLineId` | Each charge links to one posted debit line; installment totals match the approved agreement |
| `Expense` | `expenseGroupId`, `matterId?`, `proceedingId?`, `clientMatterPartyId?`, description, category, day, amount, `funding: LAWYER/CLIENT_ADVANCE/OFFICE`, reimbursable, `evidenceDocumentId?`, `transactionId` | A reimbursable expense requires a matter and client; office expenses have no client; mixed funding creates two parts sharing group, transaction, and evidence, unique on `(expenseGroupId, funding)`; their sum matches the confirmed amount without duplicating the disbursement |
| `MoneyAccount` | `type`, `matterId?`, `clientMatterPartyId?`, `cashMethod?` | Types below are fixed in code; the user does not create a general chart of accounts |
| `MoneyTransaction` | `kind`, `status: DRAFT/POSTED`, transaction day, reference, description, `payerPartyId?`, `payeePartyId?`, `idempotencyRecordId`, `postedById`, `postedAt`, `reversalOfId?`, `refundOfId?`, `reason?` | Unique idempotency association; posted records immutable; one full reversal per transaction followed by a new correction; reversals and refunds retain the original reference; actual payer may differ from debtor |
| `MoneyLine` | `transactionId`, `accountId`, `side: DEBIT/CREDIT`, `amountPiastres`, `matterId?`, `clientMatterPartyId?`, `originalLineId?` | Positive amount; one currency; total debits = total credits before posting; dimensions agree with the account; a refund/reversal line references its original line and cannot exceed it after earlier refunds |
| `MoneyAllocation` | `settlementLineId`, `receivableLineId`, `amountPiastres`, `action: APPLY/RELEASE`, `releasesAllocationId?`, `adjustmentTransactionId?` | Links settlement to a specific debt with the same account type, client, and matter; release references the same allocation and refund/reversal transaction; net allocation cannot exceed either debt or settlement and cannot fall below zero |
| `AdvanceApplication` | `advanceSourceCreditLineId`, `advanceDebitLineId`, `targetLineId`, amount, `reversalOfId?` | Tracks which advance receipt was used; the target is a cash-disbursement or fee-settlement line for the same client and matter; total use and refunds cannot exceed their source; fees are never deducted from advances automatically |
| `Receipt` | `transactionId`, unique sequential number, year, payment source, payer, issue time, immutable header details | Management collection receipt, not described as a tax invoice; cancellation/refund appears through a linked receipt, not deletion of the original |

`MoneyAccount` types: `CASH_CLEARING` for cash/transfers, `FEE_RECEIVABLE` for fee debt, `FEE_BASIS` as the counterpart for recording the management agreement, `EXPENSE_RECEIVABLE` for expenses recoverable from the client, `CLIENT_ADVANCE` for funds supplied for a particular client and matter, `OFFICE_EXPENSE` for nonrecoverable office expenses, and `OPENING_BRIDGE` as the counterpart for opening balances. `CLIENT_ADVANCE` is a liability; its available balance = credits − debits.

`MoneyTransaction.kind` values: `FEE_CHARGE`, `FEE_PAYMENT`, `REIMBURSABLE_EXPENSE`, `EXPENSE_REIMBURSEMENT`, `ADVANCE_RECEIPT`, `ADVANCE_SPEND`, `ADVANCE_TO_FEE`, `OFFICE_EXPENSE`, `MIXED_RECEIPT`, `REFUND`, `REVERSAL`, `OPENING_BALANCE`, `FEE_ADJUSTMENT`. Each kind accepts a defined account combination, not arbitrary journal entries from the UI. Record `REFUND` with its original type and reference so reports distinguish fee refunds from advance refunds.

When someone pays for two clients, `payerPartyId` identifies the payer, while each debt/advance line retains its owner and matter. The receipt displays an immutable allocation. Example: a 3,000 payment includes 2,000 toward client A's fees in matter S and 1,000 toward client B's advance in matter T: debit cash 300,000 piastres, credit A's fees 200,000, and credit B's advance 100,000. Do not split automatically equally, and do not reduce B's debt because A paid. The default UI starts with one client; another allocation is added deliberately.

There is no editable `balance` column on a client or matter. Summaries derive from posted entries and their allocations. Spending or refunding an advance cannot create a negative balance; check and lock within the same transaction. An overpayment prompts a choice: change the amount or explicitly classify the excess as an advance. Hiding it as a negative fee balance is forbidden.

### Example that must produce identical results across all screens

| Transaction | Debit | Credit | Result |
|---|---|---|---|
| Fee agreement of 15,000 EGP | `FEE_RECEIVABLE` 1,500,000 piastres | `FEE_BASIS` 1,500,000 | Fees due 15,000 |
| Collect 5,000 in fees | `CASH_CLEARING` 500,000 | `FEE_RECEIVABLE` 500,000, allocated to the agreement | Remaining fees 10,000 |
| Lawyer funds a reimbursable expense of 1,200 | `EXPENSE_RECEIVABLE` 120,000 | `CASH_CLEARING` 120,000 | Expenses due 1,200, separate from fees |
| Client reimburses the 1,200 | `CASH_CLEARING` 120,000 | `EXPENSE_RECEIVABLE` 120,000 | Expenses due zero; fees still 10,000 |
| Receive 2,000 for later spending | `CASH_CLEARING` 200,000 | `CLIENT_ADVANCE` 200,000 | Advance available 2,000; no fee collection |
| Spend 700 from the advance | `CLIENT_ADVANCE` 70,000 | `CASH_CLEARING` 70,000 | Advance 1,300; no new expense debt |

`CASH_CLEARING` reflects only transactions entered in this system; it is not claimed to be the actual bank balance. Opening balances are not recorded as new collections. An accounting reversal reproduces the original lines with opposite sides. An actual refund is a separate transaction that may reopen debt or return an advance according to its type; it does not cancel the original obligation automatically.

**Preventing duplicate cash movements:** `REVERSAL` corrects an incorrect record, such as a payment recorded twice or one that never occurred. It does not instruct a physical disbursement. If money was actually received and then returned to the client, use `REFUND` once, not `REVERSAL` of the original followed by `REFUND` for the same amount. The counterpart cash line in reversing a fictitious entry removes only its ledger effect. An existing refund, advance usage, or subsequent allocation blocks reversal until its consequences are handled through an explicit path. Version one rejects a complex case rather than generating an automatic correction. Reclassifying an amount already received is a noncash adjustment and requires Codex review of the entry format in T15.

Approved formulas per client/matter: remaining fees = debits to `FEE_RECEIVABLE` − its credits; expenses due = debits to `EXPENSE_RECEIVABLE` − its credits; advance available = credits to `CLIENT_ADVANCE` − its debits. The cash-fee-collection report sums cash collection items allocated to fees and subtracts their refunds, showing fees settled from advances separately. Agreement reductions, opening balances, and expense reimbursements are not new collections. The charge statement uses net allocations for each line, and its total reconciles with the debt account.

## 7. Audit, import, and export

| Entity | Fields and rules |
|---|---|
| `AuditEvent` | User, time, action, entity type/identifier, redacted changed fields, reason, `requestId`; append-only from the application, with no document contents, secrets, or full national ID |
| `IdempotencyRecord` | `actorId`, `commandType`, `key`, `payloadHash`, `status: IN_PROGRESS/COMPLETED`, `resultType/resultId`, creation and completion time; unique on actor, command type, and key; the same key with a different hash is rejected; the stored result is a redacted reference without secrets |
| `ImportBatch` | `sourceNamespace`, source type, filename, hash, status `DRAFT/VALIDATED/COMMITTED/PARTIALLY_COMMITTED/FAILED`, statistics, owner, time; no posting before preview |
| `ImportRow` | Batch, row number, `sourceRowId`, `entityType`, staging data, errors, warnings, `status: PENDING/INVALID/COMMITTED/SKIPPED`, link result; unique on batch, entity type, and source key |
| `ImportSourceLink` | `sourceNamespace`, `entityType`, `sourceRowId`, `targetId`; unique on the first three across all batches; reimporting the source returns the same record; updates require a separate diff path rather than overwrite |
| `ExportJob` | Scope, type, requester, status, file expiry, storage key; export file private and temporary; requests and downloads audited |
| `JobRun` | `type`, `sourceType/sourceId/sourceVersion`, `deduplicationKey`, `payloadVersion`, Schema-validated `payload`, `status: PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED`, `attemptCount`, `maxAttempts`, `availableAt`, `nextAttemptAt`, `leaseUntil`, `lockedBy`, completion time, redacted error; deduplication key unique; atomic claiming and lease expiry allow retries |
| `BackupRun` | `backupId`, status, start/completion time, application and migration version, `dumpObjectKey`, `manifestObjectKey`, counts, size and checksums, external snapshot reference, latest check/restore, redacted error; no decryption keys stored |
| `BackupFilePin` | `backupId`, `documentVersionId`; unique pair; prevents deletion of a file version required by an in-progress backup; released after successful copying or documented safe cancellation |

In V1, `JobRun` is the durable outbox and queue row itself, not a temporary attempt log added after a transaction succeeds. A separate event-bus table is not required. Create it within the sensitive command's transaction; the worker handles its side effect after Commit. `ReminderDelivery` represents the visible notification and its link to this job; do not record SENT before it is available. Attempt details go to redacted logs, avoiding an unnecessary table per attempt. Payloads contain no document bytes or secrets.

Create `IdempotencyRecord`, the command result, and the domain change in the same transaction. Failure rolls them all back; concurrent requests use uniqueness/locking rather than creating two results. Multistep file uploads retain an upload-attempt identifier and check state at every step. Key retention must cover the period in which a request can be retried. Financial and import keys remain linked to their records and are not deleted by generic cleanup.

Retention, cleanup, key, and export durations follow [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md). Procedures for retaining and recovering historical encryption keys are in [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md).

## 8. Indexes, constraints, and tests that must not be guessed

1. Index `Matter(fileCode)` and `status/updatedAt`, normalized party names and phone, registration number/year/court, `Hearing(status, hearingDate)`, `Task(status, dueDate)`, and `Deadline(status, dueDate)`.
2. Index `Document(matterId, createdAt)`, `MoneyLine(accountId, transactionId)`, `MoneyAllocation(receivableLineId)`, `AuditEvent(entityType, entityId, createdAt)`, and `ReminderDelivery(status, scheduledAt)`. Use pagination rather than loading the entire office into memory.
3. Foreign keys prevent broken references. Validate matching `matterId` across hearing, document, proceeding, and party inside a transaction, with composite constraints where appropriate; knowing a UUID is not sufficient authorization.
4. Composite operations `openMatter`, `recordHearingResult`, `rescheduleHearing`, `postTransaction`, `reverseTransaction`, and `commitImport` each expose one Module interface through which their rules are tested, following the Interface names in [ARCHITECTURE.md](ARCHITECTURE.md).
5. `recordHearingResult` commits the result, next hearing, tasks, and outbox generation together or rolls them all back. Recording the same result with the same retry key does not duplicate the hearing.
6. Prevent over-allocation and overspending with transaction locking/isolation and bounded retries on conflicts; UI validation alone is insufficient.
7. Posted finances are not editable through the UI, even by the owner. Reversing a charge with settlements is blocked until allocations are released or settlements reversed first; no silent debt release.
8. Test Cairo clock changes, Arabic/Western digits, duplicate registration numbers in two courts, multiple clients and proceedings, interrupted uploads, concurrent collections, partial refunds, and an archived matter with an open obligation.
